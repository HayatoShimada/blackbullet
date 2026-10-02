#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 HayatoShimada
#
# Tests for scripts/ops.sh (backup, restore, CONFIG sync, status) and setup.sh dispatch. Run: bash scripts/ops.test.sh
set -uo pipefail
ORIG_PATH="$PATH"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_TMP="$(mktemp -d)"
trap 'rm -rf "$ROOT_TMP"' EXIT
pass=0; fail=0
die() { echo "die: $*" >&2; exit 1; }
. "$HERE/ops.sh"

ok() { if eval "$2"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $1"; fi; }

fresh() { # new work dir with a space, CONFIG and .env
  W="$(mktemp -d -p "$ROOT_TMP")"; cd "$W"
  SPACE_DIR=./space; MEMO_PORT=3010; MEMO_MCP_TOKEN=tok1; MEMO_SPACE_NAME=notes
  BB_PORT=3000; MEMO_INDEX_DIR=./.memo-index; MEMO_EMBED=on
  mkdir -p space/sub; echo hello > space/a.md; echo deep > space/sub/b.md
  echo secret > space/.silverbullet.auth.json
  echo "TOKEN=tok1" > .env
  ops_write_config_block space/CONFIG.md >/dev/null
}

# ---- sync_config
fresh
echo "# mine" >> space/CONFIG.md
ok "sync is a no-op when unchanged" '[ -z "$(ops_sync_config space/CONFIG.md)" ]'
MEMO_PORT=4000; MEMO_MCP_TOKEN=tok2; MEMO_SPACE_NAME=other
out="$(ops_sync_config space/CONFIG.md)"
ok "sync reports the update" '[[ "$out" == *updated* ]]'
ok "sync rewrote url" 'grep -q "url = \"127.0.0.1:4000\"," space/CONFIG.md'
ok "sync rewrote token" 'grep -q "token = \"tok2\"," space/CONFIG.md'
ok "sync rewrote space" 'grep -q "space = \"other\"," space/CONFIG.md'
ok "sync kept the rest" 'grep -q "^# mine" space/CONFIG.md && ! grep -q tok1 space/CONFIG.md'
ok "sync is idempotent" '[ -z "$(ops_sync_config space/CONFIG.md)" ]'
echo 'other = "x"' > space/CONFIG2.md
ops_sync_config space/CONFIG2.md >/dev/null
ok "sync appends a block to a CONFIG without one" 'grep -q memoSidecar space/CONFIG2.md && grep -q "^other" space/CONFIG2.md'

# ---- backup
fresh
ops_backup bk >/dev/null
f="$(ls bk/blackbullet-notes-*.tar.gz)"
ok "backup creates a timestamped archive" '[ -f "$f" ]'
l="$(tar -tzf "$f")"
ok "backup includes notes" '[[ "$l" == *a.md* && "$l" == *sub/b.md* ]]'
ok "backup keeps CONFIG.md by default, redacted" '[[ "$l" == *CONFIG.md* ]] && [ -z "$(tar -xzOf "$f" CONFIG.md | grep tok1)" ] && tar -xzOf "$f" CONFIG.md | grep -q "token = \"\","'
ok "backup excludes auth secret and .env" '[[ "$l" != *auth.json* && "$l" != *blackbullet-env* ]]'
ok "backup is private (0600)" '[ "$(stat -c %a "$f")" = 600 ]'
ops_backup bk2 --with-secrets >/dev/null
l="$(tar -tzf bk2/*.tar.gz)"
ok "--with-secrets includes CONFIG.md and .env" '[[ "$l" == *CONFIG.md* && "$l" == *blackbullet-env* && "$l" == *auth.json* ]]'
ok "backup rejects unknown flags" '! ( ops_backup --nope ) >/dev/null 2>&1'

# ---- restore
fresh
ops_backup bk >/dev/null; f="$(ls bk/*.tar.gz)"
echo changed > space/a.md; echo new > space/c.md
echo "# my config" > space/CONFIG.md
ops_restore "$f" >/dev/null
ok "restore brings back the file" '[ "$(cat space/a.md)" = hello ]'
ok "restore keeps the existing CONFIG.md" '[ "$(cat space/CONFIG.md)" = "# my config" ]'
ok "restore wrote a safety copy" 'ls space.pre-restore-*.tar.gz >/dev/null 2>&1'
ok "safety copy has the pre-restore state" '[ -n "$(tar -xzOf space.pre-restore-*.tar.gz ./a.md | grep changed)" ]'
ok "restore fails on a missing file" '! ( ops_restore nope.tar.gz ) >/dev/null 2>&1'
echo junk > bad.tar.gz
ok "restore fails on a corrupt archive" '! ( ops_restore bad.tar.gz ) >/dev/null 2>&1'
ok "restore requires an argument" '! ( ops_restore ) >/dev/null 2>&1'
# secrets round trip into a new machine
ops_backup bk3 --with-secrets >/dev/null
W2="$(mktemp -d -p "$ROOT_TMP")"; arch="$(ls "$W"/bk3/*.tar.gz)"; cd "$W2"
echo "TOKEN=old" > .env
ops_restore "$arch" >/dev/null
ok "restore into an empty folder works" '[ -f space/sub/b.md ] && [ -f space/CONFIG.md ]'
ok "restore does not replace .env" 'grep -q old .env && ! grep -q tok1 .env'
ok "restore saves the archived .env aside (0600)" 'grep -q tok1 .env.from-backup && [ "$(stat -c %a .env.from-backup)" = 600 ]'
# path traversal
fresh; mkdir evil; echo x > evil/x; tar -czf bad2.tar.gz --transform 's|^evil/|../|' evil/x 2>/dev/null
ok "restore refuses .. paths" '! ( ops_restore bad2.tar.gz ) >/dev/null 2>&1'

# links pointing outside
fresh; ln -s /etc space/lnk; ops_backup bk >/dev/null
ok "restore refuses links that point outside" '! ( ops_restore bk/*.tar.gz ) >/dev/null 2>&1'
# relative dir resolves from the caller's cwd; dir inside notes refused; no partial files
fresh; mkdir caller; OPS_CALLER_PWD="$W/caller" ops_backup rel >/dev/null
ok "relative backup dir is taken from the caller" 'ls caller/rel/*.tar.gz >/dev/null 2>&1'
ok "backup refuses a dir inside the notes folder" '! ( ops_backup space/in ) >/dev/null 2>&1'
ok "backup leaves no .part file" '[ -z "$(find . -name "*.part")" ]'
# sync keeps a remote url and treats the word in prose as no block
fresh; sed -i 's|127.0.0.1:3010|10.0.0.5:3010|' space/CONFIG.md; MEMO_MCP_TOKEN=zzz
ok "sync keeps a non-local url" '[[ "$(ops_sync_config space/CONFIG.md)" == *kept* ]] && grep -q 10.0.0.5 space/CONFIG.md && ! grep -q zzz space/CONFIG.md'
echo "mentions memoSidecar in prose" > space/P.md
ops_sync_config space/P.md >/dev/null
ok "sync writes a block when only the word appears" 'grep -q "config.set(\"memoSidecar\"" space/P.md'
fresh; MEMO_SPACE_NAME='a&b\c'; ops_sync_config space/CONFIG.md >/dev/null
ok "sync handles & and backslash in values" 'grep -qF "space = \"a&b\\c\"," space/CONFIG.md'

# ---- status (stubbed docker and curl)
fresh
mkdir bin
cat > bin/docker <<'EOF'
#!/bin/sh
echo "NAME STATUS"; echo "app running"
EOF
cat > bin/curl <<'EOF'
#!/bin/sh
case "$*" in
  *"/.instance"*) [ "$STUB_APP" = down ] && exit 22; echo '{"version":"x"}' ;;
  *healthz*) [ "$STUB_SIDECAR" = down ] && exit 22; echo ok ;;
  *"/api/search"*) echo "$STUB_SEARCH" ;;
