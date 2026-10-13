import type { Db } from "@/lib/db";
import { all, nowIso, one, run } from "@/lib/db";
import { SEASON_CODE } from "@/lib/repo/league";
import { MODEL_VERSION } from "@/lib/model/priors";
import { optimizeLineup, scoreLineup, type LineupResult, type Strategy } from "@/lib/model/lineup";
import { compareCandidates } from "@/lib/model/compare";
import { binaryMetrics, meanAbsError, type Observation } from "@/lib/model/calibration";
import { analyzeMatchday, persistEvaluations, type MatchdayAnalysis } from "./pipeline";
import type { PlayerEvaluation } from "@/lib/model/evaluate";

export interface StoredRecommendation {
  id: number;
  computedAt: string;
  dataVersion: number;
  result: LineupResult;
}

export interface SavedLineup {
  id: number;
  module: string;
  starters: number[];
  bench: number[];
  strategy: string | null;
  expected_points: number | null;
  saved_at: string;
  recommendation_id: number | null;
  notes: string | null;
}

function latestRecommendation(db: Db, userId: number, matchday: number, strategy: Strategy): StoredRecommendation | null {
  const row = one<{ id: number; computed_at: string; data_version: number; payload: string }>(
    db,
    "SELECT id, computed_at, data_version, payload FROM lineup_recommendations WHERE user_id = ? AND season_code = ? AND matchday = ? AND strategy = ? ORDER BY id DESC LIMIT 1",
    [userId, SEASON_CODE, matchday, strategy],
  );
  return row ? { id: row.id, computedAt: row.computed_at, dataVersion: row.data_version, result: JSON.parse(row.payload) } : null;
}

/**
 * Restituisce la formazione consigliata per giornata e strategia; la ricalcola solo
 * se i dati sono cambiati dall'ultima volta. Registra le variazioni rispetto alla precedente.
 */
export function getRecommendation(db: Db, userId: number, matchday: number, strategy: Strategy): {
  analysis: MatchdayAnalysis;
  rec: StoredRecommendation | null;
  previous: StoredRecommendation | null;
} {
  const analysis = analyzeMatchday(db, userId, matchday);
  persistEvaluations(db, userId, analysis);
  const last = latestRecommendation(db, userId, matchday, strategy);
  const settingsAt = one<{ updated_at: string }>(db, "SELECT updated_at FROM league_settings WHERE user_id = ?", [userId])?.updated_at ?? "";
  const lockedPast = analysis.firstKickoff && new Date(analysis.firstKickoff).getTime() < Date.now() - 3 * 86400_000;
  if (last && (last.dataVersion === analysis.dataVersion || lockedPast) && last.computedAt >= settingsAt) {
    return { analysis, rec: last, previous: null };
  }
  const result = optimizeLineup(analysis.candidates, analysis.sim, analysis.config, strategy);
  if (!result) return { analysis, rec: null, previous: last };
  const id = run(
    db,
    "INSERT INTO lineup_recommendations (user_id, season_code, matchday, strategy, module, computed_at, model_version, data_version, expected_points, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [userId, SEASON_CODE, matchday, strategy, result.module, nowIso(), MODEL_VERSION, analysis.dataVersion, result.metrics.mean, JSON.stringify(result)],
  ).lastId;
  // registro: chi entra / esce dagli undici consigliati
  if (last) {
    const before = new Set(last.result.starters.map((s) => s.playerId));
    const after = new Set(result.starters.map((s) => s.playerId));
    for (const pid of after) {
      if (!before.has(pid)) {
        run(db, "INSERT INTO evaluation_changes (user_id, player_id, season_code, matchday, changed_at, field, old_value, new_value, reason, significant) VALUES (?, ?, ?, ?, ?, 'Formazione consigliata', 'panchina', 'titolare', ?, 1)", [
          userId, pid, SEASON_CODE, matchday, nowIso(), `Strategia ${strategy}: sale tra i titolari dopo il ricalcolo`,
        ]);
      }
    }
    for (const pid of before) {
      if (!after.has(pid)) {
        run(db, "INSERT INTO evaluation_changes (user_id, player_id, season_code, matchday, changed_at, field, old_value, new_value, reason, significant) VALUES (?, ?, ?, ?, ?, 'Formazione consigliata', 'titolare', 'panchina', ?, 1)", [
          userId, pid, SEASON_CODE, matchday, nowIso(), `Strategia ${strategy}: esce dai titolari dopo il ricalcolo`,
        ]);
      }
    }
  }
  return { analysis, rec: { id, computedAt: nowIso(), dataVersion: analysis.dataVersion, result }, previous: last };
}

