import type { EditorialInput } from "./inputs";

export interface Consensus {
  available: boolean;
  index: number | null; // 0-100 (50 = neutrale)
  independentSources: number;
  agreement: "unanime" | "prevalente" | "disaccordo" | null;
  explicitCount: number;
  statsOnlyCount: number;
  stale: boolean;
  summary: string;
  opinions: (EditorialInput & { weight: number })[];
}

const SCORE: Record<EditorialInput["verdict"], number> = { consigliato: 2, schierabile: 1, neutrale: 0, rischioso: -1, sconsigliato: -2 };

/**
 * Indice di consenso editoriale. Ogni fonte conta una sola volta (la più recente);
 * notizie riprese da più fonti (stesso story_key) contano come una sola conferma;
 * i pareri vengono pesati per freschezza, pertinenza alla giornata ed esplicitezza.
 */
export function editorialConsensus(ops: EditorialInput[], matchday: number, now = Date.now()): Consensus {
  const relevant = ops.filter((o) => o.matchday == null || o.matchday === matchday);
  if (relevant.length === 0) {
    return { available: false, index: null, independentSources: 0, agreement: null, explicitCount: 0, statsOnlyCount: 0, stale: false, summary: "Nessun parere raccolto per questa giornata.", opinions: [] };
  }
  // una sola opinione per fonte (la più recente)
  const bySource = new Map<string, EditorialInput>();
  for (const o of [...relevant].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))) {
    const k = o.source.trim().toLowerCase();
    if (!bySource.has(k)) bySource.set(k, o);
  }
  // le riprese della stessa notizia valgono una volta sola
  const byStory = new Map<string, EditorialInput[]>();
  for (const o of bySource.values()) {
    const k = o.storyKey?.trim().toLowerCase() || `__${o.source}`;
    if (!byStory.has(k)) byStory.set(k, []);
    byStory.get(k)!.push(o);
  }
  const weighted: (EditorialInput & { weight: number })[] = [];
  let wSum = 0;
  let sSum = 0;
  let stale = true;
  for (const group of byStory.values()) {
    const share = 1 / group.length;
    for (const o of group) {
      const ageH = o.publishedAt ? Math.max(0, (now - new Date(o.publishedAt).getTime()) / 3_600_000) : 96;
      if (ageH < 96) stale = false;
      const fresh = Math.pow(0.5, ageH / 72);
      const relevance = o.matchday === matchday ? 1 : 0.4;
      const explicit = o.explicit ? 1 : 0.3;
      const w = fresh * relevance * explicit * share;
      weighted.push({ ...o, weight: w });
      wSum += w;
      sSum += w * SCORE[o.verdict];
    }
  }
  const mean = wSum > 0 ? sSum / wSum : 0;
  const variance = wSum > 0 ? weighted.reduce((s, o) => s + o.weight * (SCORE[o.verdict] - mean) ** 2, 0) / wSum : 0;
  const signs = new Set(weighted.filter((o) => o.weight > 0.05).map((o) => Math.sign(SCORE[o.verdict])));
  const agreement: Consensus["agreement"] =
    signs.size <= 1 && variance < 0.3 ? "unanime" : signs.has(1) && signs.has(-1) && variance >= 1 ? "disaccordo" : "prevalente";
  const independent = byStory.size;
  const index = Math.round(50 + 25 * mean);
  const explicitCount = weighted.filter((o) => o.explicit).length;
  const statsOnlyCount = weighted.length - explicitCount;
  const tone = mean >= 1 ? "positivo" : mean >= 0.3 ? "moderatamente positivo" : mean > -0.3 ? "neutrale" : mean > -1 ? "moderatamente negativo" : "negativo";
  let summary = `Giudizio ${tone} da ${independent} fonte/i indipendente/i.`;
  if (agreement === "disaccordo") summary = `Le fonti sono in disaccordo (${independent} fonti): valuta i singoli pareri.`;
  if (stale) summary += " Pareri non recenti.";
  return { available: true, index, independentSources: independent, agreement, explicitCount, statsOnlyCount, stale, summary, opinions: weighted };
}
