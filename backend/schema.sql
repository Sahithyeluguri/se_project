-- =============================================================
--  SupportAI  --  SQLite Schema
-- =============================================================

PRAGMA foreign_keys = ON;

-- -------------------------------------------------------------
-- 1. Customers
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT    NOT NULL UNIQUE,          -- customer1, customer2 ...
    password     TEXT    NOT NULL,                 -- bcrypt hash in production
    name         TEXT    NOT NULL,
    email        TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -------------------------------------------------------------
-- 2. Support agents
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_agents (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT    NOT NULL UNIQUE,  -- support1, support2 ...
    password             TEXT    NOT NULL,
    name                 TEXT    NOT NULL,
    specialties          TEXT    NOT NULL DEFAULT '[]',  -- JSON array
    is_busy              INTEGER NOT NULL DEFAULT 0,
    active_ticket_count  INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -------------------------------------------------------------
-- 3. Ticket resolutions  (most important table)
--    Every ticket — open, in-progress, resolved — lives here.
--    The embedding column is what drives agent ranking.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_resolutions (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_ref             TEXT    NOT NULL UNIQUE,   -- TKT-0001, TKT-0002 ...
    customer_id            INTEGER NOT NULL REFERENCES customers(id),

    -- Ticket content
    subject                TEXT    NOT NULL,
    body                   TEXT    NOT NULL DEFAULT '',

    -- AI classification output
    priority               TEXT    NOT NULL DEFAULT 'medium',  -- high / medium / low
    ticket_type            TEXT    NOT NULL DEFAULT 'Request', -- Incident / Request / Problem / Change
    queue                  TEXT    NOT NULL DEFAULT 'General Inquiry',
    priority_score         REAL    NOT NULL DEFAULT 0.0,       -- model confidence 0–1
    embedding              TEXT    NOT NULL DEFAULT '[]',      -- JSON array, 768-d vector

    -- Assignment
    assigned_agent_id      INTEGER REFERENCES support_agents(id),
    assigned_agent_name    TEXT,
    top5_ranking           TEXT    NOT NULL DEFAULT '[]',      -- JSON array of {rank,name,score,reason}

    -- Resolution
    status                 TEXT    NOT NULL DEFAULT 'open',    -- open / in_progress / resolved
    resolution_notes       TEXT,
    resolution_time_minutes REAL,
    customer_rating        REAL,                               -- 1–5, filled after close

    -- Timestamps
    created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    assigned_at            TEXT,
    resolved_at            TEXT
);

-- Indexes for the most common lookups
CREATE INDEX IF NOT EXISTS idx_tr_customer   ON ticket_resolutions(customer_id);
CREATE INDEX IF NOT EXISTS idx_tr_agent      ON ticket_resolutions(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_tr_status     ON ticket_resolutions(status);
CREATE INDEX IF NOT EXISTS idx_tr_queue      ON ticket_resolutions(queue);

-- =============================================================
--  Seed data
-- =============================================================

INSERT OR IGNORE INTO customers (username, password, name, email) VALUES
  ('customer1',  'pass123', 'Alice Morgan', 'alice@example.com'),
  ('customer2',  'pass123', 'Bob Chen',     'bob@example.com'),
  ('customer3',  'pass123', 'Clara Diaz',   'clara@example.com'),
  ('customer4',  'pass123', 'David Kim',    'david@example.com'),
  ('customer5',  'pass123', 'Eva Rossi',    'eva@example.com');

INSERT OR IGNORE INTO support_agents (username, password, name, specialties) VALUES
  ('support1',  'pass123', 'Support Agent 1',  '["Technical Support","IT Support"]'),
  ('support2',  'pass123', 'Support Agent 2',  '["Technical Support","IT Support"]'),
  ('support3',  'pass123', 'Support Agent 3',  '["Technical Support","Product Support"]'),
  ('support4',  'pass123', 'Support Agent 4',  '["Billing and Payments","Returns and Exchanges"]'),
  ('support5',  'pass123', 'Support Agent 5',  '["Billing and Payments","Returns and Exchanges"]'),
  ('support6',  'pass123', 'Support Agent 6',  '["Billing and Payments","Customer Service"]'),
  ('support7',  'pass123', 'Support Agent 7',  '["Customer Service","General Inquiry"]'),
  ('support8',  'pass123', 'Support Agent 8',  '["Customer Service","General Inquiry"]'),
  ('support9',  'pass123', 'Support Agent 9',  '["Service Outages and Maintenance","IT Support"]'),
  ('support10', 'pass123', 'Support Agent 10', '["Sales and Pre-Sales","Human Resources"]');
