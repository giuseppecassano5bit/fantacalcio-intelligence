import Link from "next/link";
import { requireContext } from "@/lib/auth/session";
import { resolveMatchday } from "@/lib/analysis/context";
import { getRoster } from "@/lib/repo/players";
import { getRecommendation, getSavedLineup, diffSaved } from "@/lib/analysis/recommend";
import { recentChanges } from "@/lib/analysis/pipeline";
import { getLeagueSettings } from "@/lib/repo/data";
import { formatKickoff, relativeTime, formatDateTime, isFuture } from "@/lib/domain/time";
import { Empty, Notice, Section, Stat, MoreLink, fmtPct, Prob, cx } from "@/components/ui";
import { PlayerItem } from "@/components/PlayerItem";
import type { PlayerEvaluation } from "@/lib/model/evaluate";

export const metadata = { title: "Dashboard" };

const shortDate = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long" });

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, mode, db } = await requireContext();
  const sp = await searchParams;
  const md = resolveMatchday(db, sp.g);
  const roster = getRoster(db, user.id);
  const settings = getLeagueSettings(db, user.id);

  if (!md.matchday) {
    return (
      <Empty title="Calendario non ancora scaricato">
        {mode === "demo" ? "La demo non ha calendario." : "Premi “Aggiorna” in alto: l'app scarica calendario e risultati della Serie A dalle fonti gratuite configurate."}
      </Empty>
    );
  }
  if (roster.length === 0) {
    return (
      <Empty title="La tua rosa è vuota" action={<Link href="/rosa" className="btn btn-primary">Inserisci la rosa</Link>}>
        Inserisci una sola volta i giocatori della tua squadra: restano salvati per tutta la stagione.
      </Empty>
    );
  }

  const { analysis, rec } = getRecommendation(db, user.id, md.matchday, "equilibrata");
  const evs = analysis.evaluations;
  const saved = getSavedLineup(db, user.id, md.matchday);
  const diff = diffSaved(saved, rec?.result ?? null);
  const changes = recentChanges(db, user.id, md.matchday, { onlySignificant: true, limit: 8 });
  const info = md.info!;
  const first = info.firstKickoff;
  const lastK = info.lastKickoff;
  const available = evs.filter((e) => e.playing.availability !== "indisponibile" && e.match);
  const out = evs.filter((e) => e.playing.availability === "indisponibile" && e.match);
  const benchRisk = available.filter((e) => !e.playing.insufficient && e.playing.pStart < 0.5);
  const home = evs.filter((e) => e.match?.isHome).length;
  const away = evs.filter((e) => e.match && !e.match.isHome).length;
  const noMatch = evs.filter((e) => !e.match).length;

  const by = (f: (e: PlayerEvaluation) => number) => [...evs].sort((a, b) => f(b) - f(a));
  const bonus = by((e) => e.probs.anyBonus.p).filter((e) => e.playing.pVote > 0.3 && e.role !== "P").slice(0, 5);
  const reliable = by((e) => e.playing.pVote * 10 + (e.points.expectedPoints ?? 0)).filter((e) => e.playing.pVote >= 0.8 && !e.playing.insufficient).slice(0, 5);
  const risky = evs.filter((e) => e.match && e.playing.availability !== "indisponibile" && (e.playing.pVote < 0.6 || e.playing.availability === "dubbio" || e.playing.rumors.length > 0)).slice(0, 6);
  const surprises = evs
    .filter((e) => e.role !== "P" && e.playing.pStart >= 0.3 && e.playing.pStart <= 0.7 && (e.points.p90 ?? 0) >= 9)
    .sort((a, b) => (b.points.p90 ?? 0) - (a.points.p90 ?? 0))
    .slice(0, 4);
  const avoid = evs
    .filter((e) => e.match && e.playing.availability !== "indisponibile" && ((e.consensus.index != null && e.consensus.index < 40) || (e.fantavalue?.index ?? 100) < 35))
    .slice(0, 5);
  const matchPotential = [...analysis.matches]
    .map((m) => {
      const h = analysis.table.ratings.get(m.home_team_id);
      const a = analysis.table.ratings.get(m.away_team_id);
      const total = analysis.table.homeGoals * (h?.attack ?? 1) * (a?.defence ?? 1) + analysis.table.awayGoals * (a?.attack ?? 1) * (h?.defence ?? 1);
      const mine = evs.filter((e) => e.match?.id === m.id).length;
      return { m, total, mine };
    })
    .sort((x, y) => y.total - x.total)
    .slice(0, 4);

  return (
    <div className="space-y-6">
      {/* Testata della giornata */}
      <section aria-labelledby="titolo-giornata" className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 id="titolo-giornata" className="font-display text-4xl font-bold leading-none tracking-tight">
              Giornata {md.matchday}
            </h1>
            <p className="mt-1 text-ink-2">
              {first && lastK ? `Dal ${shortDate.format(new Date(first))} al ${shortDate.format(new Date(lastK))}` : "Date da definire"}
              {info.postponed > 0 ? `, ${info.postponed} partita/e rinviata/e` : ""}
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-ink-2">Primo calcio d&apos;inizio, termine per la formazione</div>
            <div className="num text-xl font-bold">{first ? formatKickoff(first) : "da definire"}</div>
            {isFuture(first) && <div className="text-sm text-ink-3">{relativeTime(first)}</div>}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
          <Stat label="Convocabili" value={`${available.length}/${roster.length}`} sub={noMatch ? `${noMatch} senza partita` : undefined} />
          <Stat label="Indisponibili" value={out.length} sub={out.length ? out.slice(0, 2).map((e) => e.name.split(" ").slice(-1)[0]).join(", ") : undefined} />
          <Stat label="A rischio panchina" value={benchRisk.length} sub="titolarità stimata sotto il 50%" />
          <Stat label="Casa e trasferta" value={`${home} e ${away}`} />
        </div>
      </section>

      {settings.provisional && (
        <Notice tone="warn">
          Stai usando un regolamento <strong>provvisorio</strong> (valori diffusi, non necessariamente quelli della tua lega).{" "}
          <Link href="/impostazioni" className="font-semibold underline">
            Imposta il regolamento della tua lega
          </Link>
          .
        </Notice>
      )}
      {diff && !diff.identical && (
        <Notice tone="info">
          La formazione consigliata è cambiata rispetto a quella che hai salvato il {formatDateTime(saved!.saved_at)}: {diff.toAdd.length} ingresso/i, {diff.toRemove.length} uscita/e
          {diff.moduleChanged ? ", modulo diverso" : ""}. La tua formazione salvata non è stata modificata.{" "}
          <Link href={`/formazione?g=${md.matchday}`} className="font-semibold underline">
            Confronta
          </Link>
        </Notice>
      )}

      {rec && (
        <Section title="Formazione consigliata" aside={<MoreLink href={`/formazione?g=${md.matchday}`}>Apri formazione</MoreLink>}>
          <p className="text-sm text-ink-2">
            Strategia equilibrata, modulo <strong className="num">{rec.result.module}</strong>: punti attesi{" "}
            <strong className="num">{rec.result.metrics.mean.toFixed(1).replace(".", ",")}</strong> (scenario prudente {rec.result.metrics.p10.toFixed(0)}, favorevole {rec.result.metrics.p90.toFixed(0)}).
          </p>
          {rec.result.risks.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-warn">
              {rec.result.risks.slice(0, 3).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Migliori opzioni per il bonus">
          {bonus.length ? (
            <ul>
              {bonus.map((e) => (
                <PlayerItem key={e.playerId} ev={e} md={md.matchday!} metric={<span><Prob est={e.probs.anyBonus} level={e.reliability.level} showRange={false} /><span className="block text-xs text-ink-3">bonus</span></span>} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Nessun giocatore con dati sufficienti.</p>
          )}
        </Section>
        <Section title="Titolari affidabili">
          {reliable.length ? (
            <ul>
              {reliable.map((e) => (
                <PlayerItem key={e.playerId} ev={e} md={md.matchday!} metric={<span><span className="num font-semibold">{fmtPct(e.playing.pVote, e.reliability.level)}</span><span className="block text-xs text-ink-3">a voto</span></span>} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Servono probabili formazioni o statistiche di impiego per indicare titolari affidabili.</p>
          )}
        </Section>
        <Section title="Giocatori ad alto rischio">
          {risky.length ? (
            <ul>
              {risky.map((e) => (
                <PlayerItem key={e.playerId} ev={e} md={md.matchday!} metric={<span><span className="num font-semibold text-warn">{fmtPct(e.playing.pVote, e.reliability.level)}</span><span className="block text-xs text-ink-3">a voto</span></span>} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Nessun rischio particolare segnalato.</p>
          )}
        </Section>
        <Section title="Possibili sorprese">
          {surprises.length ? (
            <ul>
              {surprises.map((e) => (
                <PlayerItem key={e.playerId} ev={e} md={md.matchday!} note="Titolarità incerta ma alto potenziale nello scenario favorevole." metric={<span><span className="num font-semibold">{(e.points.p90 ?? 0).toFixed(0)}</span><span className="block text-xs text-ink-3">se va bene</span></span>} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Nessun giocatore con titolarità incerta e alto potenziale.</p>
          )}
        </Section>
        <Section title="Da evitare o valutare con attenzione">
          {avoid.length ? (
            <ul>
              {avoid.map((e) => (
                <PlayerItem key={e.playerId} ev={e} md={md.matchday!} note={e.consensus.available ? e.consensus.summary : undefined} metric={<span><span className="num font-semibold">{e.fantavalue?.index ?? "n.d."}</span><span className="block text-xs text-ink-3">Fantavalue</span></span>} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Nessun giocatore sconsigliato dai dati o dalle fonti.</p>
          )}
        </Section>
        <Section title="Partite con più potenziale offensivo" aside={<MoreLink href={`/giornata?g=${md.matchday}`}>Analisi giornata</MoreLink>}>
          <ul className="divide-y divide-line">
            {matchPotential.map(({ m, total, mine }) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {m.home_name} contro {m.away_name}
                  </span>
                  <span className="text-xs text-ink-3">{mine ? `${mine} tuoi giocatori` : "nessun tuo giocatore"}</span>
                </span>
                <span className="num text-right font-semibold">
                  {total.toFixed(1).replace(".", ",")}
                  <span className="block text-xs font-normal text-ink-3">gol attesi</span>
                </span>
              </li>
            ))}
          </ul>
          {analysis.table.matchesPlayed < 30 && <p className="mt-2 text-xs text-ink-3">Stima basata su {analysis.table.matchesPlayed} partite giocate: affidabilità limitata a inizio stagione.</p>}
        </Section>
      </div>

      <Section title="Valutazioni cambiate di recente" aside={<MoreLink href={`/storico?g=${md.matchday}`}>Registro completo</MoreLink>}>
        {changes.length ? (
          <ul className="divide-y divide-line text-sm">
            {changes.map((c) => (
              <li key={c.id} className="py-2">
                <span className="font-semibold">{c.full_name}</span>: {c.field.toLowerCase()} da <span className="num">{c.old_value}</span> a{" "}
                <span className={cx("num font-semibold")}>{c.new_value}</span>
                <span className="block text-xs text-ink-3">
                  {c.reason}, {relativeTime(c.changed_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">Nessuna variazione rilevante dall&apos;ultimo calcolo.</p>
        )}
      </Section>
    </div>
  );
}
