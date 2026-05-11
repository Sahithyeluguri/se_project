import os
import sys
import json
import time
import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
from transformers import DistilBertTokenizer, DistilBertModel
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.utils.class_weight import compute_class_weight

logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

PRIORITY_LABELS = ["high", "medium", "low"]
TYPE_LABELS     = ["Incident", "Request", "Problem", "Change"]
QUEUE_LABELS    = [
    "Technical Support", "Product Support", "Customer Service",
    "IT Support", "Billing and Payments", "Returns and Exchanges",
    "Service Outages and Maintenance", "Sales and Pre-Sales",
    "General Inquiry", "Human Resources",
]

PRIORITY_URGENCY = {"high": 3, "medium": 2, "low": 1}


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------

def progress_bar(current, total, bar_len=35):
    filled = int(bar_len * current / total)
    bar    = "#" * filled + "-" * (bar_len - filled)
    pct    = current / total * 100
    return f"[{bar}] {pct:5.1f}%  {current}/{total}"


def print_epoch_header(epoch, total_epochs):
    print()
    print("=" * 65)
    print(f"  EPOCH {epoch} / {total_epochs}")
    print("=" * 65)


def print_batch_progress(batch_idx, total_batches, loss, elapsed):
    bar  = progress_bar(batch_idx, total_batches)
    rate = batch_idx / elapsed if elapsed > 0 else 0
    eta  = (total_batches - batch_idx) / rate if rate > 0 else 0
    sys.stdout.write(
        f"\r  Train  {bar}  loss={loss:.4f}  "
        f"{rate:.1f} batch/s  ETA {eta:.0f}s   "
    )
    sys.stdout.flush()


def print_val_progress(batch_idx, total_batches):
    bar = progress_bar(batch_idx, total_batches)
    sys.stdout.write(f"\r  Val    {bar}   ")
    sys.stdout.flush()


def print_epoch_summary(epoch, total_epochs, train_loss, p_acc, t_acc, q_acc, elapsed):
    print(f"\n\n  +---------------------------------------------+")
    print(f"  |  Epoch {epoch}/{total_epochs} Summary                        |")
    print(f"  +---------------------------------------------+")
    print(f"  |  Train Loss   : {train_loss:.4f}                        |")
    print(f"  |  Val Accuracy :                               |")
    print(f"  |    Priority   : {p_acc*100:5.2f}%                        |")
    print(f"  |    Type       : {t_acc*100:5.2f}%                        |")
    print(f"  |    Queue      : {q_acc*100:5.2f}%                        |")
    print(f"  |  Time         : {elapsed:.1f}s                          |")
    print(f"  +---------------------------------------------+")


def print_per_class_accuracy(label_list, correct_per_class, total_per_class, heading):
    """Print per-class accuracy table to surface minority class failures."""
    print(f"\n  {heading}")
    print(f"  {'Class':<40} {'Correct':>8} {'Total':>8} {'Acc':>8}")
    print(f"  {'-'*40} {'-'*8} {'-'*8} {'-'*8}")
    for i, lbl in enumerate(label_list):
        tot = total_per_class[i]
        cor = correct_per_class[i]
        acc = (cor / tot * 100) if tot > 0 else 0.0
        print(f"  {lbl:<40} {cor:>8} {tot:>8} {acc:>7.2f}%")


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

class TicketClassifier(nn.Module):
    """
    Architecture that matches the trained .pt file:
      - Mean pooling over all tokens (improvement over [CLS]-only)
      - Single linear classification heads (matches saved weights)
    To use the deeper MLP heads, retrain with the v2 trainer.
    """
    def __init__(self, model_name="distilbert-base-uncased"):
        super().__init__()
        self.bert   = DistilBertModel.from_pretrained(model_name)
        hidden      = self.bert.config.hidden_size   # 768

        self.dropout       = nn.Dropout(0.3)
        self.head_priority = nn.Linear(hidden, len(PRIORITY_LABELS))
        self.head_type     = nn.Linear(hidden, len(TYPE_LABELS))
        self.head_queue    = nn.Linear(hidden, len(QUEUE_LABELS))

    def _mean_pool(self, last_hidden_state, attention_mask):
        mask   = attention_mask.unsqueeze(-1).float()
        summed = (last_hidden_state * mask).sum(dim=1)
        counts = mask.sum(dim=1).clamp(min=1e-9)
        return summed / counts

    def forward(self, input_ids, attention_mask):
        out    = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        pooled = self._mean_pool(out.last_hidden_state, attention_mask)
        pooled = self.dropout(pooled)
        return {
            "priority": self.head_priority(pooled),
            "type":     self.head_type(pooled),
            "queue":    self.head_queue(pooled),
        }

    def get_embedding(self, input_ids, attention_mask):
        with torch.no_grad():
            out = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        return self._mean_pool(out.last_hidden_state, attention_mask)


