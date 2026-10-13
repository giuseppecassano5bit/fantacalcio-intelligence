import type { Db } from "@/lib/db";

export type DataKind =
  | "calendario"
  | "risultati"
  | "squadre"
  | "rose"
  | "statistiche_giocatori"
  | "infortuni"
  | "formazioni_ufficiali"
  | "notizie";

export const DATA_KIND_LABEL: Record<DataKind, string> = {
  calendario: "Calendario e orari",
  risultati: "Risultati",
  squadre: "Squadre",
  rose: "Rose e trasferimenti",
  statistiche_giocatori: "Statistiche giocatori",
  infortuni: "Infortuni e squalifiche",
  formazioni_ufficiali: "Formazioni ufficiali",
  notizie: "Notizie",
};

export interface SyncContext {
  db: Db;
  force: boolean;
  /** giornate su cui concentrare le richieste (corrente, precedente, successiva) */
  focusMatchdays: number[];
  log: (msg: string) => void;
  now: number;
}

export interface ConnectorOutcome {
  connector: string;
  ok: boolean;
  skipped?: string;
  items: Record<string, number>;
  messages: string[];
  error?: string;
  usedCache?: boolean;
  stale?: boolean;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface Connector {
  id: string;
  name: string;
  description: string;
  provides: DataKind[];
  requiresKey: boolean;
  envVar?: string;
  docsUrl: string;
  limits: string;
  license: string;
  fallback: string;
  priority: number; // precedenza dei dati di calendario/risultati
  isConfigured(): boolean;
  test(db: Db): Promise<TestResult>;
  sync(ctx: SyncContext, kinds: DataKind[]): Promise<ConnectorOutcome>;
}
