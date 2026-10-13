import { ChevronRight } from "lucide-react";
import type { PlayerEvaluation } from "@/lib/model/evaluate";
import { formatKickoff } from "@/lib/domain/time";
import { MoreLink, Prob, RoleBadge, StatusTag, ReliabilityTag, cx, fmtPct } from "./ui";

export function oppLabel(ev: PlayerEvaluation): string {
  if (!ev.match) return "nessuna partita";
  return `${ev.match.isHome ? "in casa" : "in trasferta"} contro ${ev.match.oppName}`;
}

/** Riga giocatore con dettaglio espandibile: il "perché" di ogni indicazione. */
export function PlayerItem({ ev, metric, md, note }: { ev: PlayerEvaluation; metric: React.ReactNode; md: number; note?: string }) {
  const lvl = ev.reliability.level;
  return (
    <li className="border-b border-line last:border-b-0">
      <details>
        <summary className="flex items-center gap-3 py-2.5">
          <RoleBadge role={ev.role} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{ev.name}</span>
            <span className="block truncate text-xs text-ink-2">
              {ev.teamName ?? "squadra n.d."}, {oppLabel(ev)}
            </span>
          </span>
          <span className="text-right text-sm">{metric}</span>
          <ChevronRight size={16} className="chev shrink-0 text-ink-3 transition-transform" aria-hidden />
        </summary>
        <div className="mb-3 ml-10 space-y-2 rounded-lg bg-surface-2 p-3 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <StatusTag status={ev.playing.availability === "dubbio" ? "dubbio" : ev.playing.availability} label={ev.playing.availabilityLabel} />
            <ReliabilityTag level={lvl} />
            {ev.playing.official && <span className="text-xs font-semibold text-ok">Formazione ufficiale</span>}
          </div>
          {note && <p className="text-ink-2">{note}</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-ink-3">Titolare</dt>
              <dd className={cx("num font-semibold", ev.playing.insufficient && "text-ink-3")}>{ev.playing.insufficient ? "sconosciuta" : fmtPct(ev.playing.pStart, lvl)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Prende voto</dt>
              <dd className="num font-semibold">{fmtPct(ev.playing.pVote, lvl)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Gol o assist</dt>
              <dd>
                <Prob est={ev.probs.goalOrAssist} level={lvl} showRange={false} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Punti attesi</dt>
              <dd className="num font-semibold">{ev.points.expectedPoints != null ? ev.points.expectedPoints.toFixed(1).replace(".", ",") : "n.d."}</dd>
            </div>
          </dl>
          {ev.factors.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-ink-2">
              {ev.factors.slice(0, 5).map((f, i) => (
                <li key={i} className={f.sign < 0 ? "text-bad" : undefined}>
                  {f.text}
                </li>
              ))}
            </ul>
          )}
          {ev.match?.kickoff && <p className="text-xs text-ink-3">Calcio d&apos;inizio: {formatKickoff(ev.match.kickoff, ev.match.kickoffKnown)}</p>}
          <MoreLink href={`/giocatore/${ev.playerId}?g=${md}`}>Scheda completa</MoreLink>
        </div>
      </details>
    </li>
  );
}
