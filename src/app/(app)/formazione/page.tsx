import Link from "next/link";
import { requireContext } from "@/lib/auth/session";
import { resolveMatchday } from "@/lib/analysis/context";
import { getRecommendation, getSavedLineup, diffSaved, scoreSaved } from "@/lib/analysis/recommend";
import { getRoster } from "@/lib/repo/players";
import { STRATEGY_HELP, STRATEGY_LABEL, type Strategy } from "@/lib/model/lineup";
import { formatDateTime } from "@/lib/domain/time";
import { saveLineupAction } from "@/app/actions/data";
import { Pitch } from "@/components/Pitch";
import { Empty, Notice, Section, RoleBadge, Prob, fmtPct, cx, MoreLink } from "@/components/ui";
import { oppLabel } from "@/components/PlayerItem";

export const metadata = { title: "Formazione consigliata" };

const STRATS: Strategy[] = ["equilibrata", "bonus", "sicurezza"];
const f1 = (x: number | null | undefined) => (x == null ? "n.d." : x.toFixed(1).replace(".", ","));

export default async function FormazionePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, db } = await requireContext();
  const sp = await searchParams;
  const md = resolveMatchday(db, sp.g);
  const strategy = (STRATS.includes(sp.strategia as Strategy) ? sp.strategia : "equilibrata") as Strategy;
  if (!md.matchday) return <Empty title="Calendario non disponibile">Premi “Aggiorna” per scaricare il calendario.</Empty>;
  if (getRoster(db, user.id).length === 0)
    return (
      <Empty title="Nessun giocatore in rosa" action={<Link className="btn btn-primary" href="/rosa">Inserisci la rosa</Link>}>
        La formazione viene costruita solo con i giocatori della tua rosa.
      </Empty>
    );

  const { analysis, rec } = getRecommendation(db, user.id, md.matchday, strategy);
  const saved = getSavedLineup(db, user.id, md.matchday);
  const diff = diffSaved(saved, rec?.result ?? null);
  const savedScore = saved ? scoreSaved(analysis, saved) : null;
  const evBy = new Map(analysis.evaluations.map((e) => [e.playerId, e]));
  const name = (id: number) => evBy.get(id)?.name ?? `#${id}`;
  const qs = (s: Strategy) => `?g=${md.matchday}&strategia=${s}`;

  if (!rec) {
    return (
      <Empty title="Impossibile costruire una formazione valida">
        Mancano giocatori per coprire almeno un modulo del regolamento (controlla i ruoli in rosa e i moduli ammessi nelle impostazioni).
      </Empty>
    );
  }
  const r = rec.result;
  const pitchPlayers = r.starters.map((s) => {
    const ev = evBy.get(s.playerId)!;
    return { id: s.playerId, name: ev.name, role: ev.role ?? "C", expected: ev.points.expectedPoints, pVote: ev.playing.pVote, warn: s.warnings.length > 0 };
  });
  const benchIds = r.bench.map((b) => b.playerId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Formazione consigliata, giornata {md.matchday}</h1>
          <p className="text-ink-2">Costruita solo con la tua rosa, rispettando il regolamento della lega. È una proposta: non sostituisce la tua formazione salvata.</p>
        </div>
      </div>

      <nav aria-label="Strategia" className="flex flex-wrap gap-2">
        {STRATS.map((s) => (
          <Link key={s} href={qs(s)} aria-current={s === strategy ? "page" : undefined} className={cx("btn", s === strategy ? "btn-primary" : "btn-ghost")}>
            {STRATEGY_LABEL[s]}
          </Link>
        ))}
      </nav>
      <p className="-mt-3 text-sm text-ink-2">{STRATEGY_HELP[strategy]}</p>

      {analysis.provisional && <Notice tone="warn">Calcolo basato sul regolamento provvisorio: <Link className="font-semibold underline" href="/impostazioni">imposta quello della tua lega</Link>.</Notice>}
      {analysis.evaluations.filter((e) => e.playing.insufficient || e.reliability.level === "bassa").length >= analysis.evaluations.length * 0.4 && (
        <Notice tone="warn">
          Per molti giocatori mancano titolarità e statistiche: questa proposta è poco affidabile e va presa come indicativa. Per migliorarla importa i file di Fantacalcio.it (statistiche e voti) o le probabili formazioni da{" "}
          <Link className="font-semibold underline" href="/fonti#importa">Fonti e aggiornamenti</Link>, oppure configura una chiave gratuita di football-data.org.
        </Notice>
      )}
      {sp.salvata && <Notice tone="info">Formazione salvata. Se la raccomandazione cambierà con nuove notizie, verrai avvisato senza modifiche automatiche.</Notice>}
      {r.warnings.map((w, i) => (
        <Notice key={i} tone="bad">{w}</Notice>
      ))}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="space-y-4">
          <Pitch players={pitchPlayers} module={r.module} />
          <div className="grid grid-cols-3 gap-3 rounded-xl border border-line bg-surface p-4 text-center">
            <div>
              <div className="num text-2xl font-bold">{r.module}</div>
              <div className="text-xs text-ink-2">modulo</div>
            </div>
            <div>
              <div className="num text-2xl font-bold">{f1(r.metrics.mean)}</div>
              <div className="text-xs text-ink-2">punti attesi</div>
            </div>
            <div>
              <div className="num text-2xl font-bold">{r.metrics.expectedTeamGoals.toFixed(2).replace(".", ",")}</div>
              <div className="text-xs text-ink-2">gol fanta attesi</div>
            </div>
            <div className="col-span-3 border-t border-line pt-2 text-xs text-ink-2">
              Scenario prudente (10%) <span className="num font-semibold">{r.metrics.p10.toFixed(0)}</span>, mediano <span className="num font-semibold">{r.metrics.p50.toFixed(0)}</span>, favorevole (90%){" "}
              <span className="num font-semibold">{r.metrics.p90.toFixed(0)}</span>. Tutti gli slot coperti da un voto: <span className="num font-semibold">{fmtPct(r.metrics.pAllCovered, "alta")}</span>.
            </div>
          </div>
          <form action={saveLineupAction} className="rounded-xl border border-line bg-surface p-4">
            <input type="hidden" name="matchday" value={md.matchday} />
            <input type="hidden" name="module" value={r.module} />
            <input type="hidden" name="starters" value={JSON.stringify(r.starters.map((s) => s.playerId))} />
            <input type="hidden" name="bench" value={JSON.stringify(benchIds)} />
            <input type="hidden" name="strategy" value={strategy} />
            <input type="hidden" name="recommendationId" value={rec.id} />
            <input type="hidden" name="expectedPoints" value={r.metrics.mean} />
            {saved ? (
              <p className="mb-3 text-sm text-ink-2">
                Hai salvato una formazione il {formatDateTime(saved.saved_at)} ({saved.module}
                {savedScore ? `, ${f1(savedScore.mean)} punti attesi con i dati di oggi` : ""}).
                {diff && !diff.identical && (
                  <span className="mt-1 block text-warn">
                    Diversa dalla consigliata: entrerebbero {diff.toAdd.map(name).join(", ") || "nessuno"}; uscirebbero {diff.toRemove.map(name).join(", ") || "nessuno"}
                    {diff.benchOrderChanged ? "; ordine della panchina diverso" : ""}.
                  </span>
                )}
              </p>
            ) : (
              <p className="mb-3 text-sm text-ink-2">Salva questa formazione per tenerne traccia nello storico e confrontarla con i risultati reali.</p>
            )}
            <button className="btn btn-primary">{saved ? "Sostituisci la formazione salvata" : "Salva questa formazione"}</button>
          </form>
        </div>

        <div className="space-y-6">
          <Section title="Perché li schiero">
            <ul className="divide-y divide-line">
              {r.starters.map((s) => {
                const ev = evBy.get(s.playerId)!;
                return (
                  <li key={s.playerId} className="py-3">
                    <details>
                      <summary className="flex items-center gap-3">
                        <RoleBadge role={ev.role} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{ev.name}</span>
                          <span className="block truncate text-xs text-ink-2">{oppLabel(ev)}</span>
                        </span>
                        <span className="text-right text-sm">
                          <span className="num block font-semibold">{f1(ev.points.expectedPoints)}</span>
                          <span className="text-xs text-ink-3">bonus <Prob est={ev.probs.anyBonus} level={ev.reliability.level} showRange={false} /></span>
                        </span>
                      </summary>
                      <ul className="ml-10 mt-2 list-disc space-y-0.5 pl-4 text-sm text-ink-2">
                        {s.reasons.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                        {s.warnings.map((x, i) => (
                          <li key={`w${i}`} className="text-warn">{x}</li>
                        ))}
                      </ul>
                      <div className="ml-10 mt-1">
                        <MoreLink href={`/giocatore/${ev.playerId}?g=${md.matchday}`}>Scheda</MoreLink>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title="Panchina, in ordine di utilizzo">
            <ol className="divide-y divide-line">
              {r.bench.map((b, i) => {
                const ev = evBy.get(b.playerId)!;
                return (
                  <li key={b.playerId} className="py-2.5">
                    <details>
                      <summary className="flex items-center gap-3">
                        <span className="num w-5 text-right text-ink-3">{i + 1}</span>
                        <RoleBadge role={ev.role} size="sm" />
                        <span className="min-w-0 flex-1 truncate font-semibold">{ev.name}</span>
                        <span className="num text-sm">{fmtPct(ev.playing.pVote, ev.reliability.level)} a voto</span>
                      </summary>
                      <ul className="ml-14 mt-1 list-disc pl-4 text-sm text-ink-2">
                        {b.reasons.map((x, k) => (
                          <li key={k}>{x}</li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ol>
            {r.excluded.length > 0 && (
              <p className="mt-3 text-sm text-ink-2">
                Fuori lista: {r.excluded.map((e) => name(e.playerId)).join(", ")}. Regola: {analysis.config.formazione.regolaSostituzioni === "ruolo_per_ruolo" ? "sostituzioni ruolo per ruolo" : "panchina libera"}, massimo {analysis.config.formazione.maxSostituzioni} cambi.
              </p>
            )}
          </Section>

          <Section title="Rischi e alternative">
            {r.risks.length ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-warn">
                {r.risks.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">Nessun rischio rilevante individuato.</p>
            )}
            {r.ballottaggi.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1 font-semibold">Ballottaggi aperti</h3>
                <ul className="space-y-1 text-sm">
                  {r.ballottaggi.map((b) => (
                    <li key={`${b.starterId}-${b.alternativeId}`}>
                      {name(b.starterId)} o {name(b.alternativeId)}: differenza di {Math.abs(b.delta).toFixed(2).replace(".", ",")} punti.{" "}
                      <Link className="font-semibold text-prato underline" href={`/ballottaggi?g=${md.matchday}&p=${b.starterId}&p=${b.alternativeId}`}>
                        Confronta
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.secondBest && (
              <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
                <h3 className="font-semibold">Seconda migliore formazione: {r.secondBest.module}</h3>
                <p className="text-ink-2">
                  Punti attesi {f1(r.secondBest.mean)} ({(r.secondBest.mean - r.metrics.mean).toFixed(2).replace(".", ",")} rispetto alla consigliata).
                  {r.secondBest.in.length > 0 && ` Entrerebbero ${r.secondBest.in.map(name).join(", ")}, uscirebbero ${r.secondBest.out.map(name).join(", ")}.`}
                </p>
              </div>
            )}
            <details className="mt-4 text-sm">
              <summary className="font-semibold text-prato">Moduli valutati</summary>
              <ul className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
                {r.modulesTried.map((m) => (
                  <li key={m.module} className="num">
                    {m.module}: {m.feasible ? f1(m.mean) : "non schierabile"}
                  </li>
                ))}
              </ul>
            </details>
          </Section>
          <p className="text-xs text-ink-3">
            Calcolata il {formatDateTime(rec.computedAt)} con {analysis.sim.n.toLocaleString("it-IT")} simulazioni della giornata. Le probabilità sono stime, non certezze.
          </p>
        </div>
      </div>
    </div>
  );
}
