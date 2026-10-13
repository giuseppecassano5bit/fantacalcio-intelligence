import type { Db } from "@/lib/db";
import { all, one, run, nowIso } from "@/lib/db";
import { DEFAULT_CONFIG, leagueConfigSchema, parseConfig, type LeagueConfig } from "@/lib/domain/settings";
import { SEASON_CODE } from "./league";

// ======================= Impostazioni lega =======================

export function getLeagueSettings(db: Db, userId: number): { config: LeagueConfig; provisional: boolean; updatedAt: string | null } {
  const row = one<{ config: string; is_provisional: number; updated_at: string }>(
    db,
    "SELECT config, is_provisional, updated_at FROM league_settings WHERE user_id = ?",
    [userId],
  );
  if (!row) return { config: DEFAULT_CONFIG, provisional: true, updatedAt: null };
  return { config: parseConfig(row.config), provisional: row.is_provisional === 1, updatedAt: row.updated_at };
}

export function saveLeagueSettings(db: Db, userId: number, config: LeagueConfig, confirmed: boolean) {
  const valid = leagueConfigSchema.parse(config);
  run(
    db,
    `INSERT INTO league_settings (user_id, config, is_provisional, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET config = excluded.config, is_provisional = excluded.is_provisional, updated_at = excluded.updated_at`,
    [userId, JSON.stringify(valid), confirmed ? 0 : 1, nowIso()],
  );
}

// ======================= Statistiche =======================

export interface SeasonStatsRow {
  id: number;
  player_id: number;
  season_code: string;
  source: string;
  as_of: string;
  appearances: number | null;
  starts: number | null;
  minutes: number | null;
  avg_vote: number | null;
  avg_fantavote: number | null;
  goals: number | null;
  goals_conceded: number | null;
  assists: number | null;
  penalties_taken: number | null;
  penalties_scored: number | null;
  penalties_missed: number | null;
  penalties_saved: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  own_goals: number | null;
  xg: number | null;
  xa: number | null;
  shots: number | null;
  shots_on_target: number | null;
  key_passes: number | null;
}

export type SeasonStatsInput = Partial<Omit<SeasonStatsRow, "id" | "player_id" | "season_code" | "source" | "as_of">>;

const SEASON_COLS = [
  "appearances", "starts", "minutes", "avg_vote", "avg_fantavote", "goals", "goals_conceded", "assists", "penalties_taken",
  "penalties_scored", "penalties_missed", "penalties_saved", "yellow_cards", "red_cards", "own_goals", "xg", "xa", "shots",
  "shots_on_target", "key_passes",
] as const;

export function upsertSeasonStats(db: Db, playerId: number, season: string, source: string, data: SeasonStatsInput) {
  const vals = SEASON_COLS.map((c) => (data[c] === undefined ? null : (data[c] as number | null)));
  run(
    db,
    `INSERT INTO player_season_stats (player_id, season_code, source, as_of, ${SEASON_COLS.join(", ")})
     VALUES (?, ?, ?, ?, ${SEASON_COLS.map(() => "?").join(", ")})
     ON CONFLICT(player_id, season_code, source) DO UPDATE SET as_of = excluded.as_of, ${SEASON_COLS.map((c) => `${c} = COALESCE(excluded.${c}, ${c})`).join(", ")}`,
    [playerId, season, source, nowIso(), ...vals],
  );
}

export function getSeasonStats(db: Db, playerId: number): SeasonStatsRow[] {
  return all<SeasonStatsRow>(db, "SELECT * FROM player_season_stats WHERE player_id = ? ORDER BY season_code DESC, as_of DESC", [playerId]);
}

export function getSeasonStatsMany(db: Db, playerIds: number[]): Map<number, SeasonStatsRow[]> {
  const map = new Map<number, SeasonStatsRow[]>();
  if (playerIds.length === 0) return map;
  const rows = all<SeasonStatsRow>(
    db,
    `SELECT * FROM player_season_stats WHERE player_id IN (${playerIds.map(() => "?").join(",")}) ORDER BY season_code DESC, as_of DESC`,
    playerIds,
  );
  for (const r of rows) {
    if (!map.has(r.player_id)) map.set(r.player_id, []);
    map.get(r.player_id)!.push(r);
  }
  return map;
}

