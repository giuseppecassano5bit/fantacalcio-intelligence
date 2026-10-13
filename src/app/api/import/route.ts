import { NextResponse } from "next/server";
import { getCurrentUser, getMode } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { readTable, parseCsv } from "@/lib/importers/parse";
import { detectKind, type ImportKind, IMPORT_KIND_LABEL } from "@/lib/importers/formats";
import { buildPreview, applyImport, type Resolution } from "@/lib/importers/apply";

export const dynamic = "force-dynamic";
const MAX_BYTES = 5 * 1024 * 1024;

/** POST multipart: file (oppure testo) -> anteprima. POST JSON {batchId, resolutions} -> applica. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Accesso richiesto" }, { status: 401 });
  const db = getDb(await getMode());
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const body = (await req.json()) as { batchId: string; resolutions: Resolution[]; matchday?: number | null; season?: string };
      const res = applyImport(db, user.id, body.batchId, body.resolutions ?? [], { matchday: body.matchday ?? null, season: body.season, username: user.username });
      return NextResponse.json(res);
    }
    const form = await req.formData();
    const file = form.get("file");
    const text = form.get("text");
    let rows: string[][];
    let fileName = "testo incollato";
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) return NextResponse.json({ error: "File troppo grande (max 5 MB)." }, { status: 413 });
      fileName = file.name;
      rows = await readTable(file.name, await file.arrayBuffer());
    } else if (typeof text === "string" && text.trim()) {
      const t = text.trim();
      rows = t.includes(";") || t.includes("\t") || /\n.*,.*\n/.test(t) ? parseCsv(t) : t.split(/[\n,]+/).map((x) => [x.trim()]).filter((r) => r[0]);
      if (!rows.some((r) => /nome|giocatore/i.test(r.join(" ")))) rows = [["nome"], ...rows.map((r) => [r.join(" ").trim()])];
    } else {
      return NextResponse.json({ error: "Nessun file o testo ricevuto." }, { status: 400 });
    }
    const requested = String(form.get("kind") ?? "auto");
    const kind = (requested !== "auto" && requested in IMPORT_KIND_LABEL ? requested : detectKind(rows, fileName)) as ImportKind | null;
    if (!kind) return NextResponse.json({ error: "Formato non riconosciuto: scegli il tipo di file." }, { status: 400 });
    const md = form.get("matchday");
    const preview = buildPreview(db, user.id, kind, fileName, rows, { matchday: md ? Number(md) : null, season: String(form.get("season") || "") || undefined });
    return NextResponse.json(preview);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
