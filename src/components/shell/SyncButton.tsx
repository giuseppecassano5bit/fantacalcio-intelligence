"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, X } from "lucide-react";

interface Outcome {
  connector: string;
  ok: boolean;
  skipped?: string;
  items: Record<string, number>;
  messages: string[];
  error?: string;
  stale?: boolean;
}
interface Report {
  status: "ok" | "parziale" | "errore" | "saltata";
  outcomes: Outcome[];
  recomputed: { users: number; changes: number };
  message?: string;
  finishedAt: string;
}

const NAMES: Record<string, string> = {
  openfootball: "openfootball",
  thesportsdb: "TheSportsDB",
  "football-data": "football-data.org",
  "api-football": "API-Football",
  rss: "Notizie RSS",
  ricalcolo: "Ricalcolo",
};

export function SyncButton({ disabled, disabledReason }: { disabled?: boolean; disabledReason?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "completo" }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Errore ${res.status}`);
      setReport(json as Report);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button type="button" className="btn btn-primary" onClick={run} disabled={busy || disabled} title={disabled ? disabledReason : "Scarica subito calendario, risultati, notizie e dati disponibili"} aria-busy={busy}>
        <RefreshCw size={16} aria-hidden className={busy ? "animate-spin" : ""} />
        {busy ? "Aggiornamento…" : "Aggiorna"}
      </button>
      {(report || error) && (
        <div role="status" className="absolute right-0 z-40 mt-2 w-[min(92vw,380px)] rounded-xl border border-line bg-surface p-3 text-sm shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <strong className="font-display text-base">
              {error ? "Aggiornamento non riuscito" : report?.status === "ok" ? "Aggiornamento completato" : report?.status === "saltata" ? "Aggiornamento già in corso" : report?.status === "parziale" ? "Aggiornamento parziale" : "Aggiornamento non riuscito"}
            </strong>
            <button type="button" className="rounded p-1 text-ink-3 hover:text-ink" onClick={() => { setReport(null); setError(null); }} aria-label="Chiudi">
              <X size={16} />
            </button>
          </div>
          {error && <p className="text-bad">{error}</p>}
          {report?.message && <p className="text-ink-2">{report.message}</p>}
          <ul className="space-y-1.5">
            {report?.outcomes.map((o, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5">
                  {o.skipped ? <AlertTriangle size={15} className="text-ink-3" aria-label="saltato" /> : o.ok && !o.stale ? <CheckCircle2 size={15} className="text-ok" aria-label="riuscito" /> : o.ok ? <AlertTriangle size={15} className="text-warn" aria-label="dati in cache" /> : <XCircle size={15} className="text-bad" aria-label="errore" />}
                </span>
                <span className="min-w-0">
                  <span className="font-semibold">{NAMES[o.connector] ?? o.connector}</span>{" "}
                  <span className="text-ink-2">
                    {o.skipped
                      ? o.skipped
                      : o.error
                        ? o.error
                        : Object.entries(o.items)
                            .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
                            .join(", ") || "nessun dato nuovo"}
                    {o.stale ? " (fonte non raggiungibile: usati dati in cache)" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {report && report.recomputed.users > 0 && <p className="mt-2 text-ink-2">Valutazioni ricalcolate: {report.recomputed.changes} variazioni registrate.</p>}
        </div>
      )}
    </div>
  );
}
