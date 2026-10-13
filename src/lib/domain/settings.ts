import { z } from "zod";

export type RoleClassic = "P" | "D" | "C" | "A";
export const ROLES: RoleClassic[] = ["P", "D", "C", "A"];
export const ROLE_LABEL: Record<RoleClassic, string> = { P: "Portiere", D: "Difensore", C: "Centrocampista", A: "Attaccante" };

const perRole = z.object({ P: z.number(), D: z.number(), C: z.number(), A: z.number() });

/** Slot di un modulo: elenco dei ruoli ammessi (Classic: un ruolo; Mantra: più ruoli). */
export const moduleSchema = z.object({
  name: z.string().min(1),
  slots: z.array(z.array(z.string().min(1)).min(1)).min(1),
});
export type ModuleDef = z.infer<typeof moduleSchema>;

export const leagueConfigSchema = z.object({
  mode: z.enum(["classic", "mantra"]),
  nomeLega: z.string().max(80).default(""),
  bonus: z.object({
    gol: perRole,
    assist: z.number(),
    rigoreSegnato: z.number(), // in molte leghe uguale al gol
    rigoreParato: z.number(),
    portaInviolata: z.number(),
    golDecisivo: z.number().default(0),
  }),
  malus: z.object({
    golSubito: z.number(),
    ammonizione: z.number(),
    espulsione: z.number(),
    autogol: z.number(),
    rigoreSbagliato: z.number(),
  }),
  modificatoreDifesa: z.object({
    attivo: z.boolean(),
    minDifensori: z.number().int().min(3).max(5),
    soglie: z.array(z.object({ daMedia: z.number(), bonus: z.number() })),
  }),
  golSquadra: z.object({ soglia: z.number(), passo: z.number() }),
  formazione: z.object({
    moduli: z.array(moduleSchema).min(1),
    panchina: z.number().int().min(0).max(20),
    maxSostituzioni: z.number().int().min(0).max(11),
    regolaSostituzioni: z.enum(["ruolo_per_ruolo", "panchina_libera"]),
    senzaVoto: z.enum(["zero", "voto_ufficio"]),
    votoUfficio: z.number().default(0),
  }),
  rosa: perRole,
  regoleSpecifiche: z.string().max(2000).default(""),
});
export type LeagueConfig = z.infer<typeof leagueConfigSchema>;

function classicModule(name: string): ModuleDef {
  const [d, c, a] = name.split("-").map(Number);
  return {
    name,
    slots: [["P"], ...Array(d).fill(["D"]), ...Array(c).fill(["C"]), ...Array(a).fill(["A"])],
  };
}

export const CLASSIC_MODULES = ["3-4-3", "3-5-2", "4-3-3", "4-4-2", "4-5-1", "5-3-2", "5-4-1"];

/**
 * Configurazione iniziale PROVVISORIA: valori diffusi nelle leghe Classic,
 * da verificare con il regolamento effettivo della tua lega.
 */
export const DEFAULT_CONFIG: LeagueConfig = {
  mode: "classic",
  nomeLega: "",
  bonus: {
    gol: { P: 3, D: 3, C: 3, A: 3 },
    assist: 1,
    rigoreSegnato: 3,
    rigoreParato: 3,
    portaInviolata: 1,
    golDecisivo: 0,
  },
  malus: { golSubito: 1, ammonizione: 0.5, espulsione: 1, autogol: 2, rigoreSbagliato: 3 },
  modificatoreDifesa: {
    attivo: false,
    minDifensori: 4,
    soglie: [
      { daMedia: 6, bonus: 1 },
      { daMedia: 6.5, bonus: 3 },
      { daMedia: 7, bonus: 6 },
    ],
  },
  golSquadra: { soglia: 66, passo: 6 },
  formazione: {
    moduli: CLASSIC_MODULES.map(classicModule),
    panchina: 7,
    maxSostituzioni: 3,
    regolaSostituzioni: "ruolo_per_ruolo",
    senzaVoto: "zero",
    votoUfficio: 0,
  },
  rosa: { P: 3, D: 8, C: 8, A: 6 },
  regoleSpecifiche: "",
};

/**
 * Moduli Mantra di partenza, PROVVISORI e semplificati: verifica gli slot con il
 * regolamento Mantra ufficiale adottato dalla tua lega e correggili nelle impostazioni.
 */
export const MANTRA_MODULES_PROVVISORI: ModuleDef[] = [
  { name: "3-4-3", slots: [["Por"], ["Dc"], ["Dc"], ["Dc"], ["E"], ["M", "C"], ["C"], ["E"], ["W", "A"], ["A", "Pc"], ["W", "A"]] },
  { name: "4-3-3", slots: [["Por"], ["Dd"], ["Dc"], ["Dc"], ["Ds"], ["M", "C"], ["M"], ["C"], ["W", "A"], ["A", "Pc"], ["W", "A"]] },
  { name: "4-4-2", slots: [["Por"], ["Dd"], ["Dc"], ["Dc"], ["Ds"], ["E", "W"], ["M", "C"], ["C"], ["E", "W"], ["A", "Pc"], ["A", "Pc"]] },
  { name: "3-5-2", slots: [["Por"], ["Dc"], ["Dc"], ["Dc"], ["E", "W"], ["M"], ["C"], ["C"], ["E", "W"], ["A", "Pc"], ["A", "Pc"]] },
];

export function moduleString(m: ModuleDef): string {
  return m.name;
}

/** Ruolo Classic equivalente di un ruolo Mantra (per statistiche e modello). */
export function mantraToClassic(r: string): RoleClassic {
  const k = r.trim().toLowerCase();
  if (k === "por") return "P";
  if (["dc", "dd", "ds", "b"].includes(k)) return "D";
  if (["e", "m", "c"].includes(k)) return "C";
  if (["t", "w"].includes(k)) return "C";
  return "A";
}

export function slotAccepts(slot: string[], roles: string[]): boolean {
  const s = slot.map((x) => x.toLowerCase());
  return roles.some((r) => s.includes(r.toLowerCase()));
}

export function parseConfig(raw: string | null | undefined): LeagueConfig {
  if (!raw) return DEFAULT_CONFIG;
  try {
    const parsed = leagueConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Ruoli ammessi per un giocatore in base alla modalità. */
export function playerRolesForMode(cfg: LeagueConfig, roleClassic: RoleClassic | null, rolesMantra: string | null): string[] {
  if (cfg.mode === "mantra") {
    const rm = (rolesMantra ?? "").split(/[;,/]/).map((s) => s.trim()).filter(Boolean);
    return rm.length ? rm : [];
  }
  return roleClassic ? [roleClassic] : [];
}

export { classicModule };
