/**
 * Schema.
 *
 * Runs are immutable once written — a run records what the engine concluded at
 * a moment, under a named set of tolerances, from a named seed. Re-grading an
 * old run under today's rules would quietly rewrite history, and the whole
 * point of keeping runs is being able to say "this is what changed when we
 * loosened the date window".
 *
 * The one mutable thing is an exception's resolution, because that is a human
 * decision made after the fact. It is stored beside the exception rather than
 * replacing it, so the queue can always show both what the engine said and what
 * the reviewer decided.
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  seed          INTEGER NOT NULL,
  order_count   INTEGER NOT NULL,
  tolerances    TEXT NOT NULL,
  adjudicator   TEXT,
  metrics       TEXT NOT NULL,
  timeline      TEXT NOT NULL,
  dataset       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  run_id         TEXT NOT NULL,
  match_id       TEXT NOT NULL,
  level          TEXT NOT NULL,
  left_id        TEXT NOT NULL,
  right_id       TEXT NOT NULL,
  tier           INTEGER NOT NULL,
  confidence     REAL NOT NULL,
  state          TEXT NOT NULL,
  variance_code  TEXT,
  variance_paise INTEGER NOT NULL DEFAULT 0,
  rationale      TEXT,
  evidence       TEXT NOT NULL,
  PRIMARY KEY (run_id, match_id),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_matches_run_state ON matches(run_id, state);
CREATE INDEX IF NOT EXISTS idx_matches_left      ON matches(run_id, left_id);

CREATE TABLE IF NOT EXISTS exceptions (
  run_id       TEXT NOT NULL,
  exception_id TEXT NOT NULL,
  level        TEXT NOT NULL,
  record_id    TEXT NOT NULL,
  record_kind  TEXT NOT NULL,
  code         TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  occurred_on  TEXT NOT NULL,
  rejected     TEXT NOT NULL,
  rationale    TEXT,
  resolution   TEXT NOT NULL DEFAULT 'open',
  resolved_at  TEXT,
  note         TEXT,
  PRIMARY KEY (run_id, exception_id),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exceptions_open ON exceptions(run_id, resolution);
CREATE INDEX IF NOT EXISTS idx_exceptions_code ON exceptions(run_id, code);

CREATE TABLE IF NOT EXISTS agent_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL,
  at      TEXT NOT NULL,
  kind    TEXT NOT NULL,
  label   TEXT NOT NULL,
  detail  TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_log_run ON agent_log(run_id, id);

-- Single row. The tolerance profile the next run will use.
CREATE TABLE IF NOT EXISTS rules (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  tolerances TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`
