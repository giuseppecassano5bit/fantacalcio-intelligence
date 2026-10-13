import Link from "next/link";
import { requireContext } from "@/lib/auth/session";
import { getRoster, rosterHistory, countPlayers, STATUS_LABEL } from "@/lib/repo/players";
import { getLeagueSettings } from "@/lib/repo/data";
import { resolveMatchday } from "@/lib/analysis/context";
import { analyzeMatchday } from "@/lib/analysis/pipeline";
import { formatDateTime } from "@/lib/domain/time";
import { RosterSearch } from "@/components/RosterSearch";
import { ImportWizard } from "@/components/ImportWizard";
import { ActionForm, Field } from "@/components/ActionForm";
import { createManualPlayerAction, removeFromRosterAction, updateRosterEntryAction } from "@/app/actions/data";
import { Section, RoleBadge, StatusTag, Notice, Fantavalue, Tag, cx } from "@/components/ui";
import { BadgeCheck, CircleHelp } from "lucide-react";
import { ROLES } from "@/lib/domain/settings";

export const metadata = { title: "La mia rosa" };

const ACTION_LABEL: Record<string, string> = {
  aggiunto: "Aggiunto",
  rimosso: "Rimosso",
  modificato: "Modificato",
  sostituito: "Sostituzione",
  trasferimento: "Cambio squadra reale",
};

