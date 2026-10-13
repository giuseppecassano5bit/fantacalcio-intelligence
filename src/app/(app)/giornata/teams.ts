import type { Db } from "@/lib/db";
import { all } from "@/lib/db";
import type { TeamRow } from "@/lib/repo/league";

export function getTeamsById(db: Db, ids: number[]): Map<number, TeamRow> {
  const uniq = Array.from(new Set(ids));
  if (uniq.length === 0) return new Map();
  const rows = all<TeamRow>(db, `SELECT * FROM teams WHERE id IN (${uniq.map(() => "?").join(",")})`, uniq);
  return new Map(rows.map((r) => [r.id, r]));
}
