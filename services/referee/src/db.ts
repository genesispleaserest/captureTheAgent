import DatabaseConstructor from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

const DB_PATH = process.env.ARENA_DB_PATH ?? "arena.db";

let dbInstance: BetterSqlite3Database | null = null;

function ensureSchema(db: BetterSqlite3Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      policy TEXT NOT NULL,
      seed INTEGER NOT NULL,
      user_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      transcript TEXT NOT NULL,
      artifacts TEXT NOT NULL,
      alleged TEXT NOT NULL,
      idempotency_key TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      processed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      seed INTEGER NOT NULL,
      logs TEXT NOT NULL,
      detectors TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (claim_id) REFERENCES claims (id)
    );

    CREATE TABLE IF NOT EXISTS verdicts (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      reproduced BOOLEAN NOT NULL,
      severity TEXT NOT NULL,
      run_id TEXT NOT NULL,
      regression_path TEXT,
      detectors_version TEXT,
      env_hash TEXT,
      evidence TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (claim_id) REFERENCES claims (id),
      FOREIGN KEY (run_id) REFERENCES runs (id)
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS magic_links (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users (id)
    );

    -- External Agents (Hosted Callback / Runner / Container)
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      endpoint_url TEXT,
      hmac_secret TEXT,
      mode TEXT DEFAULT 'hosted',
      capabilities TEXT DEFAULT '[]',
      tools TEXT DEFAULT '[]',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      disabled INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS agent_versions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      version TEXT NOT NULL,
      model_id TEXT,
      notes TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (agent_id) REFERENCES agents (id)
    );

    CREATE TABLE IF NOT EXISTS run_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      seed INTEGER,
      inputs TEXT,
      status TEXT DEFAULT 'queued',
      error TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents (id),
      FOREIGN KEY (session_id) REFERENCES sessions (id)
    );
  `);

  // Best-effort migrations for existing DBs
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_idempotency ON claims(idempotency_key)"); } catch {}
  try { db.exec("ALTER TABLE claims ADD COLUMN idempotency_key TEXT"); } catch {}
  try { db.exec("ALTER TABLE verdicts ADD COLUMN detectors_version TEXT"); } catch {}
  try { db.exec("ALTER TABLE verdicts ADD COLUMN env_hash TEXT"); } catch {}
  try { db.exec("ALTER TABLE verdicts ADD COLUMN evidence TEXT"); } catch {}
  try { db.exec("ALTER TABLE sessions ADD COLUMN user_id TEXT"); } catch {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_run_jobs_status ON run_jobs(status)"); } catch {}
}

export function getDatabase(): BetterSqlite3Database {
  if (!dbInstance) {
    dbInstance = new DatabaseConstructor(DB_PATH);
    ensureSchema(dbInstance);
  }
  return dbInstance;
}

export type { BetterSqlite3Database };
