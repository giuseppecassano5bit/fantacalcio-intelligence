import { getDb, bumpDataVersion, setState, getState, type Db } from "@/lib/db";
import { CONNECTORS } from "@/lib/connectors/registry";
import type { ConnectorOutcome, DataKind } from "@/lib/connectors/types";
import { currentMatchday, listMatchdays, SEASON_CODE } from "@/lib/repo/league";
import { finishSyncRun, getConnectorStatus, markConnectorError, markConnectorSuccess, runningSync, startSyncRun, purgeCache, type SyncTrigger } from "@/lib/repo/sync";
import { usersWithRoster } from "@/lib/repo/players";
import { analyzeMatchday, persistEvaluations } from "@/lib/analysis/pipeline";
import { getRecommendation, computeMatchdayResult } from "@/lib/analysis/recommend";
import { all } from "@/lib/db";

export type SyncScope = "leggero" | "completo" | "risultati" | "formazioni";

export const SCOPE_LABEL: Record<SyncScope, string> = {
  leggero: "Calendario e risultati",
  completo: "Aggiornamento completo",
  risultati: "Risultati e statistiche post-partita",
  formazioni: "Formazioni ufficiali e ultime notizie",
};

const SCOPE_KINDS: Record<SyncScope, DataKind[]> = {
  leggero: ["calendario", "risultati", "squadre"],
  completo: ["calendario", "risultati", "squadre", "rose", "statistiche_giocatori", "infortuni", "formazioni_ufficiali", "notizie"],
  risultati: ["calendario", "risultati", "statistiche_giocatori"],
  formazioni: ["calendario", "formazioni_ufficiali", "infortuni", "notizie"],
};

export interface SyncReport {
  runId: number | null;
  scope: SyncScope;
  status: "ok" | "parziale" | "errore" | "saltata";
  reason: string;
  startedAt: string;
  finishedAt: string;
  outcomes: ConnectorOutcome[];
  recomputed: { users: number; changes: number };
  message?: string;
}

let inProcess = false;

function focusMatchdays(db: Db): number[] {
  const cur = currentMatchday(db);
  const md = cur?.matchday ?? 1;
  const set = new Set([md - 1, md, md + 1, md + 2].filter((x) => x >= 1 && x <= 38));
  // giornate con partite rinviate ancora da recuperare
  for (const m of all<{ matchday: number }>(db, "SELECT DISTINCT matchday FROM matches WHERE season_code = ? AND status IN ('rinviata','sospesa')", [SEASON_CODE])) set.add(m.matchday);
  return [...set].sort((a, b) => a - b);
}

/**
 * Esegue una sincronizzazione. Ogni connettore è indipendente: l'errore di una fonte
 * non blocca le altre e viene registrato nello stato del connettore.
 */
export async function runSync(opts: { trigger: SyncTrigger; scope: SyncScope; reason: string; force?: boolean }): Promise<SyncReport> {
  const db = getDb("reale");
  const startedAt = new Date().toISOString();
  if (inProcess || runningSync(db)) {
    return { runId: null, scope: opts.scope, status: "saltata", reason: opts.reason, startedAt, finishedAt: startedAt, outcomes: [], recomputed: { users: 0, changes: 0 }, message: "Una sincronizzazione è già in corso." };
  }
  inProcess = true;
  const runId = startSyncRun(db, opts.trigger, opts.scope, opts.reason);
  const outcomes: ConnectorOutcome[] = [];
  const kinds = SCOPE_KINDS[opts.scope];
  try {
    const hasCalendar = listMatchdays(db).length > 0;
    for (const c of CONNECTORS) {
      const st = getConnectorStatus(db, c.id);
      const relevant = c.provides.some((k) => kinds.includes(k));
      if (!relevant) continue;
      if (!st.enabled) {
        outcomes.push({ connector: c.id, ok: true, skipped: "Disattivato nelle impostazioni", items: {}, messages: [] });
        continue;
      }
      if (!c.isConfigured()) {
        outcomes.push({ connector: c.id, ok: true, skipped: c.requiresKey ? "Chiave API non configurata" : "Non configurato", items: {}, messages: [] });
        continue;
      }
      // openfootball serve come base: negli aggiornamenti frequenti basta la cache
      if (c.id === "openfootball" && hasCalendar && (opts.scope === "formazioni")) continue;
      try {
        const res = await c.sync({ db, force: !!opts.force, focusMatchdays: focusMatchdays(db), log: () => {}, now: Date.now() }, kinds);
        outcomes.push(res);
        if (res.skipped) continue;
        if (res.ok) markConnectorSuccess(db, c.id);
        else markConnectorError(db, c.id, res.messages.join("; ") || "errore");
        if (res.stale) markConnectorError(db, c.id, "Fonte non raggiungibile: usati dati in cache (scaduti)");
      } catch (e) {
        const msg = (e as Error).message;
        markConnectorError(db, c.id, msg);
        outcomes.push({ connector: c.id, ok: false, items: {}, messages: [], error: msg });
      }
    }
    bumpDataVersion(db);
    setState(db, `last_${opts.scope}_at`, new Date().toISOString());
    if (opts.scope === "completo") setState(db, "last_leggero_at", new Date().toISOString());
    purgeCache(db);

    // ricalcolo delle valutazioni per ogni utente con una rosa
    let changes = 0;
    const users = usersWithRoster(db);
    const cur = currentMatchday(db);
    for (const u of users) {
      if (!cur) break;
      try {
        const a = analyzeMatchday(db, u, cur.matchday);
        changes += persistEvaluations(db, u, a).changes;
        getRecommendation(db, u, cur.matchday, "equilibrata");
        // risultati delle giornate concluse con formazione salvata
        for (const md of listMatchdays(db).filter((m) => m.matchday < cur.matchday).slice(-3)) computeMatchdayResult(db, u, md.matchday);
      } catch (e) {
        outcomes.push({ connector: "ricalcolo", ok: false, items: {}, messages: [], error: `Utente ${u}: ${(e as Error).message}` });
      }
    }
    const failed = outcomes.filter((o) => !o.ok && !o.skipped);
    const status: SyncReport["status"] = failed.length === 0 ? "ok" : failed.length < outcomes.filter((o) => !o.skipped).length ? "parziale" : "errore";
    const report: SyncReport = { runId, scope: opts.scope, status, reason: opts.reason, startedAt, finishedAt: new Date().toISOString(), outcomes, recomputed: { users: users.length, changes } };
    finishSyncRun(db, runId, status, report);
    return report;
  } catch (e) {
    const report: SyncReport = { runId, scope: opts.scope, status: "errore", reason: opts.reason, startedAt, finishedAt: new Date().toISOString(), outcomes, recomputed: { users: 0, changes: 0 }, message: (e as Error).message };
    finishSyncRun(db, runId, "errore", report);
    return report;
  } finally {
    inProcess = false;
  }
}

export function lastScopeRun(db: Db, scope: SyncScope): string | null {
  return getState(db, `last_${scope}_at`);
}
