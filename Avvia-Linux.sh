#!/bin/bash
# Avvio di FantaIntelligence su Linux: ./Avvia-Linux.sh (aggiungi --rete per usarla dal telefono).
cd "$(dirname "$0")" || exit 1
export PATH="$PWD/.node/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js non è installato: installa la versione LTS da https://nodejs.org/it/download e riprova."
  exit 1
fi
exec node scripts/avvia.mjs "$@"
