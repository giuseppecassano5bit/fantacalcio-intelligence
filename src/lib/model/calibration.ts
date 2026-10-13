/**
 * Valutazione delle previsioni passate: Brier score, log loss, calibrazione per fasce,
 * confronto con una baseline semplice (frequenza media osservata per ruolo).
 * Il modello NON viene modificato automaticamente: queste metriche servono a decidere
 * eventuali correzioni in modo motivato.
 */

export interface Observation {
  role: string;
  p: number;
  outcome: 0 | 1;
}

export interface BinaryMetrics {
  n: number;
  brier: number | null;
  logLoss: number | null;
  baselineBrier: number | null;
  skill: number | null; // 1 - brier/baseline (>0 = meglio della baseline)
  observedRate: number | null;
  meanPredicted: number | null;
  bins: { from: number; to: number; n: number; predicted: number; observed: number }[];
  enough: boolean;
}

export const MIN_OBSERVATIONS = 60;

export function binaryMetrics(obs: Observation[]): BinaryMetrics {
  const n = obs.length;
  if (n === 0) return { n, brier: null, logLoss: null, baselineBrier: null, skill: null, observedRate: null, meanPredicted: null, bins: [], enough: false };
  const eps = 1e-4;
  let brier = 0;
  let ll = 0;
  for (const o of obs) {
    const p = Math.min(1 - eps, Math.max(eps, o.p));
    brier += (p - o.outcome) ** 2;
    ll += -(o.outcome * Math.log(p) + (1 - o.outcome) * Math.log(1 - p));
  }
  // baseline: frequenza osservata per ruolo (stima "ingenua" senza modello)
  const byRole = new Map<string, { s: number; n: number }>();
  for (const o of obs) {
    const r = byRole.get(o.role) ?? { s: 0, n: 0 };
    r.s += o.outcome;
    r.n += 1;
    byRole.set(o.role, r);
  }
  let base = 0;
  for (const o of obs) {
    const r = byRole.get(o.role)!;
    base += (r.s / r.n - o.outcome) ** 2;
  }
  const edges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  const bins = edges.slice(0, -1).map((from, i) => {
    const to = edges[i + 1];
    const inBin = obs.filter((o) => o.p >= from && o.p < to);
    return {
      from,
      to: Math.min(1, to),
      n: inBin.length,
      predicted: inBin.length ? inBin.reduce((s, o) => s + o.p, 0) / inBin.length : 0,
      observed: inBin.length ? inBin.reduce((s, o) => s + o.outcome, 0) / inBin.length : 0,
    };
  }).filter((b) => b.n > 0);
  return {
    n,
    brier: brier / n,
    logLoss: ll / n,
    baselineBrier: base / n,
    skill: base > 0 ? 1 - brier / base : null,
    observedRate: obs.reduce((s, o) => s + o.outcome, 0) / n,
    meanPredicted: obs.reduce((s, o) => s + o.p, 0) / n,
    bins,
    enough: n >= MIN_OBSERVATIONS,
  };
}

export function meanAbsError(pairs: { predicted: number; actual: number }[]): number | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((s, x) => s + Math.abs(x.predicted - x.actual), 0) / pairs.length;
}
