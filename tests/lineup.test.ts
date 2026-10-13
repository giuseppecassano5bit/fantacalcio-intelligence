import { describe, expect, it } from "vitest";
import { optimizeLineup, type Candidate } from "@/lib/model/lineup";
import { compareCandidates } from "@/lib/model/compare";
import { hungarian } from "@/lib/model/hungarian";
import { simulate, playerSimStats } from "@/lib/model/simulate";
import { DEFAULT_CONFIG, type LeagueConfig, type RoleClassic } from "@/lib/domain/settings";
import type { PlayerEvaluation } from "@/lib/model/evaluate";
import { simParams } from "./helpers";

/** Valutazione minima sufficiente per l'ottimizzatore. */
function fakeEv(id: number, role: RoleClassic, pVote: number, available = true): PlayerEvaluation {
  return {
    playerId: id,
    name: `G${id}`,
    role,
    playing: { pStart: pVote, pVote, pSub: 0, availability: available ? "disponibile" : "indisponibile", availabilityLabel: available ? "Disponibile" : "Infortunato", rumors: [], insufficient: false },
    probs: { goalOrAssist: { p: 0.2 }, yellow: { p: 0.1 } },
    factors: [],
    reliability: { level: "media", missing: [] },
    points: {},
    match: null,
  } as unknown as PlayerEvaluation;
}

function roster(spec: { id: number; role: RoleClassic; pStart: number; goal90?: number; voteMean?: number }[], cfg: LeagueConfig = DEFAULT_CONFIG) {
  const params = spec.map((s) => simParams({ playerId: s.id, role: s.role, pStart: s.pStart, pSub: 0, goal90: s.role === "P" ? 0 : s.goal90 ?? 0.1, voteMean: s.voteMean ?? 6, teamId: 100 + s.id, oppId: 200 + s.id }));
  const sim = simulate(params, cfg, 3000, 11);
  const cands: Candidate[] = spec.map((s) => ({
    playerId: s.id,
    name: `G${s.id}`,
    roles: [s.role],
    classicRole: s.role,
    ev: fakeEv(s.id, s.role, s.pStart, s.pStart > 0),
    stats: playerSimStats(sim, s.id, cfg),
  }));
  return { sim, cands };
}

// rosa tipo 3P 8D 8C 6A
const base: { id: number; role: RoleClassic; pStart: number; goal90?: number }[] = [
  ...[0.95, 0.1, 0.05].map((p, i) => ({ id: 1 + i, role: "P" as const, pStart: p })),
  ...[0.95, 0.9, 0.9, 0.85, 0.8, 0.5, 0.3, 0.1].map((p, i) => ({ id: 10 + i, role: "D" as const, pStart: p })),
  ...[0.95, 0.9, 0.85, 0.85, 0.8, 0.4, 0.3, 0.1].map((p, i) => ({ id: 20 + i, role: "C" as const, pStart: p, goal90: 0.12 })),
  ...[0.95, 0.9, 0.85, 0.3, 0.2, 0].map((p, i) => ({ id: 30 + i, role: "A" as const, pStart: p, goal90: 0.4 })),
];

describe("algoritmo ungherese", () => {
  it("trova l'assegnazione a costo minimo", () => {
    const res = hungarian([
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ]);
    const cost = res.reduce((s, j, i) => s + [[4, 1, 3], [2, 0, 5], [3, 2, 2]][i][j], 0);
    expect(cost).toBe(5);
  });
});

describe("formazione consigliata", () => {
  it("rispetta modulo, ruoli e dimensione della panchina", () => {
    const { sim, cands } = roster(base);
    const r = optimizeLineup(cands, sim, DEFAULT_CONFIG, "equilibrata")!;
    expect(r).not.toBeNull();
    expect(r.starters).toHaveLength(11);
    const roles = r.starters.map((s) => cands.find((c) => c.playerId === s.playerId)!.classicRole);
    const [d, c, a] = r.module.split("-").map(Number);
    expect(roles.filter((x) => x === "P")).toHaveLength(1);
    expect(roles.filter((x) => x === "D")).toHaveLength(d);
    expect(roles.filter((x) => x === "C")).toHaveLength(c);
    expect(roles.filter((x) => x === "A")).toHaveLength(a);
    expect(r.bench.length).toBeLessThanOrEqual(DEFAULT_CONFIG.formazione.panchina);
    const all = new Set([...r.starters.map((s) => s.playerId), ...r.bench.map((b) => b.playerId)]);
    expect(all.size).toBe(r.starters.length + r.bench.length);
  });

  it("non schiera un indisponibile se esiste un'alternativa", () => {
    const spec = base.map((s) => (s.id === 30 ? { ...s, pStart: 0 } : s));
    const { sim, cands } = roster(spec);
    const r = optimizeLineup(cands, sim, DEFAULT_CONFIG, "equilibrata")!;
    expect(r.starters.map((s) => s.playerId)).not.toContain(30);
  });

  it("schiera il portiere titolare e mette in panchina i portieri di riserva", () => {
    const { sim, cands } = roster(base);
    const r = optimizeLineup(cands, sim, DEFAULT_CONFIG, "equilibrata")!;
    expect(r.starters.map((s) => s.playerId)).toContain(1);
  });

  it("la strategia cambia davvero l'obiettivo", () => {
    // attaccante esplosivo ma incerto contro attaccante affidabile poco prolifico
    const spec = [
      ...base.filter((s) => s.role !== "A"),
      { id: 30, role: "A" as const, pStart: 0.95, goal90: 0.35 },
      { id: 31, role: "A" as const, pStart: 0.95, goal90: 0.35 },
      { id: 32, role: "A" as const, pStart: 0.97, goal90: 0.05 },
      { id: 33, role: "A" as const, pStart: 0.55, goal90: 1.2 },
    ];
    const { sim, cands } = roster(spec);
    const bonus = optimizeLineup(cands, sim, DEFAULT_CONFIG, "bonus")!;
    const safe = optimizeLineup(cands, sim, DEFAULT_CONFIG, "sicurezza")!;
    expect(bonus.metrics.objective).not.toBeCloseTo(safe.metrics.objective, 1);
    // ogni formazione è ottima per la propria strategia
    expect(bonus.metrics.p90).toBeGreaterThanOrEqual(safe.metrics.p90 - 1e-9);
  });

  it("restituisce null se nessun modulo è schierabile", () => {
    const { sim, cands } = roster(base.filter((s) => s.role !== "P"));
    expect(optimizeLineup(cands, sim, DEFAULT_CONFIG, "equilibrata")).toBeNull();
  });

  it("include spiegazioni concrete per titolari e panchina", () => {
    const { sim, cands } = roster(base);
    const r = optimizeLineup(cands, sim, DEFAULT_CONFIG, "equilibrata")!;
    expect(r.starters.every((s) => s.reasons.some((x) => x.startsWith("Punti attesi")))).toBe(true);
    expect(r.bench.every((b) => b.reasons.length > 0)).toBe(true);
    expect(r.secondBest).not.toBeNull();
  });
});

describe("ballottaggi", () => {
  it("indica prima e seconda scelta", () => {
    const { sim, cands } = roster([
      { id: 1, role: "A", pStart: 0.95, goal90: 0.5 },
      { id: 2, role: "A", pStart: 0.4, goal90: 0.5 },
    ]);
    const res = compareCandidates(cands, sim, DEFAULT_CONFIG, "equilibrata");
    expect(res.first).toBe(1);
    expect(res.second).toBe(2);
    expect(res.explanation.length).toBeGreaterThan(0);
  });
});