export function getSavedLineup(db: Db, userId: number, matchday: number): SavedLineup | null {
  const row = one<{ id: number; module: string; starters: string; bench: string; strategy: string | null; expected_points: number | null; saved_at: string; recommendation_id: number | null; notes: string | null }>(
    db,
    "SELECT * FROM saved_lineups WHERE user_id = ? AND season_code = ? AND matchday = ?",
    [userId, SEASON_CODE, matchday],
  );
  return row ? { ...row, starters: JSON.parse(row.starters), bench: JSON.parse(row.bench) } : null;
}

export function saveLineup(db: Db, userId: number, matchday: number, data: { module: string; starters: number[]; bench: number[]; strategy?: string | null; recommendationId?: number | null; expectedPoints?: number | null; notes?: string | null }) {
  run(
    db,
    `INSERT INTO saved_lineups (user_id, season_code, matchday, module, starters, bench, recommendation_id, strategy, expected_points, saved_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, season_code, matchday) DO UPDATE SET module = excluded.module, starters = excluded.starters, bench = excluded.bench,
       recommendation_id = excluded.recommendation_id, strategy = excluded.strategy, expected_points = excluded.expected_points, saved_at = excluded.saved_at, notes = excluded.notes`,
    [userId, SEASON_CODE, matchday, data.module, JSON.stringify(data.starters), JSON.stringify(data.bench), data.recommendationId ?? null, data.strategy ?? null, data.expectedPoints ?? null, nowIso(), data.notes ?? null],
  );
}

/** Differenze tra formazione salvata e consigliata attuale (per avvisare senza modificare nulla). */
export function diffSaved(saved: SavedLineup | null, rec: LineupResult | null) {
  if (!saved || !rec) return null;
  const recStart = new Set(rec.starters.map((s) => s.playerId));
  const savedStart = new Set(saved.starters);
  const toAdd = [...recStart].filter((x) => !savedStart.has(x));
  const toRemove = [...savedStart].filter((x) => !recStart.has(x));
  const benchOrderChanged = JSON.stringify(saved.bench) !== JSON.stringify(rec.bench.map((b) => b.playerId));
  return { toAdd, toRemove, benchOrderChanged, moduleChanged: saved.module !== rec.module, identical: toAdd.length === 0 && !benchOrderChanged && saved.module === rec.module };
}

export function scoreSaved(analysis: MatchdayAnalysis, saved: SavedLineup) {
  const mod = analysis.config.formazione.moduli.find((m) => m.name === saved.module) ?? analysis.config.formazione.moduli[0];
  // ricostruisce gli slot in ordine di modulo
  const remaining = [...saved.starters];
  const starters: { id: number; slot: string[] }[] = [];
  for (const slot of mod.slots) {
    const idx = remaining.findIndex((id) => {
      const c = analysis.candidates.find((x) => x.playerId === id);
      return c && c.roles.some((r) => slot.map((s) => s.toLowerCase()).includes(r.toLowerCase()));
    });
    if (idx >= 0) starters.push({ id: remaining.splice(idx, 1)[0], slot });
  }
  return scoreLineup(analysis.candidates, analysis.sim, analysis.config, starters, saved.bench);
}

export function compareForUser(db: Db, userId: number, matchday: number, playerIds: number[], strategy: Strategy) {
  const analysis = analyzeMatchday(db, userId, matchday);
  const cands = analysis.candidates.filter((c) => playerIds.includes(c.playerId));
  return { analysis, result: compareCandidates(cands, analysis.sim, analysis.config, strategy), cands };
}

// ---------------- risultati reali e calibrazione ----------------

