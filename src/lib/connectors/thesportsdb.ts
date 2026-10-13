import { z } from "zod";
import type { Connector, ConnectorOutcome, SyncContext } from "./types";
import { cachedGet, isStale } from "./http";
import { SEASON_CODE, upsertMatch, ensureSeason, type MatchStatus } from "@/lib/repo/league";

const LEAGUE_ID = "4332"; // Italian Serie A
const key = () => process.env.THESPORTSDB_API_KEY || "123"; // "123" = chiave pubblica gratuita di TheSportsDB
const seasonParam = () => {
  const [a, b] = SEASON_CODE.split("-");
  return `${a}-${a.slice(0, 2)}${b}`; // 2026-27 -> 2026-2027
};
const base = () => `https://www.thesportsdb.com/api/v1/json/${key()}`;

const eventSchema = z
  .object({
    idEvent: z.string(),
    strTimestamp: z.string().nullable().optional(),
    dateEvent: z.string().nullable().optional(),
    strTime: z.string().nullable().optional(),
    strHomeTeam: z.string(),
    strAwayTeam: z.string(),
    idHomeTeam: z.string().nullable().optional(),
    idAwayTeam: z.string().nullable().optional(),
    intHomeScore: z.string().nullable().optional(),
    intAwayScore: z.string().nullable().optional(),
    intRound: z.string().nullable().optional(),
    strStatus: z.string().nullable().optional(),
    strPostponed: z.string().nullable().optional(),
  })
  .passthrough();

const roundSchema = z.object({ events: z.array(eventSchema).nullable() });

export function mapTsdbStatus(status: string | null | undefined, postponed: string | null | undefined, hasScore: boolean): MatchStatus {
  const s = (status ?? "").toLowerCase();
  if ((postponed ?? "").toLowerCase() === "yes" || s.includes("postp") || s === "pst") return "rinviata";
  if (s.includes("cancel") || s === "canc" || s === "abd") return "annullata";
  if (s.includes("susp") || s === "int") return "sospesa";
  if (["ft", "aet", "pen", "match finished", "awd"].includes(s)) return "terminata";
  if (["1h", "2h", "ht", "et", "bt", "p", "live", "in progress"].includes(s)) return "in_corso";
  if (!s && hasScore) return "terminata";
  return "programmata";
}

export const thesportsdb: Connector = {
  id: "thesportsdb",
  name: "TheSportsDB",
  description: "Orari ufficiali, stato e risultati delle partite per giornata. Con la chiave gratuita pubblica fornisce le partite di una giornata alla volta.",
  provides: ["calendario", "risultati"],
  requiresKey: false,
  envVar: "THESPORTSDB_API_KEY",
  docsUrl: "https://www.thesportsdb.com/free_sports_api",
  limits: "Chiave gratuita: 30 richieste/minuto; liste di squadre, classifica e giocatori troncate (max 10 elementi).",
  license: "Uso gratuito con chiave pubblica; per usi intensivi è disponibile un piano a pagamento.",
  fallback: "Se non risponde, restano gli orari di openfootball (eventualmente meno aggiornati).",
  priority: 20,
  isConfigured: () => true,

  async test(db) {
    try {
      const { body } = await cachedGet(db, `${base()}/eventsround.php?id=${LEAGUE_ID}&r=1&s=${seasonParam()}`, {
        bucket: "thesportsdb",
        perMinute: 25,
        ttlSeconds: 60,
        force: true,
        cacheKey: `thesportsdb:test`,
      });
      const ev = roundSchema.parse(JSON.parse(body)).events ?? [];
      return ev.length > 0
        ? { ok: true, message: `Giornata 1 stagione ${seasonParam()}: ${ev.length} partite ricevute.` }
        : { ok: false, message: "Nessuna partita restituita per la stagione configurata." };
    } catch (e) {
      return { ok: false, message: `Errore: ${(e as Error).message}` };
    }
  },

  async sync(ctx: SyncContext): Promise<ConnectorOutcome> {
    const out: ConnectorOutcome = { connector: "thesportsdb", ok: true, items: {}, messages: [] };
    ensureSeason(ctx.db);
    let upserts = 0;
    let changed = 0;
    let disc = 0;
    let anyStale = false;
    const rounds = ctx.focusMatchdays.filter((r) => r >= 1 && r <= 38);
    for (const r of rounds) {
      const url = `${base()}/eventsround.php?id=${LEAGUE_ID}&r=${r}&s=${seasonParam()}`;
      // giornate vicine: cache breve; quelle lontane: più lunga
      const { body, fetchedAt } = await cachedGet(ctx.db, url, {
        bucket: "thesportsdb",
        perMinute: 25,
        ttlSeconds: 20 * 60,
        force: ctx.force,
        cacheKey: `thesportsdb:round:${SEASON_CODE}:${r}`,
      });
      anyStale ||= isStale(fetchedAt);
      const events = roundSchema.parse(JSON.parse(body)).events ?? [];
      for (const e of events) {
        const hasScore = e.intHomeScore != null && e.intHomeScore !== "" && e.intAwayScore != null && e.intAwayScore !== "";
        const status = mapTsdbStatus(e.strStatus, e.strPostponed, hasScore);
        const ts = e.strTimestamp ? (e.strTimestamp.endsWith("Z") ? e.strTimestamp : `${e.strTimestamp}Z`) : null;
        const timeKnown = !!ts && !!e.strTime && e.strTime !== "00:00:00";
        const res = upsertMatch(ctx.db, {
          matchday: Number(e.intRound ?? r) || r,
          home: e.strHomeTeam,
          away: e.strAwayTeam,
          kickoffUtc: ts ? new Date(ts).toISOString() : null,
          timeKnown,
          status,
          homeGoals: status === "terminata" && hasScore ? Number(e.intHomeScore) : null,
          awayGoals: status === "terminata" && hasScore ? Number(e.intAwayScore) : null,
          source: "thesportsdb",
          priority: 20,
          externalId: e.idEvent,
          homeExtId: e.idHomeTeam,
          awayExtId: e.idAwayTeam,
        });
        upserts++;
        if (res.changed) changed++;
        disc += res.discrepancies.length;
      }
    }
    out.stale = anyStale;
    out.items = { giornate: rounds.length, partite: upserts, aggiornate: changed, discrepanze: disc };
    out.messages.push(`Giornate ${rounds.join(", ")}: ${upserts} partite verificate.`);
    return out;
  },
};
