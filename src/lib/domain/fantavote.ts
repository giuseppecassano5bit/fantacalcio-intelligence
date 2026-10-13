import type { LeagueConfig, RoleClassic } from "./settings";

export interface VoteLine {
  vote: number | null;
  goals: number; // gol su azione (i rigori segnati sono in penScored)
  penScored: number;
  penMissed: number;
  penSaved: number;
  assists: number;
  yellow: number;
  red: number;
  ownGoals: number;
  goalsConceded: number;
}

/** Fantavoto secondo il regolamento della lega. */
export function fantavote(line: VoteLine, role: RoleClassic, cfg: LeagueConfig): number | null {
  if (line.vote == null) return null;
  const b = cfg.bonus;
  const m = cfg.malus;
  const actionGoals = line.goals;
  let fv = line.vote;
  fv += actionGoals * b.gol[role] + line.penScored * b.rigoreSegnato + line.assists * b.assist + line.penSaved * b.rigoreParato;
  fv -= line.yellow * m.ammonizione + line.red * m.espulsione + line.ownGoals * m.autogol + line.penMissed * m.rigoreSbagliato;
  if (role === "P") {
    fv -= line.goalsConceded * m.golSubito;
    if (line.goalsConceded === 0) fv += b.portaInviolata;
  }
  return Math.round(fv * 100) / 100;
}
