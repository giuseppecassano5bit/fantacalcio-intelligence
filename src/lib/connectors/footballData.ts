import { z } from "zod";
import type { Connector, ConnectorOutcome, DataKind, SyncContext } from "./types";
import { cachedGet, isStale } from "./http";
import { SEASON_CODE, upsertMatch, ensureSeason, type MatchStatus } from "@/lib/repo/league";
import { upsertPlayer } from "@/lib/repo/players";
import { upsertSeasonStats } from "@/lib/repo/data";
import type { RoleClassic } from "@/lib/domain/settings";

const BASE = "https://api.football-data.org/v4";
const key = () => process.env.FOOTBALL_DATA_API_KEY || "";
const seasonYear = () => SEASON_CODE.slice(0, 4);

const teamRef = z.object({ id: z.number(), name: z.string().nullable(), shortName: z.string().nullable().optional() }).passthrough();
const matchesSchema = z.object({
  matches: z.array(
    z
      .object({
        id: z.number(),
        utcDate: z.string(),
        status: z.string(),
        matchday: z.number().nullable(),
        homeTeam: teamRef,
        awayTeam: teamRef,
        score: z.object({ fullTime: z.object({ home: z.number().nullable(), away: z.number().nullable() }) }).passthrough(),
      })
      .passthrough(),
  ),
});
const teamsSchema = z.object({
  teams: z.array(
    z
      .object({
        id: z.number(),
        name: z.string(),
        shortName: z.string().nullable().optional(),
        squad: z
          .array(z.object({ id: z.number(), name: z.string(), position: z.string().nullable().optional(), dateOfBirth: z.string().nullable().optional() }).passthrough())
          .optional()
          .default([]),
      })
      .passthrough(),
  ),
});
const scorersSchema = z.object({
  scorers: z.array(
    z
      .object({
        player: z.object({ id: z.number(), name: z.string(), dateOfBirth: z.string().nullable().optional(), section: z.string().nullable().optional() }).passthrough(),
        team: teamRef,
        playedMatches: z.number().nullable().optional(),
        goals: z.number().nullable().optional(),
        assists: z.number().nullable().optional(),
        penalties: z.number().nullable().optional(),
      })
      .passthrough(),
  ),
});

export function mapFdStatus(s: string): MatchStatus {
  switch (s) {
    case "FINISHED":
    case "AWARDED":
      return "terminata";
    case "IN_PLAY":
    case "PAUSED":
    case "LIVE":
      return "in_corso";
    case "POSTPONED":
      return "rinviata";
    case "SUSPENDED":
      return "sospesa";
    case "CANCELLED":
      return "annullata";
    default:
      return "programmata";
  }
}

/** Ruolo fantacalcistico stimato dalla posizione reale (da verificare con il listone). */
export function positionToRole(pos: string | null | undefined): { role: RoleClassic | null; estimated: boolean } {
  const p = (pos ?? "").toLowerCase();
  if (!p) return { role: null, estimated: true };
  if (p.includes("goalkeeper")) return { role: "P", estimated: false };
  if (p.includes("back") || p.includes("defen")) return { role: "D", estimated: p !== "defence" && p !== "defender" };
  if (p.includes("winger")) return { role: "A", estimated: true };
  if (p.includes("midfield")) return { role: "C", estimated: p.includes("attacking") };
  if (p.includes("forward") || p.includes("offence") || p.includes("attack") || p.includes("striker")) return { role: "A", estimated: false };
  return { role: null, estimated: true };
}

const opts = (ttl: number, force: boolean, k: string) => ({
  bucket: "football-data",
  perMinute: 9,
  ttlSeconds: ttl,
  force,
  headers: { "X-Auth-Token": key() },
  cacheKey: `football-data:${k}`,
});

