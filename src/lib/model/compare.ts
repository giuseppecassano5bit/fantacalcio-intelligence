import type { Candidate, Strategy } from "./lineup";
import { aggregate } from "./lineup";
import type { SimOutput } from "./simulate";
import { noVoteValue } from "./simulate";
import type { LeagueConfig } from "@/lib/domain/settings";

export interface CompareRow {
  playerId: number;
  score: number;
  expectedPoints: number;
  upside: number; // 80° percentile
  downside: number; // 20° percentile
}

export interface CompareResult {
  rows: CompareRow[];
  first: number | null;
  second: number | null;
  riskyAlternative: number | null;
  explanation: string[];
  whatCouldChange: string[];
}

const fmt = (x: number, d = 1) => x.toFixed(d).replace(".", ",");
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Confronto diretto tra due o più giocatori della rosa secondo la strategia scelta. */
export function compareCandidates(cands: Candidate[], sim: SimOutput, cfg: LeagueConfig, strategy: Strategy): CompareResult {
  const nv = noVoteValue(cfg);
  const rows: CompareRow[] = cands
    .filter((c) => sim.fv.has(c.playerId))
    .map((c) => {
      const fv = sim.fv.get(c.playerId)!;
      const vals = Array.from(fv, (x) => (Number.isNaN(x) ? nv : x));
      const sorted = Float64Array.from(vals).sort();
      return {
        playerId: c.playerId,
        score: aggregate(vals, strategy),
        expectedPoints: vals.reduce((a, b) => a + b, 0) / vals.length,
        upside: sorted[Math.floor(sorted.length * 0.8)],
        downside: sorted[Math.floor(sorted.length * 0.2)],
      };
    })
    .sort((a, b) => b.score - a.score);
  const byId = new Map(cands.map((c) => [c.playerId, c]));
  const first = rows[0]?.playerId ?? null;
  const second = rows[1]?.playerId ?? null;
  const risky = rows
    .slice(1)
    .filter((r) => r.upside > (rows[0]?.upside ?? 0) + 0.25)
    .sort((a, b) => b.upside - a.upside)[0]?.playerId ?? null;

  const explanation: string[] = [];
  const whatCouldChange: string[] = [];
  if (first != null) {
    const a = byId.get(first)!;
    const ra = rows[0];
    explanation.push(`${a.name} è la prima scelta: ${fmt(ra.expectedPoints)} punti attesi, titolarità ${pct(a.ev.playing.pStart)}, P(gol o assist) ${pct(a.ev.probs.goalOrAssist.p)}.`);
    if (second != null) {
      const b = byId.get(second)!;
      const rb = rows[1];
      const diffs: string[] = [];
      if (a.ev.playing.pStart - b.ev.playing.pStart >= 0.1) diffs.push(`titolarità più alta (${pct(a.ev.playing.pStart)} contro ${pct(b.ev.playing.pStart)})`);
      if (a.ev.probs.goalOrAssist.p - b.ev.probs.goalOrAssist.p >= 0.05) diffs.push(`più probabilità di bonus (${pct(a.ev.probs.goalOrAssist.p)} contro ${pct(b.ev.probs.goalOrAssist.p)})`);
      const ea = a.ev.match?.expectation;
      const eb = b.ev.match?.expectation;
      if (ea && eb && ea.attackFactor - eb.attackFactor >= 0.1) diffs.push(`partita più favorevole (${ea.teamGoals.toFixed(1)} gol attesi contro ${eb.teamGoals.toFixed(1)})`);
      if (b.ev.probs.yellow.p - a.ev.probs.yellow.p >= 0.08) diffs.push("minor rischio di ammonizione");
      if (diffs.length === 0) diffs.push("un vantaggio complessivo contenuto: è un ballottaggio aperto");
      explanation.push(`Rispetto a ${b.name} (${fmt(rb.expectedPoints)} punti attesi): ${diffs.join(", ")}.`);
      if (Math.abs(ra.score - rb.score) < 0.3) explanation.push("La differenza è piccola rispetto all'incertezza della stima.");
      // cosa cambierebbe la decisione
      if (b.ev.playing.pStart < 0.85 && b.stats?.expectedIfStarts != null && a.stats) {
        if (b.stats.expectedIfStarts > a.stats.expectedPoints) {
          whatCouldChange.push(`Se ${b.name} venisse confermato titolare (oggi ${pct(b.ev.playing.pStart)}), i suoi punti attesi salirebbero a circa ${fmt(b.stats.expectedIfStarts)}: diventerebbe la prima scelta.`);
        }
      }
      if (a.ev.playing.pStart < 0.85) whatCouldChange.push(`Se ${a.name} perdesse il posto da titolare (oggi ${pct(a.ev.playing.pStart)}) la scelta passerebbe a ${b.name}.`);
      if (a.ev.playing.availability === "dubbio") whatCouldChange.push(`${a.name} è in dubbio: attendi le notizie dell'ultimo allenamento.`);
    }
    if (risky != null) {
      const r = byId.get(risky)!;
      explanation.push(`${r.name} è l'alternativa più rischiosa ma con più potenziale: nello scenario favorevole (80° percentile) vale ${fmt(rows.find((x) => x.playerId === risky)!.upside)} punti.`);
    }
  }
  return { rows, first, second, riskyAlternative: risky, explanation, whatCouldChange };
}
