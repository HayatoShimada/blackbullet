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
#   ./setup.sh --rebuild [--tailnet]  rebuild the images (after `git pull`), then start
#   ./setup.sh --upgrade [--tailnet]  git pull --ff-only, then re-run this (new) script with --rebuild;
#                         the tailnet containers are included when they are running
#   ./setup.sh --status   containers, app, sidecar/search mode, embedding model, disk use
#   ./setup.sh --backup [dir] [--with-secrets]   notes -> <dir>/blackbullet-notes-<time>.tar.gz
#                         (default ./backups; CONFIG.md is included with token/key/secret/password values blanked; .silverbullet.auth.json and .env are left out unless --with-secrets)
#   ./setup.sh --restore <file>   unpack a backup into the notes folder (saves a safety copy first)
#   ./setup.sh --stop     stop everything (your notes stay where they are)
# Tests for the helpers: bash scripts/ops.test.sh
# Tip: keep the notes folder in git too, with CONFIG.md in its .gitignore (it holds the token and API keys).
set -euo pipefail
OPS_CALLER_PWD="$PWD"
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

. ./scripts/ops.sh

mode="${1:-}"
case "$mode" in
  ""|--tailnet|--rebuild|--upgrade|--stop|--status|--backup|--restore) ;;
  *) die "usage: $0 [--tailnet|--rebuild [--tailnet]|--upgrade [--tailnet]|--stop|--status|--backup [dir] [--with-secrets]|--restore <file>]" ;;
esac

tailnet=0
[ "$mode" = "--tailnet" ] && tailnet=1
case "$mode" in
  --rebuild|--upgrade)
    case "${2:-}" in
      "") ;;
      --tailnet) tailnet=1 ;;
      *) die "unknown option for $mode: $2" ;;
    esac ;;
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

if [ "$tailnet" = 1 ]; then
  for key in TS_AUTHKEY CF_API_TOKEN ACME_EMAIL ALLOWED_LOGINS SITE_DOMAIN; do require "$key"; done
fi

set -a; . ./.env; set +a

# Read-only commands run before anything touches the notes folder.
case "$mode" in
  --backup) shift; ops_backup "$@"; exit 0 ;;
  --restore)
    ops_restore "${2:-}"
    echo "Run ./setup.sh to start (it rewrites the sidecar settings in CONFIG.md from .env)."
    exit 0 ;;
  --status) ops_status; exit $? ;;
esac

mkdir -p "$SPACE_DIR" "$MEMO_INDEX_DIR"
# The server seeds the welcome page only into a folder without any .md file, and CONFIG.md below
# would count as one; so put the welcome page there ourselves when the folder is new.
if [ -z "$(find "$SPACE_DIR" -name '*.md' -print -quit)" ]; then
  cp bin/silverbullet/space_template/index.md "$SPACE_DIR/index.md"
  echo "created the welcome page in $SPACE_DIR"
fi
ops_sync_config "$SPACE_DIR/CONFIG.md"

profile=()
case "$mode" in
  --upgrade)
    command -v git >/dev/null || die "git is required for --upgrade"
    old="$(git rev-parse --short HEAD)"
    git pull --ff-only || die "git pull --ff-only failed (local changes or diverged history); resolve it, then re-run"
    new="$(git rev-parse --short HEAD)"
    if [ -n "$(docker compose --profile tailnet ps -q tailscale 2>/dev/null)" ]; then tailnet=1; fi
    if [ "$old" = "$new" ]; then
      echo "already up to date ($new)"
      [ "$tailnet" = 1 ] && profile=(--profile tailnet)
    else
      echo "upgraded $old -> $new"; git log --oneline "$old..$new" | head -20
      # continue with the pulled script, so new .env keys and steps apply
      if [ "$tailnet" = 1 ]; then exec ./setup.sh --rebuild --tailnet; fi
      exec ./setup.sh --rebuild
    fi
    ;;
esac

[ "$tailnet" = 1 ] && profile=(--profile tailnet)
# `up` builds an image only when it is missing; --rebuild forces it (the app image takes 10-20 min).
if [ "$mode" = "--rebuild" ] || [ "$mode" = "--upgrade" ]; then
  docker compose build
fi
docker compose "${profile[@]}" up -d

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${BB_PORT}/.instance" >/dev/null 2>&1; then
    # Build the search index and embeddings now instead of on the first search (downloads the model once).
    if [ "$MEMO_EMBED" != "off" ]; then
      docker compose exec -d memo-mcp node src/reindex.mjs --embed >/dev/null 2>&1 || true
      echo "indexing started in the background; check progress with ./setup.sh --status"
    fi
    cat <<EOF

BlackBullet is running:  http://127.0.0.1:${BB_PORT}
Your notes:              ${SPACE_DIR}  (plain Markdown files; edit them with anything)

Use it from an AI client (MCP over HTTP, local only):
  claude mcp add --transport http memo http://127.0.0.1:${MEMO_PORT}/mcp \\
    --header "Authorization: Bearer ${MEMO_MCP_TOKEN}"

$([ "$tailnet" = 1 ] && ops_remote_hint)

Stop with ./setup.sh --stop   Status: ./setup.sh --status   Backup: ./setup.sh --backup
EOF
    exit 0
  fi
  sleep 2
done
docker compose logs --tail 30 app
die "the app did not become healthy; see the logs above"
