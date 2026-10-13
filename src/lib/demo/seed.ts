import type { Db } from "@/lib/db";
import { getState, nowIso, one, run, setState, tx, bumpDataVersion } from "@/lib/db";
import { SEASON_CODE, upsertMatch, upsertTeam } from "@/lib/repo/league";
import { addToRoster, upsertPlayer, setPlayerStatus } from "@/lib/repo/players";
import { addAvailability, addEditorial, upsertLineupReport, upsertMatchStats, upsertSeasonStats } from "@/lib/repo/data";
import { fantavote } from "@/lib/domain/fantavote";
import { DEFAULT_CONFIG, type RoleClassic } from "@/lib/domain/settings";
import { Rng } from "@/lib/model/rng";

/**
 * DATI DEMO ESPLICITAMENTE FITTIZI: squadre, giocatori, risultati e notizie inventati,
 * salvati in un database separato. Servono solo a provare l'interfaccia.
 */
const TEAMS = ["Aquile Demo", "Lupi Demo", "Delfini Demo", "Falchi Demo", "Orsi Demo", "Volpi Demo", "Tori Demo", "Gufi Demo", "Leoni Demo", "Squali Demo"];
const SURNAMES = ["Rossi", "Bianchi", "Ferri", "Gallo", "Conti", "Marini", "Greco", "Bruno", "Ricci", "Costa", "Fontana", "Moretti", "Barbieri", "Lombardi", "Testa", "Serra", "Villa", "Pellegrini", "Caruso", "Leone", "Longo", "Gentile", "Martini", "Vitale", "Rinaldi", "Farina", "Mariani", "Sala", "Cattaneo", "Ferrara"];
const NAMES = ["Luca", "Marco", "Andrea", "Matteo", "Davide", "Simone", "Federico", "Alessio", "Nicola", "Tommaso", "Pietro", "Giorgio"];

function roundRobin(n: number): [number, number][][] {
  const teams = [...Array(n).keys()];
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i];
      const b = teams[n - 1 - i];
      round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    teams.splice(1, 0, teams.pop()!);
  }
  return [...rounds, ...rounds.map((r) => r.map(([a, b]) => [b, a] as [number, number]))];
}

