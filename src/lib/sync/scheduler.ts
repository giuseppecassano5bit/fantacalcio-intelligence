import { getDb, getState, setState, all } from "@/lib/db";
import { SEASON_CODE } from "@/lib/repo/league";
import { apiFootball } from "@/lib/connectors/apiFootball";
import { getConnectorStatus } from "@/lib/repo/sync";
import { planSync, type PlanDecision } from "./planner";
import { runSync, type SyncReport } from "./engine";

export function currentPlan(now = Date.now()): PlanDecision {
  const db = getDb("reale");
  const matches = all<{ kickoff_utc: string | null; status: string }>(db, "SELECT kickoff_utc, status FROM matches WHERE season_code = ?", [SEASON_CODE]).map((m) => ({
    kickoff: m.kickoff_utc,
    status: m.status,
  }));
  const af = getConnectorStatus(db, apiFootball.id);
  return planSync(
    matches,
    {
      lastLeggero: getState(db, "last_leggero_at"),
      lastCompleto: getState(db, "last_completo_at"),
      lastRisultati: getState(db, "last_risultati_at"),
      lastFormazioni: getState(db, "last_formazioni_at"),
      officialLineupsAvailable: apiFootball.isConfigured() && af.enabled === 1,
    },
    now,
  );
}

/** Un "battito" del pianificatore: esegue l'aggiornamento solo se serve. */
export async function schedulerTick(trigger: "automatico" | "cron" = "automatico"): Promise<{ plan: PlanDecision; report: SyncReport | null }> {
  const plan = currentPlan();
  const db = getDb("reale");
  setState(db, "planner_last_tick", new Date().toISOString());
  setState(db, "planner_decision", JSON.stringify(plan));
  if (!plan.action) return { plan, report: null };
  const report = await runSync({ trigger, scope: plan.action, reason: plan.reason });
  const after = currentPlan();
  setState(db, "planner_decision", JSON.stringify(after));
  return { plan, report };
}

const g = globalThis as unknown as { __fiScheduler?: NodeJS.Timeout };

export function startScheduler() {
  if (g.__fiScheduler) return;
  if (process.env.SCHEDULER_ENABLED === "false") return;
  const minutes = Math.max(2, Number(process.env.SCHEDULER_INTERVAL_MINUTES ?? 5));
  const tick = () => schedulerTick().catch((e) => console.error("[scheduler]", e));
  setTimeout(tick, 15_000);
  g.__fiScheduler = setInterval(tick, minutes * 60_000);
  console.log(`[scheduler] attivo: controllo ogni ${minutes} minuti (gli aggiornamenti partono solo quando servono)`);
}

export function plannerInfo() {
  const db = getDb("reale");
  const raw = getState(db, "planner_decision");
  return {
    lastTick: getState(db, "planner_last_tick"),
    decision: raw ? (JSON.parse(raw) as PlanDecision) : null,
    enabled: process.env.SCHEDULER_ENABLED !== "false",
  };
}
