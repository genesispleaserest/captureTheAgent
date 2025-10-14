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
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      transcript TEXT NOT NULL,
      artifacts TEXT NOT NULL,
      alleged TEXT NOT NULL,
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
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (claim_id) REFERENCES claims (id),
      FOREIGN KEY (run_id) REFERENCES runs (id)
    );
  `);
}

export function getDatabase(): BetterSqlite3Database {
  if (!dbInstance) {
    dbInstance = new DatabaseConstructor(DB_PATH);
    ensureSchema(dbInstance);
  }
  return dbInstance;
}

export type { BetterSqlite3Database };
