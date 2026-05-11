"""
SupportAI  --  FastAPI Backend
Run:  uvicorn api:app --reload --port 8000
"""

import os
import json
import sqlite3
import datetime
from contextlib import contextmanager
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Lazy-load the ML model so the server starts even without the .pt file
# ---------------------------------------------------------------------------
_predictor = None
_ranker    = None

def get_predictor():
    global _predictor
    if _predictor is None:
        if os.environ.get("MOCK_MODE", "false").lower() == "true":
            print("[ML]  MOCK_MODE enabled — skipping model load")
            return None
        try:
            from ticket_ai import TicketPredictor
            pt = os.environ.get("MODEL_PATH", "ticket_model_best.pt")
            _predictor = TicketPredictor(weights_path=pt)
            print(f"[ML]  Model loaded from {pt}")
        except Exception as e:
            print(f"[ML]  WARNING: could not load model — {e}")
            print("[ML]  Running in MOCK mode (predictions will be dummy values)")
    return _predictor

def get_ranker():
    global _ranker
    if _ranker is None:
        try:
            from ticket_ai import AgentRanker
            _ranker = AgentRanker()
        except Exception as e:
            print(f"[ML]  Ranker unavailable: {e}")
    return _ranker

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
DB_PATH = os.environ.get("DB_PATH", "supportai.db")

def init_db():
    with open("schema.sql") as f:
        sql = f.read()
    con = sqlite3.connect(DB_PATH)
    con.executescript(sql)
    con.close()
    print(f"[DB]  Initialised  {DB_PATH}")

@contextmanager
def get_db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="SupportAI API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    init_db()
    get_predictor()   # warm up model at start

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str
    role:     str          # customer / support / admin

class SignupRequest(BaseModel):
    username: str
    password: str
    name: str
    email: Optional[str] = None

class NewTicketRequest(BaseModel):
    customer_id: int
    subject:     str
    body:        str = ""

class ResolveRequest(BaseModel):
    agent_id:         int
    resolution_notes: str
    customer_rating:  Optional[float] = None

class RatingRequest(BaseModel):
    customer_rating: float

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

ADMIN_USERNAME = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASS", "admin123")

@app.post("/auth/login")
def login(req: LoginRequest):
    if req.role == "admin":
        if req.username == ADMIN_USERNAME and req.password == ADMIN_PASSWORD:
            return {"id": 0, "username": "admin", "name": "Administrator", "role": "admin"}
        raise HTTPException(401, "Invalid admin credentials")

    table = "customers" if req.role == "customer" else "support_agents"
    with get_db() as db:
        row = db.execute(
            f"SELECT * FROM {table} WHERE username=? AND password=?",
            (req.username, req.password)
        ).fetchone()
    if not row:
        raise HTTPException(401, "Invalid username or password")

    data = dict(row)
    data.pop("password", None)
    data["role"] = req.role
    if "specialties" in data:
        data["specialties"] = json.loads(data["specialties"])
    return data

@app.post("/auth/signup")
def signup(req: SignupRequest):
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM customers WHERE username=?",
            (req.username,)
        ).fetchone()
        if existing:
            raise HTTPException(409, "Username already exists")

        if req.email:
            email_match = db.execute(
                "SELECT id FROM customers WHERE email=?",
                (req.email,)
            ).fetchone()
            if email_match:
                raise HTTPException(409, "Email already exists")

        cur = db.execute(
            "INSERT INTO customers (username, password, name, email) VALUES (?, ?, ?, ?)",
            (req.username, req.password, req.name, req.email)
        )
        customer_id = cur.lastrowid
        row = db.execute(
            "SELECT id, username, name, email, created_at FROM customers WHERE id=?",
            (customer_id,)
        ).fetchone()

    data = dict(row)
    data["role"] = "customer"
    return data

# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------

@app.get("/customers/{customer_id}/tickets")
def customer_tickets(customer_id: int):
    with get_db() as db:
        rows = db.execute(
            """
            SELECT
              id, ticket_ref, customer_id, subject, body,
              priority, ticket_type, queue, priority_score,
              assigned_agent_id, assigned_agent_name,
              status, resolution_notes, resolution_time_minutes,
              customer_rating, created_at, assigned_at, resolved_at
            FROM ticket_resolutions
            WHERE customer_id=?
            ORDER BY created_at DESC
            """,
            (customer_id,)
        ).fetchall()
    return [_format_ticket(r) for r in rows]

# ---------------------------------------------------------------------------
# Tickets — create & classify
# ---------------------------------------------------------------------------

