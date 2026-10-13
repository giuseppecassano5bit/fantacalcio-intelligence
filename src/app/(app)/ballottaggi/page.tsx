import { requireContext } from "@/lib/auth/session";
import { resolveMatchday } from "@/lib/analysis/context";
import { compareForUser } from "@/lib/analysis/recommend";
import { getRoster } from "@/lib/repo/players";
import { STRATEGY_LABEL, type Strategy } from "@/lib/model/lineup";
import { Empty, Section, RoleBadge, Prob, fmtPct, ReliabilityTag, StatusTag, cx } from "@/components/ui";
import { oppLabel } from "@/components/PlayerItem";
import { ROLES } from "@/lib/domain/settings";
import type { PlayerEvaluation } from "@/lib/model/evaluate";

export const metadata = { title: "Ballottaggi" };

const f1 = (x: number | null | undefined) => (x == null ? "n.d." : x.toFixed(1).replace(".", ","));
const f2 = (x: number | null | undefined) => (x == null ? "n.d." : x.toFixed(2).replace(".", ","));

export default async function BallottaggiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, db } = await requireContext();
  const sp = await searchParams;
  const md = resolveMatchday(db, sp.g);
  if (!md.matchday) return <Empty title="Calendario non disponibile">Premi “Aggiorna” per scaricare il calendario.</Empty>;
  const roster = getRoster(db, user.id);
  const role = typeof sp.ruolo === "string" && ROLES.includes(sp.ruolo as never) ? sp.ruolo : "";
  const selected = (Array.isArray(sp.p) ? sp.p : sp.p ? [sp.p] : []).map(Number).filter(Boolean);
  const strategy = (["equilibrata", "bonus", "sicurezza"].includes(String(sp.strategia)) ? sp.strategia : "equilibrata") as Strategy;
  const pool = roster.filter((p) => !role || p.role_classic === role);
  const cmp = selected.length >= 2 ? compareForUser(db, user.id, md.matchday, selected, strategy) : null;
  const evs = cmp ? cmp.result.rows.map((r) => cmp.cands.find((c) => c.playerId === r.playerId)!.ev) : [];
  const rowBy = new Map(cmp?.result.rows.map((r) => [r.playerId, r]) ?? []);

  const lines: { label: string; get: (e: PlayerEvaluation) => React.ReactNode }[] = [
    { label: "Stato", get: (e) => <StatusTag status={e.playing.availability === "dubbio" ? "dubbio" : e.playing.availability} label={e.playing.availabilityLabel} /> },
    { label: "Partita", get: (e) => oppLabel(e) },
    { label: "Titolarità stimata", get: (e) => (e.playing.insufficient ? <span className="text-ink-3">sconosciuta</span> : fmtPct(e.playing.pStart, e.reliability.level)) },
    { label: "Minuti attesi", get: (e) => <span className="num">{Math.round(e.playing.expectedMinutes)}</span> },
    { label: "Forma, ultime 5 (fantamedia)", get: (e) => (e.rates?.form5?.avgFantavote != null ? <span className="num">{f2(e.rates.form5.avgFantavote)} in {e.rates.form5.played} gare</span> : <span className="text-ink-3">n.d.</span>) },
    { label: "Forma, ultime 10 (fantamedia)", get: (e) => (e.rates?.form10?.avgFantavote != null ? <span className="num">{f2(e.rates.form10.avgFantavote)} in {e.rates.form10.played} gare</span> : <span className="text-ink-3">n.d.</span>) },
    { label: "Gol attesi della squadra", get: (e) => (e.match ? <span className="num">{f1(e.match.expectation.teamGoals)} (media {f1(e.match.expectation.teamSeasonAvg)})</span> : "n.d.") },
    { label: "Probabilità di gol", get: (e) => <Prob est={e.probs.goal} level={e.reliability.level} /> },
    { label: "Probabilità di assist", get: (e) => <Prob est={e.probs.assist} level={e.reliability.level} /> },
    { label: "Rischio ammonizione", get: (e) => <Prob est={e.probs.yellow} level={e.reliability.level} /> },
    { label: "Rischio senza voto", get: (e) => <span className="num">{fmtPct(e.probs.noVote, e.reliability.level)}</span> },
    { label: "Punti attesi", get: (e) => <span className="num font-semibold">{f1(e.points.expectedPoints)}</span> },
    { label: "Scenario favorevole / prudente", get: (e) => <span className="num">{f1(rowBy.get(e.playerId)?.upside)} / {f1(rowBy.get(e.playerId)?.downside)}</span> },
    { label: "Fonti specializzate", get: (e) => (e.consensus.available ? <span>{e.consensus.summary}</span> : <span className="text-ink-3">nessun parere</span>) },
    { label: "Affidabilità", get: (e) => <ReliabilityTag level={e.reliability.level} /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Ballottaggi</h1>
        <p className="text-ink-2">Scegli due o più giocatori della tua rosa e confrontali sulla giornata {md.matchday}.</p>
      </div>
      <form className="space-y-3 rounded-xl border border-line bg-surface p-4" method="get">
        <input type="hidden" name="g" value={md.matchday} />
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Ruolo</span>
            <select name="ruolo" defaultValue={role} className="input">
              <option value="">Tutti</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Strategia</span>
            <select name="strategia" defaultValue={strategy} className="input">
              {(["equilibrata", "bonus", "sicurezza"] as Strategy[]).map((s) => (
                <option key={s} value={s}>{STRATEGY_LABEL[s]}</option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Giocatori da confrontare</legend>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {pool.map((p) => (
              <label key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
                <input type="checkbox" name="p" value={p.id} defaultChecked={selected.includes(p.id)} />
                <span className="sr-only">{p.role_classic}</span>
                <RoleBadge role={p.role_classic} size="sm" />
                <span className="truncate">{p.full_name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="btn btn-primary">Confronta</button>
      </form>

      {selected.length === 1 && <p className="text-sm text-warn">Seleziona almeno due giocatori.</p>}
      {cmp && (
        <>
          <Section title="Verdetto">
            <div className="space-y-2 text-sm">
              <p className="font-display text-xl font-semibold">
                Prima scelta: {evs[0]?.name}
                {cmp.result.second && <span className="font-normal text-ink-2">, poi {cmp.cands.find((c) => c.playerId === cmp.result.second)?.name}</span>}
              </p>
              {cmp.result.explanation.map((x, i) => (
                <p key={i}>{x}</p>
              ))}
              {cmp.result.whatCouldChange.length > 0 && (
                <div className="rounded-lg bg-surface-2 p-3">
                  <h3 className="font-semibold">Cosa potrebbe cambiare la decisione</h3>
                  <ul className="mt-1 list-disc pl-5">
                    {cmp.result.whatCouldChange.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Section>
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[560px] border-separate border-spacing-0 rounded-xl border border-line bg-surface text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-surface p-3 text-left text-xs text-ink-2">Criterio</th>
                  {evs.map((e, i) => (
                    <th key={e.playerId} className={cx("p-3 text-left", i === 0 && "bg-prato-tint")}>
                      <div className="flex items-center gap-2">
                        <RoleBadge role={e.role} size="sm" />
                        <span>{e.name}</span>
                      </div>
                      <div className="text-xs font-normal text-ink-2">{i === 0 ? "Prima scelta" : i === 1 ? "Seconda scelta" : `${i + 1}ª scelta`}{cmp.result.riskyAlternative === e.playerId ? ", alternativa rischiosa" : ""}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.label}>
                    <th scope="row" className="sticky left-0 border-t border-line bg-surface p-3 text-left text-xs font-semibold text-ink-2">
                      {l.label}
                    </th>
                    {evs.map((e, i) => (
                      <td key={e.playerId} className={cx("border-t border-line p-3", i === 0 && "bg-prato-tint/50")}>
                        {l.get(e)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
