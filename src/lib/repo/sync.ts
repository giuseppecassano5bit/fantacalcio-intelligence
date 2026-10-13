import type { Db } from "@/lib/db";
import { all, one, run, nowIso } from "@/lib/db";

export interface ConnectorStatusRow {
  id: string;
  enabled: number;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  last_test_at: string | null;
  last_test_ok: number | null;
  last_test_message: string | null;
  usage_note: string | null;
}

export function getConnectorStatus(db: Db, id: string): ConnectorStatusRow {
  run(db, "INSERT OR IGNORE INTO connector_status (id, enabled) VALUES (?, 1)", [id]);
  return one<ConnectorStatusRow>(db, "SELECT * FROM connector_status WHERE id = ?", [id])!;
}

export function markConnectorSuccess(db: Db, id: string, usageNote?: string | null) {
  getConnectorStatus(db, id);
  run(db, "UPDATE connector_status SET last_success_at = ?, usage_note = COALESCE(?, usage_note) WHERE id = ?", [nowIso(), usageNote ?? null, id]);
}

export function markConnectorError(db: Db, id: string, error: string) {
  getConnectorStatus(db, id);
  run(db, "UPDATE connector_status SET last_error_at = ?, last_error = ? WHERE id = ?", [nowIso(), error.slice(0, 500), id]);
}

export function markConnectorTest(db: Db, id: string, ok: boolean, message: string) {
  getConnectorStatus(db, id);
  run(db, "UPDATE connector_status SET last_test_at = ?, last_test_ok = ?, last_test_message = ? WHERE id = ?", [nowIso(), ok ? 1 : 0, message.slice(0, 500), id]);
}

export function setConnectorEnabled(db: Db, id: string, enabled: boolean) {
  getConnectorStatus(db, id);
  run(db, "UPDATE connector_status SET enabled = ? WHERE id = ?", [enabled ? 1 : 0, id]);
}

export type SyncTrigger = "manuale" | "automatico" | "cron";
export type SyncStatus = "in_corso" | "ok" | "parziale" | "errore";

export interface SyncRunRow {
  id: number;
  trigger: SyncTrigger;
  scope: string;
  reason: string | null;
  started_at: string;
  finished_at: string | null;
  status: SyncStatus;
  summary: string | null;
}

export function startSyncRun(db: Db, trigger: SyncTrigger, scope: string, reason: string): number {
  return run(db, "INSERT INTO sync_runs (trigger, scope, reason, started_at, status) VALUES (?, ?, ?, ?, 'in_corso')", [trigger, scope, reason, nowIso()]).lastId;
}

export function finishSyncRun(db: Db, id: number, status: SyncStatus, summary: unknown) {
  run(db, "UPDATE sync_runs SET finished_at = ?, status = ?, summary = ? WHERE id = ?", [nowIso(), status, JSON.stringify(summary), id]);
}

export function listSyncRuns(db: Db, limit = 20): SyncRunRow[] {
  return all<SyncRunRow>(db, "SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?", [limit]);
}

export function lastSuccessfulSync(db: Db): SyncRunRow | undefined {
  return one<SyncRunRow>(db, "SELECT * FROM sync_runs WHERE status IN ('ok','parziale') ORDER BY finished_at DESC LIMIT 1");
}

export function runningSync(db: Db): SyncRunRow | undefined {
  // una sincronizzazione "in corso" da più di 15 minuti è considerata interrotta
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  run(db, "UPDATE sync_runs SET status = 'errore', finished_at = ?, summary = '{\"errore\":\"interrotta\"}' WHERE status = 'in_corso' AND started_at < ?", [nowIso(), cutoff]);
  return one<SyncRunRow>(db, "SELECT * FROM sync_runs WHERE status = 'in_corso' ORDER BY started_at DESC LIMIT 1");
}

// ---- cache HTTP ----
export function cacheGet(db: Db, key: string, allowStale = false): { body: string; status: number; fetched_at: string } | null {
  const row = one<{ body: string; status: number; fetched_at: string; expires_at: string }>(db, "SELECT body, status, fetched_at, expires_at FROM http_cache WHERE key = ?", [key]);
  if (!row) return null;
  if (!allowStale && new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export function cacheSet(db: Db, key: string, url: string, status: number, body: string, ttlSeconds: number) {
  const now = new Date();
  run(
    db,
    `INSERT INTO http_cache (key, url, status, body, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET status = excluded.status, body = excluded.body, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    [key, url, status, body, now.toISOString(), new Date(now.getTime() + ttlSeconds * 1000).toISOString()],
  );
}

export function purgeCache(db: Db) {
  run(db, "DELETE FROM http_cache WHERE expires_at < ?", [new Date(Date.now() - 7 * 86400_000).toISOString()]);
}