esac
EOF
chmod +x bin/docker bin/curl
export PATH="$PWD/bin:$PATH"
export STUB_SEARCH='{"mode":"hybrid","results":[]}'
out="$(ops_status 2>&1)"; rc=$?
ok "status ok when all is up" '[ $rc = 0 ] && [[ "$out" == *"search: working"* ]]'
ok "status says the model is missing" '[[ "$out" == *"not downloaded yet"* ]]'
mkdir -p .memo-index/m; touch .memo-index/m/model.onnx
ok "status finds the model" '[[ "$(ops_status 2>&1)" == *"present in"* ]]'
ok "status counts pages" '[[ "$(ops_status 2>&1)" == *"3 Markdown pages"* ]]'
export STUB_SEARCH='{"mode":"lexical","warning":"no embeddings","results":[]}'
ok "status shows the warning" '[[ "$(ops_status 2>&1)" == *"warning: no embeddings"* ]]'
export STUB_SEARCH='{"error":"Unauthorized"}'
out="$(ops_status 2>&1)"; rc=$?
ok "status flags a token mismatch" '[ $rc = 1 ] && [[ "$out" == *"401"* ]]'
export STUB_SEARCH='{"mode":"hybrid","results":[]}' STUB_APP=down
out="$(ops_status 2>&1)"; rc=$?
ok "status fails when the app is down" '[ $rc = 1 ] && [[ "$out" == *DOWN* ]]'
export STUB_APP=up STUB_SIDECAR=down
ok "status fails when the sidecar is down" '! ( ops_status ) >/dev/null 2>&1'
MEMO_EMBED=off
ok "status reports embeddings disabled" '[[ "$(STUB_SIDECAR=up ops_status 2>&1)" == *"MEMO_EMBED=off"* ]]'

