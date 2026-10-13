import type { RoleClassic } from "@/lib/domain/settings";
import type { PlayerEvaluation } from "./evaluate";
import type { LeagueTable } from "./teamStrength";

/**
 * FANTAVALUE (0-100): indice sintetico di convenienza, diverso per ruolo.
 * NON è una probabilità: un valore alto indica una buona scelta nelle circostanze attuali,
 * non la certezza di un bonus. Le componenti restano sempre visibili.
 */
export const FANTAVALUE_WEIGHTS: Record<RoleClassic, Record<string, number>> = {
  A: { titolarita: 0.3, bonus: 0.3, malus: 0.08, voto: 0.1, partita: 0.12, affidabilita: 0.1 },
  C: { titolarita: 0.3, bonus: 0.25, malus: 0.1, voto: 0.15, partita: 0.1, affidabilita: 0.1 },
  D: { titolarita: 0.32, bonus: 0.15, malus: 0.13, voto: 0.18, partita: 0.12, affidabilita: 0.1 },
  P: { titolarita: 0.35, bonus: 0.1, malus: 0.1, voto: 0.15, partita: 0.2, affidabilita: 0.1 },
};

const BONUS_REF: Record<RoleClassic, number> = { A: 0.55, C: 0.4, D: 0.22, P: 0.4 };
const MALUS_REF: Record<RoleClassic, number> = { A: 0.6, C: 0.6, D: 0.6, P: 2.0 };

const c100 = (x: number) => Math.round(Math.min(100, Math.max(0, x)));

export function computeFantavalue(ev: PlayerEvaluation, table: LeagueTable): PlayerEvaluation["fantavalue"] {
  const role = ev.role;
  if (!role) return null;
  const w = FANTAVALUE_WEIGHTS[role];
  const pl = ev.playing;
  const titolarita = c100(100 * (0.7 * pl.pVote + 0.3 * Math.min(1, pl.expectedMinutes / 90)));
  const bonus = c100((100 * ev.probs.anyBonus.p) / BONUS_REF[role]);
  const malus = c100(100 * (1 - ev.points.expectedMalus / MALUS_REF[role]));
  const voto = c100(((ev.points.expectedVote - 5.5) / 1.0) * 100);
  let partita = 50;
  const ex = ev.match?.expectation;
  if (ex) {
    const att = 50 + 125 * (ex.attackFactor - 1);
    const def = 50 + 125 * (1 - ex.oppGoals / Math.max(0.5, table.avgGoals));
    partita = c100(role === "A" || role === "C" ? att : role === "D" ? 0.5 * att + 0.5 * def : def);
  }
  const affidabilita = c100(100 * ev.reliability.score);
  const components = { titolarita, bonus, malus, voto, partita, affidabilita };
  let index = Object.entries(components).reduce((s, [k, v]) => s + v * (w[k] ?? 0), 0);
  if (pl.pVote < 0.05) index = Math.min(index, 5);
  return { index: c100(index), components, weights: w };
}
