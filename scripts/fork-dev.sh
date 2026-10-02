#!/usr/bin/env bash
# Fast build/verify loop for the fork on the Pi.
#   bundle            npm run build in a Node 24 container -> ./client_bundle (incremental, host dir)
#   server            docker build of the debug server image (cargo cache mounts); only needed on Rust changes
#   build             bundle (+ server if the image is missing)
#   up <dir> [port]   run sbfork-<port> on a COPY of a space (default port 3020), client_bundle bind-mounted
#   down [port]       stop/remove sbfork-<port>
#   logs [port]       follow logs
# Env: SBFORK_LOCK (flock file shared by all fork docker builds), SBFORK_NODE_IMAGE.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="${SBFORK_LOCK:-/tmp/sbfork-build.lock}"
NODE_IMAGE="${SBFORK_NODE_IMAGE:-node:24-bookworm}"
IMAGE=silverbullet-fork:devrun
# Must equal the path baked into the debug binary (CARGO_MANIFEST_DIR in Dockerfile.fork-dev).
BUNDLE_MOUNT=/src/client_bundle

die() { echo "fork-dev: $*" >&2; exit 1; }

cmd_bundle() {
  mkdir -p "$ROOT/client_bundle"
  flock "$LOCK" docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm \
    -v "$ROOT":/src -w /src "$NODE_IMAGE" sh -ec '
      if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then npm ci; fi
      npm run build'
}

cmd_server() {
  cd "$ROOT"
  DOCKER_BUILDKIT=1 flock "$LOCK" docker build -f Dockerfile.fork-dev -t "$IMAGE" .
}

cmd_build() {
  cmd_bundle
  docker image inspect "$IMAGE" >/dev/null 2>&1 || cmd_server
}

cmd_up() {
  local dir="${1:-}" port="${2:-3020}"
  [ -n "$dir" ] || die "usage: up <space-copy-dir> [port]"
  dir="$(cd "$dir" && pwd)"
  case "$dir" in /srv/*) die "refusing to mount a real space ($dir); use a copy" ;; esac
  case "$port" in 3003|3010) die "port $port is reserved" ;; esac
  [ -f "$ROOT/client_bundle/client/.client/index.html" ] || die "no client bundle; run '$0 bundle' first"
  docker image inspect "$IMAGE" >/dev/null 2>&1 || die "no image $IMAGE; run '$0 server' first"
  docker rm -f "sbfork-$port" >/dev/null 2>&1 || true
  docker run -d --name "sbfork-$port" -p "127.0.0.1:$port:3000" \
    -e PUID=1000 -e PGID=1000 \
    -e SB_DISABLE_SERVICE_WORKER=1 \
    -v "$dir":/data \
    -v "$ROOT/client_bundle":"$BUNDLE_MOUNT":ro \
    "$IMAGE"
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:$port/.instance" >/dev/null 2>&1 && { echo "up: http://127.0.0.1:$port"; return; }
    sleep 1
  done
  docker logs --tail 30 "sbfork-$port"; die "server did not become healthy"
}

cmd_down() { docker rm -f "sbfork-${1:-3020}"; }
cmd_logs() { docker logs -f --tail 100 "sbfork-${1:-3020}"; }

sub="${1:-}"; shift || true
case "$sub" in
  bundle) cmd_bundle ;;
  server) cmd_server ;;
  build) cmd_build ;;
  up) cmd_up "$@" ;;
  down) cmd_down "$@" ;;
  logs) cmd_logs "$@" ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
