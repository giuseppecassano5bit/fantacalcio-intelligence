import { z } from "zod";
import type { Connector, ConnectorOutcome, SyncContext } from "./types";
import { cachedGet, isStale } from "./http";
import { SEASON_CODE, upsertMatch, ensureSeason } from "@/lib/repo/league";
import { romeLocalToUtcIso } from "@/lib/domain/time";

const schema = z.object({
  name: z.string(),
  matches: z.array(
    z.object({
      round: z.string(),
      date: z.string(),
      time: z.string().optional(),
      team1: z.string(),
      team2: z.string(),
      score: z.object({ ft: z.array(z.number()).length(2).optional() }).partial().optional(),
    }),
  ),
});

function url() {
  return `https://raw.githubusercontent.com/openfootball/football.json/master/${SEASON_CODE}/it.1.json`;
}

export const openfootball: Connector = {
  id: "openfootball",
  name: "openfootball (football.json)",
  description: "Calendario completo e risultati della Serie A da un archivio open data su GitHub. Nessuna chiave richiesta.",
  provides: ["calendario", "risultati", "squadre"],
  requiresKey: false,
  docsUrl: "https://github.com/openfootball/football.json",
  limits: "File statico aggiornato manualmente dai volontari: i risultati possono arrivare con giorni di ritardo.",
  license: "Pubblico dominio (CC0)",
  fallback: "Usato come base del calendario; orari e risultati vengono sovrascritti da fonti più aggiornate.",
  priority: 10,
  isConfigured: () => true,

  async test(db) {
    try {
      const { body } = await cachedGet(db, url(), { bucket: "openfootball", perMinute: 20, ttlSeconds: 60, force: true });
      const data = schema.parse(JSON.parse(body));
      const played = data.matches.filter((m) => m.score?.ft).length;
      return { ok: true, message: `${data.name}: ${data.matches.length} partite in calendario, ${played} con risultato.` };
    } catch (e) {
      return { ok: false, message: `Non raggiungibile: ${(e as Error).message}` };
    }
  },

  async sync(ctx: SyncContext): Promise<ConnectorOutcome> {
    const out: ConnectorOutcome = { connector: "openfootball", ok: true, items: {}, messages: [] };
    ensureSeason(ctx.db);
    const { body, fromCache, fetchedAt } = await cachedGet(ctx.db, url(), { bucket: "openfootball", perMinute: 20, ttlSeconds: 6 * 3600, force: ctx.force });
    out.usedCache = fromCache;
    out.stale = isStale(fetchedAt);
    const data = schema.parse(JSON.parse(body));
    let upserts = 0;
    let changed = 0;
    let discrepancies = 0;
    for (const m of data.matches) {
      const md = Number(m.round.replace(/\D+/g, ""));
      if (!md) continue;
      const ft = m.score?.ft;
      const kickoff = m.time ? romeLocalToUtcIso(m.date, m.time) : romeLocalToUtcIso(m.date, "12:00");
      const r = upsertMatch(ctx.db, {
        matchday: md,
        home: m.team1,
        away: m.team2,
        kickoffUtc: kickoff,
        timeKnown: !!m.time,
        status: ft ? "terminata" : "programmata",
        homeGoals: ft ? ft[0] : null,
        awayGoals: ft ? ft[1] : null,
        source: "openfootball",
        priority: 10,
      });
      upserts++;
      if (r.changed) changed++;
      discrepancies += r.discrepancies.length;
    }
    out.items = { partite: upserts, aggiornate: changed, discrepanze: discrepancies };
    out.messages.push(`${upserts} partite lette${fromCache ? " (dalla cache)" : ""}.`);
    return out;
  },
};
