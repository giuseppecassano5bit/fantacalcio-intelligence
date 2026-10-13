import { describe, expect, it } from "vitest";
import { shrinkRate, estimateRates } from "@/lib/model/playerRates";
import { estimatePlaying } from "@/lib/model/availability";
import { buildLeagueTable, expectMatch, defenceProfile } from "@/lib/model/teamStrength";
import { evaluatePlayer } from "@/lib/model/evaluate";
import { simulate, playerSimStats } from "@/lib/model/simulate";
import { editorialConsensus } from "@/lib/model/consensus";
import { binaryMetrics } from "@/lib/model/calibration";
import { computeFantavalue } from "@/lib/model/fantavalue";
import { fantavote } from "@/lib/domain/fantavote";
import { DEFAULT_CONFIG } from "@/lib/domain/settings";
import { ROLE_PRIORS } from "@/lib/model/priors";
import type { SeasonAgg } from "@/lib/model/inputs";
import { player, match, simParams } from "./helpers";

const season = "2026-27";
const agg = (over: Partial<SeasonAgg>): SeasonAgg => ({
  season, source: "test", asOf: "2026-10-01", apps: null, starts: null, minutes: null, avgVote: null, avgFantavote: null, goals: null, assists: null,
  penTaken: null, penScored: null, penMissed: null, penSaved: null, yellow: null, red: null, ownGoals: null, goalsConceded: null, xg: null, xa: null,
  shots: null, shotsOnTarget: null, keyPasses: null, ...over,
});

describe("tassi individuali", () => {
  it("senza dati il tasso coincide con il prior", () => {
    const r = shrinkRate(0, 0, 0.34, 900);
    expect(r.per90).toBeCloseTo(0.34, 5);
    expect(r.priorShare).toBe(1);
  });

  it("con molti minuti il tasso si avvicina all'osservato", () => {
    const r = shrinkRate(20, 2700, 0.34, 900); // 0.67 gol/90 osservati
    expect(r.per90).toBeGreaterThan(0.55);
    expect(r.low).toBeLessThan(r.per90);
    expect(r.high).toBeGreaterThan(r.per90);
  });

  it("un dato mancante non viene trattato come zero", () => {
    // fonte con soli gol e presenze (es. classifica marcatori): niente cartellini
    const rates = estimateRates(player(), "A", season, [agg({ apps: 10, goals: 6 })], [], [], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rates.yellow.per90).toBeCloseTo(ROLE_PRIORS.A.yellow90, 5);
    expect(rates.goalNp.per90).toBeGreaterThan(ROLE_PRIORS.A.goal90);
    expect(rates.minutesEstimated).toBe(true);
  });

  it("i rigori segnati sono esclusi dai gol su azione", () => {
    const withPens = estimateRates(player(), "A", season, [agg({ apps: 10, minutes: 900, goals: 6, penScored: 4, penMissed: 0 })], [], [], []);
    const noPens = estimateRates(player(), "A", season, [agg({ apps: 10, minutes: 900, goals: 2, penScored: 0, penMissed: 0 })], [], [], []);
    expect(withPens.goalNp.per90).toBeCloseTo(noPens.goalNp.per90, 5);
    expect(withPens.penalties.takerProb).toBeGreaterThan(0.5);
  });
});

describe("titolarità e disponibilità", () => {
  const rates = estimateRates(player(), "A", season, [agg({ apps: 6, starts: 6, minutes: 480, goals: 2 })], [], [], [1, 2, 3, 4, 5, 6]);

  it("la formazione ufficiale ha priorità su tutto", () => {
    const pe = estimatePlaying(player({ status: "infortunato" }), "A", match(), rates, [], [{ kind: "ufficiale", status: "titolare", probability: null, source: "x", reportedAt: new Date().toISOString(), url: null }], 6);
    expect(pe.pStart).toBeGreaterThan(0.99);
    expect(pe.official).toBe(true);
  });

  it("un infortunio confermato azzera la probabilità di giocare", () => {
    const pe = estimatePlaying(player(), "A", match(), rates, [{ kind: "infortunio", certainty: "confermato", description: "lesione", expectedReturn: null, source: "club", url: null, reportedAt: new Date().toISOString() }], [], 6);
    expect(pe.pStart).toBe(0);
    expect(pe.pVote).toBe(0);
    expect(pe.availability).toBe("indisponibile");
  });

  it("un'indiscrezione non modifica la stima ma viene segnalata", () => {
    const base = estimatePlaying(player(), "A", match(), rates, [], [], 6);
    const rumor = estimatePlaying(player(), "A", match(), rates, [{ kind: "infortunio", certainty: "indiscrezione", description: "voce", expectedReturn: null, source: "giornale", url: null, reportedAt: new Date().toISOString() }], [], 6);
    expect(rumor.pStart).toBeCloseTo(base.pStart, 10);
    expect(rumor.rumors).toHaveLength(1);
    expect(rumor.warnings.join(" ")).toMatch(/verificare/);
  });

  it("senza alcuna evidenza la titolarità è dichiarata sconosciuta", () => {
    const empty = estimateRates(player(), "A", season, [], [], [], []);
    const pe = estimatePlaying(player(), "A", match(), empty, [], [], 0);
    expect(pe.insufficient).toBe(true);
  });

  it("i minuti attesi usano i minuti reali da titolare", () => {
    const pe = estimatePlaying(player(), "A", match(), rates, [], [], 6);
    expect(pe.minutesIfStart).toBeCloseTo(80, 0);
    expect(pe.expectedMinutes).toBeGreaterThan(60);
  });
});

