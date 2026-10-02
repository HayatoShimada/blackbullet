// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

// The canvas paints with colours a stylesheet owns. A canvas cannot resolve
// `var()` (or `color-mix()` in older engines), so every colour is read through
// the document's computed style and normalised to a concrete `rgb()` once per
// theme change, never per frame.

export type CanvasTheme = {
  font: string;
  bg: string;
  nodeStroke: string;
  nodeDim: string;
  label: string;
  labelDim: string;
  link: string;
  linkDim: string;
  linkHot: string;
  linkMention: string;
  linkSimilar: string;
  accent: string;
  /** False while the stylesheets are still loading: the values are fallbacks. */
  ready: boolean;
  /** Normalises any CSS colour expression, `var()` and `hsl(... var())` included. */
  resolve(css: string): string;
};

// Last-resort fallbacks (light reading) for a document that has no stylesheet
// yet. The tokens in object-graph.scss are the source of truth; these are read
// only until it loads, so keep them in step with the light palette there.
const FALLBACKS = {
  bg: "#ffffff",
  nodeStroke: "#ffffff",
  nodeDim: "#9e4705",
  label: "#1c2128",
  labelDim: "#5f6973",
  link: "#87919c",
  linkDim: "#c3c8ce",
  linkHot: "#2f5fb3",
  linkMention: "#8a62d6",
  linkSimilar: "#0f8a78",
  accent: "#2f5fb3",
};

const PROBE_ID = "gv-color-probe";

function probeFor(doc: Document): HTMLElement {
  const existing = doc.getElementById(PROBE_ID);
  if (existing) return existing;
  const probe = doc.createElement("span");
  probe.id = PROBE_ID;
  probe.setAttribute("aria-hidden", "true");
  probe.style.display = "none";
  doc.documentElement.appendChild(probe);
  return probe;
}

export function readCanvasTheme(
  doc: Document = document,
  win: Window = window,
): CanvasTheme {
  const cs = win.getComputedStyle(doc.documentElement);
  // One probe element: assigning a colour to it and reading the computed
  // colour back is the engine's own resolver, so nothing is reimplemented.
  const probe = probeFor(doc);
  const cache = new Map<string, string>();
  const resolve = (css: string): string => {
    const hit = cache.get(css);
    if (hit !== undefined) return hit;
    probe.style.color = "";
    probe.style.color = css;
    const out =
      probe.style.color === "" ? "" : win.getComputedStyle(probe).color;
    cache.set(css, out);
    return out;
  };
  const token = (name: keyof typeof FALLBACKS, cssName: string): string =>
    resolve(cs.getPropertyValue(cssName).trim()) ||
    resolve(FALLBACKS[name]) ||
    FALLBACKS[name];
  const theme: CanvasTheme = {
    font: cs.fontFamily,
    bg: token("bg", "--gv-bg"),
    nodeStroke: token("nodeStroke", "--gv-node-stroke"),
    nodeDim: token("nodeDim", "--gv-node-dim"),
    label: token("label", "--gv-label"),
    labelDim: token("labelDim", "--gv-label-dim"),
    link: token("link", "--gv-link"),
    linkDim: token("linkDim", "--gv-link-dim"),
    linkHot: token("linkHot", "--gv-link-hot"),
    linkMention: token("linkMention", "--gv-link-mention"),
    linkSimilar: token("linkSimilar", "--gv-link-similar"),
    accent: token("accent", "--gv-accent"),
    // --gv-bg is defined by this plug's own stylesheet and points at the shared
    // --sb-bg: both there means every token above was read, not defaulted.
    ready:
      cs.getPropertyValue("--gv-bg").trim() !== "" &&
      cs.getPropertyValue("--ui-font").trim() !== "",
    resolve,
  };
  return theme;
}
