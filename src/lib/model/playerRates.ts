import type { RoleClassic } from "@/lib/domain/settings";
import type { MatchLine, PlayerInput, SeasonAgg } from "./inputs";
import {
  LEAGUE_PRIORS,
  PREVIOUS_SEASON_MAX_MINUTES,
  PREVIOUS_SEASON_WEIGHT,
  PRIOR_MINUTES,
  RECENCY_HALF_LIFE_MATCHDAYS,
  ROLE_PRIORS,
} from "./priors";
import { gammaQuantile } from "./rng";

export interface RateEstimate {
  per90: number;
  low: number; // 10° percentile
  high: number; // 90° percentile
  events: number; // eventi osservati (ponderati)
  minutes: number; // minuti osservati (ponderati)
  priorShare: number; // quota di informazione proveniente dal prior (0-1)
}

export interface FormSummary {
  games: number; // giornate considerate (della squadra, con voti importati)
  played: number;
  starts: number | null;
  minutes: number | null;
  goals: number;
  assists: number;
  avgVote: number | null;
  avgFantavote: number | null;
  bonusRate: number | null; // quota di presenze con gol o assist
  xg: number | null;
  penaltiesTaken: number;
}

export interface PlayerRates {
  goalNp: RateEstimate;
  assist: RateEstimate;
  yellow: RateEstimate;
  red: RateEstimate;
  ownGoal: RateEstimate;
  minutesObserved: number;
  minutesEstimated: boolean;
  appearances: number | null;
  starts: number | null;
  vote: { mean: number; n: number; fromPrior: boolean };
  avgFantavote: number | null;
  penalties: { taken: number; scored: number; missed: number; missRate: number; takerProb: number; basis: string };
  gk: { conceded: number; saved: number; minutes: number };
  usedXg: boolean;
  usedXa: boolean;
  usedMatchLines: boolean;
  prevSeasonUsed: boolean;
  primarySource: string | null;
  sources: string[];
  form5: FormSummary | null;
  form10: FormSummary | null;
  formSeason: FormSummary | null;
  shots90: number | null;
  shotsOnTarget90: number | null;
  keyPasses90: number | null;
}

/** Stima di un tasso per 90' con shrinkage Gamma-Poisson verso il prior. */
export function shrinkRate(events: number, minutes: number, prior90: number, priorMinutes: number): RateEstimate {
  const alpha0 = (prior90 * priorMinutes) / 90;
  const beta0 = priorMinutes / 90;
  const shape = Math.max(events, 0) + alpha0;
  const rate = Math.max(minutes, 0) / 90 + beta0;
  const per90 = shape / rate;
  return {
    per90,
    low: gammaQuantile(shape, rate, 0.1),
    high: gammaQuantile(shape, rate, 0.9),
    events,
    minutes,
    priorShare: beta0 / rate,
  };
}

function pickPrimary(rows: SeasonAgg[]): SeasonAgg | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => (b.apps ?? 0) - (a.apps ?? 0) || (b.minutes != null ? 1 : 0) - (a.minutes != null ? 1 : 0) || b.asOf.localeCompare(a.asOf))[0];
}

function summarize(lines: MatchLine[], teamMatchdays: number[], role: RoleClassic): FormSummary | null {
  if (teamMatchdays.length === 0) return null;
  const set = new Set(teamMatchdays);
  const ls = lines.filter((l) => set.has(l.matchday));
  const played = ls.filter((l) => l.played);
  const startsKnown = played.some((l) => l.started != null);
  const minsKnown = played.length > 0 && played.every((l) => l.minutes != null);
  const votes = played.map((l) => l.vote).filter((v): v is number => v != null);
  const fvs = played.map((l) => l.fantavote).filter((v): v is number => v != null);
  const xgs = played.map((l) => l.xg).filter((v): v is number => v != null);
  return {
    games: teamMatchdays.length,
    played: played.length,
    starts: startsKnown ? played.filter((l) => l.started).length : null,
    minutes: minsKnown ? played.reduce((s, l) => s + (l.minutes ?? 0), 0) : null,
    goals: played.reduce((s, l) => s + l.goals + l.penScored, 0),
    assists: played.reduce((s, l) => s + l.assists, 0),
    avgVote: votes.length ? votes.reduce((a, b) => a + b, 0) / votes.length : null,
    avgFantavote: fvs.length ? fvs.reduce((a, b) => a + b, 0) / fvs.length : null,
    bonusRate: played.length ? played.filter((l) => l.goals + l.penScored + l.assists > 0 || (role === "P" && l.penSaved > 0)).length / played.length : null,
    xg: xgs.length === played.length && xgs.length > 0 ? xgs.reduce((a, b) => a + b, 0) : null,
    penaltiesTaken: played.reduce((s, l) => s + l.penScored + l.penMissed, 0),
  };
}

