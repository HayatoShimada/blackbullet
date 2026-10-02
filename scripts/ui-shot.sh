#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 HayatoShimada
#
# Screenshots of a running BlackBullet for design work, taken with Playwright in a container
# (no browser install on the host). Playwright's version comes from package-lock.json, so the
# browsers in the image match the `playwright` package in node_modules (mounted read-only).
#
#   scripts/ui-shot.sh shot <url> <out.png> [--mobile] [--dark] [--full] [--wait ms]
#       one page, 1280x800 (or iPhone 13 with --mobile), light or dark colour scheme
#   scripts/ui-shot.sh run <script.mjs> [args...]
#       run a Playwright script (import { chromium } from "playwright") with the host network,
#       so http://127.0.0.1:<port> reaches a local instance; the script's directory is mounted at /work
#
# Env: UI_SHOT_IMAGE (default mcr.microsoft.com/playwright:v<version from node_modules>-noble)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -d "$ROOT/node_modules/playwright" ] || { echo "ui-shot: node_modules/playwright is missing (run npm ci in a Node 24 container first)" >&2; exit 1; }
PW_VERSION="$(node -e 'console.log(require(process.argv[1]).version)' "$ROOT/node_modules/playwright/package.json" 2>/dev/null \
  || sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/node_modules/playwright/package.json" | head -1)"
IMAGE="${UI_SHOT_IMAGE:-mcr.microsoft.com/playwright:v${PW_VERSION}-noble}"

run_in_pw() { # mounts: a work dir (rw) with the repo's node_modules inside it (ro; ESM ignores NODE_PATH); host network for 127.0.0.1 instances
  local work="$1"; shift
  docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$work":/work -v "$ROOT/node_modules":/work/node_modules:ro -w /work "$IMAGE" "$@"
}

cmd_shot() {
  local url="${1:-}" out="${2:-}"; shift 2 || { echo "usage: $0 shot <url> <out.png> [--mobile] [--dark] [--full] [--wait ms]" >&2; exit 1; }
  local mobile=0 dark=0 full=0 wait=3000
  while [ $# -gt 0 ]; do
    case "$1" in
      --mobile) mobile=1 ;; --dark) dark=1 ;; --full) full=1 ;;
      --wait) wait="$2"; shift ;;
      *) echo "ui-shot: unknown option $1" >&2; exit 1 ;;
    esac
    shift
  done
  local outdir; outdir="$(cd "$(dirname "$out")" && pwd)"; local name; name="$(basename "$out")"
  cat > "$outdir/.ui-shot-$$.mjs" <<EOF
import { chromium, devices } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...($mobile ? devices["iPhone 13"] : { viewport: { width: 1280, height: 800 } }),
  colorScheme: $dark ? "dark" : "light",
  serviceWorkers: "block",
});
const page = await ctx.newPage();
await page.goto(${url@Q}, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout($wait);
await page.screenshot({ path: ${name@Q}, fullPage: $full === 1 });
await browser.close();
EOF
  run_in_pw "$outdir" node ".ui-shot-$$.mjs"
  rm -f "$outdir/.ui-shot-$$.mjs"
  echo "wrote $out"
}

cmd_run() {
  local script="${1:-}"; shift || { echo "usage: $0 run <script.mjs> [args...]" >&2; exit 1; }
  local dir; dir="$(cd "$(dirname "$script")" && pwd)"
  run_in_pw "$dir" node "$(basename "$script")" "$@"
}

case "${1:-}" in
  shot) shift; cmd_shot "$@" ;;
  run) shift; cmd_run "$@" ;;
  *) sed -n '5,14p' "$0"; exit 1 ;;
esac
