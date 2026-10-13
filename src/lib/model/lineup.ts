import { slotAccepts, type LeagueConfig, type ModuleDef, type RoleClassic } from "@/lib/domain/settings";
import type { PlayerEvaluation } from "./evaluate";
import { noVoteValue, type PlayerSimStats, type SimOutput } from "./simulate";
import { hungarian } from "./hungarian";
import { quantile } from "./rng";

export type Strategy = "equilibrata" | "bonus" | "sicurezza";
export const STRATEGY_LABEL: Record<Strategy, string> = {
  equilibrata: "Equilibrata",
  bonus: "A caccia di bonus",
  sicurezza: "Sicurezza",
};
export const STRATEGY_HELP: Record<Strategy, string> = {
  equilibrata: "Massimizza il punteggio medio atteso della squadra.",
  bonus: "Metà peso alla media e metà allo scenario favorevole (80° percentile): accetta più variabilità.",
  sicurezza: "Metà peso alla media e metà allo scenario sfavorevole (20° percentile): penalizza rischio di senza voto e malus.",
};

export interface Candidate {
  playerId: number;
  name: string;
  roles: string[]; // ruoli ammessi nella modalità della lega
  classicRole: RoleClassic;
  ev: PlayerEvaluation;
  stats: PlayerSimStats | null;
}

export interface LineupSlot {
  playerId: number;
  slotRoles: string[];
  reasons: string[];
  warnings: string[];
}

export interface LineupResult {
  strategy: Strategy;
  module: string;
  starters: LineupSlot[];
  bench: { playerId: number; reasons: string[] }[];
  excluded: { playerId: number; reasons: string[] }[];
  metrics: {
    mean: number;
    objective: number;
    p10: number;
    p50: number;
    p90: number;
    pAllCovered: number;
    expectedSubs: number;
    expectedTeamGoals: number;
    expectedNoVoteStarters: number;
  };
  risks: string[];
  ballottaggi: { starterId: number; alternativeId: number; delta: number }[];
  secondBest: { module: string; starters: number[]; mean: number; objective: number; in: number[]; out: number[] } | null;
  modulesTried: { module: string; feasible: boolean; mean: number | null; objective: number | null }[];
  warnings: string[];
}

interface Ctx {
  cfg: LeagueConfig;
  sim: SimOutput;
  byId: Map<number, Candidate>;
  n: number; // iterazioni usate
  noVote: number;
  strategy: Strategy;
}

export function aggregate(values: Float64Array | number[], strategy: Strategy): number {
  const arr = Float64Array.from(values as ArrayLike<number>);
  let mean = 0;
  for (const x of arr) mean += x;
  mean /= arr.length;
  if (strategy === "equilibrata") return mean;
  arr.sort();
  return strategy === "bonus" ? 0.5 * mean + 0.5 * quantile(arr, 0.8) : 0.5 * mean + 0.5 * quantile(arr, 0.2);
}

function individualScore(ctx: Ctx, id: number): number {
  const fv = ctx.sim.fv.get(id);
  if (!fv) return -1;
  const vals = new Float64Array(ctx.n);
  for (let i = 0; i < ctx.n; i++) vals[i] = Number.isNaN(fv[i]) ? ctx.noVote : fv[i];
  return aggregate(vals, ctx.strategy);
}

