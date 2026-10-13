import type { Db } from "@/lib/db";
import { currentMatchday, listMatchdays, type MatchdayInfo } from "@/lib/repo/league";

export interface MatchdayChoice {
  matchday: number | null;
  info: MatchdayInfo | null;
  list: MatchdayInfo[];
  isCurrent: boolean;
}

/** Giornata selezionata (?g=N) oppure quella corrente. */
export function resolveMatchday(db: Db, g?: string | string[] | null): MatchdayChoice {
  const list = listMatchdays(db);
  const cur = currentMatchday(db);
  const raw = Array.isArray(g) ? g[0] : g;
  const wanted = raw ? Number(raw) : NaN;
  const info = Number.isFinite(wanted) ? list.find((m) => m.matchday === wanted) ?? cur : cur;
  return { matchday: info?.matchday ?? null, info: info ?? null, list, isCurrent: !!cur && info?.matchday === cur.matchday };
}
