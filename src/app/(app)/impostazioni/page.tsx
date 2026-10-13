import { requireContext } from "@/lib/auth/session";
import { getLeagueSettings } from "@/lib/repo/data";
import { CLASSIC_MODULES, MANTRA_MODULES_PROVVISORI } from "@/lib/domain/settings";
import { formatDateTime } from "@/lib/domain/time";
import { saveSettingsAction } from "@/app/actions/data";
import { changePasswordAction, setModeAction } from "@/app/actions/auth";
import { ActionForm, Field } from "@/components/ActionForm";
import { AuthForm } from "@/components/AuthForm";
import { Section, Notice } from "@/components/ui";

export const metadata = { title: "Impostazioni" };

function Num({ name, label, value, step = "0.5" }: { name: string; label: string; value: number; step?: string }) {
  return (
    <Field label={label}>
      <input name={name} type="number" step={step} defaultValue={value} className="input num" />
    </Field>
  );
}

export default async function ImpostazioniPage() {
  const { user, db, mode } = await requireContext();
  const { config: c, provisional, updatedAt } = getLeagueSettings(db, user.id);
  const mantraText = (c.mode === "mantra" ? c.formazione.moduli : MANTRA_MODULES_PROVVISORI).map((m) => `${m.name}: ${m.slots.map((s) => s.join(";")).join(" | ")}`).join("\n");
  const soglie = [0, 1, 2].map((i) => c.modificatoreDifesa.soglie[i] ?? { daMedia: "", bonus: "" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Impostazioni</h1>
        <p className="text-ink-2">Il regolamento della tua lega: proiezioni e formazione consigliata lo rispettano.</p>
      </div>
      {provisional ? (
        <Notice tone="warn">Regolamento provvisorio: i valori sono quelli più diffusi nelle leghe Classic e potrebbero non coincidere con la tua lega. Controllali e spunta la conferma in fondo.</Notice>
      ) : (
        <Notice tone="info">Regolamento confermato il {formatDateTime(updatedAt)}.</Notice>
      )}

      <Section title="Regolamento della lega">
        <ActionForm action={saveSettingsAction} submitLabel="Salva regolamento">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Nome della lega (facoltativo)">
              <input name="nomeLega" className="input" defaultValue={c.nomeLega} />
            </Field>
            <Field label="Modalità">
              <select name="mode" className="input" defaultValue={c.mode}>
                <option value="classic">Fantacalcio Classic</option>
                <option value="mantra">Fantacalcio Mantra</option>
              </select>
            </Field>
          </div>

          <fieldset className="space-y-3 rounded-lg border border-line p-4">
            <legend className="px-1 font-display text-lg font-semibold">Bonus</legend>
            <div className="grid gap-3 sm:grid-cols-4">
              <Num name="gol_P" label="Gol del portiere" value={c.bonus.gol.P} />
              <Num name="gol_D" label="Gol del difensore" value={c.bonus.gol.D} />
              <Num name="gol_C" label="Gol del centrocampista" value={c.bonus.gol.C} />
              <Num name="gol_A" label="Gol dell'attaccante" value={c.bonus.gol.A} />
              <Num name="assist" label="Assist" value={c.bonus.assist} />
              <Num name="rigoreSegnato" label="Rigore segnato" value={c.bonus.rigoreSegnato} />
              <Num name="rigoreParato" label="Rigore parato" value={c.bonus.rigoreParato} />
              <Num name="portaInviolata" label="Porta inviolata (portiere)" value={c.bonus.portaInviolata} />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-line p-4">
            <legend className="px-1 font-display text-lg font-semibold">Malus (valori positivi da sottrarre)</legend>
            <div className="grid gap-3 sm:grid-cols-5">
              <Num name="golSubito" label="Gol subito (portiere)" value={c.malus.golSubito} />
              <Num name="ammonizione" label="Ammonizione" value={c.malus.ammonizione} />
              <Num name="espulsione" label="Espulsione" value={c.malus.espulsione} />
              <Num name="autogol" label="Autogol" value={c.malus.autogol} />
              <Num name="rigoreSbagliato" label="Rigore sbagliato" value={c.malus.rigoreSbagliato} />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-line p-4">
            <legend className="px-1 font-display text-lg font-semibold">Modificatore difesa e gol squadra</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="modDifesa" defaultChecked={c.modificatoreDifesa.attivo} /> Modificatore difesa attivo (media voto del portiere e dei 3 migliori difensori)
            </label>
            <div className="grid gap-3 sm:grid-cols-4">
              <Num name="minDifensori" label="Difensori minimi schierati" value={c.modificatoreDifesa.minDifensori} step="1" />
              {soglie.map((s, i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <Field label={`Da media ${i + 1}`}>
                    <input name={`md_soglia_${i + 1}`} type="number" step="0.25" defaultValue={s.daMedia} className="input num" />
                  </Field>
                  <Field label="Bonus">
                    <input name={`md_bonus_${i + 1}`} type="number" step="0.5" defaultValue={s.bonus} className="input num" />
                  </Field>
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Num name="soglia" label="Soglia del primo gol squadra" value={c.golSquadra.soglia} step="1" />
              <Num name="passo" label="Punti per ogni gol successivo" value={c.golSquadra.passo} step="1" />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-line p-4">
            <legend className="px-1 font-display text-lg font-semibold">Formazione e panchina</legend>
            <div>
              <div className="mb-1 text-sm font-semibold">Moduli ammessi (Classic)</div>
              <div className="flex flex-wrap gap-3">
                {CLASSIC_MODULES.map((m) => (
                  <label key={m} className="num flex items-center gap-1.5">
                    <input type="checkbox" name={`modulo_${m}`} defaultChecked={c.mode === "classic" ? c.formazione.moduli.some((x) => x.name === m) : true} /> {m}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Moduli Mantra (una riga per modulo: nome, poi gli 11 slot separati da |, ruoli alternativi separati da ;)" help="I moduli proposti sono provvisori e semplificati: verifica gli slot con il regolamento Mantra della tua lega.">
              <textarea name="mantraModules" className="input min-h-28 font-mono text-xs" defaultValue={mantraText} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-4">
              <Num name="panchina" label="Giocatori in panchina" value={c.formazione.panchina} step="1" />
              <Num name="maxSostituzioni" label="Sostituzioni massime" value={c.formazione.maxSostituzioni} step="1" />
              <Field label="Regola delle sostituzioni">
                <select name="regolaSostituzioni" className="input" defaultValue={c.formazione.regolaSostituzioni}>
                  <option value="ruolo_per_ruolo">Ruolo per ruolo, in ordine di panchina</option>
                  <option value="panchina_libera">Panchina libera (primo disponibile)</option>
                </select>
              </Field>
              <Field label="Giocatore senza voto e senza sostituto">
                <select name="senzaVoto" className="input" defaultValue={c.formazione.senzaVoto}>
                  <option value="zero">Vale 0</option>
                  <option value="voto_ufficio">Voto d&apos;ufficio</option>
                </select>
              </Field>
              <Num name="votoUfficio" label="Valore del voto d'ufficio" value={c.formazione.votoUfficio} />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-line p-4">
            <legend className="px-1 font-display text-lg font-semibold">Composizione della rosa</legend>
            <div className="grid gap-3 sm:grid-cols-4">
              <Num name="rosa_P" label="Portieri" value={c.rosa.P} step="1" />
              <Num name="rosa_D" label="Difensori" value={c.rosa.D} step="1" />
              <Num name="rosa_C" label="Centrocampisti" value={c.rosa.C} step="1" />
              <Num name="rosa_A" label="Attaccanti" value={c.rosa.A} step="1" />
            </div>
            <Field label="Regole specifiche della lega (promemoria)">
              <textarea name="regoleSpecifiche" className="input min-h-20" defaultValue={c.regoleSpecifiche} />
            </Field>
          </fieldset>

          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" name="confirmed" defaultChecked={!provisional} /> Confermo che questi valori corrispondono al regolamento della mia lega
          </label>
        </ActionForm>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Account">
          <p className="mb-3 text-sm text-ink-2">
            Accesso come <strong>{user.username}</strong>. La rosa, le impostazioni e le formazioni sono visibili solo a te; i dati di campionato e le segnalazioni con fonte sono condivisi con gli altri utenti di questa installazione.
          </p>
          <AuthForm
            action={changePasswordAction}
            submitLabel="Cambia password"
            fields={[
              { name: "current", label: "Password attuale", type: "password", autoComplete: "current-password" },
              { name: "next", label: "Nuova password", type: "password", autoComplete: "new-password", help: "Almeno 10 caratteri, con lettere e numeri." },
            ]}
          />
        </Section>
        <Section title="Modalità demo">
          <p className="mb-3 text-sm text-ink-2">La modalità demo usa un database separato con squadre e giocatori inventati, utile per provare l&apos;interfaccia. Non si mescola mai con i dati reali.</p>
          <form action={setModeAction}>
            <input type="hidden" name="mode" value={mode === "demo" ? "reale" : "demo"} />
            <button className="btn btn-ghost">{mode === "demo" ? "Torna ai dati reali" : "Apri la modalità demo"}</button>
          </form>
        </Section>
      </div>
    </div>
  );
}