/** Totali di squadra per iterazione, con sostituzioni dalla panchina e modificatore difesa. */
function teamTotals(ctx: Ctx, starters: { id: number; slot: string[] }[], bench: number[], collect = false) {
  const { cfg, sim, n } = ctx;
  const T = new Float64Array(n);
  let covered = 0;
  let subsSum = 0;
  let noVoteStarters = 0;
  const maxSubs = cfg.formazione.maxSostituzioni;
  const free = cfg.formazione.regolaSostituzioni === "panchina_libera";
  const benchRoles = bench.map((b) => ctx.byId.get(b)!);
  const md = cfg.modificatoreDifesa;
  const useMod = cfg.mode === "classic" && md.attivo;
  const sFv = starters.map((s) => sim.fv.get(s.id)!);
  const bFv = bench.map((b) => sim.fv.get(b)!);
  const used = new Uint8Array(bench.length);
  for (let i = 0; i < n; i++) {
    used.fill(0);
    let total = 0;
    let subs = 0;
    let allCovered = true;
    let gkVote: number | null = null;
    const dVotes: number[] = [];
    for (let s = 0; s < starters.length; s++) {
      const x = sFv[s][i];
      const slot = starters[s].slot;
      const isGkSlot = slot.some((r) => r === "P" || r.toLowerCase() === "por");
      let pid = starters[s].id;
      let val = x;
      if (Number.isNaN(x)) {
        if (collect) noVoteStarters++;
        val = NaN;
        if (subs < maxSubs) {
          for (let b = 0; b < bench.length; b++) {
            if (used[b]) continue;
            const cand = benchRoles[b];
            const ok = free && !isGkSlot ? cand.classicRole !== "P" : slotAccepts(slot, cand.roles);
            if (!ok) continue;
            const y = bFv[b][i];
            if (Number.isNaN(y)) continue;
            used[b] = 1;
            subs++;
            val = y;
            pid = bench[b];
            break;
          }
        }
      }
      if (Number.isNaN(val)) {
        allCovered = false;
        total += ctx.noVote;
        continue;
      }
      total += val;
      if (useMod) {
        const c = ctx.byId.get(pid)!;
        const v = sim.vote.get(pid)![i];
        if (c.classicRole === "P") gkVote = v;
        else if (c.classicRole === "D") dVotes.push(v);
      }
    }
    if (useMod && gkVote != null && dVotes.length >= md.minDifensori) {
      dVotes.sort((a, b) => b - a);
      const media = (gkVote + dVotes[0] + dVotes[1] + dVotes[2]) / 4;
      let bonus = 0;
      for (const t of md.soglie) if (media >= t.daMedia) bonus = Math.max(bonus, t.bonus);
      total += bonus;
    }
    T[i] = total;
    if (allCovered) covered++;
    subsSum += subs;
  }
  return { T, pAllCovered: covered / n, expectedSubs: subsSum / n, expectedNoVoteStarters: noVoteStarters / n };
}

const ROLE_ORDER: Record<string, number> = { P: 0, D: 1, C: 2, A: 3 };

/** Sceglie e ordina la panchina tra i non titolari. */
function chooseBench(ctx: Ctx, nonStarters: number[]): number[] {
  const size = ctx.cfg.formazione.panchina;
  const val = (id: number) => {
    const st = ctx.byId.get(id)!.stats;
    return st ? (st.expectedFvIfVote ?? 0) * Math.min(1, st.pVote * 1.5) : 0;
  };
  let chosen: number[];
  if (nonStarters.length <= size) chosen = [...nonStarters];
  else {
    chosen = [];
    const byRole = new Map<string, number[]>();
    for (const id of nonStarters) {
      const r = ctx.byId.get(id)!.classicRole;
      if (!byRole.has(r)) byRole.set(r, []);
      byRole.get(r)!.push(id);
    }
    for (const list of byRole.values()) list.sort((a, b) => val(b) - val(a));
    // prima un giocatore per ruolo (copertura), poi i migliori rimanenti con penalità per ridondanza
    for (const r of ["P", "D", "C", "A"]) {
      const l = byRole.get(r);
      if (l && l.length && chosen.length < size) chosen.push(l.shift()!);
    }
    const rest = [...byRole.values()].flat();
    while (chosen.length < size && rest.length) {
      rest.sort((a, b) => {
        const ra = chosen.filter((c) => ctx.byId.get(c)!.classicRole === ctx.byId.get(a)!.classicRole).length;
        const rb = chosen.filter((c) => ctx.byId.get(c)!.classicRole === ctx.byId.get(b)!.classicRole).length;
        return val(b) / (1 + 0.6 * rb) - val(a) / (1 + 0.6 * ra);
      });
      chosen.push(rest.shift()!);
    }
  }
  // ordinamento: per ruolo, poi per fantavoto atteso se a voto (chi ha poche probabilità di voto in fondo)
  return chosen.sort((a, b) => {
    const ca = ctx.byId.get(a)!;
    const cb = ctx.byId.get(b)!;
    const ro = ctx.cfg.mode === "classic" ? (ROLE_ORDER[ca.classicRole] ?? 9) - (ROLE_ORDER[cb.classicRole] ?? 9) : 0;
    if (ro !== 0) return ro;
    const la = (ca.stats?.pVote ?? 0) < 0.05 ? 1 : 0;
    const lb = (cb.stats?.pVote ?? 0) < 0.05 ? 1 : 0;
    if (la !== lb) return la - lb;
    return (cb.stats?.expectedFvIfVote ?? 0) - (ca.stats?.expectedFvIfVote ?? 0);
  });
}

