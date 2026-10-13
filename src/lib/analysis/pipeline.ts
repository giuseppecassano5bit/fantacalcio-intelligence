import type { Db } from "@/lib/db";
import { all, getDataVersion, nowIso, one, run, tx } from "@/lib/db";
import { playerRolesForMode, type LeagueConfig, type RoleClassic } from "@/lib/domain/settings";
import { SEASON_CODE, listMatchesOfMatchday, listMatchdays, teamPlayedMatches, type MatchRow } from "@/lib/repo/league";
import { getRoster, type RosterRow } from "@/lib/repo/players";
import {
  activeAvailability,
  editorialFor,
  getLeagueSettings,
  getMatchStatsMany,
  getSeasonStatsMany,
  lineupReportsForMatches,
  type MatchStatsRow,
  type SeasonStatsRow,
} from "@/lib/repo/data";
import type { AvailInput, EditorialInput, LineupInput, MatchInfo, MatchLine, PlayerInput, SeasonAgg } from "@/lib/model/inputs";
import { buildLeagueTable, type AdvancedTeamStats, type LeagueTable } from "@/lib/model/teamStrength";
import { evaluatePlayer, type PlayerEvaluation } from "@/lib/model/evaluate";
import { simulate, playerSimStats, type SimOutput, type PlayerSimStats } from "@/lib/model/simulate";
import { computeFantavalue } from "@/lib/model/fantavalue";
import { hashSeed } from "@/lib/model/rng";
import { MODEL_VERSION } from "@/lib/model/priors";
import type { Candidate } from "@/lib/model/lineup";

export const SIM_ITERATIONS = 4000;

export interface MatchdayAnalysis {
  season: string;
  matchday: number;
  computedAt: string;
  dataVersion: number;
  config: LeagueConfig;
  provisional: boolean;
  table: LeagueTable;
  roster: RosterRow[];
  evaluations: PlayerEvaluation[];
  stats: Map<number, PlayerSimStats | null>;
  candidates: Candidate[];
  sim: SimOutput;
  matches: MatchRow[];
  firstKickoff: string | null;
}

export function toSeasonAgg(r: SeasonStatsRow): SeasonAgg {
  return {
    season: r.season_code,
    source: r.source,
    asOf: r.as_of,
    apps: r.appearances,
    starts: r.starts,
    minutes: r.minutes,
    avgVote: r.avg_vote,
    avgFantavote: r.avg_fantavote,
    goals: r.goals,
    assists: r.assists,
    penTaken: r.penalties_taken,
    penScored: r.penalties_scored,
    penMissed: r.penalties_missed,
    penSaved: r.penalties_saved,
    yellow: r.yellow_cards,
    red: r.red_cards,
    ownGoals: r.own_goals,
    goalsConceded: r.goals_conceded,
    xg: r.xg,
    xa: r.xa,
    shots: r.shots,
    shotsOnTarget: r.shots_on_target,
    keyPasses: r.key_passes,
  };
}

/** Riduce più righe per la stessa giornata (fonti diverse) a una sola, preferendo quella più ricca. */
export function toMatchLines(rows: MatchStatsRow[]): MatchLine[] {
  const byMd = new Map<number, MatchStatsRow>();
  for (const r of rows) {
    const cur = byMd.get(r.matchday);
    const richness = (x: MatchStatsRow) => (x.minutes != null ? 2 : 0) + (x.vote != null ? 1 : 0) + (x.xg != null ? 1 : 0);
    if (!cur || richness(r) > richness(cur)) byMd.set(r.matchday, r);
  }
  return [...byMd.values()].map((r) => ({
    matchday: r.matchday,
    source: r.source,
    played: r.played === 1 || r.vote != null || (r.minutes ?? 0) > 0,
    started: r.started == null ? null : r.started === 1,
    minutes: r.minutes,
    vote: r.vote,
    fantavote: r.fantavote,
    goals: r.goals ?? 0,
    assists: r.assists ?? 0,
    yellow: r.yellow ?? 0,
    red: r.red ?? 0,
    ownGoals: r.own_goals ?? 0,
    penScored: r.pen_scored ?? 0,
    penMissed: r.pen_missed ?? 0,
    penSaved: r.pen_saved ?? 0,
    goalsConceded: r.goals_conceded ?? 0,
    xg: r.xg,
    xa: r.xa,
    shots: r.shots,
  }));
}

