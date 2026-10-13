"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle2, AlertTriangle, XCircle, Plus } from "lucide-react";

interface Cand { id: number; name: string; team: string | null; role: string | null; score: number }
interface Row {
  line: number;
  name: string;
  team: string | null;
  role: string | null;
  status: "riconosciuto" | "ambiguo" | "non_trovato" | "errore" | "nuovo";
  playerId: number | null;
  matchedName?: string;
  matchedTeam?: string | null;
  candidates: Cand[];
  message?: string;
}
interface Preview {
  batchId: string;
  kind: string;
  fileName: string;
  rows: Row[];
  summary: { total: number; riconosciuti: number; ambigui: number; nonTrovati: number; errori: number; nuovi: number };
  notes: string[];
  matchday?: number | null;
}
type Choice = { action: "usa" | "crea" | "salta"; playerId?: number | null; role?: string | null };

const KIND_LABEL: Record<string, string> = {
  rosa: "La mia rosa",
  listone: "Listone / quotazioni Fantacalcio.it",
  statistiche: "Statistiche stagionali",
  voti: "Voti di una giornata",
  probabili: "Probabili formazioni",
  infortuni: "Infortuni e squalifiche",
  pareri: "Pareri delle fonti",
  squadre_avanzate: "Dati avanzati di squadra",
};

