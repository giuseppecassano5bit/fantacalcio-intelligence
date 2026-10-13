# Note di sviluppo

Documento per chi contribuisce al codice (e per riprendere il lavoro in una nuova sessione).

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4.
- Database: SQLite tramite `node:sqlite` (integrato in Node ≥ 22.13, nessuna compilazione nativa). File in `data/` (ignorato da git).
- `cacheComponents` disattivato: l'app è interamente dinamica.
- `proxy.ts` (ex middleware) fa solo il controllo ottimistico del cookie; la sessione vera è verificata lato server.
- Scheduler in-process avviato da `src/instrumentation.ts`; in alternativa `/api/cron` protetto da `CRON_SECRET`.

## Struttura

```
src/lib/db            connessione, migrazioni (migrations.ts), helper SQL
src/lib/domain        normalizzazione nomi/squadre, fusi orari, regolamento (settings.ts), fantavoto
src/lib/auth          password (scrypt), sessioni su cookie httpOnly
src/lib/repo          accesso ai dati: league (squadre/partite), players (catalogo+rosa), data (statistiche, disponibilità, formazioni, pareri, notizie), sync
src/lib/connectors    connettori indipendenti: openfootball, thesportsdb, footballData, apiFootball, rss (+ http.ts con cache/retry/rate limit)
src/lib/sync          engine (esecuzione), planner (quando aggiornare), scheduler
src/lib/model         modello statistico puro e testabile:
                        priors (iperparametri), teamStrength, playerRates (shrinkage Gamma-Poisson),
                        availability (titolarità), evaluate (probabilità+affidabilità+fattori),
                        simulate (Monte Carlo congiunto), fantavalue, lineup (ungherese + ricerca locale),
                        compare (ballottaggi), consensus (fonti editoriali), calibration (Brier/log loss)
src/lib/analysis      pipeline DB -> modello, persistenza valutazioni e registro variazioni, raccomandazioni
src/lib/importers     CSV/XLSX, formati Fantacalcio.it (listone, statistiche, voti), modelli CSV
src/lib/demo          dati demo fittizi in database separato (data/demo.sqlite)
src/app/(app)         pagine autenticate; src/app/(auth) login/setup/registrati; src/app/api
```

## Convenzioni sui dati

- `player_season_stats.goals` = gol totali (rigori compresi); `player_match_stats.goals` = gol su azione (rigori in `pen_scored`).
- Un dato mancante resta `NULL`, mai 0: i tassi senza dato restano sul prior e l'affidabilità scende.
- Ogni informazione manuale (infortuni, probabili, pareri) richiede la fonte.
- Le indiscrezioni (RSS o manuali) non modificano le probabilità finché non vengono confermate.
- Precedenza fonti per partite: football-data (30) > api-football (25) > thesportsdb (20) > openfootball (10). Le differenze finiscono in `data_discrepancies`.

## Avvio e distribuzione

- `scripts/avvia.mjs`: avvio unico per Codespaces, Mac, Windows e Linux. Installa le dipendenze (`npm ci` solo se `package-lock.json` è cambiato), compila in `.next-app/` solo se cambia l'impronta dei sorgenti, copia `static` e `public` nel pacchetto standalone, avvia `server.js` con i database in `data/` (percorsi assoluti), aspetta `/api/health` e apre il browser. In locale imposta `INSECURE_COOKIES=true` (http); `--rete` ascolta su 0.0.0.0 per il telefono.
- `.devcontainer/devcontainer.json`: Codespaces (immagine Node 24). `onCreateCommand` prepara (`--prepara`), `postAttachCommand` avvia; la porta 3000 si apre nel browser. `LOG_REQUESTS=true` stampa una riga per pagina, perché l'output del terminale tiene acceso il codespace. Il proxy delle porte riscrive `Origin` in `localhost:3000` (mentre `x-forwarded-host` è il dominio pubblico): per questo `next.config.ts` ammette `localhost:3000` e `*.<dominio>` quando `CODESPACES=true`. Senza questa voce login e registrazione falliscono con "Invalid Server Actions request". I comandi di avvio non ricevono sempre `CODESPACE_NAME`, `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` e i segreti: `avvia.mjs` li legge da `/workspaces/.codespaces/shared/user-secrets-envs.json`. La feature `sshd` permette `gh codespace ssh`.
- `scripts/installa.sh` / `scripts/installa.ps1`: installazione con un comando. Scaricano l'archivio del ramo (`FANTA_REF`, predefinito `main`) in `~/FantaIntelligence` (`FANTA_DIR`) e, se serve, una copia privata di Node 24 verificata con SHA-256 (`FANTA_SCARICA_NODE=1` la forza). Non toccano `data/`, `.env` e `node_modules`.
- Avviatori con doppio clic nella radice: `Avvia-Mac.command`, `Avvia-Windows.bat` (CRLF, vedi `.gitattributes`), `Avvia-Linux.sh`.
- Chiavi delle fonti: `src/lib/connectors/keys.ts`. Vale prima la variabile d'ambiente, poi la chiave salvata in `app_state` (`api_key:<NOME>`), che l'amministratore (primo utente, `isAdmin`) incolla nella pagina Fonti. Se la fonte risponde 400/401/403 la chiave non viene salvata; se è valida parte subito un aggiornamento completo (`after`).
- CI: `.github/workflows/verifica.yml` esegue test, lint e tipi, poi prova l'installazione con un comando su ubuntu, macos e windows.

Verifiche del 13/10/2026: in un Codespace reale (2 core, 8 GB) la creazione prepara tutto in meno di un minuto, all'avvio successivo non ricompila, il calendario si scarica da solo e i moduli funzionano dall'indirizzo pubblico (provati a 375 px). L'installazione con un comando è verificata sul Mac e, dalla CI, su windows-latest, macos-latest e ubuntu-latest.

Misure (13/10/2026, Mac Apple Silicon): compilazione con picco di circa 2,3 GB di RSS totale (9 worker); server in uso circa 280 MB, con calendario scaricato e simulazioni demo. Spazio su disco: `node_modules` 620 MB, `.next-app` 155 MB.

## Stato (13/10/2026)

Completato: tutte le funzionalità della prima versione, 62 test vitest verdi, lint pulito, build di produzione e server standalone verificati, collaudo nel browser (desktop e 375 px), README, .env.example, Dockerfile (non provato: Docker non disponibile sulla macchina di sviluppo), licenza MIT. Avvio con un clic in Codespaces e installazione con un comando (vedi sopra).

Prossimi passi possibili: verificare football-data.org e API-Football con chiavi reali; provare l'import con file scaricati da Fantacalcio.it; rifinire la modalità Mantra (malus fuori ruolo); notifiche per variazioni rilevanti.

Collaudo locale: `.claude/launch.json` nella cartella superiore definisce `fantaintelligence-collaudo` (porta 3200, database `data/collaudo.sqlite`, codice invito `collaudo-invito`). Per provare `avvia.mjs` senza toccare il database personale: `DATABASE_PATH=/tmp/prova.sqlite node scripts/avvia.mjs --porta 3300`.
