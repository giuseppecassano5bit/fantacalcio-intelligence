import Link from "next/link";
import { requireContext } from "@/lib/auth/session";
import { all } from "@/lib/db";
import { resolveMatchday } from "@/lib/analysis/context";
import { recentChanges } from "@/lib/analysis/pipeline";
import { calibrationReport, computeMatchdayResult } from "@/lib/analysis/recommend";
import { SEASON_CODE } from "@/lib/repo/league";
import { getPlayers } from "@/lib/repo/players";
import { MIN_OBSERVATIONS, type BinaryMetrics } from "@/lib/model/calibration";
import { formatDateTime } from "@/lib/domain/time";
import { Section, Notice, Tag, fmtPct } from "@/components/ui";

export const metadata = { title: "Storico" };

const f2 = (x: number | null | undefined) => (x == null ? "n.d." : x.toFixed(3).replace(".", ","));
const f1 = (x: number | null | undefined) => (x == null ? "n.d." : x.toFixed(1).replace(".", ","));

function MetricRow({ label, m }: { label: string; m: BinaryMetrics }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-2 pr-3 text-left font-semibold">{label}</th>
      <td className="num px-2">{m.n}</td>
      <td className="num px-2">{f2(m.brier)}</td>
      <td className="num px-2">{f2(m.baselineBrier)}</td>
      <td className="num px-2">{m.skill == null ? "n.d." : `${m.skill >= 0 ? "+" : ""}${Math.round(m.skill * 100)}%`}</td>
      <td className="num px-2">{f2(m.logLoss)}</td>
      <td className="num px-2">{m.meanPredicted != null ? `${fmtPct(m.meanPredicted, "alta")} / ${fmtPct(m.observedRate ?? 0, "alta")}` : "n.d."}</td>
      <td className="px-2">{m.enough ? <Tag tone="ok">sufficiente</Tag> : <Tag tone="warn">insufficiente</Tag>}</td>
    </tr>
  );
}

