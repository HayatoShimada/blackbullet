// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// A fixed tour of the main screens, saved as PNGs: the same set every time so design rounds compare like with like.
//   scripts/ui-shot.sh run scripts/ui-tour.mjs http://127.0.0.1:3040 <outdir> [light|dark|both] [desktop|mobile|both]
// Expects the demo space (examples/demo-space) or any space with Tasks, Projects/Spring Launch and Journal pages.
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [
  base = "http://127.0.0.1:3040",
  outArg = ".",
  schemes = "both",
  forms = "both",
] = process.argv.slice(2);
const out = path.resolve("/work", outArg);
fs.mkdirSync(out, { recursive: true });
const SCHEMES = schemes === "both" ? ["light", "dark"] : [schemes];
const FORMS = forms === "both" ? ["desktop", "mobile"] : [forms];
const MOD = "Control";

const browser = await chromium.launch();
for (const form of FORMS) {
  for (const scheme of SCHEMES) {
    const ctx = await browser.newContext({
      ...(form === "mobile"
        ? devices["iPhone 13"]
        : { viewport: { width: 1280, height: 800 } }),
      colorScheme: scheme,
      serviceWorkers: "block",
    });
    const page = await ctx.newPage();
    const shot = async (name, opts = {}) => {
      await page.waitForTimeout(opts.wait ?? 1200);
      const file = path.join(out, `${form}-${scheme}-${name}.png`);
      await page.screenshot({ path: file, fullPage: opts.full ?? false });
      console.log("wrote", path.relative("/work", file));
    };
    const open = async (p) => {
      await page
        .goto(`${base}/${p}`, { waitUntil: "networkidle" })
        .catch(() => {});
      await page.waitForTimeout(2500);
    };
    const esc = async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    };

    await open("");
    await shot("home");
    await shot("home-full", { full: true });

    await open("Projects/Spring%20Launch");
    await shot("project-page");
    // block editor affordances appear on hover
    const line = page.locator(".cm-line").nth(6);
    if (await line.count()) {
      await line.hover().catch(() => {});
      await shot("project-page-hover");
    }

    await open("Tasks");
    await shot("db-views", { wait: 2500 });
    await shot("db-views-full", { full: true, wait: 500 });

    await open("Journal/2026-10-02");
    await shot("journal");

    await open("");
    await page.keyboard.press(`${MOD}+/`);
    await shot("command-palette");
    await esc();

    await page.keyboard.press(`${MOD}+Shift+f`);
    await page.waitForTimeout(600);
    await page.keyboard.type("launch");
    await shot("memo-search", { wait: 2500 });
    await esc();

    await page.keyboard.press(`${MOD}+Shift+g`);
    await shot("graph", { wait: 3500 });
    await esc();

    await page.keyboard.press(`${MOD}+k`);
    await shot("page-picker");
    await esc();

    await ctx.close();
  }
}
await browser.close();