export interface MatchStatsRow {
  id: number;
  player_id: number;
  season_code: string;
  matchday: number;
  match_id: number | null;
  team_id: number | null;
  source: string;
  played: number | null;
  started: number | null;
  minutes: number | null;
  vote: number | null;
  fantavote: number | null;
  goals: number;
  goals_conceded: number;
  assists: number;
  yellow: number;
  red: number;
  own_goals: number;
  pen_scored: number;
  pen_missed: number;
  pen_saved: number;
  xg: number | null;
  xa: number | null;
  shots: number | null;
  imported_at: string;
}

export type MatchStatsInput = Partial<Omit<MatchStatsRow, "id" | "player_id" | "season_code" | "matchday" | "source" | "imported_at">>;

const MATCH_COLS = [
  "match_id", "team_id", "played", "started", "minutes", "vote", "fantavote", "goals", "goals_conceded", "assists", "yellow", "red",
  "own_goals", "pen_scored", "pen_missed", "pen_saved", "xg", "xa", "shots",
] as const;

export function upsertMatchStats(db: Db, playerId: number, season: string, matchday: number, source: string, data: MatchStatsInput) {
  const vals = MATCH_COLS.map((c) => (data[c] === undefined ? null : (data[c] as number | null)));
  run(
    db,
    `INSERT INTO player_match_stats (player_id, season_code, matchday, source, imported_at, ${MATCH_COLS.join(", ")})
     VALUES (?, ?, ?, ?, ?, ${MATCH_COLS.map(() => "?").join(", ")})
     ON CONFLICT(player_id, season_code, matchday, source) DO UPDATE SET imported_at = excluded.imported_at, ${MATCH_COLS.map((c) => `${c} = excluded.${c}`).join(", ")}`,
    [playerId, season, matchday, source, nowIso(), ...vals],
  );
}

export function getMatchStats(db: Db, playerId: number, season = SEASON_CODE): MatchStatsRow[] {
  return all<MatchStatsRow>(db, "SELECT * FROM player_match_stats WHERE player_id = ? AND season_code = ? ORDER BY matchday DESC, source", [playerId, season]);
}

export function getMatchStatsMany(db: Db, playerIds: number[], season = SEASON_CODE): Map<number, MatchStatsRow[]> {
  const map = new Map<number, MatchStatsRow[]>();
  if (playerIds.length === 0) return map;
  const rows = all<MatchStatsRow>(
    db,
    `SELECT * FROM player_match_stats WHERE season_code = ? AND player_id IN (${playerIds.map(() => "?").join(",")}) ORDER BY matchday DESC`,
    [season, ...playerIds],
  );
  for (const r of rows) {
    if (!map.has(r.player_id)) map.set(r.player_id, []);
    map.get(r.player_id)!.push(r);
  }
  return map;
}

export function matchStatsForMatchday(db: Db, matchday: number, season = SEASON_CODE): MatchStatsRow[] {
  return all<MatchStatsRow>(db, "SELECT * FROM player_match_stats WHERE season_code = ? AND matchday = ?", [season, matchday]);
}

// ======================= Disponibilità =======================

export type AvailabilityKind = "infortunio" | "squalifica" | "diffida" | "malattia" | "altro";
export type Certainty = "confermato" | "dubbio" | "in_recupero" | "indiscrezione";
export const CERTAINTY_LABEL: Record<Certainty, string> = {
  confermato: "Confermato",
  dubbio: "In dubbio",
  in_recupero: "In recupero",
  indiscrezione: "Indiscrezione giornalistica",
};

export interface AvailabilityRow {
  id: number;
  player_id: number;
  kind: AvailabilityKind;
  certainty: Certainty;
  description: string | null;
  expected_return: string | null;
  source: string;
  url: string | null;
  reported_at: string;
  resolved_at: string | null;
  origin: "manuale" | "api" | "rss";
  created_by: number | null;
  created_at: string;
  author: string | null;
}

