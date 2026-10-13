# FantaIntelligence nel cloud (GitHub Codespaces)

Benvenuto! Questa è la tua copia personale di FantaIntelligence: un piccolo server nel cloud di GitHub (2 processori, 8 GB di RAM) che usa solo i tuoi dati.

## 1. Aspetta che l'app si avvii

Nel **terminale in basso** compaiono i messaggi di avvio. Il primo avvio dura qualche minuto. Quando leggi **"FantaIntelligence è pronta!"**, l'app si apre in una nuova scheda del browser.

Se la scheda non si apre (alcuni browser bloccano le finestre automatiche):
1. in basso apri la scheda **PORTE** (o *PORTS*);
2. sulla riga **3000 – FantaIntelligence** clicca l'icona del **globo** («Apri nel browser»).

L'indirizzo dell'app finisce con `.app.github.dev` ed è privato: lo apre solo chi ha effettuato l'accesso con il tuo account GitHub.

## 2. Primo accesso

- Crea il tuo account: sei l'amministratore di questa copia.
- Il calendario della Serie A si scarica da solo entro un paio di minuti (oppure premi **Aggiorna**).
- Inserisci la rosa in **La mia rosa** e il regolamento in **Impostazioni**.

## 3. Facoltativo: dati più completi con football-data.org

L'app funziona già senza chiavi. Con la chiave gratuita di football-data.org ottieni anche le rose ufficiali con i trasferimenti e la classifica marcatori:
1. registrati su https://www.football-data.org/client/register (la chiave arriva via email);
2. nell'app apri **Fonti e aggiornamenti**, incolla la chiave nel riquadro di football-data.org e premi **Salva e verifica**.

In alternativa puoi salvarla una volta per tutte nei segreti personali di Codespaces (https://github.com/settings/codespaces → *New secret*, nome `FOOTBALL_DATA_API_KEY`, repository `fantacalcio-intelligence`): varrà per ogni codespace che crei.

## Da sapere

- **Ore gratuite.** Ogni account GitHub ha 120 "ore-core" gratuite al mese: con questa macchina a 2 processori sono **60 ore di utilizzo**.
- **Spegnimento automatico.** Il codespace si spegne dopo 30 minuti senza attività (ogni pagina dell'app che apri conta come attività). I dati restano salvati.
- **Per riaprirlo:** vai su https://github.com/codespaces e clicca sul nome del codespace. Non serve crearne uno nuovo: un codespace nuovo partirebbe senza i tuoi dati.
- **Aggiornamenti automatici.** Funzionano mentre il codespace è acceso. Quando lo riapri, l'app recupera da sola gli aggiornamenti persi entro pochi minuti.
- **Conservazione.** GitHub elimina i codespace non aperti da 30 giorni, con i dati dentro: aprilo almeno una volta al mese.
- **Dal telefono.** Apri https://github.com/codespaces dal browser del telefono, entra con lo stesso account GitHub e avvia il codespace. Se è già acceso puoi aprire direttamente l'indirizzo `…-3000.app.github.dev`.
- **Per spegnerlo subito** e risparmiare ore: https://github.com/codespaces → menu «…» accanto al codespace → *Stop codespace*.

Hai bisogno di un'app sempre accesa e condivisa con gli amici? Leggi la sezione «Metterlo online per gli amici» nel README.
