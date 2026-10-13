import { normalizeName } from "@/lib/domain/text";

export type ImportKind = "rosa" | "listone" | "statistiche" | "voti" | "probabili" | "infortuni" | "pareri" | "squadre_avanzate";

export const IMPORT_KIND_LABEL: Record<ImportKind, string> = {
  rosa: "La mia rosa (elenco giocatori)",
  listone: "Listone / quotazioni Fantacalcio.it",
  statistiche: "Statistiche stagionali (Fantacalcio.it o CSV)",
  voti: "Voti di una giornata (Fantacalcio.it o CSV)",
  probabili: "Probabili formazioni (CSV)",
  infortuni: "Infortuni e squalifiche (CSV)",
  pareri: "Pareri delle fonti specializzate (CSV)",
  squadre_avanzate: "Dati avanzati di squadra: xG, tiri (CSV)",
};

/** Alias delle intestazioni accettate (confronto su testo normalizzato). */
export const ALIASES: Record<string, string[]> = {
  id: ["id", "cod", "cod.", "codice"],
  ruolo: ["r", "ruolo", "role", "ruolo classic"],
  ruoloMantra: ["rm", "ruolo mantra", "ruoli mantra"],
  nome: ["nome", "giocatore", "calciatore", "player", "name", "nominativo"],
  squadra: ["squadra", "team", "club", "sq", "sq."],
  prezzo: ["prezzo", "costo", "crediti", "price", "qt a", "qt.a"],
  note: ["note", "notes"],
  pv: ["pv", "presenze", "pg", "partite", "appearances", "presenze con voto"],
  titolarita: ["titolare", "titolarita", "partite da titolare", "starts"],
  minuti: ["minuti", "min", "minutes", "mp"],
  mv: ["mv", "media voto", "voto medio"],
  fm: ["fm", "fantamedia", "mfv"],
  gf: ["gf", "gol", "gol fatti", "goals"],
  gs: ["gs", "gol subiti", "goals conceded"],
  rp: ["rp", "rigori parati"],
  rc: ["rc", "rigori calciati"],
  rSegnati: ["r+", "rf", "rigori segnati", "rigori fatti"],
  rSbagliati: ["r-", "rs", "rigori sbagliati"],
  ass: ["ass", "assist", "assists"],
  amm: ["amm", "ammonizioni", "gialli", "yellow"],
  esp: ["esp", "espulsioni", "rossi", "red"],
  au: ["au", "autogol", "autoreti"],
  xg: ["xg"],
  xa: ["xa", "xag"],
  tiri: ["tiri", "shots"],
  tiriPorta: ["tiri in porta", "tiri nello specchio", "sot"],
  voto: ["voto", "v", "vote"],
  fantavoto: ["fantavoto", "fv"],
  giornata: ["giornata", "gg", "matchday"],
  stato: ["stato", "status"],
  probabilita: ["probabilita", "percentuale", "prob"],
  fonte: ["fonte", "source"],
  url: ["url", "link"],
  data: ["data", "date", "pubblicato"],
  tipo: ["tipo", "kind"],
  certezza: ["certezza", "affidabilita notizia", "certainty"],
  descrizione: ["descrizione", "dettagli", "motivo"],
  rientro: ["rientro", "data rientro", "ritorno"],
  giudizio: ["giudizio", "verdetto", "consiglio"],
  esplicito: ["esplicito", "consiglio esplicito"],
  sintesi: ["sintesi", "commento", "testo"],
  notizia: ["notizia", "story", "chiave notizia"],
  partite: ["partite", "pg", "matches"],
  xgFatti: ["xg fatti", "xg for", "xg"],
  xgSubiti: ["xg subiti", "xga", "xg against"],
  tiriFatti: ["tiri fatti", "shots for"],
  tiriSubiti: ["tiri subiti", "shots against"],
  porteInviolate: ["porte inviolate", "clean sheet", "clean sheets"],
};

export function normHeader(h: string): string {
  return normalizeName(h.replace("+", " plus ").replace("-", " minus ")).replace(" plus", "+").replace(" minus", "-").trim();
}

const normAlias = (a: string) => normalizeName(a.replace("+", " plus ").replace("-", " minus ")).replace(" plus", "+").replace(" minus", "-").trim();

/** Trova la riga di intestazione (deve contenere almeno "nome") e mappa le colonne. */
export function findHeader(rows: string[][], required: string[] = ["nome"]): { index: number; map: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map((c) => {
      const raw = c.toLowerCase().trim();
      return raw === "r+" || raw === "r-" ? raw : normHeader(c);
    });
    const map: Record<string, number> = {};
    for (const [key, aliases] of Object.entries(ALIASES)) {
      const idx = cells.findIndex((c) => aliases.some((a) => (a === "r+" || a === "r-" ? c === a : c === normAlias(a))));
      if (idx >= 0 && !Object.values(map).includes(idx)) map[key] = idx;
    }
    if (required.every((r) => r in map)) return { index: i, map };
  }
  return null;
}

/** Riconosce il tipo di file dalle intestazioni. */
export function detectKind(rows: string[][], fileName: string): ImportKind | null {
  const f = fileName.toLowerCase();
  if (f.includes("voti")) return "voti";
  if (f.includes("quotazioni") || f.includes("listone")) return "listone";
  if (f.includes("statistiche")) return "statistiche";
  const h = findHeader(rows);
  if (!h) return null;
  const k = Object.keys(h.map);
  if (k.includes("voto") && !k.includes("pv")) return "voti";
  if (k.includes("pv") || k.includes("mv") || k.includes("fm")) return "statistiche";
  if (k.includes("giudizio")) return "pareri";
  if (k.includes("certezza") || k.includes("rientro")) return "infortuni";
  if (k.includes("stato") && k.includes("fonte")) return "probabili";
  if (k.includes("prezzo") && k.includes("ruolo") && k.includes("id")) return "listone";
  return "rosa";
}

export const TEMPLATES: Record<Exclude<ImportKind, "listone" | "voti">, string> = {
  rosa: "nome;ruolo;squadra;prezzo;note\nNome Cognome;A;Squadra;25;\n",
  statistiche: "nome;squadra;ruolo;pv;titolare;minuti;mv;fm;gf;ass;amm;esp;au;rc;r+;r-;rp;gs;xg;xa;tiri\n",
  probabili: "giocatore;squadra;stato;probabilita;fonte;url;data\nNome Cognome;Squadra;titolare;80;Nome fonte;https://...;2026-10-16\n",
  infortuni: "giocatore;squadra;tipo;certezza;descrizione;rientro;fonte;url;data\nNome Cognome;Squadra;infortunio;confermato;Lesione muscolare;2026-11-01;Comunicato del club;https://...;2026-10-13\n",
  pareri: "giocatore;squadra;giornata;fonte;giudizio;esplicito;sintesi;url;data;notizia\nNome Cognome;Squadra;7;Nome fonte;consigliato;si;Breve sintesi;https://...;2026-10-15;\n",
  squadre_avanzate: "squadra;partite;xg fatti;xg subiti;tiri fatti;tiri subiti;porte inviolate;fonte\n",
};
