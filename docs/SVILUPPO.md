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

## Stato (13/10/2026)

Fatto: schema DB, auth multiutente con codice invito, connettori verificati (openfootball, TheSportsDB, RSS SOS Fanta senza chiave; football-data e API-Football con chiave, non verificati senza credenziali), sync + planner + scheduler, modello completo, import, demo, tutte le pagine (Dashboard, Rosa, Formazione, Giornata, Ballottaggi, Giocatore, Fonti, Storico, Impostazioni, Altro, login/setup/registrati). `npx tsc --noEmit` pulito.

Da fare: prova completa nel browser e correzioni; test vitest; `npm run build` e lint; README, .env.example, Dockerfile, LICENSE; pubblicazione su GitHub.