export function toPlayerInput(p: RosterRow | (Omit<RosterRow, "entry_id" | "added_at" | "purchase_price" | "notes">)): PlayerInput {
  return {
    id: p.id,
    name: p.full_name,
    role: p.role_classic,
    rolesMantra: p.roles_mantra,
    teamId: p.current_team_id,
    teamName: p.team_name,
    status: p.status,
    statusSource: p.status_source,
    statusUpdatedAt: p.status_updated_at,
    penaltyOrder: p.penalty_order,
    penaltyOrderSource: p.penalty_order_source,
    officialVerified: p.official_verified === 1,
    lastVerifiedAt: p.last_verified_at,
  };
}

function loadAdvanced(db: Db, season: string): Map<number, AdvancedTeamStats> {
  const rows = all<{ team_id: number; matches: number | null; xg_for: number | null; xg_against: number | null; shots_for: number | null; shots_against: number | null }>(
    db,
    "SELECT team_id, matches, xg_for, xg_against, shots_for, shots_against FROM team_advanced_stats WHERE season_code = ? ORDER BY as_of",
    [season],
  );
  const map = new Map<number, AdvancedTeamStats>();
  for (const r of rows) map.set(r.team_id, { matches: r.matches, xgFor: r.xg_for, xgAgainst: r.xg_against, shotsFor: r.shots_for, shotsAgainst: r.shots_against });
  return map;
}

/** Tabella di forza delle squadre usando solo partite giocate prima della giornata analizzata. */
export function leagueTableBefore(db: Db, matchday: number, season = SEASON_CODE): { table: LeagueTable; teamMatchdays: Map<number, number[]> } {
  const md = listMatchdays(db, season).find((m) => m.matchday === matchday);
  const cutoff = md?.firstKickoff ?? null;
  const played = teamPlayedMatches(db, season).filter((m) => (cutoff ? (m.kickoff_utc ?? "") < cutoff : m.matchday < matchday));
  const table = buildLeagueTable(
    played.map((m) => ({ homeId: m.home_team_id, awayId: m.away_team_id, homeGoals: m.home_goals!, awayGoals: m.away_goals!, kickoff: m.kickoff_utc })),
    loadAdvanced(db, season),
  );
  const teamMatchdays = new Map<number, number[]>();
  for (const m of played) {
    for (const t of [m.home_team_id, m.away_team_id]) {
      if (!teamMatchdays.has(t)) teamMatchdays.set(t, []);
      teamMatchdays.get(t)!.push(m.matchday);
    }
  }
  return { table, teamMatchdays };
}

const cache = new Map<string, MatchdayAnalysis>();
const dbIds = new WeakMap<Db, number>();
let dbSeq = 0;
function dbId(db: Db): number {
  if (!dbIds.has(db)) dbIds.set(db, ++dbSeq);
  return dbIds.get(db)!;
}

/**
 * Analisi completa di una giornata per la rosa dell'utente (o per un insieme di giocatori).
 * Il risultato è deterministico per gli stessi dati (simulazione con seme fisso).
 */
