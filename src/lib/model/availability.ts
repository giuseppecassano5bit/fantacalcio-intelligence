import type { RoleClassic } from "@/lib/domain/settings";
import type { AvailInput, LineupInput, MatchInfo, PlayerInput } from "./inputs";
import type { PlayerRates } from "./playerRates";
import { LEAGUE_PRIORS, ROLE_PRIORS } from "./priors";

export interface SourceRef {
  label: string;
  at: string | null;
  url?: string | null;
  kind: "verificato" | "parziale" | "giornalistico" | "stima" | "manuale";
}

export interface PlayingEstimate {
  availability: "disponibile" | "dubbio" | "indisponibile" | "sconosciuta";
  availabilityLabel: string;
  pStart: number;
  pSub: number;
  pNone: number;
  pVote: number;
  pVoteIfSub: number;
  minutesIfStart: number;
  minutesIfSub: number;
  expectedMinutes: number;
  insufficient: boolean; // nessuna evidenza su titolarità: valore di ripiego
  official: boolean; // formazione ufficiale pubblicata
  preliminary: boolean; // partita lontana: previsione preliminare
  basis: string[];
  warnings: string[];
  sources: SourceRef[];
  rumors: AvailInput[]; // indiscrezioni da verificare (non cambiano le probabilità)
  diffidato: boolean;
}

const HOURS = 3_600_000;

function freshnessWeight(iso: string, now: number, halfLifeHours: number): number {
  const age = Math.max(0, (now - new Date(iso).getTime()) / HOURS);
  return Math.pow(0.5, age / halfLifeHours);
}

/**
 * Probabilità di titolarità / ingresso / mancato impiego.
 * Priorità delle evidenze: formazione ufficiale > indisponibilità confermate > probabili formazioni > storico.
 */
