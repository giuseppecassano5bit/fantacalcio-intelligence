import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { schedulerTick } from "@/lib/sync/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : new URL(req.url).searchParams.get("secret") ?? "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Da chiamare periodicamente (es. ogni 10-15 minuti) da uno scheduler esterno quando
 * l'app gira su piattaforme senza processi sempre attivi. Esegue un aggiornamento solo se serve.
 */
async function handle(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET non configurato" }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const { plan, report } = await schedulerTick("cron");
  return NextResponse.json({ plan, report: report ? { status: report.status, scope: report.scope, outcomes: report.outcomes.map((o) => ({ connector: o.connector, ok: o.ok, skipped: o.skipped, error: o.error })) } : null });
}

export const GET = handle;
export const POST = handle;