describe("forza delle squadre", () => {
  const ms = [
    { homeId: 1, awayId: 2, homeGoals: 4, awayGoals: 0, kickoff: "2026-09-01" },
    { homeId: 3, awayId: 1, homeGoals: 0, awayGoals: 3, kickoff: "2026-09-08" },
    { homeId: 2, awayId: 3, homeGoals: 1, awayGoals: 1, kickoff: "2026-09-15" },
  ];
  it("l'attacco forte contro la difesa debole produce più gol attesi", () => {
    const t = buildLeagueTable(ms);
    const strong = expectMatch(t, 1, 2, true);
    const weak = expectMatch(t, 2, 1, true);
    expect(strong.teamGoals).toBeGreaterThan(weak.teamGoals);
  });
  it("il profilo difensivo dichiara la mancanza di dati avanzati", () => {
    const t = buildLeagueTable(ms);
    expect(defenceProfile(t, 2).basis).toBe("gol");
    expect(defenceProfile(t, 2).note).toMatch(/non disponibili/);
  });
});

describe("valutazione completa e simulazione", () => {
  const t = buildLeagueTable([]);
  const input = (over = {}) => ({
    player: player(),
    season,
    seasonRows: [agg({ apps: 6, starts: 6, minutes: 500, goals: 4, assists: 1, yellow: 1, red: 0, ownGoals: 0, penScored: 0, penMissed: 0 })],
    matchLines: [],
    importedMatchdays: [],
    teamMatchdays: [1, 2, 3, 4, 5, 6],
    match: match(),
    availability: [],
    lineups: [],
    editorial: [],
    matchday: 7,
    ...over,
  });

  it("produce probabilità coerenti (gol o assist >= gol)", () => {
    const ev = evaluatePlayer(input(), t, DEFAULT_CONFIG);
    expect(ev.probs.goalOrAssist.p).toBeGreaterThanOrEqual(ev.probs.goal.p);
    expect(ev.probs.goal.low).toBeLessThanOrEqual(ev.probs.goal.p);
    expect(ev.probs.goal.high).toBeGreaterThanOrEqual(ev.probs.goal.p);
    expect(ev.probs.noVote).toBeCloseTo(1 - ev.playing.pVote, 10);
  });

  it("il rigore sbagliato è scomposto in tre fattori", () => {
    const ev = evaluatePlayer(input({ player: player({ penaltyOrder: 1 }) }), t, DEFAULT_CONFIG);
    const pm = ev.probs.penaltyMiss;
    expect(pm.total).toBeCloseTo(pm.teamAwarded * pm.isTakerOnPitch * pm.missGivenTaken, 10);
    const noTaker = evaluatePlayer(input(), t, DEFAULT_CONFIG);
    expect(noTaker.probs.penaltyMiss.total).toBeLessThan(pm.total);
  });

  it("la simulazione è riproducibile con lo stesso seme", () => {
    const a = simulate([simParams()], DEFAULT_CONFIG, 2000, 42);
    const b = simulate([simParams()], DEFAULT_CONFIG, 2000, 42);
    expect(Array.from(a.fv.get(1)!)).toEqual(Array.from(b.fv.get(1)!));
  });

  it("la probabilità di voto simulata rispetta i parametri", () => {
    const s = simulate([simParams({ pStart: 0.5, pSub: 0 })], DEFAULT_CONFIG, 8000, 7);
    const st = playerSimStats(s, 1, DEFAULT_CONFIG)!;
    expect(st.pVote).toBeGreaterThan(0.45);
    expect(st.pVote).toBeLessThan(0.55);
  });

  it("un giocatore molto produttivo ma quasi sempre in panchina non vale come un titolare", () => {
    const sim = simulate(
      [simParams({ playerId: 1, pStart: 0.95, goal90: 0.3 }), simParams({ playerId: 2, pStart: 0.1, pSub: 0.3, goal90: 0.9 })],
      DEFAULT_CONFIG,
      6000,
      3,
    );
    const titolare = playerSimStats(sim, 1, DEFAULT_CONFIG)!;
    const panchinaro = playerSimStats(sim, 2, DEFAULT_CONFIG)!;
    expect(titolare.expectedPoints).toBeGreaterThan(panchinaro.expectedPoints);
  });

  it("il Fantavalue resta tra 0 e 100 ed è basso per un indisponibile", () => {
    const ev = evaluatePlayer(input({ availability: [{ kind: "infortunio", certainty: "confermato", description: null, expectedReturn: null, source: "x", url: null, reportedAt: new Date().toISOString() }] }), t, DEFAULT_CONFIG);
    const fv = computeFantavalue(ev, t)!;
    expect(fv.index).toBeLessThanOrEqual(5);
    const ok = computeFantavalue(evaluatePlayer(input(), t, DEFAULT_CONFIG), t)!;
    expect(ok.index).toBeGreaterThan(fv.index);
    expect(ok.index).toBeLessThanOrEqual(100);
  });
});

