import type { LeagueConfig, RoleClassic } from "@/lib/domain/settings";
import type { AvailInput, EditorialInput, LineupInput, MatchInfo, MatchLine, PlayerInput, SeasonAgg } from "./inputs";
import { estimatePlaying, type PlayingEstimate } from "./availability";
import { estimateRates, type PlayerRates, type RateEstimate } from "./playerRates";
import { defenceProfile, expectMatch, type DefenceProfile, type LeagueTable, type MatchExpectation } from "./teamStrength";
import { LEAGUE_PRIORS, MIN_MINUTES_FOR_INDIVIDUAL, MODEL_VERSION } from "./priors";
import { editorialConsensus, type Consensus } from "./consensus";

/** Una stima di probabilità: sempre una STIMA, mai una certezza. */
export interface ProbEstimate {
  p: number;
  low: number;
  high: number;
  insufficient: boolean; // dati individuali insufficienti: il valore è una stima di ruolo
  note?: string;
}

export interface Factor {
  text: string;
  sign: 1 | -1 | 0;
  weight: number; // importanza relativa per ordinare le spiegazioni
}

export interface Reliability {
  level: "alta" | "media" | "bassa";
  score: number;
  missing: string[];
  sampleMinutes: number;
  minutesEstimated: boolean;
}

export interface SimParams {
  playerId: number;
  role: RoleClassic;
  teamId: number;
  oppId: number;
  pStart: number;
  pSub: number;
  pVoteIfSub: number;
  minStart: number;
  minSub: number;
  goal90: number; // gol su azione già corretti per la partita
  assist90: number;
  yellow90: number;
  red90: number;
  og90: number;
  penPerMatch: number; // rigori attesi per la squadra in questa partita
  pTaker: number;
  penMiss: number;
  conceded90: number; // solo portieri/difensori: gol attesi subiti per 90'
  penAgainstPerMatch: number;
  penSaveRate: number;
  voteMean: number;
  voteSd: number;
}

export interface PlayerEvaluation {
  modelVersion: string;
  playerId: number;
  name: string;
  role: RoleClassic | null;
  rolesMantra: string | null;
  teamId: number | null;
  teamName: string | null;
  match: (MatchInfo & { expectation: MatchExpectation; oppProfile: DefenceProfile; oppAttack: number }) | null;
  playing: PlayingEstimate;
  rates: PlayerRates | null;
  probs: {
    goal: ProbEstimate;
    assist: ProbEstimate;
    goalOrAssist: ProbEstimate;
    anyBonus: ProbEstimate;
    bigGame: ProbEstimate | null; // fantavoto >= 9 (dalla simulazione)
    yellow: ProbEstimate;
    red: ProbEstimate;
    ownGoal: ProbEstimate;
    penaltyMiss: { teamAwarded: number; isTakerOnPitch: number; missGivenTaken: number; total: number; basis: string };
    noVote: number;
    gk: { cleanSheet: ProbEstimate; expectedConceded: number; twoPlusConceded: number; penaltySave: ProbEstimate } | null;
  };
  points: {
    expectedVote: number;
    expectedFantavoteIfVote: number | null;
    expectedPoints: number | null; // incondizionato (senza voto = 0 o voto d'ufficio)
    expectedIfStarts: number | null;
    p10: number | null;
    p90: number | null;
    expectedMalus: number;
  };
  fantavalue: { index: number; components: Record<string, number>; weights: Record<string, number> } | null;
  reliability: Reliability;
  factors: Factor[];
  consensus: Consensus;
  sim: SimParams | null;
  computedAt: string;
  issues: string[]; // problemi bloccanti (es. ruolo mancante)
}