# ---------------------------------------------------------------------------
# Trainer
# ---------------------------------------------------------------------------

class TicketModelTrainer:
    def __init__(self, model_name="distilbert-base-uncased", device="cpu"):
        self.device    = torch.device(device)
        self.tokenizer = DistilBertTokenizer.from_pretrained(model_name)
        self.model     = TicketClassifier(model_name).to(self.device)

    def load_data(self, csv_paths):
        import pandas as pd

        print("\nLoading datasets...")
        frames = []
        for p in csv_paths:
            df = pd.read_csv(p)
            df = df[["subject", "body", "priority", "type", "queue"]].dropna(
                subset=["subject", "priority", "type", "queue"])
            frames.append(df)
            print(f"   [OK] {os.path.basename(p)}  ->  {len(df):,} rows")

        self.df = pd.concat(frames, ignore_index=True)
        self.df["text"] = self.df["subject"].fillna("") + " " + self.df["body"].fillna("")

        self.df["priority_id"] = self.df["priority"].map({l: i for i, l in enumerate(PRIORITY_LABELS)})
        self.df["type_id"]     = self.df["type"].map({l: i for i, l in enumerate(TYPE_LABELS)})
        self.df["queue_id"]    = self.df["queue"].map({l: i for i, l in enumerate(QUEUE_LABELS)})

        self.df.dropna(subset=["priority_id", "type_id", "queue_id"], inplace=True)
        print(f"\n   Total rows after cleaning : {len(self.df):,}")

        print("\n   Priority distribution:")
        for lbl, cnt in self.df["priority"].value_counts().items():
            print(f"     {lbl:<10}: {cnt:,}")

        print("\n   Queue distribution:")
        for lbl, cnt in self.df["queue"].value_counts().items():
            print(f"     {lbl:<40}: {cnt:,}")

    def _compute_class_weights(self, series, num_classes):
        """Compute balanced class weights from a label ID series."""
        y       = series.astype(int).values
        classes = np.arange(num_classes)
        weights = compute_class_weight("balanced", classes=classes, y=y)
        return torch.tensor(weights, dtype=torch.float).to(self.device)

    def _build_loader(self, df, batch_size=16, shuffle=True):
        from torch.utils.data import Dataset, DataLoader

        tok = self.tokenizer

        class _DS(Dataset):
            def __init__(self, df):
                self.texts = df["text"].tolist()
                self.p_ids = df["priority_id"].astype(int).tolist()
                self.t_ids = df["type_id"].astype(int).tolist()
                self.q_ids = df["queue_id"].astype(int).tolist()

            def __len__(self):
                return len(self.texts)

            def __getitem__(self, idx):
                enc = tok(
                    self.texts[idx],
                    max_length=192,       # raised from 128 -- captures more body text
                    padding="max_length",
                    truncation=True,
                    return_tensors="pt",
                )
                return {
                    "input_ids":      enc["input_ids"].squeeze(0),
                    "attention_mask": enc["attention_mask"].squeeze(0),
                    "priority_id":    torch.tensor(self.p_ids[idx], dtype=torch.long),
                    "type_id":        torch.tensor(self.t_ids[idx],  dtype=torch.long),
                    "queue_id":       torch.tensor(self.q_ids[idx],  dtype=torch.long),
                }

        return DataLoader(_DS(df), batch_size=batch_size, shuffle=shuffle)

    def train(self, epochs=50, lr_bert=2e-5, lr_heads=1e-3, batch_size=16,
              early_stopping_patience=5, early_stopping_delta=1e-4,
              save_best_path="ticket_model_best.pt"):
        """
        Improvements over v1:
          1. Differential learning rates  -- BERT backbone gets lr_bert (2e-5,
             small, preserves pretrained weights), classification heads get
             lr_heads (1e-3, 50x larger, lets them learn fast).
          2. Label smoothing (0.1) on the queue criterion  -- stops the model
             being overconfident on easy examples and improves generalisation
             on confusable queues like Technical/IT/Customer Service.
          3. Max token length raised from 128 to 192  -- captures more of the
             ticket body, which carries queue-discriminating detail.
          4. Cosine LR scheduler with warmup  -- gently ramps up then decays,
             avoids the sharp loss spikes seen at epoch boundaries.
        """
        from sklearn.model_selection import train_test_split

        train_df, val_df = train_test_split(self.df, test_size=0.1, random_state=42)
        train_loader     = self._build_loader(train_df, batch_size)
        val_loader       = self._build_loader(val_df,   batch_size, shuffle=False)

        total_train = len(train_loader)
        total_val   = len(val_loader)

        # -- Class weights (from training split only) ----------------------
        priority_weights = self._compute_class_weights(
            train_df["priority_id"], len(PRIORITY_LABELS))
        queue_weights    = self._compute_class_weights(
            train_df["queue_id"], len(QUEUE_LABELS))

        print(f"\n   Class weights (priority): ", end="")
        for lbl, w in zip(PRIORITY_LABELS, priority_weights.cpu().tolist()):
            print(f"{lbl}={w:.3f}", end="  ")
        print()
        print(f"   Class weights (queue)   : applied ({len(QUEUE_LABELS)} classes)")

        # -- Loss functions ------------------------------------------------
        # Queue gets label_smoothing=0.1 to penalise overconfidence on the
        # semantically similar majority queues.
        criterion_priority = nn.CrossEntropyLoss(weight=priority_weights)
        criterion_type     = nn.CrossEntropyLoss()
        criterion_queue    = nn.CrossEntropyLoss(
            weight=queue_weights, label_smoothing=0.1)

        print(f"\nStarting training  (v2 -- improved)")
        print(f"   Max epochs          : {epochs}")
        print(f"   Batch size          : {batch_size}")
        print(f"   LR (BERT backbone)  : {lr_bert}  (slow -- preserve pretrained weights)")
        print(f"   LR (heads)          : {lr_heads}  (fast -- heads learn from scratch)")
        print(f"   Label smoothing     : 0.1 on queue head")
        print(f"   Early stop patience : {early_stopping_patience}")
        print(f"   Best model path     : {save_best_path}")
        print(f"   Device              : {self.device}")

        # -- Differential learning rates -----------------------------------
        # BERT params get lr_bert, head params get lr_heads
        bert_params  = list(self.model.bert.parameters())
        head_params  = (list(self.model.head_priority.parameters())
                      + list(self.model.head_type.parameters())
                      + list(self.model.head_queue.parameters()))

        optimizer = torch.optim.AdamW([
            {"params": bert_params,  "lr": lr_bert,  "weight_decay": 0.01},
            {"params": head_params,  "lr": lr_heads, "weight_decay": 0.01},
        ])

        # -- Cosine LR scheduler with linear warmup -----------------------
        total_steps  = epochs * total_train
        warmup_steps = int(0.06 * total_steps)   # 6% warmup

        def lr_lambda(step):
            if step < warmup_steps:
                return step / max(1, warmup_steps)
            progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
            return max(0.0, 0.5 * (1.0 + np.cos(np.pi * progress)))

        scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

        # -- Early stopping state ------------------------------------------
        best_val_loss    = float("inf")
        patience_counter = 0
        stopped_early    = False
        all_summaries    = []

        for epoch in range(1, epochs + 1):
            print_epoch_header(epoch, epochs)
            epoch_start = time.time()

            # -- Training phase --------------------------------------------
            self.model.train()
            total_loss  = 0.0
            batch_start = time.time()

            for batch_idx, batch in enumerate(train_loader, 1):
                optimizer.zero_grad()

                logits = self.model(
                    batch["input_ids"].to(self.device),
                    batch["attention_mask"].to(self.device),
                )

                loss = (
                    criterion_priority(logits["priority"], batch["priority_id"].to(self.device))
                    + criterion_type(logits["type"],       batch["type_id"].to(self.device))
                    + criterion_queue(logits["queue"],     batch["queue_id"].to(self.device))
                )

                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
                optimizer.step()
                scheduler.step()
                total_loss += loss.item()

                elapsed = time.time() - batch_start
                print_batch_progress(batch_idx, total_train, total_loss / batch_idx, elapsed)

            avg_train_loss = total_loss / total_train
            print()

            # -- Validation phase ------------------------------------------
            self.model.eval()

            correct_p = correct_t = correct_q = n = 0
            val_loss_accum = 0.0

            q_correct_per_class = [0] * len(QUEUE_LABELS)
            q_total_per_class   = [0] * len(QUEUE_LABELS)
            p_correct_per_class = [0] * len(PRIORITY_LABELS)
            p_total_per_class   = [0] * len(PRIORITY_LABELS)

            with torch.no_grad():
                for batch_idx, batch in enumerate(val_loader, 1):
                    p_true = batch["priority_id"].to(self.device)
                    t_true = batch["type_id"].to(self.device)
                    q_true = batch["queue_id"].to(self.device)

                    logits = self.model(
                        batch["input_ids"].to(self.device),
                        batch["attention_mask"].to(self.device),
                    )

                    p_pred = logits["priority"].argmax(1)
                    t_pred = logits["type"].argmax(1)
                    q_pred = logits["queue"].argmax(1)

                    v_loss = (
                        criterion_priority(logits["priority"], p_true)
                        + criterion_type(logits["type"],       t_true)
                        + criterion_queue(logits["queue"],     q_true)
                    )
                    val_loss_accum += v_loss.item()

                    correct_p += (p_pred == p_true).sum().item()
                    correct_t += (t_pred == t_true).sum().item()
                    correct_q += (q_pred == q_true).sum().item()
                    n         += batch["input_ids"].size(0)

                    for tl, pl in zip(q_true.cpu().tolist(), q_pred.cpu().tolist()):
                        q_total_per_class[tl]   += 1
                        q_correct_per_class[tl] += int(tl == pl)

                    for tl, pl in zip(p_true.cpu().tolist(), p_pred.cpu().tolist()):
                        p_total_per_class[tl]   += 1
                        p_correct_per_class[tl] += int(tl == pl)

                    print_val_progress(batch_idx, total_val)

            avg_val_loss = val_loss_accum / total_val
            p_acc        = correct_p / n
            t_acc        = correct_t / n
            q_acc        = correct_q / n
            epoch_time   = time.time() - epoch_start

            print_epoch_summary(epoch, epochs, avg_train_loss, p_acc, t_acc, q_acc, epoch_time)
            print(f"\n  Val loss : {avg_val_loss:.4f}  |  "
                  f"Best so far : {best_val_loss:.4f}  |  "
                  f"Patience : {patience_counter}/{early_stopping_patience}")

            print_per_class_accuracy(
                PRIORITY_LABELS, p_correct_per_class, p_total_per_class,
                "Per-class accuracy -- Priority")
            print_per_class_accuracy(
                QUEUE_LABELS, q_correct_per_class, q_total_per_class,
                "Per-class accuracy -- Queue")

            all_summaries.append((epoch, avg_train_loss, avg_val_loss, p_acc, t_acc, q_acc))

            # -- Early stopping check --------------------------------------
            if avg_val_loss < best_val_loss - early_stopping_delta:
                best_val_loss    = avg_val_loss
                patience_counter = 0
                torch.save(self.model.state_dict(), save_best_path)
                print(f"\n  [CHECKPOINT] Val loss improved -> {best_val_loss:.4f}  "
                      f"Saved to {save_best_path}")
            else:
                patience_counter += 1
                print(f"\n  [NO IMPROVEMENT] Patience {patience_counter}/{early_stopping_patience}")
                if patience_counter >= early_stopping_patience:
                    print(f"\n  [EARLY STOP] Stopping at epoch {epoch}.")
                    stopped_early = True
                    break

        # -- Final summary -------------------------------------------------
        print("\n" + "=" * 70)
        print("  TRAINING STOPPED EARLY" if stopped_early else "  TRAINING COMPLETE")
        print("=" * 70)
        print(f"  {'Epoch':<8} {'Train Loss':<13} {'Val Loss':<12} "
              f"{'Priority%':<13} {'Type%':<10} {'Queue%'}")
        print(f"  {'-'*8} {'-'*13} {'-'*12} {'-'*13} {'-'*10} {'-'*8}")
        for ep, tl, vl, pa, ta, qa in all_summaries:
            print(f"  {ep:<8} {tl:<13.4f} {vl:<12.4f} "
                  f"{pa*100:<13.2f} {ta*100:<10.2f} {qa*100:.2f}")
        print("=" * 70)
        print(f"\n  Best val loss : {best_val_loss:.4f}")
        print(f"  Best model    : {save_best_path}")

    def save(self, path="ticket_model.pt"):
        torch.save(self.model.state_dict(), path)
        print(f"\nModel saved -> {path}")

    def load(self, path="ticket_model.pt"):
        self.model.load_state_dict(torch.load(path, map_location=self.device))
        print(f"Model loaded <- {path}")


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

