#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 HayatoShimada
#
# Operations helpers sourced by setup.sh (backup, restore, status, CONFIG sync). Not run directly.
# Expects `die`, and (from .env) SPACE_DIR, BB_PORT, MEMO_PORT, MEMO_MCP_TOKEN, MEMO_SPACE_NAME,
# MEMO_INDEX_DIR to be set. Tests: scripts/ops.test.sh.

# Files in the notes folder that hold secrets (sidecar bearer token, API keys, auth secret).
OPS_SECRET_FILES=(CONFIG.md .silverbullet.auth.json)
OPS_ENV_ENTRY=.blackbullet-env

# ops_write_config_block CONFIG: append the generated sidecar block.
ops_write_config_block() {
  cat >> "$1" <<EOF
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
}

# ops_sync_config CONFIG: create the sidecar block, or rewrite url/token/space inside the existing
# one when they differ from .env (the rest of the page is left alone). A block whose url points at
# another host is the user's own choice and is kept as it is.
ops_sync_config() {
  local config="$1" tmp url_line
  if [ ! -f "$config" ] || ! grep -q 'config\.set("memoSidecar"' "$config"; then
    [ -f "$config" ] && printf '\n' >> "$config"
    ops_write_config_block "$config"
    echo "wrote sidecar settings to $config"
    return 0
  fi
  url_line="$(grep -E '^[[:space:]]*url[[:space:]]*=' "$config" | head -1 || true)"
  if [ -n "$url_line" ] && ! printf '%s' "$url_line" | grep -Eq '127\.0\.0\.1|localhost'; then
    echo "kept the memoSidecar settings in $config: its url is not local"
    return 0
  fi
  tmp="$(mktemp)"
  OPS_URL="127.0.0.1:${MEMO_PORT}" OPS_TOKEN="${MEMO_MCP_TOKEN}" OPS_SPACE="${MEMO_SPACE_NAME}" \
  awk '
    function setval(v) { $0 = substr($0, 1, index($0, "=") - 1) "= \"" v "\"," }
    /config\.set\("memoSidecar"/ { inb = 1 }
    inb && /^[[:space:]]*url[[:space:]]*=/   { setval(ENVIRON["OPS_URL"]) }
    inb && /^[[:space:]]*token[[:space:]]*=/ { setval(ENVIRON["OPS_TOKEN"]) }
    inb && /^[[:space:]]*space[[:space:]]*=/ { setval(ENVIRON["OPS_SPACE"]) }
    inb && /^[[:space:]]*\}\)/ { inb = 0 }
    { print }
  ' "$config" > "$tmp"
  if cmp -s "$tmp" "$config"; then
    rm -f "$tmp"
  else
    cat "$tmp" > "$config"   # keep the file's mode and owner
    rm -f "$tmp"
    echo "updated the memoSidecar settings in $config to match .env (port/token/space changed)"
  fi
}

