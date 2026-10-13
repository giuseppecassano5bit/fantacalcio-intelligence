import Link from "next/link";
import { requireContext } from "@/lib/auth/session";
import { resolveMatchday } from "@/lib/analysis/context";
import { analyzeMatchday } from "@/lib/analysis/pipeline";
import { defenceProfile, expectMatch } from "@/lib/model/teamStrength";
import { lineupReportsForMatches, LINEUP_STATUS_LABEL } from "@/lib/repo/data";
import { formatKickoff, formatDateTime } from "@/lib/domain/time";
import { Empty, Section, RoleBadge, Prob, Tag, fmtPct, cx } from "@/components/ui";
import { setTeamNotesAction } from "@/app/actions/data";
import { getTeamsById } from "./teams";

export const metadata = { title: "Analisi giornata" };

const SORTS = { potenziale: "Potenziale offensivo", bonus: "Bonus per i miei giocatori", rischio: "Rischio difensivo" } as const;
type Sort = keyof typeof SORTS;
const f1 = (x: number) => x.toFixed(1).replace(".", ",");
const STATUS: Record<string, string> = { programmata: "In programma", in_corso: "In corso", terminata: "Terminata", rinviata: "Rinviata", sospesa: "Sospesa", annullata: "Annullata" };

export default async function GiornataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, db } = await requireContext();
  const sp = await searchParams;
  const md = resolveMatchday(db, sp.g);
  if (!md.matchday) return <Empty title="Calendario non disponibile">Premi “Aggiorna” per scaricare il calendario.</Empty>;
  const sort: Sort = (sp.ordina as Sort) in SORTS ? (sp.ordina as Sort) : "potenziale";
  const a = analyzeMatchday(db, user.id, md.matchday);
  const t = a.table;
  const reports = lineupReportsForMatches(db, a.matches.map((m) => m.id));
  const teams = getTeamsById(db, a.matches.flatMap((m) => [m.home_team_id, m.away_team_id]));

  const rows = a.matches.map((m) => {
    const eh = expectMatch(t, m.home_team_id, m.away_team_id, true);
    const mine = a.evaluations.filter((e) => e.match?.id === m.id);
    const bonusSum = mine.reduce((s, e) => s + e.probs.anyBonus.p, 0);
    const riskMine = mine.filter((e) => e.playing.pVote < 0.6 || e.probs.yellow.p > 0.3 || (e.role === "P" && (e.probs.gk?.twoPlusConceded ?? 0) > 0.35));
    const defRisk = Math.max(eh.teamGoals, eh.oppGoals);
    return { m, home: eh.teamGoals, away: eh.oppGoals, total: eh.teamGoals + eh.oppGoals, mine, bonusSum, riskMine, defRisk };
  });
  rows.sort((x, y) => (sort === "bonus" ? y.bonusSum - x.bonusSum : sort === "rischio" ? y.defRisk - x.defRisk : y.total - x.total));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Analisi della giornata {md.matchday}</h1>
        <p className="max-w-prose text-ink-2">
          Gol attesi stimati da gol fatti e subiti delle squadre ({t.matchesPlayed} partite giocate prima di questa giornata
          {t.usesPriorsOnly ? ", ancora nessuna: valori di partenza uguali per tutti" : ""}), con il vantaggio del fattore campo. Non è un pronostico sul risultato.
        </p>
      </div>
      <nav aria-label="Ordinamento" className="flex flex-wrap gap-2">
        {(Object.keys(SORTS) as Sort[]).map((k) => (
          <Link key={k} href={`?g=${md.matchday}&ordina=${k}`} aria-current={k === sort ? "page" : undefined} className={cx("btn", k === sort ? "btn-primary" : "btn-ghost")}>
            {SORTS[k]}
          </Link>
        ))}
      </nav>

      <div className="space-y-4">
        {rows.map(({ m, home, away, total, mine, riskMine }) => {
          const hp = defenceProfile(t, m.home_team_id);
          const ap = defenceProfile(t, m.away_team_id);
          const hr = t.ratings.get(m.home_team_id);
          const ar = t.ratings.get(m.away_team_id);
          const rep = reports.filter((r) => r.match_id === m.id);
          const official = rep.some((r) => r.kind === "ufficiale");
          return (
            <section key={m.id} className="rounded-xl border border-line bg-surface">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div>
                  <h2 className="font-display text-xl font-semibold">
                    {m.home_name} contro {m.away_name}
                    {m.status === "terminata" && m.home_goals != null && <span className="num ml-2">{m.home_goals}–{m.away_goals}</span>}
                  </h2>
                  <p className="text-sm text-ink-2">
                    {formatKickoff(m.kickoff_utc, m.kickoff_time_known === 1)}, {STATUS[m.status] ?? m.status}
                    <span className="text-ink-3"> (fonte: {m.source}, verificato {formatDateTime(m.verified_at)})</span>
                  </p>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <div>
                    <div className="num text-lg font-bold">{f1(home)} e {f1(away)}</div>
                    <div className="text-xs text-ink-3">gol attesi casa e ospiti</div>
                  </div>
                  <div>
                    <div className="num text-lg font-bold">{f1(total)}</div>
                    <div className="text-xs text-ink-3">potenziale totale</div>
                  </div>
                </div>
              </header>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                {[
                  { name: m.home_name, r: hr, p: hp, id: m.home_team_id },
                  { name: m.away_name, r: ar, p: ap, id: m.away_team_id },
                ].map(({ name, r, p, id }) => (
                  <div key={id} className="space-y-1.5 text-sm">
                    <div className="font-semibold">{name}</div>
                    {r && r.games > 0 ? (
                      <>
                        <div className="text-ink-2">
                          Ultime {r.last5.games}: <span className="num font-semibold">{r.last5.form.split("").join(" ")}</span>, gol fatti {r.last5.gf} e subiti {r.last5.ga}. Stagione: {r.gf} fatti, {r.ga} subiti in {r.games}{" "}
                          partite ({r.homeGames} in casa: {r.homeGf}-{r.homeGa}; {r.awayGames} fuori: {r.awayGf}-{r.awayGa}).
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {p.labels.map((l) => (
                            <Tag key={l} tone="info">{l}</Tag>
                          ))}
                          {p.cleanSheetRate != null && <Tag>Porta inviolata {fmtPct(p.cleanSheetRate)}</Tag>}
                        </div>
                        <p className="text-xs text-ink-3">{p.note}</p>
                      </>
                    ) : (
                      <p className="text-ink-3">Nessuna partita disputata registrata.</p>
                    )}
                    {teams.get(id)?.tactical_notes && (
                      <p className="text-xs text-ink-2">
                        Note tattiche: {teams.get(id)!.tactical_notes} <span className="text-ink-3">({teams.get(id)!.tactical_notes_source ?? "fonte non indicata"})</span>
                      </p>
                    )}
                    <details className="text-xs">
                      <summary className="font-semibold text-prato">Aggiungi note tattiche (modulo, difesa bassa, transizioni)</summary>
                      <form action={setTeamNotesAction} className="mt-2 space-y-2">
                        <input type="hidden" name="teamId" value={id} />
                        <textarea name="notes" className="input" defaultValue={teams.get(id)?.tactical_notes ?? ""} />
                        <input name="source" className="input" placeholder="Fonte (obbligatoria per citarla)" defaultValue={teams.get(id)?.tactical_notes_source ?? ""} />
                        <button className="btn btn-ghost !py-1 text-xs">Salva</button>
                      </form>
                    </details>
                  </div>
                ))}
              </div>
              {(mine.length > 0 || rep.length > 0) && (
                <div className="border-t border-line p-4">
                  {mine.length > 0 && (
                    <>
                      <h3 className="mb-2 text-sm font-semibold">I tuoi giocatori ({mine.length}){riskMine.length ? `, ${riskMine.length} a rischio` : ""}</h3>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {mine.map((e) => (
                          <li key={e.playerId} className="flex items-center gap-2 text-sm">
                            <RoleBadge role={e.role} size="sm" />
                            <Link href={`/giocatore/${e.playerId}?g=${md.matchday}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">
                              {e.name}
                            </Link>
                            <span className="text-xs text-ink-2">
                              titolare {e.playing.insufficient ? "n.d." : fmtPct(e.playing.pStart, e.reliability.level)}, bonus <Prob est={e.probs.anyBonus} level={e.reliability.level} showRange={false} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {rep.length > 0 && (
                    <p className="mt-3 text-xs text-ink-2">
                      {official ? "Formazioni ufficiali disponibili." : "Probabili formazioni registrate."} Indicazioni per i tuoi giocatori:{" "}
                      {rep
                        .filter((r) => mine.some((e) => e.playerId === r.player_id))
                        .map((r) => `${mine.find((e) => e.playerId === r.player_id)?.name}: ${LINEUP_STATUS_LABEL[r.status].toLowerCase()} (${r.source})`)
                        .join("; ") || "nessuna"}
                    </p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
