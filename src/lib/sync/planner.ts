import type { SyncScope } from "./engine";

export interface PlannerMatch {
  kickoff: string | null;
  status: string;
}

export interface PlannerState {
  lastLeggero: string | null;
  lastCompleto: string | null;
  lastRisultati: string | null;
  lastFormazioni: string | null;
  officialLineupsAvailable: boolean; // esiste un connettore configurato per le formazioni ufficiali
}

export interface PlanDecision {
  action: SyncScope | null;
  reason: string;
  nextCheckAt: string | null;
  nextKickoff: string | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (iso: string | null, now: number) => (iso ? now - new Date(iso).getTime() : Number.POSITIVE_INFINITY);

/**
 * Decide se e quale aggiornamento eseguire ADESSO, in base al calendario reale:
 * - risultati: dopo la fine delle partite (kickoff + 2h15') finché non risultano concluse;
 * - formazioni: nei 70 minuti prima di ogni calcio d'inizio (ogni 15');
 * - completo: dalle 24 ore prima della prossima partita (ogni 3 ore, ogni 30' nelle ultime 3 ore);
 * - completo quotidiano e leggero quotidiano per i dati ordinari.
 * Le giornate non iniziano tutte negli stessi giorni/orari: si usa sempre l'orario di ciascuna partita.
 */
export function planSync(matches: PlannerMatch[], s: PlannerState, now = Date.now()): PlanDecision {
  const withKick = matches.filter((m) => m.kickoff).map((m) => ({ ...m, t: new Date(m.kickoff!).getTime() }));
  const upcoming = withKick.filter((m) => m.t > now && m.status === "programmata").sort((a, b) => a.t - b.t);
  const next = upcoming[0] ?? null;
  const nextKickoff = next ? new Date(next.t).toISOString() : null;
  const candidates: number[] = [];

  if (matches.length === 0) {
    return { action: "leggero", reason: "Calendario assente: primo scaricamento", nextCheckAt: null, nextKickoff };
  }

  // 1) risultati da acquisire
  const awaitingResult = withKick.filter((m) => m.t < now - 135 * MIN && m.t > now - 48 * HOUR && !["terminata", "rinviata", "annullata"].includes(m.status));
  if (awaitingResult.length > 0) {
    if (ago(s.lastRisultati, now) >= 40 * MIN) {
      return { action: "risultati", reason: `${awaitingResult.length} partita/e terminate da registrare`, nextCheckAt: null, nextKickoff };
    }
    candidates.push(new Date(s.lastRisultati!).getTime() + 40 * MIN);
  }

  // 2) formazioni ufficiali imminenti
  const imminent = withKick.filter((m) => m.t - now <= 70 * MIN && m.t - now > -10 * MIN);
  if (imminent.length > 0 && s.officialLineupsAvailable) {
    if (ago(s.lastFormazioni, now) >= 15 * MIN) {
      return { action: "formazioni", reason: "Partita in arrivo: verifica delle formazioni ufficiali", nextCheckAt: null, nextKickoff };
    }
    candidates.push(new Date(s.lastFormazioni!).getTime() + 15 * MIN);
  }

  // 3) finestra delle 24 ore prima della prossima partita
  if (next) {
    const h = (next.t - now) / HOUR;
    if (h <= 24) {
      const every = h <= 3 ? 30 * MIN : 3 * HOUR;
      if (ago(s.lastCompleto, now) >= every) {
        return {
          action: "completo",
          reason: h <= 3 ? "Ultime 3 ore prima del calcio d'inizio" : "Meno di 24 ore alla prossima partita",
          nextCheckAt: null,
          nextKickoff,
        };
      }
      candidates.push(new Date(s.lastCompleto!).getTime() + every);
    } else {
      candidates.push(next.t - 24 * HOUR);
    }
    if (s.officialLineupsAvailable) candidates.push(next.t - 70 * MIN);
  }

  // 4) aggiornamento quotidiano
  if (ago(s.lastCompleto, now) >= 24 * HOUR) {
    return { action: "completo", reason: "Aggiornamento quotidiano dei dati", nextCheckAt: null, nextKickoff };
  }
  candidates.push(new Date(s.lastCompleto!).getTime() + 24 * HOUR);
  if (ago(s.lastLeggero, now) >= 12 * HOUR) {
    return { action: "leggero", reason: "Controllo periodico di calendario e risultati", nextCheckAt: null, nextKickoff };
  }
  candidates.push(new Date(s.lastLeggero!).getTime() + 12 * HOUR);
  for (const m of withKick) if (m.t + 135 * MIN > now) candidates.push(m.t + 135 * MIN);

  const nextCheck = Math.min(...candidates.filter((t) => t > now));
  return { action: null, reason: "Nessun aggiornamento necessario ora", nextCheckAt: Number.isFinite(nextCheck) ? new Date(nextCheck).toISOString() : null, nextKickoff };
}
