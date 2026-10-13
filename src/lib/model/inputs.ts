import type { RoleClassic } from "@/lib/domain/settings";

// Strutture di input del modello, indipendenti dal database (il modello è puro e testabile).

export type ModelStatus = "disponibile" | "in_dubbio" | "infortunato" | "squalificato" | "da_verificare" | "fuori_rosa";

export interface PlayerInput {
  id: number;
  name: string;
  role: RoleClassic | null;
  rolesMantra: string | null;
  teamId: number | null;
  teamName: string | null;
  status: ModelStatus;
  statusSource: string | null;
  statusUpdatedAt: string | null;
  penaltyOrder: number | null;
  penaltyOrderSource: string | null;
  officialVerified: boolean;
  lastVerifiedAt: string | null;
}

export interface SeasonAgg {
  season: string;
  source: string;
  asOf: string;
  apps: number | null;
  starts: number | null;
  minutes: number | null;
  avgVote: number | null;
  avgFantavote: number | null;
  goals: number | null;
  assists: number | null;
  penTaken: number | null;
  penScored: number | null;
  penMissed: number | null;
  penSaved: number | null;
  yellow: number | null;
  red: number | null;
  ownGoals: number | null;
  goalsConceded: number | null;
  xg: number | null;
  xa: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  keyPasses: number | null;
}

export interface MatchLine {
  matchday: number;
  source: string;
  played: boolean;
  started: boolean | null;
  minutes: number | null;
  vote: number | null;
  fantavote: number | null;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  ownGoals: number;
  penScored: number;
  penMissed: number;
  penSaved: number;
  goalsConceded: number;
  xg: number | null;
  xa: number | null;
  shots: number | null;
}

export interface AvailInput {
  kind: "infortunio" | "squalifica" | "diffida" | "malattia" | "altro";
  certainty: "confermato" | "dubbio" | "in_recupero" | "indiscrezione";
  description: string | null;
  expectedReturn: string | null;
  source: string;
  url: string | null;
  reportedAt: string;
}

export interface LineupInput {
  kind: "probabile" | "ufficiale";
  status: "titolare" | "ballottaggio" | "panchina" | "non_convocato" | "indisponibile";
  probability: number | null;
  source: string;
  reportedAt: string;
  url: string | null;
}

export interface MatchInfo {
  id: number;
  matchday: number;
  kickoff: string | null;
  kickoffKnown: boolean;
  status: string;
  isHome: boolean;
  teamId: number;
  oppId: number;
  oppName: string;
}

export interface EditorialInput {
  source: string;
  verdict: "consigliato" | "schierabile" | "neutrale" | "rischioso" | "sconsigliato";
  explicit: boolean;
  matchday: number | null;
  publishedAt: string | null;
  storyKey: string | null;
  summary: string | null;
  url: string | null;
}