export interface EvaluationInput {
  player: PlayerInput;
  season: string;
  seasonRows: SeasonAgg[];
  matchLines: MatchLine[];
  importedMatchdays: number[];
  teamMatchdays: number[]; // giornate concluse della squadra
  match: MatchInfo | null;
  availability: AvailInput[];
  lineups: LineupInput[];
  editorial: EditorialInput[];
  matchday: number;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** P(almeno un evento) su una miscela di scenari (titolare / subentrato). */
function mixAtLeastOne(pe: PlayingEstimate, lambdaPer90: number, extraPerMatch = 0): number {
  const s = 1 - Math.exp(-(lambdaPer90 * pe.minutesIfStart) / 90 - (extraPerMatch * pe.minutesIfStart) / 90);
  const b = 1 - Math.exp(-(lambdaPer90 * pe.minutesIfSub) / 90 - (extraPerMatch * pe.minutesIfSub) / 90);
  return pe.pStart * s + pe.pSub * b;
}

function prob(pe: PlayingEstimate, r: RateEstimate, factor: number, extra = 0, insufficient = false, note?: string): ProbEstimate {
  return {
    p: mixAtLeastOne(pe, r.per90 * factor, extra),
    low: mixAtLeastOne(pe, r.low * factor, extra),
    high: mixAtLeastOne(pe, r.high * factor, extra),
    insufficient,
    note,
  };
}

export function evaluatePlayer(input: EvaluationInput, table: LeagueTable, cfg: LeagueConfig, now = Date.now()): PlayerEvaluation {
  const { player } = input;
  const issues: string[] = [];
  const role = player.role;
  const computedAt = new Date(now).toISOString();
  const consensus = editorialConsensus(input.editorial, input.matchday, now);
  const empty = (p = 0): ProbEstimate => ({ p, low: p, high: p, insufficient: true });

  if (!role) {
    issues.push("Ruolo fantacalcistico mancante: impostalo nella scheda del giocatore.");
  }
  const r: RoleClassic = role ?? "C";

  const rates = estimateRates(player, r, input.season, input.seasonRows, input.matchLines, input.importedMatchdays, input.teamMatchdays);
  const playing = estimatePlaying(player, r, input.match, rates, input.availability, input.lineups, input.teamMatchdays.length, now);

  let matchCtx: PlayerEvaluation["match"] = null;
  let factor = 1;
  let expectation: MatchExpectation | null = null;
  if (input.match && player.teamId) {
    expectation = expectMatch(table, input.match.teamId, input.match.oppId, input.match.isHome);
    factor = expectation.attackFactor;
    const oppRating = table.ratings.get(input.match.oppId);
    matchCtx = { ...input.match, expectation, oppProfile: defenceProfile(table, input.match.oppId), oppAttack: oppRating?.attack ?? 1 };
  }

  const lowSample = rates.minutesObserved < MIN_MINUTES_FOR_INDIVIDUAL && !rates.prevSeasonUsed;
  const sampleNote = lowSample ? "Meno di 180 minuti di dati individuali: stima basata soprattutto sul ruolo." : undefined;

  // --- rigori: probabilità decomposta ---
  const penPerMatch = LEAGUE_PRIORS.penaltiesPerTeamMatch * factor;
  const pTeamAwarded = 1 - Math.exp(-penPerMatch);
  const fracOnPitch = playing.pStart * (playing.minutesIfStart / 90) + playing.pSub * (playing.minutesIfSub / 90);
  const pTakerOnPitch = rates.penalties.takerProb * fracOnPitch;
  const penMissTotal = pTeamAwarded * pTakerOnPitch * rates.penalties.missRate;
  const penGoalPerMatch = penPerMatch * rates.penalties.takerProb * (1 - rates.penalties.missRate);

  const goal = r === "P" ? empty(0) : prob(playing, rates.goalNp, factor, penGoalPerMatch, lowSample, sampleNote);
  const assist = prob(playing, rates.assist, factor, 0, lowSample, sampleNote);
  const goa: ProbEstimate = {
    p: mixAtLeastOne(playing, rates.goalNp.per90 * factor + rates.assist.per90 * factor, penGoalPerMatch),
    low: mixAtLeastOne(playing, rates.goalNp.low * factor + rates.assist.low * factor, penGoalPerMatch),
    high: mixAtLeastOne(playing, rates.goalNp.high * factor + rates.assist.high * factor, penGoalPerMatch),
    insufficient: lowSample,
    note: sampleNote,
  };
  const yellow = prob(playing, rates.yellow, 1, 0, lowSample, sampleNote);
  const red = prob(playing, rates.red, 1, 0, lowSample, sampleNote);
  const ownGoal: ProbEstimate = {
    ...prob(playing, rates.ownGoal, 1, 0, true),
    note: "Evento raro: stima di base per ruolo, non individuale (affidabilità bassa).",
  };

  // --- portieri ---
  let gk: PlayerEvaluation["probs"]["gk"] = null;
  let conceded90 = 0;
  let penAgainst = 0;
  if (expectation) {
    conceded90 = expectation.oppGoals;
    penAgainst = LEAGUE_PRIORS.penaltiesPerTeamMatch * (matchCtx?.oppAttack ?? 1);
  }
  if (r === "P" && expectation) {
    const csStart = Math.exp(-expectation.oppGoals);
    const twoPlus = 1 - Math.exp(-expectation.oppGoals) * (1 + expectation.oppGoals);
    const csLow = Math.exp(-expectation.oppGoals * 1.25);
    const csHigh = Math.exp(-expectation.oppGoals * 0.8);
    const pSave = 1 - Math.exp(-penAgainst * LEAGUE_PRIORS.penaltySaveRate);
    gk = {
      cleanSheet: { p: playing.pStart * csStart, low: playing.pStart * csLow, high: playing.pStart * csHigh, insufficient: (matchCtx?.expectation.basedOnGames.opp ?? 0) < 3, note: "Basata sui gol attesi dell'avversario." },
      expectedConceded: playing.pStart * expectation.oppGoals,
      twoPlusConceded: playing.pStart * twoPlus,
      penaltySave: { p: playing.pStart * pSave, low: playing.pStart * pSave * 0.6, high: playing.pStart * pSave * 1.5, insufficient: true, note: "Stima di base: non esistono dati individuali sufficienti sui rigori parati." },
    };
  }

  // P(almeno un bonus) secondo il regolamento
  const b = cfg.bonus;
  let lamBonus90 = 0;
  if (r !== "P" && b.gol[r] > 0) lamBonus90 += rates.goalNp.per90 * factor;
  if (b.assist > 0) lamBonus90 += rates.assist.per90 * factor;
  let anyBonus: ProbEstimate = {
    p: mixAtLeastOne(playing, lamBonus90, r !== "P" && b.rigoreSegnato > 0 ? penGoalPerMatch : 0),
    low: goa.low,
    high: goa.high,
    insufficient: lowSample,
    note: sampleNote,
  };
  if (r === "P" && gk) {
    const pNoBonus = (1 - (b.portaInviolata > 0 ? gk.cleanSheet.p : 0)) * (1 - (b.rigoreParato > 0 ? gk.penaltySave.p : 0));
    anyBonus = { p: 1 - pNoBonus, low: gk.cleanSheet.low, high: Math.min(1, gk.cleanSheet.high + gk.penaltySave.p), insufficient: gk.cleanSheet.insufficient, note: "Porta inviolata e rigore parato." };
  }

  const m = cfg.malus;
  const expectedMalus =
    yellow.p * m.ammonizione + red.p * m.espulsione + ownGoal.p * m.autogol + penMissTotal * m.rigoreSbagliato + (r === "P" && gk ? gk.expectedConceded * m.golSubito : 0);

  // --- affidabilità ---
  const missing: string[] = [];
  let score = 0;
  const minScore = Math.min(1, rates.minutesObserved / 900) * (rates.minutesEstimated ? 0.8 : 1);
  score += 0.3 * minScore;
  if (rates.minutesObserved === 0) missing.push("statistiche individuali della stagione");
  else if (rates.minutesEstimated) missing.push("minuti giocati reali (stimati dalle presenze)");
  const playScore = playing.official ? 1 : playing.sources.some((s) => s.label.startsWith("Probabile")) ? 0.8 : playing.insufficient ? 0.1 : input.teamMatchdays.length >= 5 ? 0.5 : 0.3;
  score += 0.3 * playScore;
  if (!playing.official && !playing.sources.some((s) => s.label.startsWith("Probabile"))) missing.push("probabili formazioni");
  const statusVerified = player.status !== "da_verificare" || input.availability.length > 0;
  score += 0.15 * (statusVerified ? 1 : 0.3);
  if (!statusVerified) missing.push("stato di disponibilità verificato");
  const teamGames = matchCtx?.expectation.basedOnGames.team ?? 0;
  score += 0.15 * Math.min(1, teamGames / 5);
  if (teamGames < 5) missing.push("campione di partite di squadra (meno di 5)");
  score += 0.1 * (rates.usedXg ? 1 : 0.5);
  if (!rates.usedXg && r !== "P") missing.push("xG/xA individuali");
  if (!matchCtx?.oppProfile || matchCtx.oppProfile.basis === "gol") missing.push("dati difensivi avanzati dell'avversario");
  if (playing.rumors.length > 0) score -= 0.05;
  const level: Reliability["level"] = score >= 0.7 ? "alta" : score >= 0.45 ? "media" : "bassa";

  // --- fattori esplicativi ---
  const factors: Factor[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (playing.availability === "indisponibile") factors.push({ text: playing.availabilityLabel, sign: -1, weight: 10 });
  if (playing.official && playing.pStart > 0.9) factors.push({ text: "Titolare nella formazione ufficiale", sign: 1, weight: 9 });
  else if (!playing.insufficient && playing.availability !== "indisponibile") {
    if (playing.pStart >= 0.75) factors.push({ text: `Titolarità stimata ${pct(playing.pStart)}`, sign: 1, weight: 6 });
    else if (playing.pStart <= 0.45) factors.push({ text: `Titolarità stimata solo ${pct(playing.pStart)}`, sign: -1, weight: 7 });
    else factors.push({ text: `Titolarità incerta (${pct(playing.pStart)})`, sign: 0, weight: 4 });
  } else if (playing.insufficient) factors.push({ text: "Titolarità sconosciuta: mancano probabili formazioni e storico", sign: -1, weight: 5 });
  if (playing.availability === "dubbio") factors.push({ text: playing.availabilityLabel, sign: -1, weight: 6 });
  if (expectation && matchCtx) {
    if (r === "A" || r === "C") {
      if (factor >= 1.12) factors.push({ text: `Partita favorevole: ${expectation.teamGoals.toFixed(1)} gol attesi della squadra contro ${matchCtx.oppName} (media ${expectation.teamSeasonAvg.toFixed(1)})`, sign: 1, weight: 5 });
      else if (factor <= 0.88) factors.push({ text: `Partita difficile: ${expectation.teamGoals.toFixed(1)} gol attesi contro ${matchCtx.oppName} (media ${expectation.teamSeasonAvg.toFixed(1)})`, sign: -1, weight: 5 });
    } else {
      const avg = table.avgGoals;
      if (expectation.oppGoals <= avg * 0.85) factors.push({ text: `${matchCtx.oppName} ha un attacco poco produttivo: ${expectation.oppGoals.toFixed(1)} gol attesi`, sign: 1, weight: 5 });
      else if (expectation.oppGoals >= avg * 1.15) factors.push({ text: `${matchCtx.oppName} ha un attacco pericoloso: ${expectation.oppGoals.toFixed(1)} gol attesi`, sign: -1, weight: 5 });
    }
    factors.push({ text: matchCtx.isHome ? "Gioca in casa" : "Gioca in trasferta", sign: matchCtx.isHome ? 1 : 0, weight: 1 });
  }
  if (r !== "P" && goa.p >= (r === "A" ? 0.45 : r === "C" ? 0.32 : 0.18)) factors.push({ text: `Buon potenziale di bonus: P(gol o assist) ${pct(goa.p)}`, sign: 1, weight: 5 });
  if (rates.penalties.takerProb >= 0.6) factors.push({ text: rates.penalties.basis, sign: 1, weight: 4 });
  if (yellow.p >= 0.3) factors.push({ text: `Rischio ammonizione elevato (${pct(yellow.p)})`, sign: -1, weight: 3 });
  if (playing.diffidato) factors.push({ text: "Diffidato", sign: -1, weight: 2 });
  if (rates.usedXg && rates.goalNp.events < (rates.goalNp.per90 * rates.goalNp.minutes) / 90 * 0.6 && rates.goalNp.minutes > 450) {
    factors.push({ text: "Produce occasioni (xG) più di quanto dicano i gol segnati: il digiuno non indica per forza una cattiva condizione", sign: 1, weight: 3 });
  }
  if (rates.form5 && rates.form5.played >= 3 && rates.form5.avgFantavote != null && rates.formSeason?.avgFantavote != null) {
    const d = rates.form5.avgFantavote - rates.formSeason.avgFantavote;
    if (d >= 0.5) factors.push({ text: `In forma: fantamedia ultime 5 ${rates.form5.avgFantavote.toFixed(2)} (stagione ${rates.formSeason.avgFantavote.toFixed(2)})`, sign: 1, weight: 3 });
    if (d <= -0.5) factors.push({ text: `Rendimento in calo: fantamedia ultime 5 ${rates.form5.avgFantavote.toFixed(2)} (stagione ${rates.formSeason.avgFantavote.toFixed(2)})`, sign: -1, weight: 3 });
  }
  if (lowSample) factors.push({ text: "Pochi minuti di dati individuali: stima prudente", sign: 0, weight: 2 });
  if (playing.rumors.length) factors.push({ text: `Notizie da verificare: ${playing.rumors[0].description ?? playing.rumors[0].source}`, sign: -1, weight: 4 });

  const voteSd = r === "P" ? 0.65 : 0.55;
  const sim: SimParams | null =
    input.match && player.teamId
      ? {
          playerId: player.id,
          role: r,
          teamId: input.match.teamId,
          oppId: input.match.oppId,
          pStart: playing.pStart,
          pSub: playing.pSub,
          pVoteIfSub: playing.pVoteIfSub,
          minStart: playing.minutesIfStart,
          minSub: playing.minutesIfSub,
          goal90: r === "P" ? 0 : rates.goalNp.per90 * factor,
          assist90: rates.assist.per90 * factor,
          yellow90: rates.yellow.per90,
          red90: rates.red.per90,
          og90: rates.ownGoal.per90,
          penPerMatch,
          pTaker: rates.penalties.takerProb,
          penMiss: rates.penalties.missRate,
          conceded90,
          penAgainstPerMatch: penAgainst,
          penSaveRate: LEAGUE_PRIORS.penaltySaveRate,
          voteMean: rates.vote.mean,
          voteSd,
        }
      : null;

  return {
    modelVersion: MODEL_VERSION,
    playerId: player.id,
    name: player.name,
    role,
    rolesMantra: player.rolesMantra,
    teamId: player.teamId,
    teamName: player.teamName,
    match: matchCtx,
    playing,
    rates,
    probs: {
      goal,
      assist,
      goalOrAssist: goa,
      anyBonus,
      bigGame: null,
      yellow,
      red,
      ownGoal,
      penaltyMiss: {
        teamAwarded: pTeamAwarded,
        isTakerOnPitch: pTakerOnPitch,
        missGivenTaken: rates.penalties.missRate,
        total: penMissTotal,
        basis: rates.penalties.basis,
      },
      noVote: 1 - playing.pVote,
      gk,
    },
    points: {
      expectedVote: rates.vote.mean,
      expectedFantavoteIfVote: null,
      expectedPoints: null,
      expectedIfStarts: null,
      p10: null,
      p90: null,
      expectedMalus,
    },
    fantavalue: null,
    reliability: { level, score: clamp(score), missing, sampleMinutes: Math.round(rates.minutesObserved), minutesEstimated: rates.minutesEstimated },
    factors: factors.sort((a, b2) => b2.weight - a.weight),
    consensus,
    sim,
    computedAt,
    issues,
  };
}
