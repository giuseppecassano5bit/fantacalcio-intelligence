import { NextResponse } from "next/server";
import { getDb, one } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const n = one<{ n: number }>(getDb(), "SELECT COUNT(*) AS n FROM schema_migrations")?.n ?? 0;
    return NextResponse.json({ ok: true, migrations: n });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