export function estimatePlaying(
  player: PlayerInput,
  role: RoleClassic,
  match: MatchInfo | null,
  rates: PlayerRates,
  avail: AvailInput[],
  lineups: LineupInput[],
  teamGamesPlayed: number,
  now = Date.now(),
): PlayingEstimate {
  const prior = ROLE_PRIORS[role];
  const basis: string[] = [];
  const warnings: string[] = [];
  const sources: SourceRef[] = [];
  const rumors: AvailInput[] = [];
  let minutesIfStart = prior.minutesIfStart;
  const minutesIfSub = prior.minutesIfSub;
  const pVoteIfSub = LEAGUE_PRIORS.pVoteIfSub;

  const result = (pStart: number, pSub: number, extra: Partial<PlayingEstimate>): PlayingEstimate => {
    pStart = Math.min(1, Math.max(0, pStart));
    pSub = Math.min(1 - pStart, Math.max(0, pSub));
    const pNone = 1 - pStart - pSub;
    return {
      availability: "disponibile",
      availabilityLabel: "Disponibile",
      pStart,
      pSub,
      pNone,
      pVote: pStart * LEAGUE_PRIORS.pVoteIfStart + pSub * pVoteIfSub,
      pVoteIfSub,
      minutesIfStart,
      minutesIfSub,
      expectedMinutes: pStart * minutesIfStart + pSub * minutesIfSub,
      insufficient: false,
      official: false,
      preliminary: false,
      basis,
      warnings,
      sources,
      rumors,
      diffidato: avail.some((a) => a.kind === "diffida"),
      ...extra,
    };
  };

  if (!match) {
    basis.push("Nessuna partita in calendario per la sua squadra in questa giornata.");
    return result(0, 0, { availability: "indisponibile", availabilityLabel: "Non gioca (nessuna partita)" });
  }
  if (["rinviata", "annullata"].includes(match.status)) {
    basis.push(`Partita ${match.status}.`);
    return result(0, 0, { availability: "indisponibile", availabilityLabel: `Partita ${match.status}` });
  }
  if (player.status === "fuori_rosa") {
    basis.push("Il giocatore non risulta nella rosa di una squadra di Serie A.");
    return result(0, 0, { availability: "indisponibile", availabilityLabel: "Non in rosa Serie A" });
  }

  const hoursToKick = match.kickoff ? (new Date(match.kickoff).getTime() - now) / HOURS : null;
  const preliminary = hoursToKick != null && hoursToKick > 96;

  // 1) Formazione ufficiale: ha la priorità su tutto
  const official = lineups.filter((l) => l.kind === "ufficiale").sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))[0];
  if (official) {
    sources.push({ label: `Formazione ufficiale (${official.source})`, at: official.reportedAt, url: official.url, kind: "verificato" });
    if (official.status === "titolare") {
      basis.push("Titolare nella formazione ufficiale.");
      return result(0.995, 0.005, { official: true, availabilityLabel: "Titolare (ufficiale)" });
    }
    if (official.status === "panchina") {
      basis.push("In panchina nella formazione ufficiale.");
      return result(0, prior.subRate, { official: true, availabilityLabel: "Panchina (ufficiale)" });
    }
    basis.push("Non presente nella formazione ufficiale.");
    return result(0, 0, { official: true, availability: "indisponibile", availabilityLabel: "Non convocato (ufficiale)" });
  }

  // 2) Indisponibilità
  let availFactor = 1;
  let availability: PlayingEstimate["availability"] = "disponibile";
  let availabilityLabel = "Disponibile";
  const kickoffDate = match.kickoff ? match.kickoff.slice(0, 10) : null;
  for (const a of avail) {
    if (a.kind === "diffida") {
      basis.push("Diffidato: un'ammonizione comporterebbe la squalifica nella giornata successiva.");
      sources.push({ label: a.source, at: a.reportedAt, url: a.url, kind: "manuale" });
      continue;
    }
    if (a.certainty === "indiscrezione") {
      rumors.push(a);
      sources.push({ label: `${a.source} (indiscrezione)`, at: a.reportedAt, url: a.url, kind: "giornalistico" });
      continue;
    }
    const returnsBefore = a.expectedReturn && kickoffDate && a.expectedReturn <= kickoffDate;
    sources.push({ label: a.source, at: a.reportedAt, url: a.url, kind: a.certainty === "confermato" ? "verificato" : "giornalistico" });
    if (a.certainty === "confermato" && !returnsBefore) {
      availFactor = 0;
      availability = "indisponibile";
      availabilityLabel = a.kind === "squalifica" ? "Squalificato" : a.kind === "malattia" ? "Indisponibile (malattia)" : "Infortunato";
      basis.push(`${availabilityLabel}: ${a.description ?? "segnalazione confermata"} (fonte: ${a.source}).`);
    } else if (a.certainty === "dubbio" || (a.certainty === "confermato" && returnsBefore)) {
      availFactor = Math.min(availFactor, 0.55);
      availability = availability === "indisponibile" ? availability : "dubbio";
      availabilityLabel = "In dubbio";
      basis.push(`In dubbio: ${a.description ?? a.kind} (fonte: ${a.source}).`);
    } else if (a.certainty === "in_recupero") {
      availFactor = Math.min(availFactor, 0.75);
      availability = availability === "indisponibile" ? availability : "dubbio";
      availabilityLabel = "In recupero";
      basis.push(`In recupero: rischio di minutaggio ridotto (fonte: ${a.source}).`);
      minutesIfStart = Math.min(minutesIfStart, prior.minutesIfStart - 12);
    }
  }
  if (player.status === "infortunato" || player.status === "squalificato") {
    if (availFactor > 0) {
      availFactor = 0;
      availability = "indisponibile";
      availabilityLabel = player.status === "infortunato" ? "Infortunato" : "Squalificato";
      basis.push(`Stato impostato a "${availabilityLabel}" (${player.statusSource ?? "fonte non indicata"}).`);
    }
  } else if (player.status === "in_dubbio" && availFactor > 0.55) {
    availFactor = 0.55;
    availability = "dubbio";
    availabilityLabel = "In dubbio";
    basis.push(`Stato impostato a "In dubbio" (${player.statusSource ?? "fonte non indicata"}).`);
  }
  if (rumors.length > 0) {
    warnings.push(`${rumors.length} notizia/e giornalistica/he da verificare: non modificano la stima finché non vengono confermate.`);
  }
  if (availFactor === 0) {
    return result(0, 0, { availability, availabilityLabel, preliminary });
  }

  // 3) Storico di impiego
  let pStartHist: number | null = null;
  let pAppHist: number | null = null;
  const apps = rates.appearances;
  if (apps != null && teamGamesPlayed > 0) {
    pAppHist = (Math.min(apps, teamGamesPlayed) + 1) / (teamGamesPlayed + 2);
    if (rates.starts != null) {
      pStartHist = (rates.starts + 0.5) / (teamGamesPlayed + 1);
      basis.push(`Storico: ${rates.starts} partite da titolare su ${teamGamesPlayed} della squadra.`);
    } else {
      pStartHist = pAppHist * prior.startShareOfApps;
      basis.push(`Storico: ${apps} presenze su ${teamGamesPlayed} partite della squadra (quota da titolare stimata).`);
    }
    if (rates.minutesObserved > 0 && rates.starts && !rates.minutesEstimated && rates.starts >= 3) {
      minutesIfStart = Math.min(93, Math.max(55, (rates.minutesObserved - Math.max(0, apps - rates.starts) * minutesIfSub) / rates.starts));
    }
    sources.push({ label: `Statistiche (${rates.primarySource ?? "fonte"})`, at: null, kind: "parziale" });
  }

  // 4) Probabili formazioni (più fonti, pesate per freschezza)
  const probs = lineups.filter((l) => l.kind === "probabile");
  let pStartReports: number | null = null;
  if (probs.length > 0) {
    let wSum = 0;
    let pSum = 0;
    for (const l of probs) {
      const p =
        l.status === "titolare" ? (l.probability ?? 0.85)
        : l.status === "ballottaggio" ? (l.probability ?? 0.5)
        : l.status === "panchina" ? (l.probability ?? 0.08)
        : 0;
      const w = freshnessWeight(l.reportedAt, now, 48);
      pSum += w * p;
      wSum += w;
      sources.push({ label: `Probabile formazione (${l.source})`, at: l.reportedAt, url: l.url, kind: "giornalistico" });
      basis.push(`Probabile formazione ${l.source}: ${l.status}${l.probability != null ? ` (${Math.round(l.probability * 100)}%)` : ""}.`);
    }
    pStartReports = wSum > 0 ? pSum / wSum : null;
    const anyExcluded = probs.some((l) => l.status === "non_convocato" || l.status === "indisponibile");
    if (anyExcluded) warnings.push("Almeno una fonte lo indica come non convocato/indisponibile.");
  }

  let pStart: number;
  let insufficient = false;
  if (pStartReports != null && pStartHist != null) pStart = 0.75 * pStartReports + 0.25 * pStartHist;
  else if (pStartReports != null) pStart = pStartReports;
  else if (pStartHist != null) {
    // con poche partite della squadra lo storico è poco informativo
    const w = Math.min(1, teamGamesPlayed / 5);
    pStart = w * pStartHist + (1 - w) * 0.5;
  } else {
    pStart = 0.5;
    insufficient = true;
    basis.push("Nessun dato su impiego o probabili formazioni: titolarità sconosciuta (valore di ripiego 50%).");
  }
  pStart *= availFactor;

  const subRate =
    pAppHist != null && pStartHist != null && pStartHist < 0.98
      ? Math.min(0.9, Math.max(0.05, (pAppHist - pStartHist) / Math.max(0.05, 1 - pStartHist)))
      : prior.subRate;
  const pSub = (1 - pStart) * subRate * (availFactor < 1 ? 0.8 : 1);

  if (preliminary) warnings.push("Partita lontana: previsione preliminare, verrà aggiornata con le notizie della settimana.");
  if (player.status === "da_verificare") warnings.push("Stato del giocatore non ancora verificato da una fonte.");

  return result(pStart, pSub, { availability, availabilityLabel, insufficient, preliminary, minutesIfStart });
}
