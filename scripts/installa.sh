#!/usr/bin/env bash
# Installa (o aggiorna) FantaIntelligence su Mac o Linux e la avvia. Da incollare nel Terminale:
#
#   curl -fsSL https://raw.githubusercontent.com/giuseppecassano5bit/fantacalcio-intelligence/main/scripts/installa.sh | bash
#
# Cartella: ~/FantaIntelligence (cambiabile con FANTA_DIR). Se manca Node.js 22.13+, ne scarica una copia
# privata da nodejs.org dentro la cartella dell'app: non serve la password di amministratore.
# Rilanciare il comando aggiorna l'app: i dati (cartella data/) e il file .env restano dove sono.
set -euo pipefail

REPO="giuseppecassano5bit/fantacalcio-intelligence"
REF="${FANTA_REF:-main}" # ramo o commit da installare
DEST="${FANTA_DIR:-$HOME/FantaIntelligence}"
NODE_DIST="https://nodejs.org/dist/latest-v24.x"

say() { printf '\n[FantaIntelligence] %s\n' "$*"; }
die() { printf '\n[FantaIntelligence] ERRORE: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "serve il comando curl."
command -v tar >/dev/null 2>&1 || die "serve il comando tar."

if [ -d "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ] && [ ! -f "$DEST/scripts/avvia.mjs" ]; then
  die "la cartella $DEST esiste già e non contiene FantaIntelligence. Scegline un'altra con FANTA_DIR=/percorso."
fi
mkdir -p "$DEST"

# ---------- Node.js ----------
node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' >/dev/null 2>&1
}
export PATH="$DEST/.node/bin:$PATH"
# FANTA_SCARICA_NODE=1 usa sempre la copia privata (serve per le verifiche automatiche)
if { [ "${FANTA_SCARICA_NODE:-0}" = "1" ] && [ ! -x "$DEST/.node/bin/node" ]; } || ! node_ok; then
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "sistema non supportato da questo script (su Windows usa installa.ps1)." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) die "processore non supportato: $(uname -m)." ;;
  esac
  say "Scarico Node.js (circa 50 MB) da nodejs.org…"
  sums="$(curl -fsSL "$NODE_DIST/SHASUMS256.txt")"
  file="$(printf '%s\n' "$sums" | awk '{print $2}' | grep -E "^node-v[0-9.]+-$os-$arch\.tar\.gz$" | head -n 1)"
  [ -n "$file" ] || die "non trovo Node.js per $os-$arch."
  tmp="$(mktemp -d)"
  curl -fL --progress-bar "$NODE_DIST/$file" -o "$tmp/$file"
  expected="$(printf '%s\n' "$sums" | awk -v f="$file" '$2 == f {print $1}')"
  if command -v shasum >/dev/null 2>&1; then actual="$(shasum -a 256 "$tmp/$file" | awk '{print $1}')"; else actual="$(sha256sum "$tmp/$file" | awk '{print $1}')"; fi
  [ "$expected" = "$actual" ] || die "il file di Node.js scaricato è danneggiato: riprova."
  rm -rf "$DEST/.node"
  mkdir -p "$DEST/.node"
  tar -xzf "$tmp/$file" -C "$DEST/.node" --strip-components=1
  rm -rf "$tmp"
  node_ok || die "Node.js non funziona dopo l'installazione."
fi
say "Node.js $(node -v) pronto."

# ---------- Codice dell'app ----------
say "Scarico l'ultima versione dell'app da GitHub…"
tmp="$(mktemp -d)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$tmp" --strip-components=1
for item in "$tmp"/* "$tmp"/.[!.]*; do
  [ -e "$item" ] || continue
  name="$(basename "$item")"
  rm -rf "${DEST:?}/$name"
  mv "$item" "$DEST/$name"
done
rm -rf "$tmp"

say "App installata in $DEST"
case "$(uname -s)" in
  Darwin) say "Le prossime volte basta un doppio clic su Avvia-Mac.command in quella cartella." ;;
  *) say "Le prossime volte basta lanciare ./Avvia-Linux.sh in quella cartella." ;;
esac

cd "$DEST"
exec node scripts/avvia.mjs "$@" </dev/null
