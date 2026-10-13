import type { LeagueConfig } from "@/lib/domain/settings";
import type { SimParams } from "./evaluate";
import { Rng, quantile } from "./rng";

export interface SimOutput {
  n: number;
  fv: Map<number, Float32Array>; // fantavoto per iterazione (NaN = senza voto)
  vote: Map<number, Float32Array>; // voto in pagella (NaN = senza voto)
  started: Map<number, Uint8Array>;
}

/** Variabilità comune di squadra: partite "aperte" o "chiuse" correlano i giocatori della stessa squadra. */
const TEAM_SHAPE = 8;

/**
 * Simulazione Monte Carlo congiunta della giornata per i giocatori indicati.
 * Gol, assist e cartellini sono modellati con processi di Poisson condizionati ai minuti;
 * il voto base segue una normale attorno alla media del giocatore, corretta dagli eventi.
 */
export function simulate(params: SimParams[], cfg: LeagueConfig, n: number, seed: number): SimOutput {
  const rng = new Rng(seed);
  const fv = new Map<number, Float32Array>();
  const vote = new Map<number, Float32Array>();
  const started = new Map<number, Uint8Array>();
  for (const p of params) {
    fv.set(p.playerId, new Float32Array(n));
    vote.set(p.playerId, new Float32Array(n));
    started.set(p.playerId, new Uint8Array(n));
  }
  const teams = Array.from(new Set(params.flatMap((p) => [p.teamId, p.oppId])));
  const intensity = new Map<number, number>();
  const b = cfg.bonus;
  const m = cfg.malus;

  for (let i = 0; i < n; i++) {
    for (const t of teams) intensity.set(t, rng.gamma(TEAM_SHAPE, 1 / TEAM_SHAPE));
    for (const p of params) {
      const u = rng.next();
      let minutes = 0;
      let voted = false;
      let isStart = false;
      if (u < p.pStart) {
        minutes = p.minStart;
        voted = rng.next() < 0.985;
        isStart = true;
      } else if (u < p.pStart + p.pSub) {
        minutes = p.minSub;
        voted = rng.next() < p.pVoteIfSub;
      }
      started.get(p.playerId)![i] = isStart ? 1 : 0;
      if (!voted) {
        fv.get(p.playerId)![i] = NaN;
        vote.get(p.playerId)![i] = NaN;
        continue;
      }
      const f = minutes / 90;
      const ti = intensity.get(p.teamId) ?? 1;
      const oi = intensity.get(p.oppId) ?? 1;
      const goals = rng.poisson(p.goal90 * f * ti);
      const pens = rng.poisson(p.penPerMatch * ti * p.pTaker * f);
      let penScored = 0;
      let penMissed = 0;
      for (let k = 0; k < pens; k++) {
        if (rng.next() < p.penMiss) penMissed++;
        else penScored++;
      }
      const assists = rng.poisson(p.assist90 * f * ti);
      const red = rng.next() < 1 - Math.exp(-p.red90 * f);
      const yellow = !red && rng.next() < 1 - Math.exp(-p.yellow90 * f);
      const og = rng.next() < 1 - Math.exp(-p.og90 * f);
      let conceded = 0;
      let penSaved = 0;
      if (p.role === "P" || p.role === "D") conceded = rng.poisson(p.conceded90 * f * oi);
      if (p.role === "P" && rng.next() < 1 - Math.exp(-p.penAgainstPerMatch * f * p.penSaveRate)) penSaved = 1;

      let v = rng.normal(p.voteMean, p.voteSd) + 0.5 * (goals + penScored) + 0.3 * assists + 0.5 * penSaved;
      if (p.role === "P") v -= 0.35 * Math.min(conceded, 4);
      if (p.role === "D") v -= 0.15 * Math.min(conceded, 4);
      if (red) v = Math.min(v, 5) - 0.5;
      v = Math.round(Math.min(10, Math.max(3, v)) * 2) / 2;

      let total = v;
      if (p.role !== "P") total += goals * b.gol[p.role];
      total += penScored * b.rigoreSegnato + assists * b.assist;
      if (p.role === "P") {
        total -= conceded * m.golSubito;
        if (conceded === 0 && f >= 0.99) total += b.portaInviolata;
        total += penSaved * b.rigoreParato;
      }
      if (yellow) total -= m.ammonizione;
      if (red) total -= m.espulsione;
      if (og) total -= m.autogol;
      total -= penMissed * m.rigoreSbagliato;
      fv.get(p.playerId)![i] = total;
      vote.get(p.playerId)![i] = v;
    }
  }
  return { n, fv, vote, started };
}

export interface PlayerSimStats {
  pVote: number;
  expectedFvIfVote: number | null;
  expectedPoints: number; // senza voto = valore configurato
  expectedIfStarts: number | null;
  p10: number;
  p90: number;
  pBigGame: number; // fantavoto >= 9
  q80: number;
  q20: number;
}

export function noVoteValue(cfg: LeagueConfig): number {
  return cfg.formazione.senzaVoto === "voto_ufficio" ? cfg.formazione.votoUfficio : 0;
}

export function playerSimStats(sim: SimOutput, playerId: number, cfg: LeagueConfig): PlayerSimStats | null {
  const arr = sim.fv.get(playerId);
  const st = sim.started.get(playerId);
  if (!arr || !st) return null;
  const nv = noVoteValue(cfg);
  const vals = new Float64Array(arr.length);
  let voted = 0, sumV = 0, sumAll = 0, big = 0, sumStart = 0, nStart = 0;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    const val = Number.isNaN(x) ? nv : x;
    vals[i] = val;
    sumAll += val;
    if (!Number.isNaN(x)) {
      voted++;
      sumV += x;
      if (x >= 9) big++;
    }
    if (st[i]) {
      sumStart += val;
      nStart++;
    }
  }
  vals.sort();
  return {
    pVote: voted / arr.length,
    expectedFvIfVote: voted > 0 ? sumV / voted : null,
    expectedPoints: sumAll / arr.length,
    expectedIfStarts: nStart > 20 ? sumStart / nStart : null,
    p10: quantile(vals, 0.1),
    p90: quantile(vals, 0.9),
    pBigGame: big / arr.length,
    q80: quantile(vals, 0.8),
    q20: quantile(vals, 0.2),
  };
}