export interface ActualLine {
  player_id: number;
  matchday: number;
  vote: number | null;
  fantavote: number | null;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  pen_scored: number;
  started: number | null;
  played: number | null;
  minutes: number | null;
}

/** Previsione "congelata": l'ultima valutazione calcolata prima del calcio d'inizio. */
function frozenPredictions(db: Db, userId: number) {
  return all<{ player_id: number; matchday: number; payload: string; expected_points: number | null; p_goal: number | null; p_assist: number | null; p_yellow: number | null; p_vote: number | null; p_start: number | null; computed_at: string }>(
    db,
    `SELECT e.player_id, e.matchday, e.payload, e.expected_points, e.p_goal, e.p_assist, e.p_yellow, e.p_vote, e.p_start, e.computed_at
     FROM evaluations e
     LEFT JOIN matches m ON m.id = e.match_id
     WHERE e.user_id = ? AND e.season_code = ? AND (m.kickoff_utc IS NULL OR e.computed_at < m.kickoff_utc)
       AND e.id = (SELECT e2.id FROM evaluations e2 LEFT JOIN matches m2 ON m2.id = e2.match_id
                   WHERE e2.user_id = e.user_id AND e2.player_id = e.player_id AND e2.season_code = e.season_code AND e2.matchday = e.matchday
                     AND (m2.kickoff_utc IS NULL OR e2.computed_at < m2.kickoff_utc)
                   ORDER BY e2.computed_at DESC LIMIT 1)`,
    [userId, SEASON_CODE],
  );
}

function actualFor(db: Db) {
  const rows = all<ActualLine & { source: string }>(
    db,
    "SELECT player_id, matchday, vote, fantavote, goals, assists, yellow, red, pen_scored, started, played, minutes, source FROM player_match_stats WHERE season_code = ?",
    [SEASON_CODE],
  );
  const map = new Map<string, ActualLine>();
  for (const r of rows) {
    const k = `${r.player_id}|${r.matchday}`;
    const cur = map.get(k);
    if (!cur || (cur.vote == null && r.vote != null)) map.set(k, r);
  }
  return map;
}

export function calibrationReport(db: Db, userId: number) {
  const preds = frozenPredictions(db, userId);
  const actual = actualFor(db);
  const importedMd = new Set(all<{ matchday: number }>(db, "SELECT DISTINCT matchday FROM player_match_stats WHERE season_code = ?", [SEASON_CODE]).map((r) => r.matchday));
  const goal: Observation[] = [];
  const assist: Observation[] = [];
  const yellow: Observation[] = [];
  const voted: Observation[] = [];
  const start: Observation[] = [];
  const points: { predicted: number; actual: number }[] = [];
  const baselinePts: { predicted: number; actual: number }[] = [];
  const perMatchday = new Map<number, { n: number; predicted: number; actual: number }>();
  for (const p of preds) {
    if (!importedMd.has(p.matchday)) continue; // nessun dato reale per quella giornata
    const ev = JSON.parse(p.payload) as PlayerEvaluation;
    const role = ev.role ?? "?";
    const a = actual.get(`${p.player_id}|${p.matchday}`);
    const didVote = a?.vote != null;
    const g = a ? (a.goals + a.pen_scored > 0 ? 1 : 0) : 0;
    if (p.p_vote != null) voted.push({ role, p: p.p_vote, outcome: didVote ? 1 : 0 });
    if (p.p_goal != null && role !== "P") goal.push({ role, p: p.p_goal, outcome: g as 0 | 1 });
    if (p.p_assist != null) assist.push({ role, p: p.p_assist, outcome: a && a.assists > 0 ? 1 : 0 });
    if (p.p_yellow != null) yellow.push({ role, p: p.p_yellow, outcome: a && a.yellow > 0 ? 1 : 0 });
    if (p.p_start != null && a?.started != null) start.push({ role, p: p.p_start, outcome: a.started === 1 ? 1 : 0 });
    if (p.expected_points != null && a) {
      const act = a.fantavote ?? 0;
      points.push({ predicted: p.expected_points, actual: act });
      const md = perMatchday.get(p.matchday) ?? { n: 0, predicted: 0, actual: 0 };
      md.n++;
      md.predicted += p.expected_points;
      md.actual += act;
      perMatchday.set(p.matchday, md);
    }
  }
  // baseline per i punti: media dei fantavoti osservati per ruolo
  const roleMeans = new Map<string, { s: number; n: number }>();
  for (const p of preds) {
    const a = actual.get(`${p.player_id}|${p.matchday}`);
    if (!a || !importedMd.has(p.matchday)) continue;
    const role = (JSON.parse(p.payload) as PlayerEvaluation).role ?? "?";
    const r = roleMeans.get(role) ?? { s: 0, n: 0 };
    r.s += a.fantavote ?? 0;
    r.n++;
    roleMeans.set(role, r);
  }
  for (const p of preds) {
    const a = actual.get(`${p.player_id}|${p.matchday}`);
    if (!a || !importedMd.has(p.matchday)) continue;
    const role = (JSON.parse(p.payload) as PlayerEvaluation).role ?? "?";
    const r = roleMeans.get(role)!;
    baselinePts.push({ predicted: r.s / r.n, actual: a.fantavote ?? 0 });
  }
  return {
    goal: binaryMetrics(goal),
    assist: binaryMetrics(assist),
    yellow: binaryMetrics(yellow),
    voted: binaryMetrics(voted),
    start: binaryMetrics(start),
    pointsMae: meanAbsError(points),
    baselinePointsMae: meanAbsError(baselinePts),
    pointsN: points.length,
    perMatchday: [...perMatchday.entries()].sort((a, b) => a[0] - b[0]).map(([md, v]) => ({ matchday: md, ...v })),
  };
}