@app.post("/tickets")
def create_ticket(req: NewTicketRequest):
    predictor = get_predictor()
    ranker    = get_ranker()

    # -- ML classification -----------------------------------------------
    if predictor:
        result = predictor.predict(req.subject, req.body)
        priority      = result.priority
        ticket_type   = result.ticket_type
        queue         = result.queue
        priority_score = result.priority_score
        embedding     = result.embedding
    else:
        # fallback when model not loaded
        priority, ticket_type, queue = "medium", "Request", "General Inquiry"
        priority_score, embedding    = 0.5, []

    # -- Fetch agents + history for ranking ------------------------------
    with get_db() as db:
        agent_rows = [dict(r) for r in db.execute("SELECT * FROM support_agents").fetchall()]
        for a in agent_rows:
            a["specialties"] = json.loads(a["specialties"])

        history_rows = [dict(r) for r in db.execute(
            "SELECT assigned_agent_id as support_id, embedding, "
            "resolution_time_minutes, customer_rating, queue "
            "FROM ticket_resolutions WHERE status='resolved' AND embedding != '[]'"
        ).fetchall()]

        customer = db.execute(
            "SELECT id FROM customers WHERE id=?", (req.customer_id,)
        ).fetchone()
        if not customer:
            raise HTTPException(404, "Customer not found")

    # -- Rank and assign -------------------------------------------------
    top5       = []
    assigned   = None
    agent_name = None

    if ranker and agent_rows:
        ranked = ranker.rank_agents(
            ticket_embedding = embedding,
            ticket_queue     = queue,
            ticket_priority  = priority,
            agent_rows       = agent_rows,
            history_rows     = history_rows,
        )
        top5 = [
            {"rank": i+1, "name": r.support_name, "score": r.score, "reason": r.reason}
            for i, r in enumerate(ranked)
        ]
        assigned_rank = ranker.auto_assign(ranked)
        if assigned_rank:
            assigned   = assigned_rank.support_id
            agent_name = assigned_rank.support_name

    # -- Persist ticket --------------------------------------------------
    now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    with get_db() as db:
        # generate ticket ref
        count = db.execute("SELECT COUNT(*) FROM ticket_resolutions").fetchone()[0]
        ref   = f"TKT-{count+1:04d}"

        db.execute("""
            INSERT INTO ticket_resolutions
              (ticket_ref, customer_id, subject, body,
               priority, ticket_type, queue, priority_score, embedding,
               assigned_agent_id, assigned_agent_name, top5_ranking,
               status, assigned_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            ref, req.customer_id, req.subject, req.body,
            priority, ticket_type, queue, priority_score,
            json.dumps(embedding),
            assigned, agent_name, json.dumps(top5),
            "open" if not assigned else "in_progress",
            now if assigned else None,
        ))

        # Update agent load
        if assigned:
            db.execute(
                "UPDATE support_agents SET active_ticket_count = active_ticket_count + 1 WHERE id=?",
                (assigned,)
            )

        ticket = db.execute(
            "SELECT * FROM ticket_resolutions WHERE ticket_ref=?", (ref,)
        ).fetchone()

    return _format_ticket(ticket)

# ---------------------------------------------------------------------------
# Tickets — get single
# ---------------------------------------------------------------------------

@app.get("/tickets/{ticket_ref}")
def get_ticket(ticket_ref: str):
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM ticket_resolutions WHERE ticket_ref=?", (ticket_ref,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Ticket not found")
    return _format_ticket(row)

# ---------------------------------------------------------------------------
# Tickets — all (admin)
# ---------------------------------------------------------------------------

@app.get("/tickets")
def all_tickets():
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM ticket_resolutions ORDER BY created_at DESC"
        ).fetchall()
    return [_format_ticket(r) for r in rows]

# ---------------------------------------------------------------------------
# Tickets — resolve (support agent)
# ---------------------------------------------------------------------------

@app.post("/tickets/{ticket_ref}/resolve")
def resolve_ticket(ticket_ref: str, req: ResolveRequest):
    now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    with get_db() as db:
        ticket = db.execute(
            "SELECT * FROM ticket_resolutions WHERE ticket_ref=?", (ticket_ref,)
        ).fetchone()
        if not ticket:
            raise HTTPException(404, "Ticket not found")
        if ticket["assigned_agent_id"] != req.agent_id:
            raise HTTPException(403, "Not assigned to you")

        # Compute resolution time in minutes
        created   = _parse_db_datetime(ticket["created_at"])
        res_mins  = (datetime.datetime.utcnow() - created).total_seconds() / 60

        db.execute("""
            UPDATE ticket_resolutions SET
              status='resolved', resolution_notes=?,
              customer_rating=?, resolution_time_minutes=?, resolved_at=?
            WHERE ticket_ref=?
        """, (req.resolution_notes, req.customer_rating, res_mins, now, ticket_ref))

        db.execute(
            "UPDATE support_agents SET active_ticket_count = MAX(0, active_ticket_count - 1) WHERE id=?",
            (req.agent_id,)
        )

        updated = db.execute(
            "SELECT * FROM ticket_resolutions WHERE ticket_ref=?", (ticket_ref,)
        ).fetchone()
    return _format_ticket(updated)

# ---------------------------------------------------------------------------
# Support agent — their tickets
# ---------------------------------------------------------------------------

@app.get("/agents/{agent_id}/tickets")
def agent_tickets(agent_id: int):
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM ticket_resolutions WHERE assigned_agent_id=? ORDER BY created_at DESC",
            (agent_id,)
        ).fetchall()
    return [_format_ticket(r) for r in rows]

# ---------------------------------------------------------------------------
# Agents list (admin)
# ---------------------------------------------------------------------------

@app.get("/agents")
def list_agents():
    with get_db() as db:
        rows = db.execute("SELECT * FROM support_agents").fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d.pop("password", None)
        d["specialties"] = json.loads(d["specialties"])
        result.append(d)
    return result

# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": _predictor is not None}

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _format_ticket(row) -> dict:
    d = dict(row)
    for key in ("embedding", "top5_ranking"):
        if key in d and isinstance(d[key], str):
            try:    d[key] = json.loads(d[key])
            except: d[key] = []
    return d

def _parse_db_datetime(value: str) -> datetime.datetime:
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.datetime.strptime(value, fmt)
        except ValueError:
            continue
    raise HTTPException(500, f"Unsupported datetime format: {value}")