@dataclass
class PredictionResult:
    priority:       str
    ticket_type:    str
    queue:          str
    priority_score: float
    embedding:      list


class TicketPredictor:
    def __init__(self, model_name="distilbert-base-uncased", weights_path=None, device="cpu"):
        self.device    = torch.device(device)
        self.tokenizer = DistilBertTokenizer.from_pretrained(model_name)
        self.model     = TicketClassifier(model_name).to(self.device)
        if weights_path and os.path.exists(weights_path):
            self.model.load_state_dict(torch.load(weights_path, map_location=self.device))
            print(f"Weights loaded from {weights_path}")
        self.model.eval()

    def _encode(self, text):
        enc = self.tokenizer(
            text, max_length=192, padding="max_length",
            truncation=True, return_tensors="pt")
        return enc["input_ids"].to(self.device), enc["attention_mask"].to(self.device)

    def predict(self, subject, body=""):
        text = (subject + " " + body).strip()
        input_ids, attn_mask = self._encode(text)

        with torch.no_grad():
            logits = self.model(input_ids, attn_mask)
            emb    = self.model.get_embedding(input_ids, attn_mask)

        p_probs = torch.softmax(logits["priority"], dim=1)[0].cpu().numpy()
        p_idx   = int(p_probs.argmax())
        t_idx   = int(logits["type"].argmax(1).item())
        q_idx   = int(logits["queue"].argmax(1).item())

        return PredictionResult(
            priority       = PRIORITY_LABELS[p_idx],
            ticket_type    = TYPE_LABELS[t_idx],
            queue          = QUEUE_LABELS[q_idx],
            priority_score = float(p_probs[p_idx]),
            embedding      = emb[0].cpu().tolist(),
        )


