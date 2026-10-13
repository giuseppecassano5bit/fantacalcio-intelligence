"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Search, Plus, BadgeCheck, CircleHelp } from "lucide-react";
import { addPlayerToRosterAction, replaceInRosterAction } from "@/app/actions/data";

interface Result {
  id: number;
  name: string;
  team: string | null;
  role: string | null;
  roleSource: string | null;
  status: string;
  verified: boolean;
  birth: string | null;
}

const ROLE_BG: Record<string, string> = { P: "bg-role-p", D: "bg-role-d", C: "bg-role-c", A: "bg-role-a" };

export function RosterSearch({ rosterIds, replaceId, placeholder = "Cerca un giocatore di Serie A (es. Barella)" }: { rosterIds: number[]; replaceId?: number; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [added, setAdded] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(q.trim())}`);
        const json = await res.json();
        setResults(json.results ?? []);
        setActive(-1);
      } finally {
        setLoading(false);
      }
    }, 180);
  }, [q]);

  // nomi simili nello stesso elenco: mostra più dettagli per distinguerli
  const surnames = results.map((r) => r.name.split(" ").slice(-1)[0].toLowerCase());
  const dup = (r: Result) => surnames.filter((s) => s === r.name.split(" ").slice(-1)[0].toLowerCase()).length > 1;

  function pick(r: Result) {
    const fd = new FormData();
    fd.set("playerId", String(r.id));
    if (replaceId) {
      fd.set("outId", String(replaceId));
      fd.set("inId", String(r.id));
    }
    start(async () => {
      if (replaceId) await replaceInRosterAction(fd);
      else await addPlayerToRosterAction(fd);
      setAdded(`${r.name} ${replaceId ? "inserito al posto del giocatore sostituito" : "aggiunto alla rosa"}.`);
      setQ("");
      setResults([]);
    });
  }

  return (
    <div className="relative">
      <label className="relative block">
        <span className="sr-only">{placeholder}</span>
        <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          className="input !pl-9"
          value={q}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="risultati-ricerca"
          aria-autocomplete="list"
          onChange={(e) => {
            setQ(e.target.value);
            setAdded(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && active >= 0 && results[active]) {
              e.preventDefault();
              if (!rosterIds.includes(results[active].id)) pick(results[active]);
            }
          }}
        />
      </label>
      {loading && <p className="mt-1 text-xs text-ink-3">Ricerca…</p>}
      {added && <p className="mt-2 text-sm text-ok" role="status">{added}</p>}
      {results.length > 0 && (
        <ul id="risultati-ricerca" role="listbox" className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-line bg-surface shadow-lg">
          {results.map((r, i) => {
            const inRoster = rosterIds.includes(r.id);
            return (
              <li key={r.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  disabled={inRoster || pending}
                  onClick={() => pick(r)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-60 ${i === active ? "bg-surface-2" : ""}`}
                >
                  <span className={`num inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white ${ROLE_BG[r.role ?? ""] ?? "bg-ink-3"}`}>{r.role ?? "?"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{r.name}</span>
                    <span className="block truncate text-xs text-ink-2">
                      {r.team ?? "squadra non indicata"}, {r.status.toLowerCase()}
                      {r.roleSource?.includes("stimato") ? ", ruolo stimato" : ""}
                      {dup(r) && r.birth ? `, nato il ${r.birth}` : ""}
                    </span>
                  </span>
                  {r.verified ? <BadgeCheck size={16} className="text-ok" aria-label="associato a una fonte" /> : <CircleHelp size={16} className="text-ink-3" aria-label="inserito manualmente" />}
                  {inRoster ? <span className="text-xs text-ink-3">già in rosa</span> : <Plus size={16} aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {q.trim().length >= 2 && !loading && results.length === 0 && <p className="mt-2 text-sm text-ink-2">Nessun giocatore trovato. Puoi inserirlo manualmente qui sotto.</p>}
    </div>
  );
}