describe("fantavoto", () => {
  it("applica bonus e malus del regolamento", () => {
    const fv = fantavote({ vote: 6.5, goals: 1, penScored: 1, penMissed: 0, penSaved: 0, assists: 1, yellow: 1, red: 0, ownGoals: 0, goalsConceded: 0 }, "A", DEFAULT_CONFIG);
    expect(fv).toBeCloseTo(6.5 + 3 + 3 + 1 - 0.5, 5);
  });
  it("portiere: gol subiti e porta inviolata", () => {
    expect(fantavote({ vote: 6, goals: 0, penScored: 0, penMissed: 0, penSaved: 0, assists: 0, yellow: 0, red: 0, ownGoals: 0, goalsConceded: 2 }, "P", DEFAULT_CONFIG)).toBe(4);
    expect(fantavote({ vote: 6, goals: 0, penScored: 0, penMissed: 0, penSaved: 0, assists: 0, yellow: 0, red: 0, ownGoals: 0, goalsConceded: 0 }, "P", DEFAULT_CONFIG)).toBe(7);
  });
  it("senza voto restituisce null", () => {
    expect(fantavote({ vote: null, goals: 1, penScored: 0, penMissed: 0, penSaved: 0, assists: 0, yellow: 0, red: 0, ownGoals: 0, goalsConceded: 0 }, "A", DEFAULT_CONFIG)).toBeNull();
  });
});

describe("consenso editoriale", () => {
  const now = Date.now();
  const iso = new Date(now - 3600_000).toISOString();
  it("la stessa notizia ripresa da più fonti conta una volta", () => {
    const c = editorialConsensus(
      [
        { source: "A", verdict: "consigliato", explicit: true, matchday: 7, publishedAt: iso, storyKey: "rientro", summary: null, url: null },
        { source: "B", verdict: "consigliato", explicit: true, matchday: 7, publishedAt: iso, storyKey: "rientro", summary: null, url: null },
      ],
      7,
      now,
    );
    expect(c.independentSources).toBe(1);
  });
  it("mostra il disaccordo invece di forzare il consenso", () => {
    const c = editorialConsensus(
      [
        { source: "A", verdict: "consigliato", explicit: true, matchday: 7, publishedAt: iso, storyKey: null, summary: null, url: null },
        { source: "B", verdict: "sconsigliato", explicit: true, matchday: 7, publishedAt: iso, storyKey: null, summary: null, url: null },
      ],
      7,
      now,
    );
    expect(c.agreement).toBe("disaccordo");
  });
});

describe("calibrazione", () => {
  it("un modello perfetto batte la baseline", () => {
    const obs = Array.from({ length: 100 }, (_, i) => ({ role: "A", p: i % 2 ? 0.95 : 0.05, outcome: (i % 2) as 0 | 1 }));
    const m = binaryMetrics(obs);
    expect(m.brier!).toBeLessThan(m.baselineBrier!);
    expect(m.skill!).toBeGreaterThan(0.5);
    expect(m.enough).toBe(true);
  });
  it("segnala campione insufficiente", () => {
    expect(binaryMetrics([{ role: "A", p: 0.3, outcome: 1 }]).enough).toBe(false);
  });
});