export function analyzeMatchday(db: Db, userId: number, matchday: number, opts: { now?: number; season?: string } = {}): MatchdayAnalysis {
  const season = opts.season ?? SEASON_CODE;
  const dataVersion = getDataVersion(db);
  const settings = getLeagueSettings(db, userId);
  const key = `${dbId(db)}|${userId}|${season}|${matchday}|${dataVersion}|${settings.updatedAt}|${opts.now ? Math.floor(opts.now / 3_600_000) : Math.floor(Date.now() / 3_600_000)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const now = opts.now ?? Date.now();
  const cfg = settings.config;
  const roster = getRoster(db, userId);
  const ids = roster.map((r) => r.id);
  const seasonStats = getSeasonStatsMany(db, ids);
  const matchStats = getMatchStatsMany(db, ids, season);
  const importedMatchdays = all<{ matchday: number }>(db, "SELECT DISTINCT matchday FROM player_match_stats WHERE season_code = ?", [season]).map((r) => r.matchday);
  const { table, teamMatchdays } = leagueTableBefore(db, matchday, season);
  const matches = listMatchesOfMatchday(db, matchday, season);
  const mdInfo = listMatchdays(db, season).find((m) => m.matchday === matchday);
  const lineupRows = lineupReportsForMatches(db, matches.map((m) => m.id));
  const avail = activeAvailability(db, ids);
  const editorial = editorialFor(db, userId, ids, season);

  const evaluations: PlayerEvaluation[] = roster.map((p) => {
    const match = matches.find((m) => m.home_team_id === p.current_team_id || m.away_team_id === p.current_team_id) ?? null;
    const mi: MatchInfo | null =
      match && p.current_team_id
        ? {
            id: match.id,
            matchday: match.matchday,
            kickoff: match.kickoff_utc,
            kickoffKnown: match.kickoff_time_known === 1,
            status: match.status,
            isHome: match.home_team_id === p.current_team_id,
            teamId: p.current_team_id,
            oppId: match.home_team_id === p.current_team_id ? match.away_team_id : match.home_team_id,
            oppName: match.home_team_id === p.current_team_id ? match.away_name : match.home_name,
          }
        : null;
    const lineups: LineupInput[] = lineupRows
      .filter((l) => l.player_id === p.id && match && l.match_id === match.id)
      .map((l) => ({ kind: l.kind, status: l.status, probability: l.probability, source: l.source, reportedAt: l.reported_at, url: l.url }));
    const av: AvailInput[] = avail
      .filter((a) => a.player_id === p.id)
      .map((a) => ({ kind: a.kind, certainty: a.certainty, description: a.description, expectedReturn: a.expected_return, source: a.source, url: a.url, reportedAt: a.reported_at }));
    const ed: EditorialInput[] = editorial
      .filter((e) => e.player_id === p.id)
      .map((e) => ({ source: e.source, verdict: e.verdict, explicit: e.explicit_advice === 1, matchday: e.matchday, publishedAt: e.published_at ?? e.created_at, storyKey: e.story_key, summary: e.summary, url: e.url }));
    return evaluatePlayer(
      {
        player: toPlayerInput(p),
        season,
        seasonRows: (seasonStats.get(p.id) ?? []).map(toSeasonAgg),
        matchLines: toMatchLines(matchStats.get(p.id) ?? []),
        importedMatchdays,
        teamMatchdays: p.current_team_id ? teamMatchdays.get(p.current_team_id) ?? [] : [],
        match: mi,
        availability: av,
        lineups,
        editorial: ed,
        matchday,
      },
      table,
      cfg,
      now,
    );
  });

  const params = evaluations.map((e) => e.sim).filter((s): s is NonNullable<typeof s> => s != null);
  const sim = simulate(params, cfg, SIM_ITERATIONS, hashSeed(userId, season, matchday, dataVersion));
  const stats = new Map<number, PlayerSimStats | null>();
  for (const ev of evaluations) {
    const st = playerSimStats(sim, ev.playerId, cfg);
    stats.set(ev.playerId, st);
    if (st) {
      ev.points.expectedFantavoteIfVote = st.expectedFvIfVote;
      ev.points.expectedPoints = st.expectedPoints;
      ev.points.expectedIfStarts = st.expectedIfStarts;
      ev.points.p10 = st.p10;
      ev.points.p90 = st.p90;
      ev.probs.bigGame = { p: st.pBigGame, low: st.pBigGame, high: st.pBigGame, insufficient: ev.reliability.level === "bassa", note: "Fantavoto di almeno 9, dalla simulazione." };
    }
    ev.fantavalue = computeFantavalue(ev, table);
  }

  const candidates: Candidate[] = evaluations.map((ev) => {
    const p = roster.find((r) => r.id === ev.playerId)!;
    return {
      playerId: ev.playerId,
      name: ev.name,
      roles: playerRolesForMode(cfg, p.role_classic, p.roles_mantra),
      classicRole: (p.role_classic ?? "C") as RoleClassic,
      ev,
      stats: stats.get(ev.playerId) ?? null,
    };
  });

  const result: MatchdayAnalysis = {
    season,
    matchday,
    computedAt: new Date(now).toISOString(),
    dataVersion,
    config: cfg,
    provisional: settings.provisional,
    table,
    roster,
    evaluations,
    stats,
    candidates,
    sim,
    matches,
    firstKickoff: mdInfo?.firstKickoff ?? null,
  };
  if (cache.size > 30) cache.clear();
  cache.set(key, result);
  return result;
}

// ---------------- storico valutazioni e registro variazioni ----------------

interface StoredEval {
  id: number;
  player_id: number;
  computed_at: string;
  data_version: number;
  fantavalue: number | null;
  expected_points: number | null;
  p_start: number | null;
  p_vote: number | null;
  payload: string;
}

const pct = (x: number | null | undefined) => (x == null ? "n.d." : `${Math.round(x * 100)}%`);

/**
 * Salva le valutazioni correnti (se i dati sono cambiati) e registra le variazioni
 * rilevanti rispetto alla valutazione precedente, con il motivo.
 */
export function persistEvaluations(db: Db, userId: number, a: MatchdayAnalysis): { saved: boolean; changes: number } {
  const prev = all<StoredEval>(
    db,
    "SELECT id, player_id, computed_at, data_version, fantavalue, expected_points, p_start, p_vote, payload FROM evaluations WHERE user_id = ? AND season_code = ? AND matchday = ? AND is_latest = 1",
    [userId, a.season, a.matchday],
  );
  const prevBy = new Map(prev.map((p) => [p.player_id, p]));
  const allSame = a.evaluations.length === prev.length && prev.every((p) => p.data_version === a.dataVersion);
  if (allSame) return { saved: false, changes: 0 };
  // non registrare valutazioni dopo l'inizio della partita del giocatore (restano quelle pre-partita)
  let changes = 0;
  tx(db, () => {
    for (const ev of a.evaluations) {
      if (ev.match?.kickoff && new Date(ev.match.kickoff).getTime() < Date.now() && prevBy.has(ev.playerId)) continue;
      const old = prevBy.get(ev.playerId);
      if (old && old.data_version === a.dataVersion) continue;
      if (old) {
        const oldEv = JSON.parse(old.payload) as PlayerEvaluation;
        const newSources = ev.playing.sources.filter((s) => s.at && s.at > old.computed_at).map((s) => s.label);
        const reason = newSources.length ? `Nuove informazioni: ${Array.from(new Set(newSources)).join(", ")}` : "Ricalcolo con dati aggiornati (risultati, statistiche o impostazioni)";
        const rec = (field: string, o: string, n: string, significant: boolean) => {
          run(
            db,
            "INSERT INTO evaluation_changes (user_id, player_id, season_code, matchday, changed_at, field, old_value, new_value, reason, significant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [userId, ev.playerId, a.season, a.matchday, nowIso(), field, o, n, reason, significant ? 1 : 0],
          );
          changes++;
        };
        if (oldEv.playing.availabilityLabel !== ev.playing.availabilityLabel) rec("Disponibilità", oldEv.playing.availabilityLabel, ev.playing.availabilityLabel, true);
        if (old.p_start != null && Math.abs(old.p_start - ev.playing.pStart) >= 0.1) rec("Titolarità stimata", pct(old.p_start), pct(ev.playing.pStart), Math.abs(old.p_start - ev.playing.pStart) >= 0.15);
        if (old.expected_points != null && ev.points.expectedPoints != null && Math.abs(old.expected_points - ev.points.expectedPoints) >= 0.5) {
          rec("Punti attesi", old.expected_points.toFixed(1), ev.points.expectedPoints.toFixed(1), Math.abs(old.expected_points - ev.points.expectedPoints) >= 1);
        }
        if (old.fantavalue != null && ev.fantavalue && Math.abs(old.fantavalue - ev.fantavalue.index) >= 10) rec("Fantavalue", String(old.fantavalue), String(ev.fantavalue.index), false);
        if (oldEv.playing.official !== ev.playing.official && ev.playing.official) rec("Formazione ufficiale", "non pubblicata", ev.playing.availabilityLabel, true);
        run(db, "UPDATE evaluations SET is_latest = 0 WHERE id = ?", [old.id]);
      }
      const { sim: _sim, ...payload } = ev;
      void _sim;
      run(
        db,
        `INSERT INTO evaluations (user_id, player_id, season_code, matchday, match_id, computed_at, model_version, data_version, fantavalue, expected_points, p_start, p_vote, p_goal, p_assist, p_yellow, p_red, reliability, payload, is_latest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          userId,
          ev.playerId,
          a.season,
          a.matchday,
          ev.match?.id ?? null,
          a.computedAt,
          MODEL_VERSION,
          a.dataVersion,
          ev.fantavalue?.index ?? null,
          ev.points.expectedPoints,
          ev.playing.pStart,
          ev.playing.pVote,
          ev.probs.goal.p,
          ev.probs.assist.p,
          ev.probs.yellow.p,
          ev.probs.red.p,
          ev.reliability.level,
          JSON.stringify(payload),
        ],
      );
    }
  });
  return { saved: true, changes };
}

export function recentChanges(db: Db, userId: number, matchday: number, opts: { onlySignificant?: boolean; limit?: number } = {}) {
  return all<{ id: number; player_id: number; full_name: string; changed_at: string; field: string; old_value: string; new_value: string; reason: string; significant: number }>(
    db,
    `SELECT c.*, p.full_name FROM evaluation_changes c JOIN players p ON p.id = c.player_id
     WHERE c.user_id = ? AND c.season_code = ? AND c.matchday = ? ${opts.onlySignificant ? "AND c.significant = 1" : ""}
     ORDER BY c.changed_at DESC, c.id DESC LIMIT ?`,
    [userId, SEASON_CODE, matchday, opts.limit ?? 50],
  );
}

export function lastEvaluationTime(db: Db, userId: number, matchday: number): string | null {
  return one<{ t: string | null }>(db, "SELECT MAX(computed_at) AS t FROM evaluations WHERE user_id = ? AND season_code = ? AND matchday = ?", [userId, SEASON_CODE, matchday])?.t ?? null;
}
