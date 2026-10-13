import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/session";
import { resolveMatchday } from "@/lib/analysis/context";
import { analyzeMatchday, persistEvaluations } from "@/lib/analysis/pipeline";
import { all } from "@/lib/db";
import { getPlayer, getRoster, playerExternalIds, playerTransfers, STATUS_LABEL } from "@/lib/repo/players";
import { availabilityHistory, CERTAINTY_LABEL, editorialFor, getMatchStats, getSeasonStats, LINEUP_STATUS_LABEL, lineupReportsForMatches, newsForPlayers, VERDICT_LABEL } from "@/lib/repo/data";
import { SEASON_CODE, listMatchesOfMatchday } from "@/lib/repo/league";
import { formatDateTime, formatKickoff, relativeTime } from "@/lib/domain/time";
import { FANTAVALUE_WEIGHTS } from "@/lib/model/fantavalue";
import { Section, RoleBadge, StatusTag, ReliabilityTag, Prob, fmtPct, Fantavalue, Notice, Tag, SourceKind, Empty } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { FormChart } from "@/components/FormChart";
import { addAvailabilityAction, addEditorialAction, addLineupReportAction, confirmRumorAction, deleteEditorialAction, deleteLineupReportAction, resolveAvailabilityAction, updatePlayerAction } from "@/app/actions/data";
import type { FormSummary } from "@/lib/model/playerRates";