export default async function RosaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, db, mode } = await requireContext();
  const sp = await searchParams;
  const roster = getRoster(db, user.id);
  const { config } = getLeagueSettings(db, user.id);
  const md = resolveMatchday(db, sp.g);
  const catalog = countPlayers(db);
  const history = rosterHistory(db, user.id, 40);
  const analysis = md.matchday && roster.length ? analyzeMatchday(db, user.id, md.matchday) : null;
  const evBy = new Map(analysis?.evaluations.map((e) => [e.playerId, e]) ?? []);
  const counts = Object.fromEntries(ROLES.map((r) => [r, roster.filter((p) => p.role_classic === r).length]));
  const rosterIds = roster.map((r) => r.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">La mia rosa</h1>
          <p className="text-ink-2">Inserisci i giocatori una sola volta: restano salvati per tutta la stagione, anche se cambiano squadra.</p>
        </div>
        <div className="flex gap-3">
          {ROLES.map((r) => (
            <span key={r} className="flex items-center gap-1.5 text-sm">
              <RoleBadge role={r} size="sm" />
              <span className={cx("num font-semibold", counts[r] !== config.rosa[r] && "text-warn")}>
                {counts[r]}/{config.rosa[r]}
              </span>
            </span>
          ))}
        </div>
      </div>

      {sp.benvenuto && (
        <Notice tone="info">
          Benvenuto! Per iniziare: 1) inserisci la tua rosa qui sotto; 2) imposta il regolamento della tua lega in{" "}
          <Link href="/impostazioni" className="font-semibold underline">Impostazioni</Link>; 3) per avere statistiche reali importa i file di Fantacalcio.it in{" "}
          <Link href="/fonti#importa" className="font-semibold underline">Fonti e aggiornamenti</Link>.
        </Notice>
      )}
      {catalog === 0 && mode === "reale" && (
        <Notice tone="warn">
          Il catalogo dei giocatori di Serie A è vuoto. Puoi: importare il <strong>listone di Fantacalcio.it</strong> (file .xlsx scaricabile dal sito, vedi{" "}
          <Link href="/fonti#importa" className="font-semibold underline">Importa dati</Link>), configurare una chiave gratuita di football-data.org per scaricare le rose ufficiali, oppure inserire i giocatori manualmente.
          I giocatori aggiunti a mano restano segnalati come “da verificare”.
        </Notice>
      )}

      <Section title="Aggiungi giocatori">
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 font-semibold">Cerca per nome</h3>
            <RosterSearch rosterIds={rosterIds} />
          </div>
          <details className="rounded-lg border border-line">
            <summary className="px-4 py-3 font-semibold">Inserimento multiplo: incolla un elenco di nomi</summary>
            <div className="border-t border-line p-4">
              <ImportWizard mode="testo" kinds={["rosa"]} />
            </div>
          </details>
          <details className="rounded-lg border border-line">
            <summary className="px-4 py-3 font-semibold">Importa da file CSV o Excel</summary>
            <div className="space-y-2 border-t border-line p-4">
              <p className="text-sm text-ink-2">
                Colonne riconosciute: nome (obbligatoria), ruolo, squadra, prezzo, note.{" "}
                <a href="/api/templates/rosa" download className="font-semibold text-prato underline">Scarica il modello</a>.
              </p>
              <ImportWizard mode="file" kinds={["rosa"]} />
            </div>
          </details>
          <details className="rounded-lg border border-line">
            <summary className="px-4 py-3 font-semibold">Inserimento manuale (giocatore non trovato)</summary>
            <div className="border-t border-line p-4">
              <ActionForm action={createManualPlayerAction} submitLabel="Aggiungi alla rosa">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nome e cognome">
                    <input name="name" className="input" required />
                  </Field>
                  <Field label="Squadra di Serie A">
                    <input name="team" className="input" placeholder="es. Inter" />
                  </Field>
                  <Field label="Ruolo">
                    <select name="role" className="input" required defaultValue="">
                      <option value="" disabled>Scegli</option>
                      <option value="P">P, portiere</option>
                      <option value="D">D, difensore</option>
                      <option value="C">C, centrocampista</option>
                      <option value="A">A, attaccante</option>
                    </select>
                  </Field>
                  <Field label="Ruoli Mantra (facoltativo)" help="Separati da punto e virgola, es. Dc;Ds">
                    <input name="rolesMantra" className="input" />
                  </Field>
                  <Field label="Prezzo d'acquisto (facoltativo)">
                    <input name="price" className="input" inputMode="numeric" />
                  </Field>
                </div>
              </ActionForm>
            </div>
          </details>
        </div>
      </Section>

      <Section title={`Giocatori in rosa (${roster.length})`}>
        {roster.length === 0 ? (
          <p className="text-sm text-ink-2">Nessun giocatore inserito.</p>
        ) : (
          <ul className="-mx-4 divide-y divide-line border-t border-line">
            {roster.map((p) => {
              const ev = evBy.get(p.id);
              return (
                <li key={p.id} className="px-4 py-2.5">
                  <details>
                    <summary className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_auto_auto_auto]">
                      <RoleBadge role={p.role_classic} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{p.full_name}</span>
                        <span className="block truncate text-xs text-ink-2 sm:hidden">{p.team_name ?? "squadra n.d."}</span>
                        {p.notes && <span className="block truncate text-xs text-ink-3">{p.notes}</span>}
                      </span>
                      <span className="hidden truncate text-sm sm:block">{p.team_name ?? <span className="text-ink-3">n.d.</span>}</span>
                      <span className="hidden sm:block">
                        {ev ? <StatusTag status={ev.playing.availability === "dubbio" ? "dubbio" : ev.playing.availability} label={ev.playing.availabilityLabel} /> : <StatusTag status={p.status} label={STATUS_LABEL[p.status]} />}
                      </span>
                      <span className="hidden sm:block">
                        {p.official_verified ? (
                          <Tag tone="ok" icon={<BadgeCheck size={13} aria-hidden />} title={`Ultima verifica: ${formatDateTime(p.last_verified_at)}`}>
                            Fonte
                          </Tag>
                        ) : (
                          <Tag tone="warn" icon={<CircleHelp size={13} aria-hidden />} title="Inserito manualmente, non associato a un identificativo ufficiale">
                            Manuale
                          </Tag>
                        )}
                      </span>
                      <span className="text-right" title="Fantavalue della giornata selezionata">
                        <Fantavalue index={ev?.fantavalue?.index} compact />
                      </span>
                    </summary>
                    <div className="mt-3 grid gap-4 rounded-lg bg-surface-2 p-3 sm:grid-cols-2">
                      <div className="space-y-2 text-sm">
                        <div className="flex flex-wrap gap-1.5 sm:hidden">
                          {ev ? <StatusTag status={ev.playing.availability === "dubbio" ? "dubbio" : ev.playing.availability} label={ev.playing.availabilityLabel} /> : <StatusTag status={p.status} label={STATUS_LABEL[p.status]} />}
                          {p.official_verified ? <Tag tone="ok">Fonte</Tag> : <Tag tone="warn">Manuale</Tag>}
                        </div>
                        {p.role_classic_source?.includes("stimato") && <p className="text-xs text-warn">Ruolo stimato dalla posizione reale: verificalo con il listone.</p>}
                        <Link href={`/giocatore/${p.id}${md.matchday ? `?g=${md.matchday}` : ""}`} className="font-semibold text-prato underline">
                          Apri la scheda analitica
                        </Link>
                        <form action={updateRosterEntryAction} className="grid grid-cols-[1fr_6rem] gap-2">
                          <input type="hidden" name="playerId" value={p.id} />
                          <Field label="Note personali">
                            <input name="notes" className="input" defaultValue={p.notes ?? ""} />
                          </Field>
                          <Field label="Prezzo">
                            <input name="price" className="input" defaultValue={p.purchase_price ?? ""} inputMode="numeric" />
                          </Field>
                          <button className="btn btn-ghost col-span-2 justify-self-start !py-1 text-xs">Salva note e prezzo</button>
                        </form>
                      </div>
                      <div className="space-y-3 text-sm">
                        <div>
                          <div className="mb-1 font-semibold">Sostituisci con</div>
                          <RosterSearch rosterIds={rosterIds} replaceId={p.id} placeholder="Cerca il sostituto" />
                        </div>
                        <form action={removeFromRosterAction}>
                          <input type="hidden" name="playerId" value={p.id} />
                          <button className="btn btn-danger !py-1 text-xs">Rimuovi dalla rosa</button>
                          <p className="mt-1 text-xs text-ink-3">Lo storico delle giornate passate resta salvato.</p>
                        </form>
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Cronologia delle modifiche alla rosa">
        {history.length === 0 ? (
          <p className="text-sm text-ink-2">Nessuna modifica registrata.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {history.map((h) => {
              const d = h.details ? (JSON.parse(h.details) as Record<string, unknown>) : {};
              return (
                <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    <strong>{ACTION_LABEL[h.action] ?? h.action}</strong>: {h.full_name ?? "giocatore"}
                    {h.action === "trasferimento" && d.nuovaSquadra ? ` ora al ${String(d.nuovaSquadra)} (fonte: ${String(d.fonte)})` : ""}
                  </span>
                  <span className="text-ink-3">{formatDateTime(h.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
