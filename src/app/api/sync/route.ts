import { NextResponse } from "next/server";
import { getCurrentUser, getMode } from "@/lib/auth/session";
import { runSync, type SyncScope } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const lastManual = new Map<number, number>();

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Accesso richiesto" }, { status: 401 });
  if ((await getMode()) === "demo") return NextResponse.json({ error: "In modalità demo non vengono contattate fonti esterne." }, { status: 400 });
  // limitazione: un aggiornamento manuale ogni 60 secondi per utente
  const prev = lastManual.get(user.id) ?? 0;
  if (Date.now() - prev < 60_000) return NextResponse.json({ error: "Hai appena aggiornato: riprova tra un minuto." }, { status: 429 });
  lastManual.set(user.id, Date.now());
  const body = (await req.json().catch(() => ({}))) as { scope?: SyncScope };
  const scope: SyncScope = ["leggero", "completo", "risultati", "formazioni"].includes(body.scope ?? "") ? body.scope! : "completo";
  const report = await runSync({ trigger: "manuale", scope, reason: `Richiesta di ${user.username}`, force: true });
  return NextResponse.json(report);
}