export default async function StoricoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, db } = await requireContext();
  const sp = await searchParams;
  const md = resolveMatchday(db, sp.g);
  const saved = all<{ matchday: number; module: string; starters: string; bench: string; strategy: string | null; expected_points: number | null; saved_at: string }>(
    db,
    "SELECT matchday, module, starters, bench, strategy, expected_points, saved_at FROM saved_lineups WHERE user_id = ? AND season_code = ? ORDER BY matchday DESC",
    [user.id, SEASON_CODE],
  );
  for (const s of saved) if (md.matchday && s.matchday < md.matchday) computeMatchdayResult(db, user.id, s.matchday);
  const results = new Map(
    all<{ matchday: number; actual_points: number | null; expected_points: number | null; details: string | null }>(db, "SELECT matchday, actual_points, expected_points, details FROM matchday_results WHERE user_id = ? AND season_code = ?", [user.id, SEASON_CODE]).map((r) => [r.matchday, r]),
  );
  const recs = all<{ matchday: number; strategy: string; expected_points: number; computed_at: string }>(
    db,
    "SELECT matchday, strategy, expected_points, MAX(computed_at) AS computed_at FROM lineup_recommendations WHERE user_id = ? AND season_code = ? GROUP BY matchday, strategy ORDER BY matchday DESC",
    [user.id, SEASON_CODE],
  );
  const cal = calibrationReport(db, user.id);
  const changes = md.matchday ? recentChanges(db, user.id, md.matchday, { limit: 100 }) : [];
  const ids = Array.from(new Set(saved.flatMap((s) => [...JSON.parse(s.starters), ...JSON.parse(s.bench)] as number[])));
  const names = new Map(getPlayers(db, ids).map((p) => [p.id, p.full_name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Storico</h1>
        <p className="max-w-prose text-ink-2">Formazioni, previsioni e risultati reali di ogni giornata. Le previsioni vengono confrontate con i voti importati per misurare quanto sono affidabili.</p>
      </div>

      <Section title="Le tue giornate">
        {saved.length === 0 && recs.length === 0 ? (
          <p className="text-sm text-ink-2">
            Nessuna formazione salvata. Dalla pagina <Link className="font-semibold text-prato underline" href="/formazione">Formazione</Link> puoi salvare quella che schieri.
          </p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-ink-2">
                <tr>
                  <th className="py-2">Giornata</th>
                  <th className="px-2">Formazione salvata</th>
                  <th className="px-2">Punti previsti</th>
                  <th className="px-2">Punti reali</th>
                  <th className="px-2">Consigliata (equilibrata)</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set([...saved.map((s) => s.matchday), ...recs.map((r) => r.matchday)]))
                  .sort((a, b) => b - a)
                  .map((g) => {
                    const s = saved.find((x) => x.matchday === g);
                    const res = results.get(g);
                    const rec = recs.find((r) => r.matchday === g && r.strategy === "equilibrata");
                    return (
                      <tr key={g} className="border-t border-line align-top">
                        <td className="num py-2 font-semibold">{g}</td>
                        <td className="px-2">
                          {s ? (
                            <details>
                              <summary className="cursor-pointer">
                                {s.module}, salvata il {formatDateTime(s.saved_at)}
                              </summary>
                              <p className="mt-1 text-xs text-ink-2">Titolari: {(JSON.parse(s.starters) as number[]).map((id) => names.get(id) ?? id).join(", ")}</p>
                              <p className="text-xs text-ink-3">Panchina: {(JSON.parse(s.bench) as number[]).map((id) => names.get(id) ?? id).join(", ")}</p>
                            </details>
                          ) : (
                            <span className="text-ink-3">non salvata</span>
                          )}
                        </td>
                        <td className="num px-2">{f1(s?.expected_points)}</td>
                        <td className="num px-2">{res?.actual_points != null ? <strong>{f1(res.actual_points)}</strong> : <span className="font-sans text-ink-3">voti non importati</span>}</td>
                        <td className="num px-2">{rec ? f1(rec.expected_points) : "n.d."}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-3">I punti reali sono calcolati con i voti importati e le sostituzioni ruolo per ruolo (senza modificatore difesa).</p>
          </div>
        )}
      </Section>

      <Section title="Affidabilità delle previsioni">
        <Notice tone="info">
          Il modello non viene modificato automaticamente: queste metriche servono a capire se le probabilità sono calibrate. Ogni correzione futura dovrà essere validata su giornate non usate per stimarla e confrontata con la baseline. Servono almeno {MIN_OBSERVATIONS} osservazioni per un giudizio significativo.
        </Notice>
        <div className="-mx-4 mt-4 overflow-x-auto px-4">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-ink-2">
              <tr>
                <th className="py-2">Evento</th>
                <th className="px-2">Osservazioni</th>
                <th className="px-2">Brier score</th>
                <th className="px-2">Brier baseline</th>
                <th className="px-2">Miglioramento</th>
                <th className="px-2">Log loss</th>
                <th className="px-2">Previsto / osservato</th>
                <th className="px-2">Campione</th>
              </tr>
            </thead>
            <tbody>
              <MetricRow label="Prende voto" m={cal.voted} />
              <MetricRow label="Titolare" m={cal.start} />
              <MetricRow label="Gol" m={cal.goal} />
              <MetricRow label="Assist" m={cal.assist} />
              <MetricRow label="Ammonizione" m={cal.yellow} />
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-ink-2">
          Errore medio sui punti: <strong className="num">{f1(cal.pointsMae)}</strong> per giocatore (baseline per ruolo: <span className="num">{f1(cal.baselinePointsMae)}</span>) su {cal.pointsN} previsioni. Brier score più basso = meglio; il miglioramento è rispetto alla frequenza media per ruolo.
        </p>
        {cal.goal.bins.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="font-semibold text-prato">Calibrazione della probabilità di gol per fasce</summary>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {cal.goal.bins.map((b) => (
                <li key={b.from} className="num">
                  {Math.round(b.from * 100)}–{Math.round(b.to * 100)}%: previsto {fmtPct(b.predicted, "alta")}, osservato {fmtPct(b.observed, "alta")} su {b.n}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title={`Registro delle variazioni${md.matchday ? `, giornata ${md.matchday}` : ""}`}>
        {changes.length === 0 ? (
          <p className="text-sm text-ink-2">Nessuna variazione registrata per questa giornata.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {changes.map((c) => (
              <li key={c.id} className="py-2">
                <strong>{c.full_name}</strong>, {c.field.toLowerCase()}: <span className="num">{c.old_value}</span> → <span className="num font-semibold">{c.new_value}</span>
                {c.significant ? <Tag tone="warn">rilevante</Tag> : null}
                <span className="block text-xs text-ink-3">{c.reason}, {formatDateTime(c.changed_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