/** Calcola il punteggio reale della formazione salvata (se i voti della giornata sono disponibili). */
export function computeMatchdayResult(db: Db, userId: number, matchday: number) {
  const saved = getSavedLineup(db, userId, matchday);
  if (!saved) return null;
  const actual = actualFor(db);
  const hasData = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM player_match_stats WHERE season_code = ? AND matchday = ?", [SEASON_CODE, matchday])?.n ?? 0;
  if (hasData === 0) return null;
  const settings = one<{ config: string }>(db, "SELECT config FROM league_settings WHERE user_id = ?", [userId]);
  const maxSubs = settings ? (JSON.parse(settings.config).formazione?.maxSostituzioni ?? 3) : 3;
  const roles = new Map(all<{ id: number; role_classic: string | null }>(db, `SELECT id, role_classic FROM players WHERE id IN (${[...saved.starters, ...saved.bench].map(() => "?").join(",") || "NULL"})`, [...saved.starters, ...saved.bench]).map((r) => [r.id, r.role_classic]));
  let total = 0;
  let subs = 0;
  const used = new Set<number>();
  const details: { playerId: number; points: number | null; subFor?: number }[] = [];
  for (const s of saved.starters) {
    const a = actual.get(`${s}|${matchday}`);
    if (a?.fantavote != null) {
      total += a.fantavote;
      details.push({ playerId: s, points: a.fantavote });
      continue;
    }
    let replaced = false;
    if (subs < maxSubs) {
      for (const b of saved.bench) {
        if (used.has(b) || roles.get(b) !== roles.get(s)) continue;
        const ab = actual.get(`${b}|${matchday}`);
        if (ab?.fantavote != null) {
          used.add(b);
          subs++;
          total += ab.fantavote;
          details.push({ playerId: b, points: ab.fantavote, subFor: s });
          replaced = true;
          break;
        }
      }
    }
    if (!replaced) details.push({ playerId: s, points: null });
  }
  run(
    db,
    `INSERT INTO matchday_results (user_id, season_code, matchday, saved_lineup_id, actual_points, expected_points, details, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, season_code, matchday) DO UPDATE SET saved_lineup_id = excluded.saved_lineup_id, actual_points = excluded.actual_points,
       expected_points = excluded.expected_points, details = excluded.details, computed_at = excluded.computed_at`,
    [userId, SEASON_CODE, matchday, saved.id, total, saved.expected_points, JSON.stringify(details), nowIso()],
  );
  return { total, details };
}