# ops_backup [dir] [--with-secrets]: notes folder -> <dir>/blackbullet-notes-<timestamp>.tar.gz
# A relative <dir> is taken from the caller's directory (OPS_CALLER_PWD); the default is ./backups here.
ops_backup() {
  local dir="" secrets=0 a
  for a in "$@"; do
    case "$a" in
      --with-secrets) secrets=1 ;;
      -*) die "unknown backup option: $a" ;;
      *) dir="$a" ;;
    esac
  done
  if [ -z "$dir" ]; then dir=./backups
  else case "$dir" in /*) ;; *) dir="${OPS_CALLER_PWD:-$PWD}/$dir" ;; esac; fi
  [ -d "$SPACE_DIR" ] || die "no notes folder at $SPACE_DIR"
  mkdir -p "$dir"
  local out stage excl=() f space_abs dir_abs rc=0
  space_abs="$(cd "$SPACE_DIR" && pwd -P)"; dir_abs="$(cd "$dir" && pwd -P)"
  case "$dir_abs/" in "$space_abs/"*) die "the backup folder $dir must not be inside the notes folder" ;; esac
  out="$dir/blackbullet-notes-$(date +%Y%m%d-%H%M%S).tar.gz"
  stage="$(mktemp -d)"
  for f in "${OPS_SECRET_FILES[@]}"; do
    [ "$secrets" = 1 ] || excl+=(--exclude "./$f")
  done
  excl+=(--exclude ./.memo-index)
  local extra=()
  if [ "$secrets" = 1 ] && [ -f .env ]; then
    cp .env "$stage/$OPS_ENV_ENTRY"; extra+=("$OPS_ENV_ENTRY")
  elif [ "$secrets" = 0 ] && [ -f "$SPACE_DIR/CONFIG.md" ]; then
    # keep the user's own settings; blank the values that look like secrets
    sed -E 's/^([[:space:]]*[A-Za-z_]*([Tt]oken|[Kk]ey|[Ss]ecret|[Pp]assword)[A-Za-z_]*[[:space:]]*=[[:space:]]*)"[^"]*"/\1""/' \
      "$SPACE_DIR/CONFIG.md" > "$stage/CONFIG.md"
    excl+=(--exclude ./CONFIG.md); extra+=(CONFIG.md)
  fi
  local xargs=(); for f in "${extra[@]}"; do xargs+=(-C "$stage" "$f"); done
  (umask 077; tar -czf "$out.part" "${excl[@]}" -C "$SPACE_DIR" . "${xargs[@]}") || rc=$?
  # tar exits 1 when a file changed while it was read: the archive is still usable
  rm -rf "$stage"
  [ "$rc" -le 1 ] || { rm -f "$out.part"; die "tar failed (exit $rc); no backup written"; }
  [ "$rc" = 0 ] || echo "  warning: some files changed while being read"
  mv "$out.part" "$out"
  echo "backup written: $out"
  if [ "$secrets" = 1 ]; then
    echo "  includes .env and ${OPS_SECRET_FILES[*]} (tokens and API keys): keep this file private."
  else
    echo "  CONFIG.md is included with token/key/secret/password values blanked; .env and"
    echo "  .silverbullet.auth.json are left out. ./setup.sh refills the sidecar token on restore."
    echo "  add --with-secrets to include everything exactly (e.g. to move machines)."
  fi
  echo "  not included: ./.memo-index (derived, rebuilt automatically) and the tailnet Docker volumes"
  echo "  (ts-state, caddy-data: losing ts-state needs a new TS_AUTHKEY). For history, keep the notes"
  echo "  folder in git, with CONFIG.md in its .gitignore."
}

# ops_restore file: unpack a backup into the notes folder (merging: nothing is deleted), after saving
# a safety copy of the current one. An archived .env is never applied: it is written to
# .env.from-backup for you to merge (paths, ids and ports differ between machines).
ops_restore() {
  local file="${1:-}" stage ts safety
  [ -n "$file" ] || die "usage: $0 --restore <backup.tar.gz>"
  [ -f "$file" ] || die "no such file: $file"
  tar -tzf "$file" >/dev/null 2>&1 || die "not a readable tar.gz archive: $file"
  if tar -tzf "$file" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    die "refusing to restore $file: it contains absolute or '..' paths"
  fi
  if tar -tvzf "$file" | grep -Eq '^l.* -> (/|.*\.\.)|^h.* link to (/|.*\.\.)'; then
    die "refusing to restore $file: it contains links pointing outside the notes folder"
  fi
  ts="$(date +%Y%m%d-%H%M%S)"
  if [ -d "$SPACE_DIR" ] && [ -n "$(ls -A "$SPACE_DIR" 2>/dev/null)" ]; then
    safety="${SPACE_DIR%/}.pre-restore-$ts.tar.gz"
    (umask 077; tar -czf "$safety" -C "$SPACE_DIR" .)
    echo "safety copy of the current notes: $safety"
  fi
  stage="$(mktemp -d)"
  tar -xzf "$file" -C "$stage" --no-same-owner
  if [ -f "$stage/$OPS_ENV_ENTRY" ]; then
    (umask 077; cp "$stage/$OPS_ENV_ENTRY" .env.from-backup)
    rm -f "$stage/$OPS_ENV_ENTRY"
    echo "the backup's .env was saved as .env.from-backup (not applied: merge the keys you need into .env)"
  fi
  mkdir -p "$SPACE_DIR"
  if [ -f "$stage/CONFIG.md" ] && [ -f "$SPACE_DIR/CONFIG.md" ]; then
    rm -f "$stage/CONFIG.md"
    echo "kept the existing CONFIG.md (the backup's copy was not applied)"
  fi
  cp -a "$stage"/. "$SPACE_DIR"/
  rm -rf "$stage"
  echo "restored $file into $SPACE_DIR (merged: notes created since the backup are kept)"
}

# ops_status: containers, app, sidecar, index/model state, disk use. Returns 1 when something is down.
ops_status() {
  local bad=0 out warn pages
  echo "== containers"
  docker compose --profile tailnet ps 2>&1 || bad=1
  echo "== app (http://127.0.0.1:${BB_PORT})"
  if out="$(curl -fsS --max-time 5 "http://127.0.0.1:${BB_PORT}/.instance" 2>/dev/null)"; then
    echo "up: $out"
  else
    echo "DOWN (see: docker compose logs app)"; bad=1
  fi
  echo "== search sidecar (http://127.0.0.1:${MEMO_PORT})"
  if curl -fsS --max-time 5 "http://127.0.0.1:${MEMO_PORT}/healthz" >/dev/null 2>&1; then
    echo "healthz: ok"
    # lexical: a cheap auth check that does not build embeddings; the header stays off the command line
    out="$(printf 'Authorization: Bearer %s\n' "${MEMO_MCP_TOKEN}" | curl -sS --max-time 20 -H @- \
      "http://127.0.0.1:${MEMO_PORT}/api/search?space=${MEMO_SPACE_NAME}&q=a&limit=1&mode=lexical" 2>&1)" || true
    case "$out" in
      *'"results"'*)
        warn="$(printf '%s' "$out" | sed -n 's/.*"warning":"\([^"]*\)".*/\1/p')"
        echo "search: working (auth ok, lexical check)"
        [ -n "$warn" ] && echo "warning: $warn"
        ;;
      *Unauthorized*) echo "search: 401, the token in .env differs from the sidecar's; run ./setup.sh to resync"; bad=1 ;;
      *) echo "search: failed: ${out:-no response}"; bad=1 ;;
    esac
  else
    echo "DOWN (see: docker compose logs memo-mcp)"; bad=1
  fi
  pages="$(find "$SPACE_DIR" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
  echo "== notes: ${pages} Markdown pages in $SPACE_DIR"
  echo "== embedding model"
  if [ "${MEMO_EMBED:-on}" = "off" ]; then
    echo "disabled (MEMO_EMBED=off): lexical search only"
  elif [ -n "$(find "${MEMO_INDEX_DIR:-./.memo-index}" -iname '*.onnx' -print -quit 2>/dev/null)" ]; then
    echo "present in ${MEMO_INDEX_DIR:-./.memo-index}"
  else
    echo "not downloaded yet (first embedding run fetches ~120 MB; watch: docker compose logs -f memo-mcp)"
  fi
  echo "== disk"
  du -sh "$SPACE_DIR" "${MEMO_INDEX_DIR:-./.memo-index}" 2>/dev/null || true
  return "$bad"
}

# ops_remote_hint: the `claude mcp add` command for the tailnet front door (empty without SITE_DOMAIN).
# The same Tailscale + bearer checks apply; hosted connectors (claude.ai) cannot reach a tailnet name.
ops_remote_hint() {
  [ -n "${SITE_DOMAIN:-}" ] || return 0
  cat <<EOF

From another device on your tailnet (the front door adds the Tailscale check; the token is still required):
  claude mcp add --transport http memo https://${SITE_DOMAIN}/mcp \\
    --header "Authorization: Bearer ${MEMO_MCP_TOKEN}"
Hosted connectors (claude.ai) cannot reach a tailnet-only name; use a client that runs on a tailnet device.
EOF
  if [ -n "${MEMO_MCP_PUBLIC_HOST:-}" ] && [ "${MEMO_MCP_PUBLIC_HOST%%:*}" != "$SITE_DOMAIN" ]; then
    echo "Note: MEMO_MCP_PUBLIC_HOST=${MEMO_MCP_PUBLIC_HOST} is also accepted by the sidecar; ${SITE_DOMAIN} is always allowed."
  fi
}
