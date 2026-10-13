import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getConnector } from "@/lib/connectors/registry";
import { markConnectorTest } from "@/lib/repo/sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Accesso richiesto" }, { status: 401 });
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const c = id ? getConnector(id) : undefined;
  if (!c) return NextResponse.json({ error: "Connettore sconosciuto" }, { status: 404 });
  const db = getDb("reale");
  const res = await c.test(db);
  markConnectorTest(db, c.id, res.ok, res.message);
  return NextResponse.json(res);
}
