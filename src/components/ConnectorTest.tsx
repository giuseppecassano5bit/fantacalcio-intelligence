"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ConnectorTest({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="space-y-1">
      <button
        type="button"
        className="btn btn-ghost !py-1 text-xs"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await fetch("/api/connectors/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
            setRes(await r.json());
            router.refresh();
          } catch (e) {
            setRes({ ok: false, message: (e as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Verifica…" : "Verifica connessione"}
      </button>
      {res && <p className={`text-xs ${res.ok ? "text-ok" : "text-bad"}`} role="status">{res.message}</p>}
    </div>
  );
}
