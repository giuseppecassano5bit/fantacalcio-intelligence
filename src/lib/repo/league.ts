import type { Db } from "@/lib/db";
import { all, one, run, nowIso, tx } from "@/lib/db";
import { teamKey, teamDisplayName } from "@/lib/domain/text";

export const SEASON_CODE = process.env.SEASON_CODE || "2026-27";
export const SEASON_LABEL = `Serie A ${SEASON_CODE.replace("-", "/")}`;

export type MatchStatus = "programmata" | "in_corso" | "terminata" | "rinviata" | "sospesa" | "annullata";

export interface TeamRow {
  id: number;
  season_code: string;
  canonical_key: string;
  name: string;
  short_name: string | null;
  tactical_notes: string | null;
  tactical_notes_source: string | null;
  tactical_notes_updated_at: string | null;
}

export interface MatchRow {
  id: number;
  season_code: string;
  matchday: number;
  home_team_id: number;
  away_team_id: number;
  kickoff_utc: string | null;
  kickoff_time_known: number;
  status: MatchStatus;
  home_goals: number | null;
  away_goals: number | null;
  source: string;
  source_priority: number;
  verified_at: string;
  home_name: string;
  away_name: string;
  home_key: string;
  away_key: string;
}

export function ensureSeason(db: Db, code = SEASON_CODE): void {
  run(
    db,
    "INSERT INTO seasons (code, label, is_current) VALUES (?, ?, 1) ON CONFLICT(code) DO NOTHING",
    [code, `Serie A ${code.replace("-", "/")}`],
  );
}

/** Restituisce l'id della squadra (creandola se necessario) a partire da un nome di qualsiasi fonte. */
export function upsertTeam(
  db: Db,
  name: string,
  opts: { source?: string; externalId?: string | number | null; season?: string } = {},
): number {
  const season = opts.season ?? SEASON_CODE;
  const key = teamKey(name);
  if (opts.source && opts.externalId != null) {
    const ext = one<{ team_id: number }>(
      db,
      "SELECT t.id AS team_id FROM team_external_ids e JOIN teams t ON t.id = e.team_id WHERE e.source = ? AND e.external_id = ? AND t.season_code = ?",
      [opts.source, String(opts.externalId), season],
    );
    if (ext) return ext.team_id;
  }
  let row = one<{ id: number }>(db, "SELECT id FROM teams WHERE season_code = ? AND canonical_key = ?", [season, key]);
  if (!row) {
    const r = run(db, "INSERT INTO teams (season_code, canonical_key, name, short_name) VALUES (?, ?, ?, ?)", [
      season,
      key,
      teamDisplayName(key, name),
      teamDisplayName(key, name),
    ]);
    row = { id: r.lastId };
  }
  if (opts.source && opts.externalId != null) {
    run(db, "INSERT OR IGNORE INTO team_external_ids (team_id, source, external_id) VALUES (?, ?, ?)", [
      row.id,
      opts.source,
      String(opts.externalId),
    ]);
  }
  return row.id;
}

export function findTeamByName(db: Db, name: string, season = SEASON_CODE): TeamRow | undefined {
  return one<TeamRow>(db, "SELECT * FROM teams WHERE season_code = ? AND canonical_key = ?", [season, teamKey(name)]);
}

export function listTeams(db: Db, season = SEASON_CODE): TeamRow[] {
  return all<TeamRow>(db, "SELECT * FROM teams WHERE season_code = ? ORDER BY name", [season]);
}

export interface MatchInput {
  matchday: number;
  home: string;
  away: string;
  kickoffUtc: string | null;
  timeKnown: boolean;
  status: MatchStatus;
  homeGoals: number | null;
  awayGoals: number | null;
  source: string;
  priority: number; // precedenza della fonte: più alta vince
  externalId?: string | number | null;
  homeExtId?: string | number | null;
  awayExtId?: string | number | null;
}

export interface UpsertMatchResult {
  id: number;
  changed: boolean;
  discrepancies: { field: string; existing: string; incoming: string; existingSource: string }[];
}

/**
 * Inserisce o aggiorna una partita. Una fonte con precedenza più bassa non sovrascrive
 * i dati di una fonte con precedenza più alta, ma le differenze vengono registrate.
 */
