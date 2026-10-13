#!/bin/bash
# Doppio clic per avviare FantaIntelligence su Mac.
cd "$(dirname "$0")" || exit 1
export PATH="$PWD/.node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js non è installato. Si apre la pagina per scaricarlo: installa la versione LTS e poi riapri questo file."
  open "https://nodejs.org/it/download"
  read -r -p "Premi Invio per chiudere…"
  exit 1
fi
node scripts/avvia.mjs "$@" || read -r -p "Premi Invio per chiudere…"