interface Config {
  module: ModuleDef;
  starters: { id: number; slot: string[] }[];
  bench: number[];
  objective: number;
  mean: number;
}

function evaluateConfig(ctx: Ctx, module: ModuleDef, starters: { id: number; slot: string[] }[], all: number[]): Config {
  const set = new Set(starters.map((s) => s.id));
  const bench = chooseBench(ctx, all.filter((id) => !set.has(id)));
  const { T } = teamTotals(ctx, starters, bench);
  let mean = 0;
  for (const x of T) mean += x;
  mean /= T.length;
  return { module, starters, bench, objective: aggregate(T, ctx.strategy), mean };
}

function optimizeModule(ctx: Ctx, module: ModuleDef, all: number[], scores: Map<number, number>): Config | null {
  const slots = module.slots;
  const eligible = (slot: string[], id: number) => slotAccepts(slot, ctx.byId.get(id)!.roles);
  if (all.length < slots.length) return null;
  const BIG = 1e6;
  const cost = slots.map((slot) => all.map((id) => (eligible(slot, id) ? -(scores.get(id) ?? 0) : BIG)));
  const assign = hungarian(cost);
  if (assign.some((j, i) => j < 0 || cost[i][j] >= BIG)) return null;
  let starters = slots.map((slot, i) => ({ id: all[assign[i]], slot }));
  let best = evaluateConfig(ctx, module, starters, all);

  // ricerca locale: scambi titolare <-> non titolare valutati sull'intera squadra (con panchina)
  for (let pass = 0; pass < 4; pass++) {
    let improved: Config | null = null;
    const startSet = new Set(starters.map((s) => s.id));
    for (let s = 0; s < starters.length; s++) {
      const alts = all
        .filter((id) => !startSet.has(id) && eligible(starters[s].slot, id))
        .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))
        .slice(0, 3);
      for (const alt of alts) {
        const trial = starters.map((x, k) => (k === s ? { id: alt, slot: x.slot } : x));
        const c = evaluateConfig(ctx, module, trial, all);
        if (c.objective > (improved?.objective ?? best.objective) + 1e-6) improved = c;
      }
    }
    if (!improved) break;
    best = improved;
    starters = improved.starters;
  }
  return best;
}

const fmt = (x: number, d = 1) => x.toFixed(d).replace(".", ",");
const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Genera la formazione consigliata. Non ordina semplicemente per Fantavalue:
 * massimizza l'obiettivo della strategia sul punteggio di squadra simulato,
 * rispettando moduli, ruoli, panchina e regole di sostituzione della lega.
 */
