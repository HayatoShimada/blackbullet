// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
//
// Rewrites the release history of the project page (the gh-pages index.html) from GitHub Releases,
// so the page and the Releases tab never drift apart. Run by .github/workflows/pages-releases.yml
// on every published / edited / deleted release; can also be run by hand:
//
//   GITHUB_TOKEN=$(gh auth token) node scripts/pages/sync-releases.mjs path/to/index.html [owner/repo]
//
// It replaces only what sits between <!-- releases:start --> and <!-- releases:end --> and the
// version badge (<span class="ver">…</span>); the rest of the page is left as it is. Release notes
// come from GitHub already rendered (body_html), so Markdown in a release body shows as intended.
// Node 20+ (global fetch), no dependencies.
import fs from "node:fs";

const [file, repoArg] = process.argv.slice(2);
const repo = repoArg ?? process.env.GITHUB_REPOSITORY ?? "HayatoShimada/blackbullet";
if (!file) {
  console.error("usage: sync-releases.mjs <index.html> [owner/repo]");
  process.exit(2);
}

const headers = {
  Accept: "application/vnd.github.html+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "blackbullet-pages-sync",
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function fetchReleases() {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.filter((r) => !r.draft);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The page renders in Japan; show the release date as the Asia/Tokyo calendar date.
const day = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(iso));

export function renderReleases(releases, repoName) {
  if (!releases.length) {
    return `<p class="rel-empty">まだリリースはありません。</p>`;
  }
  const latest = releases.find((r) => !r.prerelease);
  const items = releases.map((r) => {
    const chips = [
      r === latest ? `<span class="chip ok latest">Latest</span>` : "",
      r.prerelease ? `<span class="chip latest">Pre-release</span>` : "",
    ].join("");
    const title = r.name && r.name !== r.tag_name ? `<h3 class="rel-name">${esc(r.name)}</h3>` : "";
    // Release bodies are often hard-wrapped text; GitHub turns each newline into <br>. Let lines flow.
    const body = (r.body_html ?? "").replace(/<br>\s*/g, " ").trim();
    const notes = body ? `<div class="rel-notes">${body}</div>` : `<p class="rel-notes">リリースノートはありません。</p>`;
    return `      <article class="rel" id="${esc(r.tag_name)}">
        <div class="rel-meta">
          <a class="rel-tag" href="${esc(r.html_url)}">${esc(r.tag_name)}</a>
          <span class="rel-date">${day(r.published_at ?? r.created_at)}</span>
          ${chips}
        </div>
        <div class="rel-body">
          ${title}
          ${notes}
        </div>
      </article>`;
  });
  return `<div class="rel-stack">
${items.join("\n")}
      </div>
      <p class="rel-source">GitHub Releases から自動で反映しています(<a href="https://github.com/${esc(repoName)}/releases">すべてのリリース</a>)。</p>`;
}

export function applyToPage(html, releases, repoName) {
  const start = "<!-- releases:start -->";
  const end = "<!-- releases:end -->";
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error(`markers ${start} / ${end} not found in the page`);
  let out = html.slice(0, a + start.length) + "\n      " + renderReleases(releases, repoName) + "\n      " + html.slice(b);
  const latest = releases.find((r) => !r.prerelease);
  if (latest) out = out.replace(/<span class="ver">[^<]*<\/span>/, `<span class="ver">${esc(latest.tag_name)}</span>`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const releases = await fetchReleases();
  const before = fs.readFileSync(file, "utf8");
  const after = applyToPage(before, releases, repo);
  if (after === before) {
    console.log(`releases: unchanged (${releases.length})`);
  } else {
    fs.writeFileSync(file, after);
    console.log(`releases: wrote ${releases.length} (latest ${releases.find((r) => !r.prerelease)?.tag_name ?? "none"})`);
  }
}
