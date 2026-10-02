#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 HayatoShimada
#
# One-command start for BlackBullet:
#   1. creates .env from .env.example (keeps an existing one, only adds missing keys)
#   2. generates the sidecar token and fills in your UID/GID
#   3. creates the notes folder and writes the sidecar settings into its CONFIG page
#   4. builds and starts the app + search sidecar (docker compose)
# Re-running is safe.
#   ./setup.sh            start (builds the images the first time, 10-20 min; then just starts)
#   ./setup.sh --tailnet  also start the tailnet-only HTTPS front door (see deploy/tailnet-proxy/README.md)
#   ./setup.sh --rebuild  rebuild the images (after `git pull`), then start
#   ./setup.sh --stop     stop everything (your notes stay where they are)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

die() { echo "setup: $*" >&2; exit 1; }
command -v docker >/dev/null || die "docker is required (https://docs.docker.com/get-docker/)"
docker compose version >/dev/null 2>&1 || die "docker compose (v2) is required"

random_hex() {
  if command -v openssl >/dev/null; then openssl rand -hex 32
  else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# ensure KEY VALUE: add KEY to .env if it is missing, or fill it if it is empty.
ensure() {
  if ! grep -q "^$1=" .env; then
    echo "$1=$2" >> .env
  elif grep -q "^$1=$" .env; then
    sed -i "s|^$1=$|$1=$2|" .env
  fi
}

# require KEY: refuse to continue when KEY is empty or missing in .env.
require() {
  grep -q "^$1=.\+" .env || die "$1 is empty in .env (needed for --tailnet; see deploy/tailnet-proxy/README.md)"
}

mode="${1:-}"
case "$mode" in
  ""|--tailnet|--rebuild|--stop) ;;
  *) die "usage: $0 [--tailnet|--rebuild|--stop]" ;;
esac

if [ "$mode" = "--stop" ]; then
  [ -f .env ] || die "nothing to stop: no .env here"
  docker compose --profile tailnet down
  exit 0
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "created .env"
fi
chmod 600 .env
ensure SPACE_DIR ./space
ensure BB_PORT 3000
ensure MEMO_PORT 3010
ensure PUID "$(id -u)"
ensure PGID "$(id -g)"
ensure MEMO_MCP_TOKEN "$(random_hex)"
ensure MEMO_SPACE_NAME notes
ensure MEMO_INDEX_DIR ./.memo-index
ensure MEMO_EMBED on

if [ "$mode" = "--tailnet" ]; then
  for key in TS_AUTHKEY CF_API_TOKEN ACME_EMAIL ALLOWED_LOGINS SITE_DOMAIN; do require "$key"; done
fi

set -a; . ./.env; set +a

mkdir -p "$SPACE_DIR" "$MEMO_INDEX_DIR"
CONFIG="$SPACE_DIR/CONFIG.md"
if [ ! -f "$CONFIG" ] || ! grep -q 'memoSidecar' "$CONFIG"; then
  [ -f "$CONFIG" ] && printf '\n' >> "$CONFIG"
  cat >> "$CONFIG" <<EOF
# Search sidecar
Written by setup.sh: connects \`Memo: Search\`, related notes and the graph's semantic edges to the sidecar.
\`\`\`space-lua
config.set("memoSidecar", {
  url = "127.0.0.1:${MEMO_PORT}",
  token = "${MEMO_MCP_TOKEN}",
  space = "${MEMO_SPACE_NAME}",
})
\`\`\`
EOF
  echo "wrote sidecar settings to $CONFIG"
fi

profile=()
[ "$mode" = "--tailnet" ] && profile=(--profile tailnet)
# `up` builds an image only when it is missing; --rebuild forces it (the app image takes 10-20 min).
if [ "$mode" = "--rebuild" ]; then
  docker compose build
fi
docker compose "${profile[@]}" up -d

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${BB_PORT}/.instance" >/dev/null 2>&1; then
    # Build the search index and embeddings now instead of on the first search (downloads the model once).
    if [ "$MEMO_EMBED" != "off" ]; then
      docker compose exec -d memo-mcp node src/reindex.mjs --embed >/dev/null 2>&1 || true
    fi
    cat <<EOF

BlackBullet is running:  http://127.0.0.1:${BB_PORT}
Your notes:              ${SPACE_DIR}  (plain Markdown files; edit them with anything)

Use it from an AI client (MCP over HTTP, local only):
  claude mcp add --transport http memo http://127.0.0.1:${MEMO_PORT}/mcp \\
    --header "Authorization: Bearer ${MEMO_MCP_TOKEN}"

Stop with ./setup.sh --stop
EOF
    exit 0
  fi
  sleep 2
done
docker compose logs --tail 30 app
die "the app did not become healthy; see the logs above"
