// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { describe, expect, it } from "vitest";
import { readCanvasTheme } from "./canvas_theme.ts";

// A stand-in for the iframe's document: tokens by name, and a probe element
// whose computed colour is whatever was assigned to it (the real engine
// normalises it to rgb(); here the assignment is enough to see the plumbing).
function fakeEnv(tokens: Record<string, string>) {
  const probe = {
    id: "",
    style: { color: "", display: "" },
    setAttribute() {},
  };
  const doc = {
    documentElement: { appendChild() {} },
    getElementById: (id: string) => (id === "gv-color-probe" ? probe : null),
    createElement: () => probe,
  } as unknown as Document;
  const win = {
    getComputedStyle: (el: unknown) =>
      el === probe
        ? { color: `resolved(${probe.style.color})` }
        : {
            fontFamily: "sans",
            getPropertyValue: (name: string) => tokens[name] ?? "",
          },
  } as unknown as Window;
  return { doc, win };
}

describe("readCanvasTheme", () => {
  it("reads every colour through the document, not from var() strings", () => {
    const { doc, win } = fakeEnv({
      "--gv-bg": "#fff",
      "--ui-font": "sans",
      "--gv-label": "#111",
      "--gv-link-similar": "teal",
    });
    const t = readCanvasTheme(doc, win);
    expect(t.ready).toBe(true);
    expect(t.label).toBe("resolved(#111)");
    expect(t.linkSimilar).toBe("resolved(teal)");
    expect(t.font).toBe("sans");
  });

  it("is not ready, and falls back, while the stylesheet has not loaded", () => {
    const t = readCanvasTheme(
      ...(Object.values(fakeEnv({})) as [Document, Window]),
    );
    expect(t.ready).toBe(false);
    // Fallback values still come out as colours, never as empty strings.
    expect(t.label).toBe("resolved(#1c2128)");
  });

  it("resolves any colour expression, caching the answer", () => {
    const { doc, win } = fakeEnv({ "--gv-bg": "#fff", "--ui-font": "sans" });
    const t = readCanvasTheme(doc, win);
    expect(t.resolve("var(--gv-untagged)")).toBe(
      "resolved(var(--gv-untagged))",
    );
    expect(t.resolve("var(--gv-untagged)")).toBe(
      "resolved(var(--gv-untagged))",
    );
  });
});
