# FantaIntelligence

**Assistente decisionale open source per il fantacalcio di Serie A 2026/27.** Inserisci la tua rosa una volta sola: l'app stima per ogni giornata titolarità, probabilità di bonus e malus e punti attesi, poi costruisce la formazione migliore secondo il regolamento della tua lega e spiega ogni scelta.

> Ogni probabilità è una **stima**, mai una certezza. I dati che mancano vengono segnalati e mai inventati: se un'informazione non c'è, l'app mostra "Dati insufficienti" e abbassa l'affidabilità.

## Cosa fa

- **La mia rosa**: la inserisci una volta (ricerca con suggerimenti, elenco incollato, file CSV o Excel, inserimento manuale) e resta salvata. Se un giocatore cambia squadra nella realtà, resta nella tua rosa.
- **Regolamento della lega**: Classic o Mantra; bonus e malus; modificatore difesa; soglie dei gol; moduli; panchina; numero di sostituzioni; regola per chi resta senza voto.
- **Formazione consigliata** con tre strategie che cambiano davvero l'obiettivo dell'algoritmo:
  - *Equilibrata*: massimizza la media;
  - *A caccia di bonus*: dà peso allo scenario favorevole;
  - *Sicurezza*: dà peso allo scenario sfavorevole.

  La formazione viene ottimizzata sull'intera squadra simulata, panchina e sostituzioni comprese, e per ogni giocatore spiega "perché lo schiero" e "perché lo tengo in panchina".
- **Scheda di ogni giocatore**:
  - titolarità, minuti attesi, infortuni con fonte;
  - forma nelle ultime 5 e 10 partite;
  - contesto della partita, analisi specifica per ruolo;
  - probabilità di gol, assist, ammonizione, espulsione, autogol, rigore sbagliato e senza voto, ciascuna con un intervallo di incertezza;
  - **Fantavalue** (0-100) con le componenti che lo determinano.
- **Ballottaggi**: confronto diretto tra due o più giocatori, con prima e seconda scelta, alternativa rischiosa e cosa potrebbe cambiare la decisione.
- **Analisi giornata**: tutte le partite, ordinabili per potenziale offensivo, bonus per i tuoi giocatori o rischio difensivo.
- **Fonti e aggiornamenti**: stato reale di ogni fonte dati, errori, discrepanze tra fonti e import dei file.
- **Storico**: formazioni salvate, punteggi previsti e reali, calibrazione delle previsioni (Brier score, log loss, confronto con una baseline) e registro di ogni variazione di valutazione con il suo motivo.
- **Aggiornamento automatico** legato al calendario reale: le giornate non iniziano tutte negli stessi giorni, quindi la finestra delle 24 ore si apre prima di *ogni* partita. In più c'è il pulsante **Aggiorna** per un aggiornamento immediato.
- **Multiutente**: tu e i tuoi amici sulla stessa installazione. Rosa, regolamento e formazioni restano privati per ciascuno.
- **Modalità demo** con dati palesemente fittizi, in un database separato, per provare l'interfaccia.

## Provala subito

### 1. Nel cloud, con un clic (niente da installare)

