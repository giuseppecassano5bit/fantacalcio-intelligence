import { NextResponse } from "next/server";
import { getCurrentUser, getMode } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { searchPlayers, STATUS_LABEL } from "@/lib/repo/players";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Accesso richiesto" }, { status: 401 });
  const db = getDb(await getMode());
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const rows = searchPlayers(db, q.slice(0, 60), 12).map((p) => ({
    id: p.id,
    name: p.full_name,
    team: p.team_name,
    role: p.role_classic,
    roleSource: p.role_classic_source,
    status: STATUS_LABEL[p.status],
    verified: p.official_verified === 1,
    birth: p.birth_date,
  }));
  return NextResponse.json({ results: rows });
}