export const footballData: Connector = {
  id: "football-data",
  name: "football-data.org",
  description: "API documentata con piano gratuito che copre la Serie A: calendario, risultati, rose delle squadre (con trasferimenti) e classifica marcatori.",
  provides: ["calendario", "risultati", "squadre", "rose", "statistiche_giocatori"],
  requiresKey: true,
  envVar: "FOOTBALL_DATA_API_KEY",
  docsUrl: "https://www.football-data.org/documentation/quickstart",
  limits: "Piano gratuito: 10 richieste/minuto. Niente formazioni, infortuni, cartellini individuali né xG.",
  license: "Gratuito per uso non commerciale previa registrazione.",
  fallback: "Senza chiave: calendario da TheSportsDB/openfootball; rosa e ruoli dal listone importato o inserimento manuale.",
  priority: 30,
  isConfigured: () => key().length > 0,

  async test(db) {
    if (!key()) return { ok: false, message: "Chiave FOOTBALL_DATA_API_KEY non configurata." };
    try {
      const { body } = await cachedGet(db, `${BASE}/competitions/SA`, opts(60, true, "test"));
      const j = JSON.parse(body) as { name?: string; currentSeason?: { startDate?: string; endDate?: string } };
      return { ok: true, message: `${j.name ?? "Serie A"} accessibile. Stagione corrente secondo la fonte: ${j.currentSeason?.startDate ?? "?"} – ${j.currentSeason?.endDate ?? "?"}.` };
    } catch (e) {
      return { ok: false, message: `Errore: ${(e as Error).message}` };
    }
  },

  async sync(ctx: SyncContext, kinds: DataKind[]): Promise<ConnectorOutcome> {
    const out: ConnectorOutcome = { connector: "football-data", ok: true, items: {}, messages: [] };
    if (!key()) return { ...out, skipped: "Chiave non configurata" };
    ensureSeason(ctx.db);
    let stale = false;
    if (kinds.includes("calendario") || kinds.includes("risultati")) {
      const r = await cachedGet(ctx.db, `${BASE}/competitions/SA/matches?season=${seasonYear()}`, opts(20 * 60, ctx.force, `matches:${seasonYear()}`));
      stale ||= isStale(r.fetchedAt);
      const data = matchesSchema.parse(JSON.parse(r.body));
      let n = 0;
      let changed = 0;
      for (const m of data.matches) {
        if (!m.matchday || !m.homeTeam.name || !m.awayTeam.name) continue;
        const status = mapFdStatus(m.status);
        const res = upsertMatch(ctx.db, {
          matchday: m.matchday,
          home: m.homeTeam.name,
          away: m.awayTeam.name,
          kickoffUtc: new Date(m.utcDate).toISOString(),
          timeKnown: m.status !== "SCHEDULED" || !m.utcDate.endsWith("T00:00:00Z"),
          status,
          homeGoals: status === "terminata" ? m.score.fullTime.home : null,
          awayGoals: status === "terminata" ? m.score.fullTime.away : null,
          source: "football-data",
          priority: 30,
          externalId: m.id,
          homeExtId: m.homeTeam.id,
          awayExtId: m.awayTeam.id,
        });
        n++;
        if (res.changed) changed++;
      }
      out.items.partite = n;
      out.items.aggiornate = changed;
    }
    if (kinds.includes("rose") || kinds.includes("squadre")) {
      const r = await cachedGet(ctx.db, `${BASE}/competitions/SA/teams?season=${seasonYear()}`, opts(24 * 3600, ctx.force, `teams:${seasonYear()}`));
      stale ||= isStale(r.fetchedAt);
      const data = teamsSchema.parse(JSON.parse(r.body));
      let players = 0;
      let created = 0;
      let transfers = 0;
      for (const t of data.teams) {
        for (const p of t.squad) {
          const { role, estimated } = positionToRole(p.position);
          const res = upsertPlayer(ctx.db, {
            fullName: p.name,
            team: t.name,
            roleClassic: role,
            roleClassicSource: estimated ? "posizione reale (stimato)" : "posizione reale",
            realPosition: p.position ?? null,
            birthDate: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : null,
            source: "football-data",
            externalId: p.id,
            origin: "api",
          });
          players++;
          if (res.created) created++;
          if (res.transferred) transfers++;
        }
      }
      out.items.squadre = data.teams.length;
      out.items.giocatori = players;
      out.items.nuovi = created;
      out.items.trasferimenti = transfers;
    }
    if (kinds.includes("statistiche_giocatori")) {
      const r = await cachedGet(ctx.db, `${BASE}/competitions/SA/scorers?season=${seasonYear()}&limit=100`, opts(12 * 3600, ctx.force, `scorers:${seasonYear()}`));
      stale ||= isStale(r.fetchedAt);
      const data = scorersSchema.parse(JSON.parse(r.body));
      let n = 0;
      for (const s of data.scorers) {
        const res = upsertPlayer(ctx.db, {
          fullName: s.player.name,
          team: s.team.name ?? undefined,
          birthDate: s.player.dateOfBirth?.slice(0, 10) ?? null,
          source: "football-data",
          externalId: s.player.id,
          origin: "api",
        });
        upsertSeasonStats(ctx.db, res.id, SEASON_CODE, "football-data (marcatori)", {
          appearances: s.playedMatches ?? null,
          goals: s.goals ?? null,
          assists: s.assists ?? null,
          penalties_scored: s.penalties ?? null,
        });
        n++;
      }
      out.items.marcatori = n;
      out.messages.push("Statistiche disponibili solo per i primi 100 marcatori (gol, assist, rigori segnati, presenze).");
    }
    out.stale = stale;
    return out;
  },
};