/**
 * Calcola i tassi individuali (gol, assist, cartellini...) combinando:
 * statistiche stagionali, partite recenti (con ponderazione temporale), stagione precedente
 * (peso ridotto) e prior di ruolo.
 *
 * importedMatchdays: giornate per cui esistono dati partita per partita (es. voti importati)
 * teamMatchdays: giornate concluse della squadra del giocatore
 */
export function estimateRates(
  player: PlayerInput,
  role: RoleClassic,
  season: string,
  seasonRows: SeasonAgg[],
  matchLines: MatchLine[],
  importedMatchdays: number[],
  teamMatchdays: number[],
): PlayerRates {
  const prior = ROLE_PRIORS[role];
  const cur = seasonRows.filter((r) => r.season === season);
  const prev = seasonRows.filter((r) => r.season !== season).sort((a, b) => b.season.localeCompare(a.season));
  const primary = pickPrimary(cur);
  const prevPrimary = pickPrimary(prev.filter((r) => r.season === prev[0]?.season));

  // --- partite per partita: usate solo per le giornate effettivamente coperte dai dati ---
  const covered = teamMatchdays.filter((md) => importedMatchdays.includes(md)).sort((a, b) => a - b);
  const lines = matchLines.filter((l) => covered.includes(l.matchday));
  const linesPlayed = lines.filter((l) => l.played);
  const useLines = linesPlayed.length >= 3 && (!primary?.apps || linesPlayed.length >= 0.7 * primary.apps);

  let goals = 0, assists = 0, yellow = 0, red = 0, og = 0, minutes = 0, penScored = 0, penMissed = 0, gkConc = 0, gkSaved = 0;
  // minuti "validi" per ciascun tasso: se la fonte non riporta un dato, quel tasso resta sul prior
  const known = { goal: true, assist: true, yellow: true, red: true, og: true };
  let minutesEstimated = false;
  let apps: number | null = null;
  let starts: number | null = null;
  let xg: number | null = null;
  let xa: number | null = null;
  let xMinutes = 0;

  if (useLines) {
    const last = covered[covered.length - 1];
    for (const l of linesPlayed) {
      const w = Math.pow(0.5, (last - l.matchday) / RECENCY_HALF_LIFE_MATCHDAYS);
      const m = l.minutes ?? (l.started === false ? prior.minutesIfSub : prior.minutesPerApp);
      if (l.minutes == null) minutesEstimated = true;
      minutes += w * m;
      goals += w * l.goals; // gol su azione (i rigori sono a parte)
      assists += w * l.assists;
      yellow += w * l.yellow;
      red += w * l.red;
      og += w * l.ownGoals;
      gkConc += w * l.goalsConceded;
      gkSaved += w * l.penSaved;
      penScored += l.penScored;
      penMissed += l.penMissed;
    }
    apps = linesPlayed.length;
    starts = linesPlayed.some((l) => l.started != null) ? linesPlayed.filter((l) => l.started).length : null;
    if (linesPlayed.every((l) => l.xg != null)) {
      xg = linesPlayed.reduce((s, l) => s + (l.xg ?? 0), 0);
      xMinutes = linesPlayed.reduce((s, l) => s + (l.minutes ?? prior.minutesPerApp), 0);
    }
  } else if (primary) {
    apps = primary.apps;
    starts = primary.starts;
    if (primary.minutes != null) minutes = primary.minutes;
    else if (primary.apps != null) {
      minutes = primary.apps * prior.minutesPerApp;
      minutesEstimated = true;
    }
    penScored = primary.penScored ?? 0;
    penMissed = primary.penMissed ?? 0;
    // i gol su azione escludono i rigori segnati
    goals = Math.max(0, (primary.goals ?? 0) - penScored);
    assists = primary.assists ?? 0;
    yellow = primary.yellow ?? 0;
    red = primary.red ?? 0;
    og = primary.ownGoals ?? 0;
    known.goal = primary.goals != null;
    known.assist = primary.assists != null;
    known.yellow = primary.yellow != null;
    known.red = primary.red != null;
    known.og = primary.ownGoals != null;
    gkConc = primary.goalsConceded ?? 0;
    gkSaved = primary.penSaved ?? 0;
  }
  // xG/xA da qualunque fonte della stagione che riporti anche i minuti
  const xRow = cur.find((r) => r.xg != null && r.minutes != null && r.minutes > 0);
  if (xg == null && xRow) {
    xg = Math.max(0, (xRow.xg ?? 0) - 0.76 * ((xRow.penTaken ?? (xRow.penScored ?? 0) + (xRow.penMissed ?? 0)) || 0));
    xMinutes = xRow.minutes!;
  }
  const xaRow = cur.find((r) => r.xa != null && r.minutes != null && r.minutes > 0);
  if (xaRow) xa = xaRow.xa;

  // --- prior: ruolo + stagione precedente (informazione secondaria) ---
  let prevSeasonUsed = false;
  const priorFor = (key: "goal90" | "assist90" | "yellow90" | "red90" | "ownGoal90", prevEvents: number | null, priorMin: number) => {
    const base = prior[key];
    if (!prevPrimary || prevEvents == null) return { p90: base, pm: priorMin };
    const prevMin = Math.min(
      PREVIOUS_SEASON_MAX_MINUTES,
      prevPrimary.minutes ?? (prevPrimary.apps ?? 0) * prior.minutesPerApp,
    ) * PREVIOUS_SEASON_WEIGHT;
    if (prevMin < 90) return { p90: base, pm: priorMin };
    prevSeasonUsed = true;
    const scale = prevPrimary.minutes ?? (prevPrimary.apps ?? 0) * prior.minutesPerApp;
    const prevRate = scale > 0 ? (prevEvents / scale) * 90 : base;
    const p90 = (prevRate * prevMin + base * priorMin) / (prevMin + priorMin);
    return { p90, pm: priorMin + prevMin };
  };
  const pPrevGoals = prevPrimary ? Math.max(0, (prevPrimary.goals ?? 0) - (prevPrimary.penScored ?? 0)) : null;
  const pg = priorFor("goal90", pPrevGoals, PRIOR_MINUTES.goal);
  const pa = priorFor("assist90", prevPrimary?.assists ?? null, PRIOR_MINUTES.assist);
  const py = priorFor("yellow90", prevPrimary?.yellow ?? null, PRIOR_MINUTES.card);
  const pr = priorFor("red90", prevPrimary?.red ?? null, PRIOR_MINUTES.card);

  let goalNp = shrinkRate(goals, known.goal ? minutes : 0, pg.p90, pg.pm);
  let usedXg = false;
  if (xg != null && xMinutes >= 270 && role !== "P") {
    // gli xG sono più stabili dei gol: media pesata (60% xG, 40% gol)
    const xRate = shrinkRate(xg, xMinutes, pg.p90, pg.pm);
    goalNp = {
      per90: 0.6 * xRate.per90 + 0.4 * goalNp.per90,
      low: 0.6 * xRate.low + 0.4 * goalNp.low,
      high: 0.6 * xRate.high + 0.4 * goalNp.high,
      events: goals,
      minutes,
      priorShare: Math.min(goalNp.priorShare, xRate.priorShare),
    };
    usedXg = true;
  }
  let assist = shrinkRate(assists, known.assist ? minutes : 0, pa.p90, pa.pm);
  let usedXa = false;
  if (xa != null && xaRow?.minutes && xaRow.minutes >= 270 && role !== "P") {
    const xRate = shrinkRate(xa, xaRow.minutes, pa.p90, pa.pm);
    assist = {
      per90: 0.6 * xRate.per90 + 0.4 * assist.per90,
      low: 0.6 * xRate.low + 0.4 * assist.low,
      high: 0.6 * xRate.high + 0.4 * assist.high,
      events: assists,
      minutes,
      priorShare: Math.min(assist.priorShare, xRate.priorShare),
    };
    usedXa = true;
  }
  if (role === "P") {
    goalNp = { per90: 0, low: 0, high: 0, events: 0, minutes, priorShare: 1 };
  }

  // --- voto medio (shrinkage verso il voto medio di ruolo) ---
  const voteN = useLines ? linesPlayed.filter((l) => l.vote != null).length : (primary?.avgVote != null ? primary.apps ?? 0 : 0);
  const voteObs = useLines
    ? (() => {
        const vs = linesPlayed.map((l) => l.vote).filter((v): v is number => v != null);
        return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
      })()
    : primary?.avgVote ?? null;
  const k = 6;
  const voteMean = voteObs != null && voteN > 0 ? (voteObs * voteN + prior.vote * k) / (voteN + k) : prior.vote;

  // --- rigori ---
  const taken = (primary?.penTaken ?? null) ?? penScored + penMissed;
  const totalTaken = useLines ? penScored + penMissed : taken;
  const missedObs = useLines ? penMissed : (primary?.penMissed ?? 0);
  const missRate = (missedObs + (1 - LEAGUE_PRIORS.penaltyConversion) * 5) / (totalTaken + 5);
  let takerProb: number;
  let basis: string;
  if (player.penaltyOrder === 1) {
    takerProb = 0.85;
    basis = `Primo rigorista (indicazione ${player.penaltyOrderSource ?? "manuale"})`;
  } else if (player.penaltyOrder === 2) {
    takerProb = 0.12;
    basis = `Secondo rigorista (indicazione ${player.penaltyOrderSource ?? "manuale"})`;
  } else if (totalTaken >= 2) {
    takerProb = 0.6;
    basis = `Ha calciato ${totalTaken} rigori in stagione (rigorista probabile, non confermato)`;
  } else if (totalTaken === 1) {
    takerProb = 0.35;
    basis = "Ha calciato 1 rigore in stagione (gerarchia non confermata)";
  } else {
    takerProb = role === "A" ? 0.04 : role === "C" ? 0.03 : role === "D" ? 0.005 : 0;
    basis = "Nessun rigore calciato registrato: probabilità di base per ruolo";
  }

  const sources = Array.from(new Set([...cur.map((r) => r.source), ...(useLines ? linesPlayed.map((l) => l.source) : [])]));
  const rate90 = (v: number | null | undefined, row: SeasonAgg | undefined) => (v != null && row?.minutes ? (v / row.minutes) * 90 : null);
  const shotRow = cur.find((r) => r.shots != null && r.minutes);
  const sotRow = cur.find((r) => r.shotsOnTarget != null && r.minutes);
  const kpRow = cur.find((r) => r.keyPasses != null && r.minutes);

  const md = [...teamMatchdays].sort((a, b) => a - b);
  const coveredMd = md.filter((m) => importedMatchdays.includes(m));
  return {
    goalNp,
    assist,
    yellow: shrinkRate(yellow, known.yellow ? minutes : 0, py.p90, py.pm),
    red: shrinkRate(red, known.red ? minutes : 0, pr.p90, pr.pm),
    ownGoal: shrinkRate(og, known.og ? minutes : 0, prior.ownGoal90, PRIOR_MINUTES.ownGoal),
    minutesObserved: minutes,
    minutesEstimated,
    appearances: apps,
    starts,
    vote: { mean: voteMean, n: voteN, fromPrior: voteN === 0 },
    avgFantavote: primary?.avgFantavote ?? null,
    penalties: { taken: totalTaken, scored: useLines ? penScored : primary?.penScored ?? 0, missed: missedObs, missRate, takerProb, basis },
    gk: { conceded: gkConc, saved: gkSaved, minutes },
    usedXg,
    usedXa,
    usedMatchLines: useLines,
    prevSeasonUsed,
    primarySource: useLines ? (linesPlayed[0]?.source ?? null) : primary?.source ?? null,
    sources,
    form5: coveredMd.length ? summarize(matchLines, coveredMd.slice(-5), role) : null,
    form10: coveredMd.length ? summarize(matchLines, coveredMd.slice(-10), role) : null,
    formSeason: coveredMd.length ? summarize(matchLines, coveredMd, role) : null,
    shots90: rate90(shotRow?.shots, shotRow),
    shotsOnTarget90: rate90(sotRow?.shotsOnTarget, sotRow),
    keyPasses90: rate90(kpRow?.keyPasses, kpRow),
  };
}
