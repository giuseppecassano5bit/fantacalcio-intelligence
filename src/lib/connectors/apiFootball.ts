import { z } from "zod";
import type { Connector, ConnectorOutcome, DataKind, SyncContext } from "./types";
import { cachedGet } from "./http";
import { all, one, run, nowIso } from "@/lib/db";
import { SEASON_CODE, upsertMatch, findMatchForTeam, upsertTeam } from "@/lib/repo/league";
import { matchPlayerName, rosterPlayerIdsAllUsers, getPlayers } from "@/lib/repo/players";
import { addAvailability, upsertLineupReport, upsertSeasonStats } from "@/lib/repo/data";
import { mapFdStatus } from "./footballData";
import { apiKey } from "./keys";

/**
 * API-Football (api-sports.io) v3. Implementato secondo la documentazione pubblica.
 * La copertura della stagione corrente dipende dal piano: viene verificata a runtime
 * e il connettore si disattiva da solo se la stagione non è inclusa.
 */
const BASE = "https://v3.football.api-sports.io";
const LEAGUE = 135; // Serie A
const key = () => apiKey("API_FOOTBALL_KEY");
const season = () => Number(SEASON_CODE.slice(0, 4));

const envelope = z.object({
  errors: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  response: z.unknown(),
  paging: z.object({ current: z.number(), total: z.number() }).partial().optional(),
});

function errorsOf(e: z.infer<typeof envelope>): string | null {
  if (!e.errors) return null;
  if (Array.isArray(e.errors)) return e.errors.length ? JSON.stringify(e.errors) : null;
  const vals = Object.values(e.errors);
  return vals.length ? vals.map(String).join("; ") : null;
}

async function get(ctx: { db: SyncContext["db"]; force: boolean }, path: string, ttl: number) {
  const { body } = await cachedGet(ctx.db, `${BASE}${path}`, {
    bucket: "api-football",
    perMinute: 9,
    ttlSeconds: ttl,
    force: ctx.force,
    headers: { "x-apisports-key": key() },
    cacheKey: `api-football:${path}`,
  });
  const env = envelope.parse(JSON.parse(body));
  const err = errorsOf(env);
  if (err) throw new Error(err);
  return env;
}

const fixtureSchema = z.array(
  z
    .object({
      fixture: z.object({ id: z.number(), date: z.string(), status: z.object({ short: z.string() }).passthrough() }).passthrough(),
      league: z.object({ round: z.string().optional() }).passthrough(),
      teams: z.object({ home: z.object({ id: z.number(), name: z.string() }).passthrough(), away: z.object({ id: z.number(), name: z.string() }).passthrough() }),
      goals: z.object({ home: z.number().nullable(), away: z.number().nullable() }),
    })
    .passthrough(),
);

const injurySchema = z.array(
  z
    .object({
      player: z.object({ id: z.number(), name: z.string(), type: z.string().nullable().optional(), reason: z.string().nullable().optional() }).passthrough(),
      team: z.object({ id: z.number(), name: z.string() }).passthrough(),
      fixture: z.object({ id: z.number(), date: z.string() }).passthrough(),
    })
    .passthrough(),
);

const lineupSchema = z.array(
  z
    .object({
      team: z.object({ id: z.number(), name: z.string() }).passthrough(),
      startXI: z.array(z.object({ player: z.object({ id: z.number(), name: z.string() }).passthrough() })).default([]),
      substitutes: z.array(z.object({ player: z.object({ id: z.number(), name: z.string() }).passthrough() })).default([]),
    })
    .passthrough(),
);

