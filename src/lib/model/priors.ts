import type { RoleClassic } from "@/lib/domain/settings";

/**
 * IPERPARAMETRI DEL MODELLO (non sono statistiche reali).
 *
 * Sono valori a priori ragionevoli per la Serie A, usati SOLO per stabilizzare le stime
 * quando i dati individuali sono pochi (shrinkage bayesiano). Con l'aumentare dei minuti
 * osservati il loro peso diminuisce. Ogni stima che si basa principalmente su questi valori
 * viene etichettata con affidabilità bassa o come "Dati insufficienti".
 */
export const MODEL_VERSION = "fi-1.0.0";

export interface RolePrior {
  goal90: number; // gol su azione per 90'
  assist90: number;
  yellow90: number;
  red90: number;
  ownGoal90: number;
  vote: number; // voto medio in pagella
  voteSd: number;
  minutesIfStart: number;
  minutesIfSub: number;
  subRate: number; // probabilità di entrare se non titolare
  startShareOfApps: number; // quota di presenze da titolare (se il dato non è disponibile)
  minutesPerApp: number; // minuti medi per presenza (per stimare i minuti dalle presenze)
}

export const ROLE_PRIORS: Record<RoleClassic, RolePrior> = {
  P: { goal90: 0, assist90: 0.004, yellow90: 0.04, red90: 0.004, ownGoal90: 0.003, vote: 6.0, voteSd: 0.65, minutesIfStart: 90, minutesIfSub: 30, subRate: 0.02, startShareOfApps: 0.97, minutesPerApp: 89 },
  D: { goal90: 0.045, assist90: 0.055, yellow90: 0.21, red90: 0.012, ownGoal90: 0.012, vote: 5.95, voteSd: 0.55, minutesIfStart: 84, minutesIfSub: 22, subRate: 0.22, startShareOfApps: 0.86, minutesPerApp: 78 },
  C: { goal90: 0.11, assist90: 0.11, yellow90: 0.21, red90: 0.01, ownGoal90: 0.004, vote: 6.0, voteSd: 0.55, minutesIfStart: 77, minutesIfSub: 22, subRate: 0.4, startShareOfApps: 0.75, minutesPerApp: 67 },
  A: { goal90: 0.34, assist90: 0.14, yellow90: 0.12, red90: 0.007, ownGoal90: 0.002, vote: 5.95, voteSd: 0.6, minutesIfStart: 72, minutesIfSub: 22, subRate: 0.45, startShareOfApps: 0.7, minutesPerApp: 63 },
};

/** Minuti "virtuali" di prior: quanto pesa il prior rispetto ai dati osservati. */
export const PRIOR_MINUTES = { goal: 900, assist: 900, card: 1200, ownGoal: 4000 };

/** Valori di campionato a priori, sostituiti dai dati reali appena disponibili. */
export const LEAGUE_PRIORS = {
  goalsPerTeamMatch: 1.33,
  homeGoals: 1.45,
  awayGoals: 1.2,
  penaltiesPerTeamMatch: 0.27,
  penaltyConversion: 0.78,
  penaltySaveRate: 0.2,
  teamShrinkGames: 6,
  pVoteIfSub: 0.55, // un subentrato riceve voto solo se gioca abbastanza
  pVoteIfStart: 0.985,
};

/** Peso della stagione precedente (informazione secondaria). */
export const PREVIOUS_SEASON_WEIGHT = 0.5;
export const PREVIOUS_SEASON_MAX_MINUTES = 1800;

/** Emivita (in giornate) della ponderazione temporale delle partite recenti. */
export const RECENCY_HALF_LIFE_MATCHDAYS = 6;

/** Soglie per l'affidabilità e per il "dati insufficienti". */
export const MIN_MINUTES_FOR_INDIVIDUAL = 180;