export function optimizeLineup(
  candidates: Candidate[],
  sim: SimOutput,
  cfg: LeagueConfig,
  strategy: Strategy,
  opts: { searchIterations?: number } = {},
): LineupResult | null {
  const byId = new Map(candidates.map((c) => [c.playerId, c]));
  const all = candidates.filter((c) => sim.fv.has(c.playerId) && c.roles.length > 0).map((c) => c.playerId);
  const ctx: Ctx = { cfg, sim, byId, n: Math.min(sim.n, opts.searchIterations ?? 1500), noVote: noVoteValue(cfg), strategy };
  const scores = new Map(all.map((id) => [id, individualScore(ctx, id)]));

  const results: Config[] = [];
  const modulesTried: LineupResult["modulesTried"] = [];
  for (const module of cfg.formazione.moduli) {
    const c = optimizeModule(ctx, module, all, scores);
    modulesTried.push({ module: module.name, feasible: !!c, mean: c?.mean ?? null, objective: c?.objective ?? null });
    if (c) results.push(c);
  }
  if (results.length === 0) return null;
  results.sort((a, b) => b.objective - a.objective);
  const best = results[0];

  // valutazione finale con tutte le iterazioni
  const full: Ctx = { ...ctx, n: sim.n };
  const final = teamTotals(full, best.starters, best.bench, true);
  const sorted = Float64Array.from(final.T).sort();
  let mean = 0;
  for (const x of final.T) mean += x;
  mean /= final.T.length;
  const goals = (t: number) => (t >= cfg.golSquadra.soglia ? Math.floor((t - cfg.golSquadra.soglia) / cfg.golSquadra.passo) + 1 : 0);
  let expGoals = 0;
  for (const x of final.T) expGoals += goals(x);
  expGoals /= final.T.length;

  const fullScores = new Map(all.map((id) => [id, individualScore(full, id)]));
  const starterIds = new Set(best.starters.map((s) => s.id));
  const benchIds = new Set(best.bench);
  const nonStarters = all.filter((id) => !starterIds.has(id));

  // --- spiegazioni ---
  const warnings: string[] = [];
  const risks: string[] = [];
  const ballottaggi: LineupResult["ballottaggi"] = [];
  const starters: LineupSlot[] = best.starters.map(({ id, slot }) => {
    const c = byId.get(id)!;
    const ev = c.ev;
    const st = c.stats;
    const reasons: string[] = [];
    const w: string[] = [];
    if (st) reasons.push(`Punti attesi ${fmt(st.expectedPoints)} (fantavoto atteso se a voto ${st.expectedFvIfVote != null ? fmt(st.expectedFvIfVote) : "n.d."})`);
    for (const f of ev.factors.filter((f) => f.sign >= 0).slice(0, 3)) reasons.push(f.text);
    const alt = nonStarters
      .filter((a) => slotAccepts(slot, byId.get(a)!.roles))
      .sort((a, b) => (fullScores.get(b) ?? 0) - (fullScores.get(a) ?? 0))[0];
    if (alt != null) {
      const ac = byId.get(alt)!;
      const delta = (fullScores.get(id) ?? 0) - (fullScores.get(alt) ?? 0);
      const altInfo = ac.ev.playing.availability === "indisponibile" ? ac.ev.playing.availabilityLabel.toLowerCase() : `titolarità ${pct(ac.ev.playing.pStart)}`;
      reasons.push(`Preferito a ${ac.name}: ${delta >= 0 ? "+" : ""}${fmt(delta, 2)} punti secondo la strategia (${ac.name}: ${altInfo})`);
      if (Math.abs(delta) < 0.35) ballottaggi.push({ starterId: id, alternativeId: alt, delta });
    }
    if (ev.playing.availability === "indisponibile") {
      w.push(`${ev.playing.availabilityLabel}: schierato solo perché non ci sono alternative valide per lo slot.`);
      warnings.push(`${c.name} è ${ev.playing.availabilityLabel.toLowerCase()} ma non esistono alternative nel ruolo.`);
    } else if (ev.playing.pVote < 0.75) {
      const cover = best.bench.find((b) => slotAccepts(slot, byId.get(b)!.roles) && (byId.get(b)!.stats?.pVote ?? 0) > 0.6);
      w.push(`Probabilità di voto ${pct(ev.playing.pVote)}${cover ? `; copertura in panchina: ${byId.get(cover)!.name}` : "; nessuna copertura affidabile in panchina"}`);
      risks.push(`${c.name}: probabilità di prendere voto ${pct(ev.playing.pVote)}${cover ? "" : " senza copertura in panchina"}.`);
    }
    if (ev.playing.rumors.length) w.push("Notizie non confermate da verificare.");
    if (ev.reliability.level === "bassa") risks.push(`${c.name}: stima poco affidabile (mancano: ${ev.reliability.missing.slice(0, 2).join(", ")}).`);
    if (ev.probs.yellow.p >= 0.3 && ev.playing.diffidato) risks.push(`${c.name}: diffidato con rischio ammonizione ${pct(ev.probs.yellow.p)}.`);
    return { playerId: id, slotRoles: slot, reasons, warnings: w };
  });

  const lastStarterByRole = new Map<string, number>();
  for (const s of best.starters) {
    const r = byId.get(s.id)!.classicRole;
    const prev = lastStarterByRole.get(r);
    if (prev == null || (fullScores.get(s.id) ?? 0) < (fullScores.get(prev) ?? 0)) lastStarterByRole.set(r, s.id);
  }
  const benchOut = best.bench.map((id) => {
    const c = byId.get(id)!;
    const reasons: string[] = [];
    if (c.ev.playing.availability === "indisponibile") reasons.push(c.ev.playing.availabilityLabel);
    const ref = lastStarterByRole.get(c.classicRole);
    if (ref != null && ref !== id) {
      const rc = byId.get(ref)!;
      reasons.push(`Meno conveniente di ${rc.name}: ${fmt(fullScores.get(id) ?? 0, 2)} contro ${fmt(fullScores.get(ref) ?? 0, 2)} punti secondo la strategia`);
    }
    for (const f of c.ev.factors.filter((f) => f.sign < 0).slice(0, 2)) reasons.push(f.text);
    if (c.stats) reasons.push(`Se entra a voto vale in media ${c.stats.expectedFvIfVote != null ? fmt(c.stats.expectedFvIfVote) : "n.d."}`);
    return { playerId: id, reasons };
  });
  const excluded = all
    .filter((id) => !starterIds.has(id) && !benchIds.has(id))
    .map((id) => {
      const c = byId.get(id)!;
      const reasons = [`Fuori dalla panchina (max ${cfg.formazione.panchina}): copertura del ruolo già garantita da giocatori più utili`];
      for (const f of c.ev.factors.filter((f) => f.sign < 0).slice(0, 1)) reasons.push(f.text);
      return { playerId: id, reasons };
    });
  const missingRole = candidates.filter((c) => c.roles.length === 0);
  if (missingRole.length) warnings.push(`${missingRole.length} giocatore/i senza ruolo valido per la modalità della lega: esclusi dal calcolo.`);
  if (final.pAllCovered < 0.85) risks.push(`Probabilità che tutti gli slot abbiano un voto (anche con la panchina): ${pct(final.pAllCovered)}.`);

  // seconda migliore formazione con titolari diversi
  const key = (c: Config) => c.starters.map((s) => s.id).sort((a, b) => a - b).join(",");
  const bestKey = key(best);
  const second = results.find((r) => key(r) !== bestKey) ?? null;
  let secondBest: LineupResult["secondBest"] = null;
  if (second) {
    const fs = teamTotals(full, second.starters, second.bench);
    let m2 = 0;
    for (const x of fs.T) m2 += x;
    m2 /= fs.T.length;
    const ids2 = new Set(second.starters.map((s) => s.id));
    secondBest = {
      module: second.module.name,
      starters: second.starters.map((s) => s.id),
      mean: m2,
      objective: aggregate(fs.T, strategy),
      in: [...ids2].filter((id) => !starterIds.has(id)),
      out: [...starterIds].filter((id) => !ids2.has(id)),
    };
  }

  return {
    strategy,
    module: best.module.name,
    starters,
    bench: benchOut,
    excluded,
    metrics: {
      mean,
      objective: aggregate(final.T, strategy),
      p10: quantile(sorted, 0.1),
      p50: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
      pAllCovered: final.pAllCovered,
      expectedSubs: final.expectedSubs,
      expectedTeamGoals: expGoals,
      expectedNoVoteStarters: final.expectedNoVoteStarters,
    },
    risks,
    ballottaggi,
    secondBest,
    modulesTried,
    warnings,
  };
}

/** Punteggio di una formazione scelta manualmente (per confronto e storico). */
export function scoreLineup(candidates: Candidate[], sim: SimOutput, cfg: LeagueConfig, starters: { id: number; slot: string[] }[], bench: number[], strategy: Strategy = "equilibrata") {
  const byId = new Map(candidates.map((c) => [c.playerId, c]));
  const valid = starters.filter((s) => sim.fv.has(s.id));
  const ctx: Ctx = { cfg, sim, byId, n: sim.n, noVote: noVoteValue(cfg), strategy };
  const r = teamTotals(ctx, valid, bench.filter((b) => sim.fv.has(b)));
  let mean = 0;
  for (const x of r.T) mean += x;
  mean /= r.T.length;
  return { mean, objective: aggregate(r.T, strategy), pAllCovered: r.pAllCovered };
}