const playerStatsSchema = z.array(
  z
    .object({
      player: z.object({ id: z.number(), name: z.string() }).passthrough(),
      statistics: z.array(
        z
          .object({
            team: z.object({ name: z.string() }).passthrough(),
            league: z.object({ id: z.number().nullable() }).passthrough(),
            games: z.object({ appearences: z.number().nullable().optional(), lineups: z.number().nullable().optional(), minutes: z.number().nullable().optional(), rating: z.string().nullable().optional() }).passthrough(),
            shots: z.object({ total: z.number().nullable().optional(), on: z.number().nullable().optional() }).passthrough().optional(),
            goals: z.object({ total: z.number().nullable().optional(), conceded: z.number().nullable().optional(), assists: z.number().nullable().optional(), saves: z.number().nullable().optional() }).passthrough(),
            passes: z.object({ key: z.number().nullable().optional() }).passthrough().optional(),
            cards: z.object({ yellow: z.number().nullable().optional(), red: z.number().nullable().optional() }).passthrough(),
            penalty: z.object({ scored: z.number().nullable().optional(), missed: z.number().nullable().optional(), saved: z.number().nullable().optional() }).passthrough().optional(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
);

function mapStatus(short: string) {
  const m: Record<string, string> = { FT: "FINISHED", AET: "FINISHED", PEN: "FINISHED", NS: "SCHEDULED", TBD: "SCHEDULED", PST: "POSTPONED", CANC: "CANCELLED", SUSP: "SUSPENDED", ABD: "SUSPENDED", AWD: "AWARDED", WO: "AWARDED" };
  return mapFdStatus(m[short] ?? (["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "INT"].includes(short) ? "IN_PLAY" : "SCHEDULED"));
}

function linkPlayer(db: SyncContext["db"], apiId: number, name: string, team: string): number | null {
  const ext = one<{ player_id: number }>(db, "SELECT player_id FROM player_external_ids WHERE source = 'api-football' AND external_id = ?", [String(apiId)]);
  if (ext) return ext.player_id;
  const m = matchPlayerName(db, name, team);
  if (m.best && m.score >= 75) {
    run(db, "INSERT OR IGNORE INTO player_external_ids (player_id, source, external_id) VALUES (?, 'api-football', ?)", [m.best.id, String(apiId)]);
    return m.best.id;
  }
  return null;
}

export const apiFootball: Connector = {
  id: "api-football",
  name: "API-Football (api-sports.io)",
  description: "Infortuni e squalifiche segnalati, formazioni ufficiali (circa 20-40 minuti prima del calcio d'inizio) e statistiche individuali (minuti, titolarità, tiri, cartellini, rigori).",
  provides: ["calendario", "risultati", "infortuni", "formazioni_ufficiali", "statistiche_giocatori"],
  requiresKey: true,
  envVar: "API_FOOTBALL_KEY",
  keyName: "API_FOOTBALL_KEY",
  keyUrl: "https://dashboard.api-football.com/register",
  docsUrl: "https://www.api-football.com/documentation-v3",
  limits: "Piano gratuito: 100 richieste/giorno e accesso limitato alle stagioni recenti: la copertura della stagione in corso va verificata con il test.",
  license: "Servizio commerciale con piano gratuito.",
  fallback: "Senza chiave o senza copertura: infortuni e formazioni si inseriscono a mano (o da notizie RSS da verificare).",
  priority: 25,
  isConfigured: () => key().length > 0,

  async test(db) {
    if (!key()) return { ok: false, message: "Chiave non configurata: incollala qui sotto oppure impostala come API_FOOTBALL_KEY." };
    try {
      const st = await get({ db, force: true }, "/status", 60);
      const resp = st.response as { subscription?: { plan?: string }; requests?: { current?: number; limit_day?: number } };
      const plan = resp?.subscription?.plan ?? "?";
      const req = resp?.requests ? `${resp.requests.current}/${resp.requests.limit_day} richieste oggi` : "";
      try {
        const lg = await get({ db, force: true }, `/leagues?id=${LEAGUE}&season=${season()}`, 60);
        const arr = lg.response as { seasons?: { year: number; coverage?: Record<string, unknown> }[] }[];
        const s = arr?.[0]?.seasons?.find((x) => x.year === season());
        if (!s) return { ok: false, message: `Piano ${plan} (${req}): stagione ${season()} non disponibile.` };
        const cov = s.coverage as { injuries?: boolean; fixtures?: { lineups?: boolean; statistics_players?: boolean }; players?: boolean } | undefined;
        return {
          ok: true,
          message: `Piano ${plan} (${req}). Stagione ${season()}: infortuni ${cov?.injuries ? "sì" : "no"}, formazioni ${cov?.fixtures?.lineups ? "sì" : "no"}, statistiche giocatori ${cov?.players ? "sì" : "no"}.`,
        };
      } catch (e) {
        return { ok: false, message: `Piano ${plan} (${req}): ${(e as Error).message}` };
      }
    } catch (e) {
      return { ok: false, message: `Errore: ${(e as Error).message}` };
    }
  },

  async sync(ctx: SyncContext, kinds: DataKind[]): Promise<ConnectorOutcome> {
    const out: ConnectorOutcome = { connector: "api-football", ok: true, items: {}, messages: [] };
    if (!key()) return { ...out, skipped: "Chiave non configurata" };
    const db = ctx.db;
    const now = ctx.now;
    const from = new Date(now - 2 * 86400_000).toISOString().slice(0, 10);
    const to = new Date(now + 8 * 86400_000).toISOString().slice(0, 10);

    // partite della finestra (servono anche per abbinare infortuni e formazioni)
    const fx = await get(ctx, `/fixtures?league=${LEAGUE}&season=${season()}&from=${from}&to=${to}`, 30 * 60);
    const fixtures = fixtureSchema.parse(fx.response);
    for (const f of fixtures) {
      const md = Number((f.league.round ?? "").replace(/\D+/g, "")) || null;
      if (!md) continue;
      const status = mapStatus(f.fixture.status.short);
      upsertMatch(db, {
        matchday: md,
        home: f.teams.home.name,
        away: f.teams.away.name,
        kickoffUtc: new Date(f.fixture.date).toISOString(),
        timeKnown: f.fixture.status.short !== "TBD",
        status,
        homeGoals: status === "terminata" ? f.goals.home : null,
        awayGoals: status === "terminata" ? f.goals.away : null,
        source: "api-football",
        priority: 25,
        externalId: f.fixture.id,
        homeExtId: f.teams.home.id,
        awayExtId: f.teams.away.id,
      });
    }
    out.items.partite = fixtures.length;

    if (kinds.includes("infortuni")) {
      const inj = await get(ctx, `/injuries?league=${LEAGUE}&season=${season()}&date=${new Date(now).toISOString().slice(0, 10)}`, 3 * 3600).catch(async () =>
        get(ctx, `/injuries?league=${LEAGUE}&season=${season()}`, 3 * 3600),
      );
      const list = injurySchema.parse(inj.response).filter((i) => i.fixture.date.slice(0, 10) >= from);
      // le segnalazioni precedenti di questa fonte vengono sostituite da quelle attuali
      run(db, "UPDATE availability_reports SET resolved_at = ? WHERE origin = 'api' AND source = 'API-Football' AND resolved_at IS NULL", [nowIso()]);
      let linked = 0;
      for (const i of list) {
        const pid = linkPlayer(db, i.player.id, i.player.name, i.team.name);
        if (!pid) continue;
        const reason = (i.player.reason ?? "").toLowerCase();
        const kind = reason.includes("suspend") || reason.includes("card") ? "squalifica" : reason.includes("ill") ? "malattia" : "infortunio";
        const certainty = (i.player.type ?? "").toLowerCase().includes("question") ? "dubbio" : "confermato";
        // riapre la segnalazione se identica a una appena chiusa
        const reopened = run(
          db,
          "UPDATE availability_reports SET resolved_at = NULL, reported_at = ? WHERE player_id = ? AND origin = 'api' AND source = 'API-Football' AND COALESCE(description,'') = ? AND resolved_at IS NOT NULL",
          [nowIso(), pid, i.player.reason ?? ""],
        );
        if (reopened.changes === 0) {
          addAvailability(db, { playerId: pid, kind, certainty, description: i.player.reason ?? null, source: "API-Football", origin: "api", reportedAt: nowIso() });
        }
        linked++;
      }
      out.items.infortuni = list.length;
      out.items.infortuni_abbinati = linked;
    }

    if (kinds.includes("formazioni_ufficiali")) {
      const rosterIds = new Set(rosterPlayerIdsAllUsers(db));
      const soon = fixtures.filter((f) => {
        const t = new Date(f.fixture.date).getTime();
        return t - now < 75 * 60_000 && now - t < 3 * 3600_000;
      });
      let reports = 0;
      for (const f of soon) {
        const lu = await get(ctx, `/fixtures/lineups?fixture=${f.fixture.id}`, 10 * 60);
        const teams = lineupSchema.parse(lu.response);
        for (const t of teams) {
          const teamId = upsertTeam(db, t.team.name);
          const md = Number((f.league.round ?? "").replace(/\D+/g, ""));
          const match = findMatchForTeam(db, teamId, md);
          if (!match) continue;
          const seen = new Set<number>();
          for (const [list, status] of [[t.startXI, "titolare"], [t.substitutes, "panchina"]] as const) {
            for (const x of list) {
              const pid = linkPlayer(db, x.player.id, x.player.name, t.team.name);
              if (!pid) continue;
              seen.add(pid);
              upsertLineupReport(db, { matchId: match.id, playerId: pid, source: "API-Football", kind: "ufficiale", status, origin: "api" });
              reports++;
            }
          }
          // giocatori in rosa di qualche utente, della stessa squadra, assenti dalla distinta
          const teamRoster = getPlayers(db, [...rosterIds]).filter((p) => p.current_team_id === teamId && !seen.has(p.id));
          for (const p of teamRoster) {
            upsertLineupReport(db, { matchId: match.id, playerId: p.id, source: "API-Football", kind: "ufficiale", status: "non_convocato", origin: "api" });
            reports++;
          }
        }
      }
      out.items.formazioni_ufficiali = reports;
      if (soon.length === 0) out.messages.push("Nessuna partita imminente: formazioni ufficiali non ancora pubblicate.");
    }

    if (kinds.includes("statistiche_giocatori")) {
      // solo per i giocatori nelle rose, max 1 aggiornamento al giorno ciascuno, con tetto per sincronizzazione
      const ids = rosterPlayerIdsAllUsers(db);
      const players = getPlayers(db, ids);
      const budget = Number(process.env.API_FOOTBALL_MAX_PLAYER_CALLS ?? 25);
      let calls = 0;
      let updated = 0;
      for (const p of players) {
        if (calls >= budget) break;
        const ext = one<{ external_id: string }>(db, "SELECT external_id FROM player_external_ids WHERE player_id = ? AND source = 'api-football'", [p.id]);
        const recent = one<{ as_of: string }>(db, "SELECT as_of FROM player_season_stats WHERE player_id = ? AND season_code = ? AND source = 'api-football'", [p.id, SEASON_CODE]);
        if (recent && now - new Date(recent.as_of).getTime() < 20 * 3600_000 && !ctx.force) continue;
        let path: string;
        if (ext) path = `/players?id=${ext.external_id}&season=${season()}`;
        else {
          const surname = p.full_name.split(" ").sort((a, b) => b.length - a.length)[0];
          if (!surname || surname.length < 4) continue;
          path = `/players?search=${encodeURIComponent(surname)}&league=${LEAGUE}&season=${season()}`;
        }
        calls++;
        try {
          const res = await get(ctx, path, 20 * 3600);
          const arr = playerStatsSchema.parse(res.response);
          const hit = ext ? arr[0] : arr.find((a) => linkPlayer(db, a.player.id, a.player.name, p.team_name ?? "") === p.id);
          if (!hit) continue;
          if (!ext) run(db, "INSERT OR IGNORE INTO player_external_ids (player_id, source, external_id) VALUES (?, 'api-football', ?)", [p.id, String(hit.player.id)]);
          const st = hit.statistics.find((s) => s.league.id === LEAGUE);
          if (!st) continue;
          upsertSeasonStats(db, p.id, SEASON_CODE, "api-football", {
            appearances: st.games.appearences ?? null,
            starts: st.games.lineups ?? null,
            minutes: st.games.minutes ?? null,
            goals: st.goals.total ?? 0,
            assists: st.goals.assists ?? 0,
            goals_conceded: st.goals.conceded ?? null,
            yellow_cards: st.cards.yellow ?? 0,
            red_cards: st.cards.red ?? 0,
            penalties_scored: st.penalty?.scored ?? null,
            penalties_missed: st.penalty?.missed ?? null,
            penalties_saved: st.penalty?.saved ?? null,
            penalties_taken: st.penalty?.scored != null && st.penalty?.missed != null ? (st.penalty.scored ?? 0) + (st.penalty.missed ?? 0) : null,
            shots: st.shots?.total ?? null,
            shots_on_target: st.shots?.on ?? null,
            key_passes: st.passes?.key ?? null,
          });
          updated++;
        } catch (e) {
          out.messages.push(`Statistiche ${p.full_name}: ${(e as Error).message}`);
          if (/limit|requests/i.test((e as Error).message)) break;
        }
      }
      out.items.statistiche_aggiornate = updated;
      out.items.richieste_statistiche = calls;
    }
    void all;
    return out;
  },
};