const f1 = (x: number | null | undefined) => (x == null ? "n.d." : x.toFixed(1).replace(".", ","));
const f2 = (x: number | null | undefined) => (x == null ? "n.d." : x.toFixed(2).replace(".", ","));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Giocatore ${id}` };
}

function FormTable({ rows }: { rows: { label: string; f: FormSummary | null }[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="text-left text-xs text-ink-2">
          <tr>
            <th className="py-1.5 pr-2">Periodo</th>
            <th className="px-2">Presenze</th>
            <th className="px-2">Da titolare</th>
            <th className="px-2">Minuti</th>
            <th className="px-2">Gol</th>
            <th className="px-2">Assist</th>
            <th className="px-2">Media voto</th>
            <th className="px-2">Fantamedia</th>
            <th className="px-2">Con bonus</th>
            <th className="px-2">xG</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map(({ label, f }) => (
            <tr key={label} className="border-t border-line">
              <td className="py-1.5 pr-2 font-sans font-semibold">{label}</td>
              {f ? (
                <>
                  <td className="px-2">{f.played}/{f.games}</td>
                  <td className="px-2">{f.starts ?? "n.d."}</td>
                  <td className="px-2">{f.minutes ?? "n.d."}</td>
                  <td className="px-2">{f.goals}</td>
                  <td className="px-2">{f.assists}</td>
                  <td className="px-2">{f2(f.avgVote)}</td>
                  <td className="px-2">{f2(f.avgFantavote)}</td>
                  <td className="px-2">{f.bonusRate != null ? fmtPct(f.bonusRate) : "n.d."}</td>
                  <td className="px-2">{f.xg != null ? f2(f.xg) : "n.d."}</td>
                </>
              ) : (
                <td className="px-2 font-sans text-ink-3" colSpan={9}>Nessun dato partita per partita</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PlayerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, db } = await requireContext();
  const { id } = await params;
  const sp = await searchParams;
  const pid = Number(id);
  const player = getPlayer(db, pid);
  if (!player) notFound();
  const md = resolveMatchday(db, sp.g);
  const inRoster = getRoster(db, user.id).some((r) => r.id === pid);
  const analysis = md.matchday && inRoster ? analyzeMatchday(db, user.id, md.matchday) : null;
  if (analysis) persistEvaluations(db, user.id, analysis);
  const ev = analysis?.evaluations.find((e) => e.playerId === pid) ?? null;
  const seasonStats = getSeasonStats(db, pid);
  const matchStats = getMatchStats(db, pid);
  const avail = availabilityHistory(db, pid);
  const matches = md.matchday ? listMatchesOfMatchday(db, md.matchday) : [];
  const myMatch = matches.find((m) => m.home_team_id === player.current_team_id || m.away_team_id === player.current_team_id);
  const lineups = myMatch ? lineupReportsForMatches(db, [myMatch.id]).filter((l) => l.player_id === pid) : [];
  const editorial = editorialFor(db, user.id, [pid]);
  const news = newsForPlayers(db, [pid], 12);
  const ext = playerExternalIds(db, pid);
  const transfers = playerTransfers(db, pid);
  const changes = all<{ id: number; matchday: number; changed_at: string; field: string; old_value: string; new_value: string; reason: string }>(
    db,
    "SELECT id, matchday, changed_at, field, old_value, new_value, reason FROM evaluation_changes WHERE user_id = ? AND player_id = ? ORDER BY changed_at DESC LIMIT 20",
    [user.id, pid],
  );
  const history = all<{ matchday: number; computed_at: string; p_start: number | null; expected_points: number | null; fantavalue: number | null }>(
    db,
    "SELECT matchday, computed_at, p_start, expected_points, fantavalue FROM evaluations WHERE user_id = ? AND player_id = ? ORDER BY computed_at DESC LIMIT 12",
    [user.id, pid],
  );
  const lvl = ev?.reliability.level ?? "bassa";
  const r = ev?.rates;
  const teamMds = analysis ? (ev?.match ? [] : []) : [];
  void teamMds;
  const lines = [...matchStats].sort((a, b) => a.matchday - b.matchday);
  const chartData = lines.map((l) => ({ matchday: l.matchday, fantavote: l.fantavote, vote: l.vote, played: l.played === 1 || l.vote != null, bonus: l.goals + l.pen_scored + l.assists > 0 }));

  return (
    <div className="space-y-6">
      {/* intestazione */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <RoleBadge role={player.role_classic} />
          <div>
            <h1 className="font-display text-3xl font-bold leading-tight tracking-tight">{player.full_name}</h1>
            <p className="text-ink-2">
              {player.team_name ?? "Squadra non indicata"}
              {player.real_position ? `, ${player.real_position}` : ""}
              {player.roles_mantra ? `, Mantra ${player.roles_mantra}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusTag status={ev ? (ev.playing.availability === "dubbio" ? "dubbio" : ev.playing.availability) : player.status} label={ev?.playing.availabilityLabel ?? STATUS_LABEL[player.status]} />
              {ev && <ReliabilityTag level={lvl} />}
              {player.official_verified ? <Tag tone="ok">Associato a una fonte</Tag> : <Tag tone="warn">Inserito manualmente, da verificare</Tag>}
              {player.role_classic_source && <Tag>Ruolo: {player.role_classic_source}</Tag>}
            </div>
          </div>
        </div>
        {ev?.fantavalue && (
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-baseline gap-2">
              <span className="num text-4xl font-bold">{ev.fantavalue.index}</span>
              <span className="text-sm text-ink-2">Fantavalue G{md.matchday}</span>
            </div>
            <p className="max-w-56 text-xs text-ink-3">Indice di convenienza 0-100, pesato per il ruolo. Non è una probabilità.</p>
          </div>
        )}
      </div>

      {!inRoster && <Notice tone="info">Questo giocatore non è nella tua rosa: le valutazioni vengono calcolate solo per i giocatori in rosa.</Notice>}
      {ev?.issues.map((x, i) => <Notice key={i} tone="bad">{x}</Notice>)}

      {ev && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Titolarità e probabilità di voto">
              <dl className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <dd className="num text-2xl font-bold">{ev.playing.insufficient ? "n.d." : fmtPct(ev.playing.pStart, lvl)}</dd>
                  <dt className="text-xs text-ink-2">Titolare</dt>
                </div>
                <div>
                  <dd className="num text-2xl font-bold">{fmtPct(ev.playing.pSub, lvl)}</dd>
                  <dt className="text-xs text-ink-2">Entra dalla panchina</dt>
                </div>
                <div>
                  <dd className="num text-2xl font-bold">{fmtPct(ev.playing.pNone, lvl)}</dd>
                  <dt className="text-xs text-ink-2">Non gioca</dt>
                </div>
                <div>
                  <dd className="num text-xl font-bold">{Math.round(ev.playing.expectedMinutes)}&prime;</dd>
                  <dt className="text-xs text-ink-2">Minuti attesi</dt>
                </div>
                <div>
                  <dd className="num text-xl font-bold">{fmtPct(ev.playing.pVote, lvl)}</dd>
                  <dt className="text-xs text-ink-2">Prende voto</dt>
                </div>
                <div>
                  <dd className="num text-xl font-bold">{r?.form5?.minutes != null && r.form5.played ? Math.round(r.form5.minutes / r.form5.played) : "n.d."}</dd>
                  <dt className="text-xs text-ink-2">Minuti medi ultime 5</dt>
                </div>
              </dl>
              <div className="mt-4 space-y-2 text-sm">
                <p className="font-semibold">{ev.playing.official ? "Formazione ufficiale pubblicata" : ev.playing.preliminary ? "Previsione preliminare (partita lontana)" : "Previsione, non formazione ufficiale"}</p>
                <ul className="list-disc space-y-0.5 pl-5 text-ink-2">
                  {ev.playing.basis.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
                {ev.playing.warnings.map((w, i) => <p key={i} className="text-warn">{w}</p>)}
                {r && (r.form5?.starts != null || r.form10?.starts != null) && (
                  <p className="text-ink-2">Da titolare: {r.form5?.starts ?? "n.d."} nelle ultime 5, {r.form10?.starts ?? "n.d."} nelle ultime 10.</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {ev.playing.sources.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-xs">
                      <SourceKind kind={s.kind} />
                      {s.url ? <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}
                      {s.at && <span className="text-ink-3">{relativeTime(s.at)}</span>}
                    </span>
                  ))}
                </div>
              </div>
            </Section>

            <Section title="Contesto della partita">
              {ev.match ? (
                <div className="space-y-2 text-sm">
                  <p>
                    <strong>{ev.match.isHome ? "In casa" : "In trasferta"}</strong> contro <strong>{ev.match.oppName}</strong>, {formatKickoff(ev.match.kickoff, ev.match.kickoffKnown)}.
                  </p>
                  <p>
                    Gol attesi: <span className="num font-semibold">{f1(ev.match.expectation.teamGoals)}</span> per la sua squadra (media stagionale {f1(ev.match.expectation.teamSeasonAvg)}), <span className="num font-semibold">{f1(ev.match.expectation.oppGoals)}</span> per l&apos;avversario.
                  </p>
                  <div>
                    <div className="text-xs font-semibold text-ink-2">Difesa avversaria</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {ev.match.oppProfile.labels.length ? ev.match.oppProfile.labels.map((l) => <Tag key={l} tone="info">{l}</Tag>) : <span className="text-ink-3">Nessun tratto distintivo</span>}
                    </div>
                    <p className="mt-1 text-xs text-ink-3">
                      {ev.match.oppProfile.goalsAgainstPerGame != null && `Gol subiti a partita ${f2(ev.match.oppProfile.goalsAgainstPerGame)}. `}
                      {ev.match.oppProfile.xgaPerGame != null && `xGA a partita ${f2(ev.match.oppProfile.xgaPerGame)}. `}
                      {ev.match.oppProfile.shotsAgainstPerGame != null && `Tiri concessi a partita ${f1(ev.match.oppProfile.shotsAgainstPerGame)}. `}
                      {ev.match.oppProfile.note}
                    </p>
                  </div>
                  <p className="text-xs text-ink-3">Calcolo su {ev.match.expectation.basedOnGames.team} partite della sua squadra e {ev.match.expectation.basedOnGames.opp} dell&apos;avversario.</p>
                </div>
              ) : (
                <p className="text-sm text-ink-2">Nessuna partita in calendario per la sua squadra in questa giornata.</p>
              )}
            </Section>
          </div>

          <Section title="Probabilità di bonus e malus" aside={<span className="text-xs text-ink-3">Stime con intervallo 10-90%. * = campione ridotto</span>}>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-2 font-semibold text-ok">Bonus</h3>
                <dl className="space-y-1.5 text-sm">
                  {ev.role !== "P" && <div className="flex justify-between gap-3"><dt>Almeno un gol</dt><dd><Prob est={ev.probs.goal} level={lvl} /></dd></div>}
                  <div className="flex justify-between gap-3"><dt>Almeno un assist</dt><dd><Prob est={ev.probs.assist} level={lvl} /></dd></div>
                  {ev.role !== "P" && <div className="flex justify-between gap-3"><dt>Gol o assist</dt><dd><Prob est={ev.probs.goalOrAssist} level={lvl} /></dd></div>}
                  <div className="flex justify-between gap-3"><dt>Almeno un bonus del regolamento</dt><dd><Prob est={ev.probs.anyBonus} level={lvl} /></dd></div>
                  <div className="flex justify-between gap-3"><dt>Fantavoto di almeno 9</dt><dd><Prob est={ev.probs.bigGame} level={lvl} showRange={false} /></dd></div>
                  {ev.probs.gk && (
                    <>
                      <div className="flex justify-between gap-3"><dt>Porta inviolata</dt><dd><Prob est={ev.probs.gk.cleanSheet} level={lvl} /></dd></div>
                      <div className="flex justify-between gap-3"><dt>Rigore parato</dt><dd><Prob est={ev.probs.gk.penaltySave} level={lvl} /></dd></div>
                    </>
                  )}
                </dl>
              </div>
              <div>
                <h3 className="mb-2 font-semibold text-bad">Malus</h3>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3"><dt>Ammonizione</dt><dd><Prob est={ev.probs.yellow} level={lvl} /></dd></div>
                  <div className="flex justify-between gap-3"><dt>Espulsione</dt><dd><Prob est={ev.probs.red} level={lvl} /></dd></div>
                  <div className="flex justify-between gap-3"><dt>Autogol</dt><dd><Prob est={ev.probs.ownGoal} level="bassa" showRange={false} /></dd></div>
                  <div className="flex justify-between gap-3"><dt>Senza voto</dt><dd className="num font-semibold">{fmtPct(ev.probs.noVote, lvl)}</dd></div>
                  {ev.probs.gk && (
                    <>
                      <div className="flex justify-between gap-3"><dt>Gol subiti attesi</dt><dd className="num font-semibold">{f2(ev.probs.gk.expectedConceded)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>Due o più gol subiti</dt><dd className="num font-semibold">{fmtPct(ev.probs.gk.twoPlusConceded, lvl)}</dd></div>
                    </>
                  )}
                  <div className="rounded-lg bg-surface-2 p-2">
                    <div className="flex justify-between gap-3"><dt>Rigore sbagliato</dt><dd className="num font-semibold">{fmtPct(ev.probs.penaltyMiss.total, lvl)}</dd></div>
                    <p className="mt-1 text-xs text-ink-2">
                      = rigore assegnato alla squadra {fmtPct(ev.probs.penaltyMiss.teamAwarded)} × lui rigorista in campo {fmtPct(ev.probs.penaltyMiss.isTakerOnPitch)} × errore se calcia {fmtPct(ev.probs.penaltyMiss.missGivenTaken)}. {ev.probs.penaltyMiss.basis}.
                    </p>
                  </div>
                </dl>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-center sm:grid-cols-5">
              <div><div className="num text-xl font-bold">{f2(ev.points.expectedVote)}</div><div className="text-xs text-ink-2">voto medio atteso</div></div>
              <div><div className="num text-xl font-bold">{f1(ev.points.expectedFantavoteIfVote)}</div><div className="text-xs text-ink-2">fantavoto se a voto</div></div>
              <div><div className="num text-xl font-bold">{f1(ev.points.expectedPoints)}</div><div className="text-xs text-ink-2">punti attesi</div></div>
              <div><div className="num text-xl font-bold">{f1(ev.points.expectedIfStarts)}</div><div className="text-xs text-ink-2">se parte titolare</div></div>
              <div><div className="num text-xl font-bold">{f1(ev.points.p10)} / {f1(ev.points.p90)}</div><div className="text-xs text-ink-2">scenario 10% / 90%</div></div>
            </div>
            <p className="mt-3 text-xs text-ink-3">
              Dati usati: {ev.reliability.sampleMinutes} minuti{ev.reliability.minutesEstimated ? " (stimati dalle presenze)" : ""}
              {r?.usedXg ? ", xG" : ""}
              {r?.usedXa ? ", xA" : ""}
              {r?.prevSeasonUsed ? ", stagione precedente con peso ridotto" : ""}. Fonti: {r?.sources.join(", ") || "nessuna statistica individuale"}.
              {ev.reliability.missing.length > 0 && ` Mancano: ${ev.reliability.missing.join(", ")}.`} Calcolato {relativeTime(ev.computedAt)}.
            </p>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            {ev.fantavalue && (
              <Section title="Componenti del Fantavalue">
                <ul className="space-y-2 text-sm">
                  {Object.entries(ev.fantavalue.components).map(([k, v]) => (
                    <li key={k} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3">
                      <span className="capitalize">{k === "titolarita" ? "titolarità" : k === "affidabilita" ? "affidabilità" : k === "malus" ? "rischio malus (inverso)" : k}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-line"><span className="block h-full bg-prato" style={{ width: `${v}%` }} /></span>
                      <span className="num text-right">{v} <span className="text-xs text-ink-3">×{Math.round((FANTAVALUE_WEIGHTS[ev.role ?? "C"][k] ?? 0) * 100)}%</span></span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <Section title="Perché questa valutazione">
              <ul className="space-y-1 text-sm">
                {ev.factors.map((f, i) => (
                  <li key={i} className={f.sign > 0 ? "text-ok" : f.sign < 0 ? "text-bad" : "text-ink-2"}>
                    {f.sign > 0 ? "＋ " : f.sign < 0 ? "－ " : "· "}
                    {f.text}
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </>
      )}

      <Section title="Forma recente">
        {chartData.length > 0 ? <FormChart data={chartData} avg={r?.formSeason?.avgFantavote ?? null} /> : <p className="mb-3 text-sm text-ink-2">Nessun voto per giornata importato: importa i voti di giornata da Fantacalcio.it in Fonti e aggiornamenti.</p>}
        {r && (
          <FormTable
            rows={[
              { label: "Ultime 5", f: r.form5 },
              { label: "Ultime 10", f: r.form10 },
              { label: "Stagione", f: r.formSeason },
            ]}
          />
        )}
        {r && r.minutesObserved < 270 && <p className="mt-2 text-sm text-warn">Campione statistico insufficiente: meno di 270 minuti osservati.</p>}
        {r && (r.shots90 != null || r.keyPasses90 != null) && (
          <p className="mt-2 text-sm text-ink-2">
            Per 90 minuti: tiri {f2(r.shots90)}, tiri nello specchio {f2(r.shotsOnTarget90)}, passaggi chiave {f2(r.keyPasses90)}.
          </p>
        )}
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold">Statistiche stagionali per fonte</h3>
          {seasonStats.length ? (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="text-left text-ink-2">
                  <tr><th className="py-1">Stagione e fonte</th><th>Pres.</th><th>Tit.</th><th>Min.</th><th>Gol</th><th>Ass.</th><th>Amm.</th><th>Esp.</th><th>Rig. (segn./sbagl.)</th><th>MV</th><th>FM</th><th>xG</th></tr>
                </thead>
                <tbody className="num">
                  {seasonStats.map((s) => (
                    <tr key={s.id} className="border-t border-line">
                      <td className="py-1 font-sans">{s.season_code.replace("-", "/")}, {s.source} <span className="text-ink-3">({relativeTime(s.as_of)})</span></td>
                      <td>{s.appearances ?? "n.d."}</td><td>{s.starts ?? "n.d."}</td><td>{s.minutes ?? "n.d."}</td><td>{s.goals ?? "n.d."}</td><td>{s.assists ?? "n.d."}</td>
                      <td>{s.yellow_cards ?? "n.d."}</td><td>{s.red_cards ?? "n.d."}</td><td>{s.penalties_scored ?? "n.d."}/{s.penalties_missed ?? "n.d."}</td>
                      <td>{f2(s.avg_vote)}</td><td>{f2(s.avg_fantavote)}</td><td>{f2(s.xg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-ink-2">Nessuna statistica disponibile. I dati mancanti non vengono inventati: le stime usano i valori di ruolo e lo dichiarano.</p>
          )}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Infortuni e squalifiche">
          {avail.length === 0 ? (
            <p className="text-sm text-ink-2">Nessuna segnalazione registrata.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {avail.map((a) => (
                <li key={a.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Tag tone={a.certainty === "confermato" ? "bad" : a.certainty === "indiscrezione" ? "neutral" : "warn"}>{CERTAINTY_LABEL[a.certainty]}</Tag>
                    <span className="font-semibold capitalize">{a.kind}</span>
                    {a.resolved_at && <Tag>chiusa</Tag>}
                  </div>
                  {a.description && <p className="mt-0.5">{a.description}</p>}
                  <p className="text-xs text-ink-3">
                    Fonte: {a.url ? <a href={a.url} className="underline" target="_blank" rel="noreferrer">{a.source}</a> : a.source}, {formatDateTime(a.reported_at)}
                    {a.expected_return ? `, rientro comunicato: ${a.expected_return}` : ""}
                    {a.author ? `, inserito da ${a.author}` : ""}
                  </p>
                  {!a.resolved_at && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {a.certainty === "indiscrezione" && (
                        <form action={confirmRumorAction} className="flex gap-1">
                          <input type="hidden" name="id" value={a.id} />
                          <select name="certainty" className="input !w-auto !py-0.5 text-xs" defaultValue="dubbio">
                            <option value="dubbio">Confermo: in dubbio</option>
                            <option value="confermato">Confermo: indisponibile</option>
                          </select>
                          <button className="btn btn-ghost !py-0.5 text-xs">Conferma</button>
                        </form>
                      )}
                      <form action={resolveAvailabilityAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="btn btn-ghost !py-0.5 text-xs">{a.certainty === "indiscrezione" ? "Ignora" : "Segna come risolta"}</button>
                      </form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <details className="mt-3">
            <summary className="text-sm font-semibold text-prato">Aggiungi una segnalazione</summary>
            <div className="mt-3">
              <ActionForm action={addAvailabilityAction} submitLabel="Registra">
                <input type="hidden" name="playerId" value={pid} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Tipo"><select name="kind" className="input"><option value="infortunio">Infortunio</option><option value="squalifica">Squalifica</option><option value="diffida">Diffida</option><option value="malattia">Malattia</option><option value="altro">Altro</option></select></Field>
                  <Field label="Affidabilità della notizia"><select name="certainty" className="input" defaultValue="dubbio"><option value="confermato">Confermato</option><option value="dubbio">In dubbio</option><option value="in_recupero">In recupero</option><option value="indiscrezione">Indiscrezione</option></select></Field>
                  <Field label="Descrizione" className="sm:col-span-2"><input name="description" className="input" /></Field>
                  <Field label="Rientro comunicato (se c'è)"><input type="date" name="expectedReturn" className="input" /></Field>
                  <Field label="Fonte (obbligatoria)"><input name="source" className="input" required /></Field>
                  <Field label="Link (facoltativo)" className="sm:col-span-2"><input name="url" type="url" className="input" /></Field>
                </div>
              </ActionForm>
            </div>
          </details>
        </Section>

        <Section title="Probabili formazioni">
          {lineups.length === 0 ? (
            <p className="text-sm text-ink-2">Nessuna indicazione per questa giornata.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {lineups.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <Tag tone={l.kind === "ufficiale" ? "ok" : "warn"}>{l.kind === "ufficiale" ? "Ufficiale" : "Probabile"}</Tag>{" "}
                    <strong>{LINEUP_STATUS_LABEL[l.status]}</strong>
                    {l.probability != null ? ` (${Math.round(l.probability * 100)}%)` : ""} secondo {l.url ? <a className="underline" href={l.url} target="_blank" rel="noreferrer">{l.source}</a> : l.source}
                    <span className="block text-xs text-ink-3">{formatDateTime(l.reported_at)}{l.author ? `, inserito da ${l.author}` : ""}</span>
                  </span>
                  {l.origin === "manuale" && (
                    <form action={deleteLineupReportAction}>
                      <input type="hidden" name="id" value={l.id} />
                      <button className="btn btn-ghost !py-0.5 text-xs">Elimina</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {myMatch && player.current_team_id && (
            <details className="mt-3">
              <summary className="text-sm font-semibold text-prato">Aggiungi un&apos;indicazione per la giornata {md.matchday}</summary>
              <div className="mt-3">
                <ActionForm action={addLineupReportAction} submitLabel="Registra">
                  <input type="hidden" name="playerId" value={pid} />
                  <input type="hidden" name="matchday" value={md.matchday ?? ""} />
                  <input type="hidden" name="teamId" value={player.current_team_id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Tipo"><select name="kind" className="input"><option value="probabile">Probabile formazione</option><option value="ufficiale">Formazione ufficiale</option></select></Field>
                    <Field label="Indicazione"><select name="status" className="input"><option value="titolare">Titolare</option><option value="ballottaggio">Ballottaggio</option><option value="panchina">Panchina</option><option value="non_convocato">Non convocato</option><option value="indisponibile">Indisponibile</option></select></Field>
                    <Field label="Percentuale (facoltativa)" help="Es. 60 per un ballottaggio 60/40"><input name="probability" className="input" inputMode="numeric" /></Field>
                    <Field label="Fonte (obbligatoria)"><input name="source" className="input" required /></Field>
                    <Field label="Link (facoltativo)" className="sm:col-span-2"><input name="url" type="url" className="input" /></Field>
                  </div>
                </ActionForm>
              </div>
            </details>
          )}
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Indicazioni delle fonti specializzate">
          {ev?.consensus.available && (
            <div className="mb-3 rounded-lg bg-surface-2 p-3 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="num text-2xl font-bold">{ev.consensus.index}</span>
                <span className="text-ink-2">indice di consenso (50 = neutrale)</span>
              </div>
              <p>{ev.consensus.summary}</p>
              <p className="text-xs text-ink-3">{ev.consensus.explicitCount} consigli espliciti, {ev.consensus.statsOnlyCount} fonti che riportano solo dati o notizie (peso ridotto).</p>
            </div>
          )}
          {editorial.length === 0 ? (
            <p className="text-sm text-ink-2">Nessun parere raccolto. I pareri si inseriscono a mano, con fonte e link: non vengono mai simulati.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {editorial.map((e) => (
                <li key={e.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong>{VERDICT_LABEL[e.verdict]}</strong> secondo {e.url ? <a href={e.url} className="underline" target="_blank" rel="noreferrer">{e.source}</a> : e.source}
                      {!e.explicit_advice && <span className="text-ink-3"> (riporta solo dati)</span>}
                      {e.matchday ? <span className="text-ink-3">, giornata {e.matchday}</span> : null}
                    </span>
                    <form action={deleteEditorialAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <button className="btn btn-ghost !py-0.5 text-xs">Elimina</button>
                    </form>
                  </div>
                  {e.summary && <p className="text-ink-2">{e.summary}</p>}
                  <p className="text-xs text-ink-3">{formatDateTime(e.published_at ?? e.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-3">
            <summary className="text-sm font-semibold text-prato">Aggiungi un parere</summary>
            <div className="mt-3">
              <ActionForm action={addEditorialAction} submitLabel="Registra">
                <input type="hidden" name="playerId" value={pid} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Fonte (obbligatoria)"><input name="source" className="input" required placeholder="es. Fantacalcio.it" /></Field>
                  <Field label="Giudizio"><select name="verdict" className="input" defaultValue="schierabile"><option value="consigliato">Consigliato</option><option value="schierabile">Schierabile</option><option value="neutrale">Neutrale</option><option value="rischioso">Rischioso</option><option value="sconsigliato">Sconsigliato</option></select></Field>
                  <Field label="Giornata"><input name="matchday" className="input" defaultValue={md.matchday ?? ""} inputMode="numeric" /></Field>
                  <Field label="Data di pubblicazione"><input name="publishedAt" type="datetime-local" className="input" /></Field>
                  <Field label="Sintesi" className="sm:col-span-2"><input name="summary" className="input" /></Field>
                  <Field label="Link" className="sm:col-span-2"><input name="url" type="url" className="input" /></Field>
                  <Field label="Stessa notizia di (facoltativo)" help="Una parola chiave uguale per pareri che riprendono la stessa notizia: conteranno come una sola conferma."><input name="storyKey" className="input" /></Field>
                  <label className="flex items-center gap-2 text-sm sm:mt-6"><input type="checkbox" name="explicit" defaultChecked /> È un consiglio esplicito</label>
                </div>
              </ActionForm>
            </div>
          </details>
        </Section>

        <Section title="Notizie che lo citano">
          {news.length === 0 ? (
            <p className="text-sm text-ink-2">Nessuna notizia collegata dai feed RSS configurati.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {news.map((n) => (
                <li key={`${n.id}-${n.player_id}`} className="py-2">
                  {n.url ? <a className="font-semibold hover:underline" href={n.url} target="_blank" rel="noreferrer">{n.title}</a> : <span className="font-semibold">{n.title}</span>}
                  <p className="text-xs text-ink-3">
                    {n.source}, {formatDateTime(n.published_at)}, corrispondenza {n.confidence === "alta" ? "per nome completo" : "per cognome e squadra (da verificare)"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Registro delle variazioni">
          {changes.length === 0 ? (
            <p className="text-sm text-ink-2">Nessuna variazione registrata.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {changes.map((c) => (
                <li key={c.id} className="py-2">
                  G{c.matchday}, {c.field.toLowerCase()}: <span className="num">{c.old_value}</span> → <span className="num font-semibold">{c.new_value}</span>
                  <span className="block text-xs text-ink-3">{c.reason}, {formatDateTime(c.changed_at)}</span>
                </li>
              ))}
            </ul>
          )}
          {history.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="font-semibold text-prato">Valutazioni calcolate</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {history.map((h, i) => (
                  <li key={i} className="num">
                    G{h.matchday}, {formatDateTime(h.computed_at)}: titolarità {h.p_start != null ? fmtPct(h.p_start) : "n.d."}, punti attesi {f1(h.expected_points)}, Fantavalue {h.fantavalue ?? "n.d."}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Section>

        <Section title="Dati del giocatore">
          <ActionForm action={updatePlayerAction} submitLabel="Salva modifiche">
            <input type="hidden" name="playerId" value={pid} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome"><input name="name" className="input" defaultValue={player.full_name} /></Field>
              <Field label="Squadra" help="Un cambio di squadra non lo rimuove dalla tua rosa."><input name="team" className="input" defaultValue={player.team_name ?? ""} /></Field>
              <Field label="Ruolo"><select name="role" className="input" defaultValue={player.role_classic ?? ""}><option value="">non impostato</option><option value="P">P</option><option value="D">D</option><option value="C">C</option><option value="A">A</option></select></Field>
              <Field label="Ruoli Mantra"><input name="rolesMantra" className="input" defaultValue={player.roles_mantra ?? ""} /></Field>
              <Field label="Stato"><select name="status" className="input" defaultValue={player.status}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Gerarchia rigori"><select name="penaltyOrder" className="input" defaultValue={player.penalty_order ?? ""}><option value="">non indicata</option><option value="1">Primo rigorista</option><option value="2">Secondo rigorista</option></select></Field>
            </div>
          </ActionForm>
          <p className="mt-3 text-xs text-ink-3">
            Identificativi: {ext.length ? ext.map((e) => `${e.source} ${e.external_id}`).join(", ") : "nessuno (non associato a fonti ufficiali)"}. Ultima verifica: {formatDateTime(player.last_verified_at)}.
            {player.status_source ? ` Stato impostato da: ${player.status_source}.` : ""}
          </p>
          {transfers.length > 0 && (
            <p className="mt-1 text-xs text-ink-3">Trasferimenti: {transfers.map((t) => `${t.from_name ?? "?"} → ${t.to_name ?? "?"} (${formatDateTime(t.changed_at)}, ${t.source})`).join("; ")}</p>
          )}
        </Section>
      </div>
      {!ev && inRoster && !md.matchday && <Empty title="Nessuna giornata disponibile">Scarica il calendario per vedere le valutazioni.</Empty>}
      <p className="text-xs text-ink-3">Stagione {SEASON_CODE.replace("-", "/")}. <Link href={`/rosa${md.matchday ? `?g=${md.matchday}` : ""}`} className="underline">Torna alla rosa</Link></p>
    </div>
  );
}
