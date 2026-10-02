// Node and swatch colour per user tag, as a CSS colour expression. The values
// live in object-graph.scss (one hue per well-known tag, a measured pair per
// colour scheme); this file only names them. A canvas cannot resolve `var()`,
// so the canvas side runs these expressions through `resolveCssColor`
// (canvas_theme.ts) before it paints; DOM swatches use them as they are.

/** Tokens for the tags the product vocabulary names (product design §1). */
const TAG_TOKENS: Record<string, string> = {
  project: "--gv-tag-project",
  area: "--gv-tag-area",
  goal: "--gv-tag-goal",
  journal: "--gv-tag-journal",
  resource: "--gv-tag-resource",
};

// Colour for nodes with no user tag.
export const UNTAGGED_COLOR_VAR = "var(--gv-untagged)";

// Any other tag: a stable hue from its name at the scheme's own saturation and
// lightness, so a free-form tag is distinct but never lighter than the page.
function hashedHue(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export function colorForTag(tag: string | null): string {
  if (!tag) return UNTAGGED_COLOR_VAR;
  const token = TAG_TOKENS[tag.toLowerCase()];
  if (token) return `var(${token})`;
  return `hsl(${hashedHue(tag)} var(--gv-tag-s) var(--gv-tag-l))`;
}