# ---- setup.sh dispatch (stubbed docker/curl): read-only commands must not touch the notes folder
PATH="$ORIG_PATH"
SW="$(mktemp -d -p "$ROOT_TMP")"; mkdir -p "$SW/scripts" "$SW/stubs" "$SW/bin/silverbullet/space_template"
cp "$HERE/../setup.sh" "$SW/"; cp "$HERE/ops.sh" "$SW/scripts/"; cp "$HERE/../.env.example" "$SW/"
echo welcome > "$SW/bin/silverbullet/space_template/index.md"
printf '#!/bin/sh\nexit 0\n' > "$SW/stubs/docker"; printf '#!/bin/sh\nexit 22\n' > "$SW/stubs/curl"
chmod +x "$SW/stubs/"*
S() { (cd "$SW" && PATH="$SW/stubs:$ORIG_PATH" bash ./setup.sh "$@"); }
S --status >/dev/null 2>&1
ok "setup.sh --status does not create the notes folder" '[ ! -e "$SW/space" ]'
ok "setup.sh --backup fails cleanly without notes" '! S --backup >/dev/null 2>&1 && [ ! -e "$SW/space" ]'
mkdir -p "$SW/src" && echo hi > "$SW/src/a.md"
tar -czf "$SW/b.tar.gz" -C "$SW/src" .
S --restore "$SW/b.tar.gz" >/dev/null 2>&1
ok "setup.sh --restore adds only the archive's files" '[ "$(ls -A "$SW/space")" = "a.md" ]'
S --backup "$SW/out" >/dev/null 2>&1
ok "setup.sh --backup writes to an absolute dir" 'ls "$SW"/out/*.tar.gz >/dev/null 2>&1'
ok "setup.sh rejects an unknown mode" '! S --nope >/dev/null 2>&1'

# ---- remote hint
SITE_DOMAIN=""; MEMO_MCP_TOKEN=tokR
ok "hint is empty without SITE_DOMAIN" '[ -z "$(ops_remote_hint)" ]'
SITE_DOMAIN=memo.example.net
h="$(ops_remote_hint)"
ok "hint names the https /mcp url" '[[ "$h" == *"https://memo.example.net/mcp"* ]]'
ok "hint carries the bearer token" '[[ "$h" == *"Bearer tokR"* ]]'
ok "hint says hosted connectors cannot reach it" '[[ "$h" == *claude.ai* ]]'

echo "ops tests: $pass passed, $fail failed"
[ "$fail" = 0 ]