export function ImportWizard({
  mode,
  kinds,
  matchdays,
  defaultMatchday,
  seasons,
}: {
  mode: "testo" | "file";
  kinds: string[];
  matchdays?: number[];
  defaultMatchday?: number | null;
  seasons?: string[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState(kinds[0] ?? "auto");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [matchday, setMatchday] = useState<number | null>(defaultMatchday ?? null);
  const [season, setSeason] = useState(seasons?.[0] ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const needsMatchday = ["voti", "probabili", "pareri"].includes(kind) || ["voti", "probabili"].includes(preview?.kind ?? "");

  async function analyze() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const fd = new FormData();
      if (mode === "file" && file) fd.set("file", file);
      else fd.set("text", text);
      fd.set("kind", kind);
      if (matchday) fd.set("matchday", String(matchday));
      if (season) fd.set("season", season);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Errore");
      setPreview(json);
      const init: Record<number, Choice> = {};
      for (const r of json.rows as Row[]) {
        if (r.status === "riconosciuto") init[r.line] = { action: "usa", playerId: r.playerId };
        else if (r.status === "nuovo") init[r.line] = { action: "crea", role: r.role };
        else init[r.line] = { action: "salta" };
      }
      setChoices(init);
      if (json.matchday) setMatchday(json.matchday);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const resolutions = Object.entries(choices).map(([line, c]) => ({ line: Number(line), action: c.action, playerId: c.playerId ?? null, role: c.role ?? null }));
      const res = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: preview.batchId, resolutions, matchday, season: season || undefined }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Errore");
      setDone(`Importazione completata: ${json.applicati} righe applicate, ${json.creati} giocatori creati, ${json.saltati} saltate.${json.errori?.length ? ` Errori: ${json.errori.slice(0, 5).join("; ")}` : ""}`);
      setPreview(null);
      setText("");
      setFile(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (line: number, c: Choice) => setChoices((prev) => ({ ...prev, [line]: c }));

  return (
    <div className="space-y-3">
      {!preview && (
        <>
          <div className="flex flex-wrap gap-3">
            {kinds.length > 1 && (
              <label className="text-sm">
                <span className="mb-1 block font-semibold">Tipo di dati</span>
                <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {k === "auto" ? "Riconosci automaticamente" : KIND_LABEL[k] ?? k}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(needsMatchday || kind === "auto") && matchdays && matchdays.length > 0 && (
              <label className="text-sm">
                <span className="mb-1 block font-semibold">Giornata</span>
                <select className="input" value={matchday ?? ""} onChange={(e) => setMatchday(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">dal file</option>
                  {matchdays.map((m) => (
                    <option key={m} value={m}>
                      Giornata {m}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {seasons && seasons.length > 1 && (kind === "statistiche" || kind === "auto") && (
              <label className="text-sm">
                <span className="mb-1 block font-semibold">Stagione dei dati</span>
                <select className="input" value={season} onChange={(e) => setSeason(e.target.value)}>
                  {seasons.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("-", "/")}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {mode === "testo" ? (
            <label className="block text-sm">
              <span className="mb-1 block font-semibold">Incolla i nomi, uno per riga o separati da virgola</span>
              <textarea className="input min-h-32 font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={"Maignan\nBastoni\nBarella\n..."} />
            </label>
          ) : (
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line bg-surface-2 px-4 py-4 text-sm">
              <Upload size={18} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file ? file.name : "Scegli un file .csv o .xlsx (max 5 MB)"}</span>
              <input type="file" accept=".csv,.txt,.tsv,.xlsx" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
          <button type="button" className="btn btn-primary" onClick={analyze} disabled={busy || (mode === "testo" ? !text.trim() : !file)}>
            {busy ? "Analisi…" : "Mostra anteprima"}
          </button>
        </>
      )}

      {error && (
        <p className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="rounded-lg bg-ok-tint px-3 py-2 text-sm text-ok" role="status">
          {done}
        </p>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <strong>{KIND_LABEL[preview.kind] ?? preview.kind}</strong>
            <span className="text-ok">{preview.summary.riconosciuti} riconosciuti</span>
            {preview.summary.nuovi > 0 && <span className="text-info">{preview.summary.nuovi} nuovi</span>}
            {preview.summary.ambigui > 0 && <span className="text-warn">{preview.summary.ambigui} ambigui</span>}
            {preview.summary.nonTrovati > 0 && <span className="text-warn">{preview.summary.nonTrovati} non trovati</span>}
            {preview.summary.errori > 0 && <span className="text-bad">{preview.summary.errori} errori</span>}
          </div>
          {preview.notes.map((n, i) => (
            <p key={i} className="text-xs text-ink-2">
              {n}
            </p>
          ))}
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-2">
                <tr>
                  <th className="px-3 py-2">Riga</th>
                  <th className="px-3 py-2">Nel file</th>
                  <th className="px-3 py-2">Esito</th>
                  <th className="px-3 py-2">Scelta</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const c = choices[r.line];
                  return (
                    <tr key={r.line} className="border-t border-line align-top">
                      <td className="num px-3 py-2 text-ink-3">{r.line}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold">{r.name}</div>
                        <div className="text-xs text-ink-3">{[r.role, r.team].filter(Boolean).join(", ")}</div>
                      </td>
                      <td className="px-3 py-2">
                        {r.status === "riconosciuto" && (
                          <span className="flex items-start gap-1 text-ok">
                            <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />
                            <span>
                              {r.matchedName} <span className="text-ink-3">({r.matchedTeam ?? "squadra n.d."})</span>
                            </span>
                          </span>
                        )}
                        {r.status === "nuovo" && (
                          <span className="flex items-center gap-1 text-info">
                            <Plus size={15} aria-hidden /> nuovo nel catalogo
                          </span>
                        )}
                        {(r.status === "ambiguo" || r.status === "non_trovato") && (
                          <span className="flex items-center gap-1 text-warn">
                            <AlertTriangle size={15} aria-hidden /> {r.status === "ambiguo" ? "ambiguo" : "non trovato"}
                          </span>
                        )}
                        {r.status === "errore" && (
                          <span className="flex items-center gap-1 text-bad">
                            <XCircle size={15} aria-hidden /> errore
                          </span>
                        )}
                        {r.message && <div className="text-xs text-ink-3">{r.message}</div>}
                      </td>
                      <td className="px-3 py-2">
                        {r.status !== "errore" && (
                          <select
                            className="input !py-1 text-sm"
                            value={c?.action === "usa" ? `usa:${c.playerId}` : c?.action === "crea" ? `crea:${c.role ?? ""}` : "salta"}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "salta") set(r.line, { action: "salta" });
                              else if (v.startsWith("usa:")) set(r.line, { action: "usa", playerId: Number(v.slice(4)) });
                              else set(r.line, { action: "crea", role: v.slice(5) || null });
                            }}
                          >
                            <option value="salta">Salta</option>
                            {r.playerId && <option value={`usa:${r.playerId}`}>Usa {r.matchedName}</option>}
                            {r.candidates
                              .filter((x) => x.id !== r.playerId)
                              .map((x) => (
                                <option key={x.id} value={`usa:${x.id}`}>
                                  Usa {x.name} ({x.team ?? "n.d."}, {x.role ?? "?"})
                                </option>
                              ))}
                            {["rosa", "listone", "statistiche", "voti"].includes(preview.kind) &&
                              (r.role ? (
                                <option value={`crea:${r.role}`}>Crea nuovo ({r.role})</option>
                              ) : (
                                ["P", "D", "C", "A"].map((ro) => (
                                  <option key={ro} value={`crea:${ro}`}>
                                    Crea nuovo come {ro}
                                  </option>
                                ))
                              ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy || (["voti", "probabili"].includes(preview.kind) && !matchday)}>
              {busy ? "Salvataggio…" : "Conferma e salva"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPreview(null)}>
              Annulla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