[![Apri in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/giuseppecassano5bit/fantacalcio-intelligence?quickstart=1)

Link da condividere: **https://codespaces.new/giuseppecassano5bit/fantacalcio-intelligence?quickstart=1**

Serve solo un account GitHub gratuito. Il link crea una piccola macchina virtuale personale (2 processori, 8 GB di RAM) che installa, compila e avvia l'app da sola. Dopo qualche minuto l'app si apre in una nuova scheda del browser e nel codespace compare una guida ([docs/CODESPACES.md](docs/CODESPACES.md)). È gratis fino a 60 ore di utilizzo al mese. La macchina si spegne da sola dopo 30 minuti senza attività e si riapre da https://github.com/codespaces con i dati intatti.

### 2. Sul tuo computer, con un comando

Il comando scarica l'app nella cartella `FantaIntelligence` del tuo utente. Se Node.js manca, ne scarica una copia privata da nodejs.org (senza permessi di amministratore). Poi compila l'app, la avvia e apre il browser. Per aggiornare l'app basta rilanciare lo stesso comando: i tuoi dati restano dove sono.

**Mac o Linux**: apri il Terminale e incolla

```bash
curl -fsSL https://raw.githubusercontent.com/giuseppecassano5bit/fantacalcio-intelligence/main/scripts/installa.sh | bash
```

**Windows**: apri PowerShell (menu Start, scrivi "PowerShell") e incolla

```powershell
irm https://raw.githubusercontent.com/giuseppecassano5bit/fantacalcio-intelligence/main/scripts/installa.ps1 | iex
```

Le volte successive basta un doppio clic su `Avvia-Mac.command` (Mac) o `Avvia-Windows.bat` (Windows) nella cartella `FantaIntelligence`. Su Linux si usa `./Avvia-Linux.sh`.

In alternativa puoi scaricare lo [ZIP del progetto](https://github.com/giuseppecassano5bit/fantacalcio-intelligence/archive/refs/heads/main.zip), estrarlo e fare doppio clic sullo stesso file. In questo caso serve [Node.js LTS](https://nodejs.org/it/download) già installato. Su Mac, macOS può bloccare i file scaricati dal browser. In quel caso apri **Impostazioni di Sistema → Privacy e sicurezza** e premi **Apri comunque**. Il comando qui sopra non ha questo problema.

Al primo accesso crei il tuo account, che diventa l'amministratore. Il calendario della Serie A si scarica da solo. Poi inserisci la rosa in **La mia rosa** e il regolamento in **Impostazioni**. Per provare con dati inventati scegli **Prova la modalità demo** dal menu.

### Requisiti

| | Cloud (Codespaces) | Sul computer |
| --- | --- | --- |
| RAM | inclusa (8 GB) | **4 GB** minimo, 8 GB consigliati. La prima compilazione usa circa 2 GB per un paio di minuti; poi l'app in uso occupa circa 300 MB |
| Disco | incluso | circa 1 GB (dipendenze e compilazione) |
| Sistema | qualsiasi browser | Windows 10 o 11, macOS 13.5 o successivo, Linux a 64 bit (x64 o arm64) |
| Account | GitHub (gratuito) | nessuno |

### Dal telefono

L'interfaccia è pensata anche per lo smartphone. Il server, però, deve girare nel cloud o su un computer: sul telefono non si può installare.
- **Codespaces**: apri l'indirizzo dell'app (`…-3000.app.github.dev`) dal browser del telefono, entrando con lo stesso account GitHub. Puoi anche avviare il codespace da https://github.com/codespaces.
- **Computer di casa**: avvia l'app con l'opzione `--rete`. Il terminale mostra l'indirizzo da aprire sul telefono collegato alla stessa rete Wi-Fi. Esempio su Mac: `./Avvia-Mac.command --rete`. Usala solo su reti di cui ti fidi.

### Per chi sviluppa

```bash
git clone https://github.com/giuseppecassano5bit/fantacalcio-intelligence.git
```

```bash
cd fantacalcio-intelligence && npm install && npm run dev
```

L'app di sviluppo è su http://localhost:3000. `node scripts/avvia.mjs` avvia invece la versione di produzione: è lo stesso script usato da Codespaces e dagli avviatori con doppio clic.

## Da dove arrivano i dati

| Fonte | Chiave | Cosa fornisce | Stato |
| --- | --- | --- | --- |
| [openfootball](https://github.com/openfootball/football.json) | no | calendario completo e risultati (con qualche giorno di ritardo) | **verificata**: 380 partite 2026/27 |
| [TheSportsDB](https://www.thesportsdb.com/free_sports_api) | chiave pubblica "123" | orari ufficiali, stato e risultati per giornata | **verificata** |
| Feed RSS di [SOS Fanta](https://www.sosfanta.com/feed) | no | titoli e link delle notizie; quelle sugli infortuni diventano "indiscrezioni da verificare" | **verificata** |
| [football-data.org](https://www.football-data.org/) | gratuita (registrazione) | calendario, risultati, **rose ufficiali con trasferimenti**, marcatori | implementata, da verificare con la tua chiave |
| [API-Football](https://www.api-football.com/) | piano gratuito o a pagamento | infortuni, **formazioni ufficiali**, minuti, tiri, cartellini, rigori | implementata, da verificare con la tua chiave (il piano gratuito potrebbe non coprire la stagione corrente: il test lo dice) |
| File di Fantacalcio.it (import manuale) | account gratuito sul sito | listone (ruoli ufficiali), statistiche stagionali, voti di ogni giornata | importatore testato con file d'esempio nel formato del sito; se il formato reale cambia, l'anteprima mostra cosa non è stato riconosciuto |
| Inserimento manuale | — | probabili formazioni, infortuni, pareri delle fonti, note tattiche (sempre con fonte e link) | funzionante |

Cosa l'app **non** fa, per scelta:
- non fa scraping dei siti di fantacalcio: il `robots.txt` di Fantacalcio.it vieta ad esempio le probabili formazioni;
- non aggira paywall o login;
- non simula pareri degli esperti mai raccolti.

I file di Fantacalcio.it li scarichi tu dal sito e li carichi in **Fonti e aggiornamenti → Importa dati**.

### Consiglio per avere dati completi senza spendere

1. Registrati su [football-data.org](https://www.football-data.org/client/register) (gratuito): la chiave arriva via email. Incollala in **Fonti e aggiornamenti** nel riquadro di football-data.org e premi **Salva e verifica**. Avrai il catalogo completo dei giocatori di Serie A con le squadre aggiornate. Ogni installazione usa la propria chiave: le chiavi sono personali e non vanno pubblicate.
2. Ogni tanto scarica da Fantacalcio.it le **Statistiche** e, dopo ogni giornata, i **Voti**, poi importali: titolarità, forma e calibrazione miglioreranno molto.
3. Facoltativo: aggiungi le probabili formazioni (dalla scheda giocatore o con il modello CSV) indicando sempre la fonte.

## Configurazione

Copia `.env.example` in `.env.local` (sviluppo) oppure in `.env` (produzione). Le voci principali:

| Variabile | A cosa serve |
| --- | --- |
| `INVITE_CODE` | codice da dare agli amici per registrarsi su `/registrati` (vuoto = registrazioni chiuse) |
| `SETUP_TOKEN` | protegge la creazione del primo account quando l'app è online |
| `FOOTBALL_DATA_API_KEY`, `API_FOOTBALL_KEY` | chiavi delle fonti dati; restano solo sul server, mai nel browser. In alternativa l'amministratore le incolla nella pagina **Fonti**. In Codespaces si possono salvare come [segreti personali](https://github.com/settings/codespaces) |
| `SERVER_ACTIONS_ALLOWED_ORIGINS` | domini aggiuntivi (separati da virgola) da cui accettare i moduli, se un proxy inoltra un host diverso da quello pubblico |
| `CRON_SECRET` | abilita `GET /api/cron` per gli aggiornamenti da uno scheduler esterno |
| `SCHEDULER_ENABLED` | scheduler interno (predefinito: attivo) |
| `DATABASE_PATH` | dove salvare il database (predefinito `./data/fantacalcio.sqlite`) |

## Metterlo online per gli amici

L'app ha bisogno di un **processo sempre attivo** (per lo scheduler) e di un **disco persistente** (per il database SQLite). Vanno bene una piccola VPS, un Raspberry Pi o servizi con volume persistente come Fly.io o Railway. Vercel invece **non** è adatto, perché il suo file system non conserva il database.

Con Docker (il Dockerfile non è stato ancora provato in un ambiente Docker):

```bash
cp .env.example .env
```

```bash
docker compose up -d --build
```

Senza Docker, su un server con Node 24:

```bash
npm ci && npm run build
```

```bash
cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
```

```bash
DATABASE_PATH=/var/lib/fanta/fantacalcio.sqlite node .next/standalone/server.js
```

Metti l'app dietro un proxy HTTPS (Caddy o nginx): i cookie di sessione sono `Secure` in produzione. Se la piattaforma spegne i processi inattivi, disattiva lo scheduler interno e chiama `/api/cron` ogni 10-15 minuti da uno scheduler esterno (cron-job.org, GitHub Actions) con l'intestazione `Authorization: Bearer <CRON_SECRET>`.

## Come funziona il modello (in breve)

- **Tassi individuali** per 90 minuti (gol su azione, assist, cartellini): uniscono i dati reali a valori di partenza per ruolo, con un peso decrescente man mano che i minuti osservati aumentano (shrinkage Gamma-Poisson). Le partite recenti pesano di più e la stagione precedente conta a metà. Se ci sono xG e xA, entrano per il 60%.
- **Titolarità**: la formazione ufficiale ha la precedenza su tutto. Seguono gli infortuni confermati, le probabili formazioni (pesate per freschezza) e lo storico d'impiego. Le indiscrezioni non cambiano le stime finché non le confermi.
- **Partita**: forza d'attacco e di difesa di ogni squadra stimata dai risultati, con il fattore campo. Se importi i dati avanzati (xG e tiri) li usa e descrive il profilo difensivo dell'avversario. Non giudica mai una difesa "facile" solo dai gol subiti.
- **Rigore sbagliato**: probabilità che venga assegnato un rigore alla squadra × probabilità che il giocatore sia il rigorista in campo × probabilità di errore se calcia.
- **Simulazione Monte Carlo** (4000 giornate) con variabilità comune per squadra. Da qui escono fantavoto atteso, scenari e la probabilità di prendere voto.
- **Formazione**: per ogni modulo, assegnazione ottimale con l'algoritmo ungherese, poi ricerca locale sul punteggio della squadra simulato con panchina, sostituzioni ruolo per ruolo e modificatore difesa.
- **Calibrazione**: le previsioni fatte prima di ogni partita vengono confrontate con i voti importati. Il modello non si modifica da solo.

Dettagli per chi vuole contribuire: [`docs/SVILUPPO.md`](docs/SVILUPPO.md).

## Test

```bash
npm test
```

Sono 62 test automatici: modello statistico, ottimizzatore della formazione, ballottaggi, pianificatore degli aggiornamenti (finestre delle 24 ore e delle 3 ore, risultati, formazioni ufficiali), importatori dei file di Fantacalcio.it, precedenza delle fonti e discrepanze, rosa permanente con trasferimenti, isolamento tra utenti, parser RSS, password, chiavi delle fonti. A ogni modifica su GitHub una verifica automatica ([`verifica.yml`](.github/workflows/verifica.yml)) esegue test, lint e controllo dei tipi e prova l'installazione con un comando su Windows, macOS e Linux. Nello sviluppo sono stati verificati anche `npm run lint`, `npm run build` e il server di produzione standalone.

## Limiti noti

- Senza statistiche importate o chiavi API, molte stime si basano sui valori per ruolo: l'app lo segnala con un avviso e con l'affidabilità bassa.
- La modalità Mantra usa moduli di partenza **provvisori e semplificati**: va controllata con il regolamento della propria lega.
- I connettori football-data.org e API-Football sono scritti secondo la documentazione ufficiale, ma non sono ancora stati provati con chiavi reali.
- Il punteggio reale nello storico non applica il modificatore difesa.

## Contribuire

Segnalazioni e proposte sono benvenute nelle [Issues](https://github.com/giuseppecassano5bit/fantacalcio-intelligence/issues). Prima di aprire una pull request esegui `npm test` e `npm run lint`.

Licenza [MIT](LICENSE). Il progetto non è affiliato a Lega Serie A, Fantacalcio.it né ad altre fonti citate. I loro contenuti restano dei rispettivi titolari.