# ---------------------------------------------------------------------------
# Agent ranking
# ---------------------------------------------------------------------------

@dataclass
class AgentRank:
    support_id:   int
    support_name: str
    score:        float
    is_busy:      bool
    reason:       str


class AgentRanker:
    W_HISTORY   = 0.50
    W_SPECIALTY = 0.30
    W_PERF      = 0.20

    def rank_agents(self, ticket_embedding, ticket_queue, ticket_priority, agent_rows, history_rows):
        new_emb = np.array(ticket_embedding).reshape(1, -1)

        agent_embs        = defaultdict(list)
        agent_times       = defaultdict(list)
        agent_rates       = defaultdict(list)
        agent_queue_match = defaultdict(int)

        for row in history_rows:
            sid = row["support_id"]
            if row.get("embedding"):
                emb = json.loads(row["embedding"]) if isinstance(row["embedding"], str) else row["embedding"]
                agent_embs[sid].append(emb)
            if row.get("resolution_time_minutes"):
                agent_times[sid].append(row["resolution_time_minutes"])
            if row.get("customer_rating"):
                agent_rates[sid].append(row["customer_rating"])
            if row.get("queue") == ticket_queue:
                agent_queue_match[sid] += 1

        all_times = [t for ts in agent_times.values() for t in ts]
        max_time  = max(all_times) if all_times else 1
        min_time  = min(all_times) if all_times else 0

        ranks = []
        for agent in agent_rows:
            sid  = agent["id"]
            name = agent["username"]

            if agent_embs[sid]:
                avg_emb     = np.mean(agent_embs[sid], axis=0).reshape(1, -1)
                sim         = float(cosine_similarity(new_emb, avg_emb)[0][0])
                queue_bonus = min(0.2, agent_queue_match[sid] * 0.01)
                sim         = min(1.0, sim + queue_bonus)
            else:
                sim = 0.0

            specialties = agent.get("specialties") or []
            spec_score  = 1.0 if ticket_queue in specialties else 0.0

            if agent_times[sid]:
                avg_t   = np.mean(agent_times[sid])
                t_score = 1.0 - ((avg_t - min_time) / (max_time - min_time + 1e-9))
            else:
                t_score = 0.5

            if agent_rates[sid]:
                avg_r   = np.mean(agent_rates[sid])
                r_score = (avg_r - 1) / 4.0
            else:
                r_score = 0.5

            perf_score   = 0.5 * t_score + 0.5 * r_score
            active       = agent.get("active_ticket_count", 0)
            load_penalty = min(0.3, active * 0.05)

            composite = (
                self.W_HISTORY   * sim
                + self.W_SPECIALTY * spec_score
                + self.W_PERF      * perf_score
                - load_penalty
            )

            reason = (
                f"sim={sim:.2f}, specialty={'yes' if spec_score else 'no'}, "
                f"perf={perf_score:.2f}, load_penalty={load_penalty:.2f}"
            )

            ranks.append(AgentRank(
                support_id   = sid,
                support_name = name,
                score        = round(composite, 4),
                is_busy      = agent.get("is_busy", False),
                reason       = reason,
            ))

        ranks.sort(key=lambda r: r.score, reverse=True)
        return ranks[:5]

    def auto_assign(self, ranked):
        for agent in ranked:
            if not agent.is_busy:
                return agent
        return None


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":

    DATASET_DIR = "/kaggle/input/datasets/sahithyelluguri/se-dataset"

    CSV_FILES = [
        os.path.join(DATASET_DIR, "priority_en.csv"),
        os.path.join(DATASET_DIR, "Ticketing dataset.csv"),
    ]

    print("=" * 62)
    print("  SupportAI -- Transformer Training Pipeline")
    print("=" * 62)

    trainer = TicketModelTrainer(device="cuda" if torch.cuda.is_available() else "cpu")
    trainer.load_data(CSV_FILES)

    BEST_MODEL_PATH = "/kaggle/working/ticket_model_best.pt"

    trainer.train(
        epochs                  = 50,
        lr_bert                 = 2e-5,
        lr_heads                = 1e-3,
        batch_size              = 16,
        early_stopping_patience = 10,   # was 5 -- gave too little time to learn
        early_stopping_delta    = 5e-5, # was 1e-4 -- was too strict, ignored small improvements
        save_best_path          = BEST_MODEL_PATH,
    )

    # The best checkpoint is saved automatically by train() on every improvement.
    # Save final state separately as a fallback.
    MODEL_PATH = "/kaggle/working/ticket_model_final.pt"
    trainer.save(MODEL_PATH)

    print("\n\n" + "=" * 62)
    print("  Inference Smoke-Test")
    print("=" * 62)

    predictor = TicketPredictor(weights_path=BEST_MODEL_PATH)

    result = predictor.predict(
        subject="Critical AWS service outage - production down",
        body="All our EC2 instances in us-east-1 are unreachable since 14:00 UTC.",
    )

    print(f"\n  Input   : 'Critical AWS service outage - production down'")
    print(f"  Priority: {result.priority.upper()}  (confidence={result.priority_score*100:.1f}%)")
    print(f"  Type    : {result.ticket_type}")
    print(f"  Queue   : {result.queue}")
    print(f"  Embed   : {len(result.embedding)}-d vector [OK]")

    print("\n\n" + "=" * 62)
    print("  Agent Ranking Results")
    print("=" * 62)

    dummy_agents = [
        {
            "id": i,
            "username": f"support{i}",
            "specialties": ["Technical Support", "IT Support"],
            "is_busy": (i == 1),
            "active_ticket_count": i % 3,
        }
        for i in range(1, 21)
    ]

    ranker = AgentRanker()
    ranked = ranker.rank_agents(
        ticket_embedding = result.embedding,
        ticket_queue     = result.queue,
        ticket_priority  = result.priority,
        agent_rows       = dummy_agents,
        history_rows     = [],
    )

    print(f"\n  Queue: '{result.queue}'  |  Priority: {result.priority.upper()}")
    print(f"\n  {'Rank':<6} {'Agent':<14} {'Score':<10} {'Status':<14} {'Details'}")
    print(f"  {'-'*6} {'-'*14} {'-'*10} {'-'*14} {'-'*30}")

    for i, r in enumerate(ranked, 1):
        status = "BUSY" if r.is_busy else "AVAILABLE"
        print(f"  #{i:<5} {r.support_name:<14} {r.score:<10.4f} {status:<14}  {r.reason}")

    assigned = ranker.auto_assign(ranked)

    print()
    if assigned:
        print(f"  Auto-assigned -> {assigned.support_name}  (score={assigned.score:.4f})")
    else:
        print("  WARNING: All top-5 agents are busy. Escalating to next tier...")
