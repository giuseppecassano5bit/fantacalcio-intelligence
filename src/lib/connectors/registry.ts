import type { Connector } from "./types";
import { openfootball } from "./openfootball";
import { thesportsdb } from "./thesportsdb";
import { footballData } from "./footballData";
import { apiFootball } from "./apiFootball";
import { rssNews } from "./rss";

/** Ordine di esecuzione: prima la base del calendario, poi le fonti più precise. */
export const CONNECTORS: Connector[] = [openfootball, thesportsdb, footballData, apiFootball, rssNews];

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