export function addAvailability(
  db: Db,
  r: { playerId: number; kind: AvailabilityKind; certainty: Certainty; description?: string | null; expectedReturn?: string | null; source: string; url?: string | null; reportedAt?: string | null; origin: "manuale" | "api" | "rss"; createdBy?: number | null },
): number {
  // evita duplicati della stessa segnalazione dalla stessa fonte
  const dup = one<{ id: number }>(
    db,
    "SELECT id FROM availability_reports WHERE player_id = ? AND source = ? AND COALESCE(url,'') = COALESCE(?, '') AND kind = ? AND resolved_at IS NULL AND COALESCE(description,'') = COALESCE(?, '')",
    [r.playerId, r.source, r.url ?? null, r.kind, r.description ?? null],
  );
  if (dup) return dup.id;
  return run(
    db,
    `INSERT INTO availability_reports (player_id, kind, certainty, description, expected_return, source, url, reported_at, origin, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.playerId, r.kind, r.certainty, r.description ?? null, r.expectedReturn ?? null, r.source, r.url ?? null, r.reportedAt ?? nowIso(), r.origin, r.createdBy ?? null, nowIso()],
  ).lastId;
}

export function resolveAvailability(db: Db, id: number) {
  run(db, "UPDATE availability_reports SET resolved_at = ? WHERE id = ?", [nowIso(), id]);
}

export function activeAvailability(db: Db, playerIds?: number[]): AvailabilityRow[] {
  const where = playerIds && playerIds.length ? `AND a.player_id IN (${playerIds.map(() => "?").join(",")})` : "";
  return all<AvailabilityRow>(
    db,
    `SELECT a.*, u.username AS author FROM availability_reports a LEFT JOIN users u ON u.id = a.created_by
     WHERE a.resolved_at IS NULL ${where} ORDER BY a.reported_at DESC`,
    playerIds ?? [],
  );
}

export function availabilityHistory(db: Db, playerId: number): AvailabilityRow[] {
  return all<AvailabilityRow>(
    db,
    `SELECT a.*, u.username AS author FROM availability_reports a LEFT JOIN users u ON u.id = a.created_by WHERE a.player_id = ? ORDER BY a.reported_at DESC LIMIT 30`,
    [playerId],
  );
}

// ======================= Formazioni probabili / ufficiali =======================

export type LineupStatus = "titolare" | "ballottaggio" | "panchina" | "non_convocato" | "indisponibile";
export const LINEUP_STATUS_LABEL: Record<LineupStatus, string> = {
  titolare: "Titolare",
  ballottaggio: "Ballottaggio",
  panchina: "Panchina",
  non_convocato: "Non convocato",
  indisponibile: "Indisponibile",
};

export interface LineupReportRow {
  id: number;
  match_id: number;
  player_id: number;
  source: string;
  kind: "probabile" | "ufficiale";
  status: LineupStatus;
  probability: number | null;
  url: string | null;
  reported_at: string;
  origin: "manuale" | "api";
  created_by: number | null;
  author: string | null;
}

export function upsertLineupReport(
  db: Db,
  r: { matchId: number; playerId: number; source: string; kind: "probabile" | "ufficiale"; status: LineupStatus; probability?: number | null; url?: string | null; reportedAt?: string | null; origin: "manuale" | "api"; createdBy?: number | null },
) {
  run(
    db,
    `INSERT INTO lineup_reports (match_id, player_id, source, kind, status, probability, url, reported_at, origin, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(match_id, player_id, source, kind) DO UPDATE SET status = excluded.status, probability = excluded.probability,
       url = excluded.url, reported_at = excluded.reported_at, created_by = excluded.created_by`,
    [r.matchId, r.playerId, r.source, r.kind, r.status, r.probability ?? null, r.url ?? null, r.reportedAt ?? nowIso(), r.origin, r.createdBy ?? null],
  );
}

export function deleteLineupReport(db: Db, id: number) {
  run(db, "DELETE FROM lineup_reports WHERE id = ?", [id]);
}

export function lineupReportsForMatches(db: Db, matchIds: number[]): LineupReportRow[] {
  if (matchIds.length === 0) return [];
  return all<LineupReportRow>(
    db,
    `SELECT l.*, u.username AS author FROM lineup_reports l LEFT JOIN users u ON u.id = l.created_by
     WHERE l.match_id IN (${matchIds.map(() => "?").join(",")}) ORDER BY l.reported_at DESC`,
    matchIds,
  );
}

// ======================= Fonti editoriali =======================

export type Verdict = "consigliato" | "schierabile" | "neutrale" | "rischioso" | "sconsigliato";
export const VERDICT_LABEL: Record<Verdict, string> = {
  consigliato: "Consigliato",
  schierabile: "Schierabile",
  neutrale: "Neutrale",
  rischioso: "Rischioso",
  sconsigliato: "Sconsigliato",
};

export interface EditorialRow {
  id: number;
  user_id: number;
  player_id: number;
  season_code: string;
  matchday: number | null;
  source: string;
  verdict: Verdict;
  explicit_advice: number;
  summary: string | null;
  url: string | null;
  published_at: string | null;
  story_key: string | null;
  origin: string;
  created_at: string;
}

export function addEditorial(
  db: Db,
  userId: number,
  e: { playerId: number; matchday: number | null; source: string; verdict: Verdict; explicitAdvice: boolean; summary?: string | null; url?: string | null; publishedAt?: string | null; storyKey?: string | null },
) {
  return run(
    db,
    `INSERT INTO editorial_opinions (user_id, player_id, season_code, matchday, source, verdict, explicit_advice, summary, url, published_at, story_key, origin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manuale', ?)`,
    [userId, e.playerId, SEASON_CODE, e.matchday, e.source, e.verdict, e.explicitAdvice ? 1 : 0, e.summary ?? null, e.url ?? null, e.publishedAt ?? null, e.storyKey ?? null, nowIso()],
  ).lastId;
}

export function deleteEditorial(db: Db, userId: number, id: number) {
  run(db, "DELETE FROM editorial_opinions WHERE id = ? AND user_id = ?", [id, userId]);
}

export function editorialFor(db: Db, userId: number, playerIds: number[], season = SEASON_CODE): EditorialRow[] {
  if (playerIds.length === 0) return [];
  return all<EditorialRow>(
    db,
    `SELECT * FROM editorial_opinions WHERE user_id = ? AND season_code = ? AND player_id IN (${playerIds.map(() => "?").join(",")}) ORDER BY COALESCE(published_at, created_at) DESC`,
    [userId, season, ...playerIds],
  );
}

// ======================= Notizie (RSS) =======================

export interface NewsRow {
  id: number;
  source: string;
  guid: string;
  title: string;
  url: string | null;
  published_at: string | null;
  categories: string | null;
  summary: string | null;
  fetched_at: string;
}

export function upsertNews(db: Db, n: Omit<NewsRow, "id" | "fetched_at">): { id: number; created: boolean } {
  const ex = one<{ id: number }>(db, "SELECT id FROM news_items WHERE guid = ?", [n.guid]);
  if (ex) return { id: ex.id, created: false };
  const id = run(
    db,
    "INSERT INTO news_items (source, guid, title, url, published_at, categories, summary, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [n.source, n.guid, n.title, n.url, n.published_at, n.categories, n.summary, nowIso()],
  ).lastId;
  return { id, created: true };
}

export function addNewsMention(db: Db, newsId: number, playerId: number, confidence: "alta" | "media") {
  run(db, "INSERT OR IGNORE INTO news_mentions (news_id, player_id, confidence) VALUES (?, ?, ?)", [newsId, playerId, confidence]);
}

export function newsForPlayers(db: Db, playerIds: number[], limit = 50) {
  if (playerIds.length === 0) return [];
  return all<NewsRow & { player_id: number; confidence: string }>(
    db,
    `SELECT n.*, m.player_id, m.confidence FROM news_mentions m JOIN news_items n ON n.id = m.news_id
     WHERE m.player_id IN (${playerIds.map(() => "?").join(",")}) ORDER BY n.published_at DESC LIMIT ?`,
    [...playerIds, limit],
  );
}

export function latestNews(db: Db, limit = 30): NewsRow[] {
  return all<NewsRow>(db, "SELECT * FROM news_items ORDER BY published_at DESC LIMIT ?", [limit]);
}