export function upsertMatch(db: Db, m: MatchInput, season = SEASON_CODE): UpsertMatchResult {
  return tx(db, () => {
    const homeId = upsertTeam(db, m.home, { source: m.source, externalId: m.homeExtId, season });
    const awayId = upsertTeam(db, m.away, { source: m.source, externalId: m.awayExtId, season });
    const existing = one<MatchRow>(
      db,
      "SELECT * FROM matches WHERE season_code = ? AND home_team_id = ? AND away_team_id = ?",
      [season, homeId, awayId],
    );
    const now = nowIso();
    const discrepancies: UpsertMatchResult["discrepancies"] = [];
    let id: number;
    let changed = false;
    if (!existing) {
      id = run(
        db,
        `INSERT INTO matches (season_code, matchday, home_team_id, away_team_id, kickoff_utc, kickoff_time_known, status, home_goals, away_goals, source, source_priority, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [season, m.matchday, homeId, awayId, m.kickoffUtc, m.timeKnown ? 1 : 0, m.status, m.homeGoals, m.awayGoals, m.source, m.priority, now],
      ).lastId;
      changed = true;
    } else {
      id = existing.id;
      // confronto dei campi principali tra fonti diverse
      if (existing.source !== m.source) {
        const sameKick =
          !existing.kickoff_utc || !m.kickoffUtc || !existing.kickoff_time_known || !m.timeKnown ||
          Math.abs(new Date(existing.kickoff_utc).getTime() - new Date(m.kickoffUtc).getTime()) < 60_000;
        if (!sameKick) {
          discrepancies.push({ field: "orario", existing: existing.kickoff_utc!, incoming: m.kickoffUtc!, existingSource: existing.source });
        }
        if (existing.status === "terminata" && m.status === "terminata" &&
            (existing.home_goals !== m.homeGoals || existing.away_goals !== m.awayGoals) && m.homeGoals != null) {
          discrepancies.push({
            field: "risultato",
            existing: `${existing.home_goals}-${existing.away_goals}`,
            incoming: `${m.homeGoals}-${m.awayGoals}`,
            existingSource: existing.source,
          });
        }
        if (existing.matchday !== m.matchday) {
          discrepancies.push({ field: "giornata", existing: String(existing.matchday), incoming: String(m.matchday), existingSource: existing.source });
        }
      }
      const canOverride = m.priority >= existing.source_priority;
      // una fonte meno prioritaria può comunque completare un risultato mancante
      const fillsResult = !canOverride && existing.status !== "terminata" && m.status === "terminata" && m.homeGoals != null;
      if (canOverride) {
        const differs =
          existing.kickoff_utc !== m.kickoffUtc || existing.status !== m.status || existing.home_goals !== m.homeGoals ||
          existing.away_goals !== m.awayGoals || existing.matchday !== m.matchday;
        run(
          db,
          `UPDATE matches SET matchday = ?, kickoff_utc = COALESCE(?, kickoff_utc), kickoff_time_known = ?, status = ?, home_goals = ?, away_goals = ?,
             source = ?, source_priority = ?, verified_at = ? WHERE id = ?`,
          [m.matchday, m.kickoffUtc, m.timeKnown ? 1 : existing.kickoff_time_known, m.status, m.homeGoals, m.awayGoals, m.source, m.priority, now, id],
        );
        changed = differs;
      } else if (fillsResult) {
        run(db, "UPDATE matches SET status = 'terminata', home_goals = ?, away_goals = ?, verified_at = ? WHERE id = ?", [
          m.homeGoals,
          m.awayGoals,
          now,
          id,
        ]);
        changed = true;
      }
    }
    if (m.externalId != null) {
      run(db, "INSERT OR IGNORE INTO match_external_ids (match_id, source, external_id) VALUES (?, ?, ?)", [id, m.source, String(m.externalId)]);
    }
    for (const d of discrepancies) {
      run(
        db,
        `INSERT INTO data_discrepancies (entity, entity_id, field, source_a, value_a, source_b, value_b, detected_at, resolved)
         VALUES ('partita', ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(entity, entity_id, field, source_a, source_b) DO UPDATE SET value_a = excluded.value_a, value_b = excluded.value_b, detected_at = excluded.detected_at, resolved = 0`,
        [id, d.field, d.existingSource, d.existing, m.source, d.incoming, now],
      );
    }
    if (discrepancies.length === 0 && existing && existing.source !== m.source) {
      run(db, "UPDATE data_discrepancies SET resolved = 1 WHERE entity = 'partita' AND entity_id = ? AND source_b = ?", [id, m.source]);
    }
    return { id, changed, discrepancies };
  });
}

const MATCH_SELECT = `
  SELECT m.*, h.name AS home_name, a.name AS away_name, h.canonical_key AS home_key, a.canonical_key AS away_key
  FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id`;

export function listMatchesOfMatchday(db: Db, matchday: number, season = SEASON_CODE): MatchRow[] {
  return all<MatchRow>(db, `${MATCH_SELECT} WHERE m.season_code = ? AND m.matchday = ? ORDER BY m.kickoff_utc, h.name`, [season, matchday]);
}

export function listAllMatches(db: Db, season = SEASON_CODE): MatchRow[] {
  return all<MatchRow>(db, `${MATCH_SELECT} WHERE m.season_code = ? ORDER BY m.matchday, m.kickoff_utc`, [season]);
}

export function getMatch(db: Db, id: number): MatchRow | undefined {
  return one<MatchRow>(db, `${MATCH_SELECT} WHERE m.id = ?`, [id]);
}

export function findMatchForTeam(db: Db, teamId: number, matchday: number, season = SEASON_CODE): MatchRow | undefined {
  return one<MatchRow>(
    db,
    `${MATCH_SELECT} WHERE m.season_code = ? AND m.matchday = ? AND (m.home_team_id = ? OR m.away_team_id = ?)`,
    [season, matchday, teamId, teamId],
  );
}

export interface MatchdayInfo {
  matchday: number;
  firstKickoff: string | null;
  lastKickoff: string | null;
  total: number;
  finished: number;
  postponed: number;
}

export function listMatchdays(db: Db, season = SEASON_CODE): MatchdayInfo[] {
  return all<MatchdayInfo>(
    db,
    `SELECT matchday, MIN(kickoff_utc) AS firstKickoff, MAX(kickoff_utc) AS lastKickoff, COUNT(*) AS total,
            SUM(CASE WHEN status = 'terminata' THEN 1 ELSE 0 END) AS finished,
            SUM(CASE WHEN status IN ('rinviata','sospesa','annullata') THEN 1 ELSE 0 END) AS postponed
     FROM matches WHERE season_code = ? GROUP BY matchday ORDER BY matchday`,
    [season],
  );
}

/** Giornata corrente: la prima non ancora conclusa (escluse le partite rinviate). */
export function currentMatchday(db: Db, season = SEASON_CODE, now = Date.now()): MatchdayInfo | null {
  const mds = listMatchdays(db, season);
  if (mds.length === 0) return null;
  for (const md of mds) {
    const pending = md.total - md.finished - md.postponed;
    if (pending > 0) return md;
    // se l'ultima partita è finita da meno di 12 ore, resta "corrente"
    if (md.lastKickoff && now - new Date(md.lastKickoff).getTime() < 12 * 3600_000) return md;
  }
  return mds[mds.length - 1];
}

export function teamPlayedMatches(db: Db, season = SEASON_CODE): MatchRow[] {
  return all<MatchRow>(db, `${MATCH_SELECT} WHERE m.season_code = ? AND m.status = 'terminata' AND m.home_goals IS NOT NULL ORDER BY m.kickoff_utc`, [season]);
}

export function listOpenDiscrepancies(db: Db) {
  return all<{
    id: number; entity: string; entity_id: number; field: string; source_a: string; value_a: string; source_b: string; value_b: string; detected_at: string;
    home_name: string | null; away_name: string | null; matchday: number | null;
  }>(
    db,
    `SELECT d.*, h.name AS home_name, a.name AS away_name, m.matchday FROM data_discrepancies d
     LEFT JOIN matches m ON d.entity = 'partita' AND m.id = d.entity_id
     LEFT JOIN teams h ON h.id = m.home_team_id LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE d.resolved = 0 ORDER BY d.detected_at DESC LIMIT 50`,
  );
}

export function setTeamNotes(db: Db, teamId: number, notes: string, source: string) {
  run(db, "UPDATE teams SET tactical_notes = ?, tactical_notes_source = ?, tactical_notes_updated_at = ? WHERE id = ?", [
    notes || null,
    source || null,
    nowIso(),
    teamId,
  ]);
}

export function upsertTeamAdvanced(
  db: Db,
  teamId: number,
  data: { source: string; matches?: number | null; xgFor?: number | null; xgAgainst?: number | null; shotsFor?: number | null; shotsAgainst?: number | null; cleanSheets?: number | null },
  season = SEASON_CODE,
) {
  run(
    db,
    `INSERT INTO team_advanced_stats (team_id, season_code, source, as_of, matches, xg_for, xg_against, shots_for, shots_against, clean_sheets)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(team_id, season_code, source) DO UPDATE SET as_of = excluded.as_of, matches = excluded.matches, xg_for = excluded.xg_for,
       xg_against = excluded.xg_against, shots_for = excluded.shots_for, shots_against = excluded.shots_against, clean_sheets = excluded.clean_sheets`,
    [teamId, season, data.source, nowIso(), data.matches ?? null, data.xgFor ?? null, data.xgAgainst ?? null, data.shotsFor ?? null, data.shotsAgainst ?? null, data.cleanSheets ?? null],
  );
}
