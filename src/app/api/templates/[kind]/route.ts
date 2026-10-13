import { NextResponse } from "next/server";
import { TEMPLATES } from "@/lib/importers/formats";

export async function GET(_req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const tpl = TEMPLATES[kind as keyof typeof TEMPLATES];
  if (!tpl) return NextResponse.json({ error: "Modello non trovato" }, { status: 404 });
  return new NextResponse(`﻿${tpl}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="modello-${kind}.csv"` },
  });
}