export function ensureDemoSeed(db: Db, userId: number) {
  if (getState(db, `demo_seed_user_${userId}`)) return;
  const rng = new Rng(20262027 + userId);
  tx(db, () => {
    run(db, "INSERT OR IGNORE INTO users (id, username, password_hash, created_at) VALUES (?, ?, '!', ?)", [userId, `demo-${userId}`, nowIso()]);
    if (!getState(db, "demo_seed_league")) {
      const teamIds = TEAMS.map((t) => upsertTeam(db, t));
      const strength = TEAMS.map(() => 0.75 + rng.next() * 0.6);
      const rounds = roundRobin(TEAMS.length);
      const now = Date.now();
      const firstUpcoming = 7;
      for (let r = 0; r < rounds.length; r++) {
        const md = r + 1;
        const base = now + (md - firstUpcoming) * 7 * 86400_000 + 2 * 86400_000;
        rounds[r].forEach(([h, a], i) => {
          // anticipo il venerdì sera, poi sabato e domenica a orari realistici (UTC)
          const slots = [[0, 18, 45], [1, 13, 0], [1, 18, 45], [2, 10, 30], [2, 18, 45]];
          const [dd, hh, mm] = slots[i % slots.length];
          const kick = new Date(base + dd * 86400_000);
          kick.setUTCHours(hh, mm, 0, 0);
          const played = md < firstUpcoming;
          const hg = played ? rng.poisson(1.45 * strength[h] / strength[a]) : null;
          const ag = played ? rng.poisson(1.15 * strength[a] / strength[h]) : null;
          upsertMatch(db, {
            matchday: md,
            home: TEAMS[h],
            away: TEAMS[a],
            kickoffUtc: kick.toISOString(),
            timeKnown: true,
            status: played ? "terminata" : "programmata",
            homeGoals: hg,
            awayGoals: ag,
            source: "demo (dati fittizi)",
            priority: 50,
          });
        });
      }
      // giocatori fittizi: 3P 7D 7C 5A per squadra
      const comp: [RoleClassic, number][] = [["P", 3], ["D", 7], ["C", 7], ["A", 5]];
      let k = 0;
      TEAMS.forEach((team, ti) => {
        for (const [role, count] of comp) {
          for (let j = 0; j < count; j++) {
            const name = `${NAMES[k % NAMES.length]} ${SURNAMES[Math.floor(k / NAMES.length) % SURNAMES.length]}`;
            k++;
            const pid = upsertPlayer(db, { fullName: name, team, roleClassic: role, roleClassicSource: "demo", source: "demo", externalId: `demo-${k}`, origin: "import" }).id;
            setPlayerStatus(db, pid, "disponibile", "demo (dati fittizi)");
            const quality = rng.next();
            const starter = j < (role === "P" ? 1 : role === "A" ? 2 : 4);
            const g90 = role === "A" ? 0.2 + quality * 0.45 : role === "C" ? 0.05 + quality * 0.2 : role === "D" ? 0.02 + quality * 0.06 : 0;
            const a90 = role === "P" ? 0 : 0.04 + quality * (role === "D" ? 0.08 : 0.2);
            let apps = 0, starts = 0, mins = 0, goals = 0, assists = 0, yellow = 0, sumV = 0, sumFv = 0, votedCount = 0;
            for (let md = 1; md < 7; md++) {
              const plays = rng.next() < (starter ? 0.9 : 0.35);
              if (!plays) continue;
              const st = starter && rng.next() < 0.92;
              const m = st ? 70 + Math.round(rng.next() * 20) : 10 + Math.round(rng.next() * 25);
              const gl = rng.poisson(g90 * m / 90);
              const as = rng.poisson(a90 * m / 90);
              const y = rng.next() < 0.2 * m / 90 ? 1 : 0;
              const vote = Math.round((5.6 + quality * 0.8 + rng.normal(0, 0.45) + gl * 0.5) * 2) / 2;
              const voted = m >= 25 || gl > 0;
              const line = { vote: voted ? vote : null, goals: gl, penScored: 0, penMissed: 0, penSaved: 0, assists: as, yellow: y, red: 0, ownGoals: 0, goalsConceded: role === "P" ? rng.poisson(1.2) : 0 };
              const fv = fantavote(line, role, DEFAULT_CONFIG);
              upsertMatchStats(db, pid, SEASON_CODE, md, "demo (dati fittizi)", {
                team_id: teamIds[ti], played: 1, started: st ? 1 : 0, minutes: m, vote: line.vote, fantavote: fv, goals: gl, assists: as, yellow: y,
                goals_conceded: line.goalsConceded, xg: Math.round(g90 * m / 90 * 100) / 100,
              });
              apps++;
              if (st) starts++;
              mins += m;
              goals += gl;
              assists += as;
              yellow += y;
              if (line.vote != null) {
                sumV += line.vote;
                votedCount++;
              }
              if (fv != null) sumFv += fv;
            }
            upsertSeasonStats(db, pid, SEASON_CODE, "demo (dati fittizi)", {
              appearances: apps, starts, minutes: mins, goals, assists, yellow_cards: yellow, red_cards: 0, own_goals: 0,
              avg_vote: votedCount ? Math.round((sumV / votedCount) * 100) / 100 : null, avg_fantavote: votedCount ? Math.round((sumFv / votedCount) * 100) / 100 : null,
              penalties_scored: 0, penalties_missed: 0, penalties_taken: 0, xg: Math.round(g90 * mins / 90 * 100) / 100,
            });
          }
        }
      });
      setState(db, "demo_seed_league", nowIso());
    }
    // rosa demo dell'utente: 3P 8D 8C 6A presi da squadre diverse
    const pick = (role: RoleClassic, n: number) =>
      (db.prepare("SELECT id FROM players WHERE role_classic = ? ORDER BY (id * 7919 + ?) % 101 LIMIT ?").all(role, userId, n) as { id: number }[]).map((r) => r.id);
    const ids = [...pick("P", 3), ...pick("D", 8), ...pick("C", 8), ...pick("A", 6)];
    for (const id of ids) addToRoster(db, userId, id);
    // qualche informazione fittizia su disponibilità, probabili formazioni e pareri
    const md7 = one<{ id: number }>(db, "SELECT id FROM matches WHERE matchday = 7 LIMIT 1");
    if (md7) {
      const [a, b, c, d] = [ids[4], ids[12], ids[19], ids[20]];
      addAvailability(db, { playerId: a, kind: "infortunio", certainty: "confermato", description: "Infortunio fittizio (demo)", source: "Fonte demo", origin: "manuale", createdBy: userId });
      addAvailability(db, { playerId: b, kind: "infortunio", certainty: "dubbio", description: "Affaticamento fittizio (demo)", source: "Fonte demo", origin: "manuale", createdBy: userId });
      addAvailability(db, { playerId: c, kind: "infortunio", certainty: "indiscrezione", description: "Voce non confermata (demo)", source: "Giornale demo", origin: "manuale", createdBy: userId });
      for (const [pid, status, p] of [[ids[17], "ballottaggio", 0.55], [d, "titolare", 0.85], [ids[21], "panchina", 0.1]] as const) {
        const team = one<{ current_team_id: number }>(db, "SELECT current_team_id FROM players WHERE id = ?", [pid])!.current_team_id;
        const m = one<{ id: number }>(db, "SELECT id FROM matches WHERE matchday = 7 AND (home_team_id = ? OR away_team_id = ?)", [team, team]);
        if (m) upsertLineupReport(db, { matchId: m.id, playerId: pid, source: "Probabili demo", kind: "probabile", status, probability: p, origin: "manuale", createdBy: userId });
      }
      addEditorial(db, userId, { playerId: d, matchday: 7, source: "Sito demo A", verdict: "consigliato", explicitAdvice: true, summary: "Parere fittizio (demo)", publishedAt: nowIso() });
      addEditorial(db, userId, { playerId: d, matchday: 7, source: "Sito demo B", verdict: "rischioso", explicitAdvice: true, summary: "Parere fittizio discordante (demo)", publishedAt: nowIso() });
    }
    bumpDataVersion(db);
    setState(db, `demo_seed_user_${userId}`, nowIso());
  });
}
