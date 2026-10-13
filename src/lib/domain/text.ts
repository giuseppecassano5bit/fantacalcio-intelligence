// Normalizzazione di nomi di giocatori e squadre per ricerca e abbinamento tra fonti.

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** minuscolo, senza accenti né punteggiatura, spazi singoli */
export function normalizeName(s: string): string {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameTokens(s: string): string[] {
  return normalizeName(s).split(" ").filter(Boolean);
}

const TEAM_STOPWORDS = new Set([
  "fc", "ac", "as", "ss", "ssc", "us", "acf", "cfc", "bc", "calcio", "hellas", "club", "football", "sc", "fbc", "1907", "1909", "1913", "1919", "1912", "1946", "1928",
]);

const TEAM_SPECIAL: Record<string, string> = {
  internazionale: "inter",
  "internazionale milano": "inter",
  "inter milan": "inter",
  "inter milano": "inter",
  juve: "juventus",
  "ac milan": "milan",
};

/** Chiave canonica di una squadra a partire da nomi diversi usati dalle fonti. */
export function teamKey(name: string): string {
  const n = normalizeName(name);
  if (TEAM_SPECIAL[n]) return TEAM_SPECIAL[n];
  const tokens = n.split(" ").filter((t) => t && !TEAM_STOPWORDS.has(t));
  const joined = tokens.join(" ");
  if (TEAM_SPECIAL[joined]) return TEAM_SPECIAL[joined];
  if (tokens.includes("inter") || tokens.includes("internazionale")) return "inter";
  return joined || n;
}

/** Nome visualizzato breve per una chiave squadra. */
export function teamDisplayName(key: string, fallback?: string): string {
  const map: Record<string, string> = {
    inter: "Inter",
    milan: "Milan",
    juventus: "Juventus",
    napoli: "Napoli",
    roma: "Roma",
    lazio: "Lazio",
    atalanta: "Atalanta",
    fiorentina: "Fiorentina",
    bologna: "Bologna",
    torino: "Torino",
    genoa: "Genoa",
    udinese: "Udinese",
    cagliari: "Cagliari",
    lecce: "Lecce",
    como: "Como",
    parma: "Parma",
    sassuolo: "Sassuolo",
    monza: "Monza",
    frosinone: "Frosinone",
    venezia: "Venezia",
    verona: "Verona",
    empoli: "Empoli",
    cremonese: "Cremonese",
    pisa: "Pisa",
  };
  if (map[key]) return map[key];
  if (fallback) return fallback;
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Distanza di Levenshtein limitata (per tolleranza a refusi). */
export function levenshtein(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
    cur = [];
  }
  return prev[b.length];
}

export interface NameCandidate {
  id: number;
  fullName: string;
  teamKey?: string | null;
}

/**
 * Punteggio di somiglianza tra un nome cercato (es. "Martinez L.", "Lautaro", "L. Martínez")
 * e un nome di catalogo. 0 = nessuna corrispondenza, 100 = identico.
 */
export function nameScore(query: string, candidate: string): number {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  const qt = q.split(" ");
  const ct = c.split(" ");
  // tutte le parole cercate presenti nel candidato
  const longQ = qt.filter((t) => t.length > 1);
  const initials = qt.filter((t) => t.length === 1);
  const matchedLong = longQ.filter((t) => ct.includes(t));
  if (longQ.length > 0 && matchedLong.length === longQ.length) {
    // le iniziali devono essere compatibili con le altre parole del candidato
    const others = ct.filter((t) => !longQ.includes(t));
    const initialsOk = initials.every((i) => others.some((o) => o.startsWith(i)));
    if (initials.length > 0 && !initialsOk) return 35;
    const coverage = matchedLong.join("").length / ct.join("").length;
    return Math.round(70 + 25 * coverage) - (initials.length > 0 ? 0 : 0);
  }
  // prefissi (ricerca mentre si digita)
  if (longQ.length > 0 && longQ.every((t) => ct.some((w) => w.startsWith(t)))) return 60;
  // tolleranza refusi su cognome
  if (longQ.length === 1 && ct.some((w) => w.length > 3 && levenshtein(w, longQ[0], 1) <= 1)) return 50;
  if (matchedLong.length > 0) return 30 + 10 * matchedLong.length;
  return 0;
}

export interface MatchResult<T extends NameCandidate> {
  best: T | null;
  score: number;
  ambiguous: boolean;
  candidates: { item: T; score: number }[];
}

/** Abbina un nome a un insieme di candidati, tenendo conto della squadra se nota. */
export function matchName<T extends NameCandidate>(
  query: string,
  candidates: T[],
  opts: { teamKey?: string | null; minScore?: number } = {},
): MatchResult<T> {
  const minScore = opts.minScore ?? 60;
  const scored = candidates
    .map((item) => {
      let score = nameScore(query, item.fullName);
      if (score > 0 && opts.teamKey && item.teamKey) {
        score += item.teamKey === opts.teamKey ? 8 : -25;
      }
      return { item, score };
    })
    .filter((x) => x.score >= Math.min(minScore, 30))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < minScore) {
    return { best: null, score: top?.score ?? 0, ambiguous: scored.length > 0, candidates: scored.slice(0, 6) };
  }
  const second = scored[1];
  const ambiguous = !!second && second.score >= minScore && top.score - second.score < 8;
  return { best: ambiguous ? null : top.item, score: top.score, ambiguous, candidates: scored.slice(0, 6) };
}
