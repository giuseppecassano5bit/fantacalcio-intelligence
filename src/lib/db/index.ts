import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { migrations } from "./migrations";

export type DbMode = "reale" | "demo";
export type Db = DatabaseSync;
export type Params = Record<string, SQLInputValue> | SQLInputValue[];

const g = globalThis as unknown as { __fiDbs?: Map<string, DatabaseSync> };

export function dbPathFor(mode: DbMode): string {
  if (mode === "demo") {
    return process.env.DEMO_DATABASE_PATH || path.join(process.cwd(), "data", "demo.sqlite");
  }
  return process.env.DATABASE_PATH || path.join(process.cwd(), "data", "fantacalcio.sqlite");
}

/** Apre (una sola volta per processo) il database del modo richiesto e applica le migrazioni. */
export function openDb(file: string): DatabaseSync {
  g.__fiDbs ??= new Map();
  const existing = g.__fiDbs.get(file);
  if (existing) return existing;
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  g.__fiDbs.set(file, db);
  return db;
}

export function getDb(mode: DbMode = "reale"): DatabaseSync {
  return openDb(dbPathFor(mode));
}

export function migrate(db: DatabaseSync): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    tx(db, () => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    });
  }
}

/** Esegue fn in una transazione; annidamenti gestiti con savepoint. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  const inTx = db.isTransaction;
  const sp = `sp_${Math.random().toString(36).slice(2, 10)}`;
  db.exec(inTx ? `SAVEPOINT ${sp}` : "BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec(inTx ? `RELEASE ${sp}` : "COMMIT");
    return result;
  } catch (err) {
    db.exec(inTx ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : "ROLLBACK");
    throw err;
  }
}

export function all<T>(db: DatabaseSync, sql: string, params: Params = []): T[] {
  const st = db.prepare(sql);
  return (Array.isArray(params) ? st.all(...params) : st.all(params)) as T[];
}

export function one<T>(db: DatabaseSync, sql: string, params: Params = []): T | undefined {
  const st = db.prepare(sql);
  return (Array.isArray(params) ? st.get(...params) : st.get(params)) as T | undefined;
}

export function run(db: DatabaseSync, sql: string, params: Params = []): { changes: number; lastId: number } {
  const st = db.prepare(sql);
  const r = Array.isArray(params) ? st.run(...params) : st.run(params);
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

export const nowIso = () => new Date().toISOString();

// ---- Stato applicativo chiave/valore ----
export function getState(db: DatabaseSync, key: string): string | null {
  return one<{ value: string | null }>(db, "SELECT value FROM app_state WHERE key = ?", [key])?.value ?? null;
}

export function setState(db: DatabaseSync, key: string, value: string | null): void {
  run(
    db,
    "INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [key, value, nowIso()],
  );
}

/** Versione dei dati: incrementata a ogni modifica che può cambiare le valutazioni. */
export function bumpDataVersion(db: DatabaseSync): number {
  const v = Number(getState(db, "data_version") ?? "0") + 1;
  setState(db, "data_version", String(v));
  return v;
}

export function getDataVersion(db: DatabaseSync): number {
  return Number(getState(db, "data_version") ?? "0");
}
