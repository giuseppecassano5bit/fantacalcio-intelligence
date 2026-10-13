"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";

export interface FormPoint {
  matchday: number;
  fantavote: number | null;
  vote: number | null;
  played: boolean;
  bonus: boolean;
}

export function FormChart({ data, avg }: { data: FormPoint[]; avg: number | null }) {
  const rows = data.map((d) => ({ ...d, label: `G${d.matchday}`, value: d.fantavote ?? 0 }));
  return (
    <div className="h-48 w-full" role="img" aria-label="Fantavoti per giornata">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={{ fill: "var(--ink-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, "dataMax + 1"]} tick={{ fill: "var(--ink-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--ink)" }}
            formatter={(_v, _n, item) => {
              const p = item.payload as FormPoint;
              if (!p.played) return ["non ha giocato", "Esito"];
              if (p.fantavote == null) return ["senza voto", "Esito"];
              return [`${p.fantavote.toFixed(1)} (voto ${p.vote ?? "s.v."})`, "Fantavoto"];
            }}
          />
          {avg != null && <ReferenceLine y={avg} stroke="var(--ink-3)" strokeDasharray="4 4" />}
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {rows.map((r) => (
              <Cell key={r.matchday} fill={!r.played || r.fantavote == null ? "var(--line)" : r.bonus ? "var(--prato)" : "var(--ink-3)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
