import { requireContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { CONNECTORS } from "@/lib/connectors/registry";
import { DATA_KIND_LABEL } from "@/lib/connectors/types";
import { getConnectorStatus, listSyncRuns, lastSuccessfulSync } from "@/lib/repo/sync";
import { listOpenDiscrepancies, listMatchdays, SEASON_CODE } from "@/lib/repo/league";
import { latestNews } from "@/lib/repo/data";
import { plannerInfo } from "@/lib/sync/scheduler";
import { SCOPE_LABEL, type SyncScope } from "@/lib/sync/engine";
import { formatDateTime, relativeTime } from "@/lib/domain/time";
import { toggleConnectorAction } from "@/app/actions/data";
import { ConnectorTest } from "@/components/ConnectorTest";
import { ImportWizard } from "@/components/ImportWizard";
import { Section, Tag, Notice } from "@/components/ui";
import { CheckCircle2, XCircle, MinusCircle, KeyRound } from "lucide-react";

export const metadata = { title: "Fonti e aggiornamenti" };

const RUN_TONE = { ok: "ok", parziale: "warn", errore: "bad", in_corso: "info" } as const;

function prevSeason(code: string) {
  const y = Number(code.slice(0, 4)) - 1;
  return `${y}-${String(y + 1).slice(2)}`;
}

export default async function FontiPage() {
  const { db, mode } = await requireContext();
  const real = getDb("reale");
  const plan = plannerInfo();
  const last = lastSuccessfulSync(real);
  const runs = listSyncRuns(real, 15);
  const disc = listOpenDiscrepancies(real);
  const news = latestNews(real, 15);
  const mds = listMatchdays(db).map((m) => m.matchday);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Fonti e aggiornamenti</h1>
        <p className="max-w-prose text-ink-2">Da dove arrivano i dati, quando sono stati verificati l&apos;ultima volta e cosa manca. Nessuna connessione viene simulata: una fonte senza chiave o non raggiungibile resta segnalata.</p>
      </div>
      {mode === "demo" && <Notice tone="warn">Sei in modalità demo: questa pagina mostra comunque lo stato delle fonti reali, che la demo non usa.</Notice>}

      <Section title="Aggiornamento automatico">
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <div className="text-ink-2">Ultimo aggiornamento riuscito</div>
            <div className="font-semibold">{last ? `${formatDateTime(last.finished_at)} (${relativeTime(last.finished_at)})` : "mai"}</div>
          </div>
          <div>
            <div className="text-ink-2">Prossimo calcio d&apos;inizio</div>
            <div className="font-semibold">{plan.decision?.nextKickoff ? formatDateTime(plan.decision.nextKickoff) : "non noto"}</div>
          </div>
          <div>
            <div className="text-ink-2">Prossimo controllo pianificato</div>
            <div className="font-semibold">{plan.enabled ? (plan.decision?.nextCheckAt ? formatDateTime(plan.decision.nextCheckAt) : plan.decision?.action ? "in corso" : "entro pochi minuti") : "scheduler disattivato"}</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-2">
          Regole: controllo leggero di calendario e risultati ogni 12 ore e aggiornamento completo ogni giorno; dalle 24 ore prima di ogni partita un aggiornamento completo ogni 3 ore, ogni 30 minuti nelle ultime 3 ore; formazioni ufficiali nei 70 minuti prima del fischio d&apos;inizio (se è configurata una fonte che le fornisce); risultati dopo la fine delle partite. Gli orari si basano sul calendario reale di ogni giornata, con anticipi e posticipi.
        </p>
        {plan.decision && <p className="mt-1 text-xs text-ink-3">Ultima decisione del pianificatore ({plan.lastTick ? relativeTime(plan.lastTick) : "mai"}): {plan.decision.reason}.</p>}
      </Section>

      <Section title="Connettori">
        <ul className="divide-y divide-line">
          {CONNECTORS.map((c) => {
            const st = getConnectorStatus(real, c.id);
            const configured = c.isConfigured();
            const healthy = configured && st.enabled && st.last_success_at && (!st.last_error_at || st.last_error_at < st.last_success_at);
            return (
              <li key={c.id} className="grid gap-3 py-4 md:grid-cols-[1fr_15rem]">
                <div className="space-y-1.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {healthy ? <CheckCircle2 size={17} className="text-ok" aria-hidden /> : !configured ? <KeyRound size={17} className="text-ink-3" aria-hidden /> : st.last_error_at ? <XCircle size={17} className="text-bad" aria-hidden /> : <MinusCircle size={17} className="text-ink-3" aria-hidden />}
                    <a href={c.docsUrl} target="_blank" rel="noreferrer" className="font-display text-lg font-semibold hover:underline">{c.name}</a>
                    {!configured ? <Tag tone="neutral">Da configurare: {c.envVar}</Tag> : !st.enabled ? <Tag tone="warn">Disattivato</Tag> : healthy ? <Tag tone="ok">Funzionante</Tag> : st.last_error_at ? <Tag tone="bad">Errore</Tag> : <Tag>Mai eseguito</Tag>}
                  </div>
                  <p className="text-ink-2">{c.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {c.provides.map((k) => <Tag key={k}>{DATA_KIND_LABEL[k]}</Tag>)}
                  </div>
                  <p className="text-xs text-ink-3">Limiti: {c.limits} Licenza: {c.license}</p>
                  <p className="text-xs text-ink-3">Se non disponibile: {c.fallback}</p>
                  <p className="text-xs">
                    Ultimo successo: <strong>{formatDateTime(st.last_success_at)}</strong>
                    {st.last_error_at && (
                      <>
                        {" "}· <span className="text-bad">ultimo errore {formatDateTime(st.last_error_at)}: {st.last_error}</span>
                      </>
                    )}
                  </p>
                  {st.last_test_at && <p className={`text-xs ${st.last_test_ok ? "text-ok" : "text-bad"}`}>Ultima verifica ({formatDateTime(st.last_test_at)}): {st.last_test_message}</p>}
                </div>
                <div className="flex flex-col items-start gap-2 md:items-end">
                  <ConnectorTest id={c.id} />
                  <form action={toggleConnectorAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="enabled" value={st.enabled ? "0" : "1"} />
                    <button className="btn btn-ghost !py-1 text-xs">{st.enabled ? "Disattiva" : "Attiva"}</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-ink-3">Le chiavi API si configurano nel file .env del server (mai nel browser): vedi il README.</p>
      </Section>

      <Section title="Importa dati" id="importa">
        <div className="space-y-3 text-sm text-ink-2">
          <p>
            Per avere statistiche reali senza API a pagamento puoi importare i file che scarichi tu da Fantacalcio.it (serve un account gratuito): <strong>Listone/Quotazioni</strong> (ruoli ufficiali e squadre),{" "}
            <strong>Statistiche</strong> (presenze, media voto, fantamedia, gol, assist, cartellini, rigori) e <strong>Voti</strong> di ogni giornata (forma recente e verifica delle previsioni). L&apos;app non scarica questi file in automatico per rispettare i termini del sito.
          </p>
          <p>
            Modelli CSV per inserire altre informazioni con la loro fonte:{" "}
            {["probabili", "infortuni", "pareri", "statistiche", "squadre_avanzate"].map((k, i) => (
              <span key={k}>
                {i > 0 && ", "}
                <a className="font-semibold text-prato underline" href={`/api/templates/${k}`}>{k.replace("_", " ")}</a>
              </span>
            ))}
            .
          </p>
        </div>
        <div className="mt-4">
          <ImportWizard mode="file" kinds={["auto", "listone", "statistiche", "voti", "probabili", "infortuni", "pareri", "squadre_avanzate"]} matchdays={mds} seasons={[SEASON_CODE, prevSeason(SEASON_CODE)]} />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Registro degli aggiornamenti">
          {runs.length === 0 ? (
            <p className="text-sm text-ink-2">Nessun aggiornamento eseguito.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {runs.map((r) => {
                const sum = r.summary ? (JSON.parse(r.summary) as { outcomes?: { connector: string; ok: boolean; skipped?: string; error?: string; items?: Record<string, number> }[] }) : null;
                return (
                  <li key={r.id} className="py-2">
                    <details>
                      <summary className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <Tag tone={RUN_TONE[r.status]}>{r.status}</Tag> <strong>{SCOPE_LABEL[r.scope as SyncScope] ?? r.scope}</strong> <span className="text-ink-3">({r.trigger})</span>
                        </span>
                        <span className="text-xs text-ink-3">{formatDateTime(r.started_at)}</span>
                      </summary>
                      <p className="mt-1 text-xs text-ink-2">Motivo: {r.reason}</p>
                      <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                        {sum?.outcomes?.map((o, i) => (
                          <li key={i}>
                            <strong>{o.connector}</strong>: {o.skipped ? `saltato (${o.skipped})` : o.error ? <span className="text-bad">{o.error}</span> : Object.entries(o.items ?? {}).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ") || "ok"}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <Section title="Discrepanze tra fonti">
          {disc.length === 0 ? (
            <p className="text-sm text-ink-2">Nessuna discrepanza aperta tra le fonti di calendario e risultati.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {disc.map((d) => (
                <li key={d.id} className="py-2">
                  <strong>
                    G{d.matchday} {d.home_name} contro {d.away_name}
                  </strong>
                  , {d.field}: {d.source_a} dice <span className="num">{d.field === "orario" ? formatDateTime(d.value_a) : d.value_a}</span>, {d.source_b} dice{" "}
                  <span className="num">{d.field === "orario" ? formatDateTime(d.value_b) : d.value_b}</span>.
                  <span className="block text-xs text-ink-3">Vale il dato della fonte più affidabile; rilevata {relativeTime(d.detected_at)}.</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Ultime notizie dai feed">
        {news.length === 0 ? (
          <p className="text-sm text-ink-2">Nessuna notizia scaricata: verranno lette al prossimo aggiornamento completo.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {news.map((n) => (
              <li key={n.id} className="py-2">
                {n.url ? <a href={n.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{n.title}</a> : <span className="font-semibold">{n.title}</span>}
                <span className="block text-xs text-ink-3">
                  {n.source}, {formatDateTime(n.published_at)}
                  {n.categories ? `, ${n.categories}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-3">Mostriamo solo titolo e link: gli articoli restano sul sito dell&apos;editore.</p>
      </Section>
    </div>
  );
}
