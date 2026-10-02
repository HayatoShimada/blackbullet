import { resolveFeatherIcons } from "./feather_icons.ts";

const SVG_ELEMENTS = new Set([
  "circle",
  "clippath",
  "defs",
  "desc",
  "ellipse",
  "g",
  "line",
  "lineargradient",
  "mask",
  "path",
  "polygon",
  "polyline",
  "radialgradient",
  "rect",
  "stop",
  "svg",
  "text",
  "title",
]);

const SVG_ATTRIBUTES = new Set([
  "aria-hidden",
  "class",
  "clip-path",
  "clip-rule",
  "cx",
  "cy",
  "d",
  "dominant-baseline",
  "fill",
  "fill-opacity",
  "fill-rule",
  "focusable",
  "font-size",
  "gradienttransform",
  "gradientunits",
  "height",
  "id",
  "mask",
  "offset",
  "opacity",
  "points",
  "preserveaspectratio",
  "r",
  "role",
  "rx",
  "ry",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
  "transform",
  "vector-effect",
  "viewbox",
  "width",
  "x",
  "x1",
  "x2",
  "xmlns",
  "y",
  "y1",
  "y2",
]);

const URL_PAINT_ATTRIBUTES = new Set(["clip-path", "fill", "mask", "stroke"]);

export type ParsedIcon =
  | { kind: "svg"; markup: string }
  | { kind: "feather"; name: string }
  | { kind: "emoji"; text: string }
  | { kind: "unknown"; prefix: string }
  | { kind: "invalid" };

// A pictograph or a flag, then whatever joins onto it (variation selectors,
// skin tones, ZWJ sequences). Letters are excluded so a name never reads as one.
const EMOJI =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})[^a-zA-Z]*$/u;

/** An icon written as an emoji itself, e.g. `icon: 📚` in a page's frontmatter. */
export function isEmojiIcon(icon: string): boolean {
  const trimmed = icon.trim();
  return trimmed.length <= 24 && EMOJI.test(trimmed);
}

/** Emoji drawn as SVG text, so it flows through the same icon pipeline (and
 * the same sizing) as a Feather icon or a hand-written SVG. */
export function emojiMarkup(text: string): string {
  const escaped = text
    .trim()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><text x="12" y="13" text-anchor="middle" dominant-baseline="central" font-size="19">${escaped}</text></svg>`;
}

export function parseIcon(icon: unknown): ParsedIcon {
  if (typeof icon !== "string") return { kind: "invalid" };
  const trimmed = icon.replace(/^\s+/, "");
  if (trimmed.startsWith("<svg")) return { kind: "svg", markup: trimmed };
  if (isEmojiIcon(trimmed)) return { kind: "emoji", text: trimmed.trim() };
  const colon = trimmed.indexOf(":");
  if (colon === -1) return { kind: "feather", name: trimmed };
  const prefix = trimmed.slice(0, colon);
  if (prefix === "feather") {
    return { kind: "feather", name: trimmed.slice(colon + 1) };
  }
  return { kind: "unknown", prefix };
}

const iconMarkupCache = new Map<string, string | undefined>();

export function resolveIconMarkup(icon: unknown): string | undefined {
  if (typeof icon !== "string") return undefined;
  if (iconMarkupCache.has(icon)) return iconMarkupCache.get(icon);
  const parsed = parseIcon(icon);
  let markup: string | undefined;
  if (parsed.kind === "svg") {
    if (typeof document === "undefined") return undefined;
    markup = createSvgNode(parsed.markup)?.outerHTML;
  }
  if (parsed.kind === "emoji") markup = emojiMarkup(parsed.text);
  if (parsed.kind === "feather") {
    markup = resolveFeatherIcons([parsed.name])[parsed.name];
  }
  iconMarkupCache.set(icon, markup);
  return markup;
}

export function createIconElement(
  icon: unknown,
  className: string,
): HTMLElement | undefined {
  const svg = resolveIconNode(icon);
  if (!svg) return undefined;
  const wrapper = document.createElement("span");
  wrapper.className = className;
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.append(svg.cloneNode(true));
  return wrapper;
}

const iconNodeCache = new Map<string, Element | undefined>();

export function resolveIconNode(icon: unknown): Element | undefined {
  const markup = resolveIconMarkup(icon);
  if (!markup || typeof document === "undefined") return undefined;
  if (iconNodeCache.has(markup)) return iconNodeCache.get(markup);
  const node = createSvgNode(markup);
  iconNodeCache.set(markup, node);
  return node;
}

export function createSvgNode(markup: string): Element | undefined {
  if (typeof document === "undefined") return undefined;
  const template = document.createElement("template");
  template.innerHTML = markup;
  const svg = template.content.firstElementChild;
  if (!svg || svg.tagName.toLowerCase() !== "svg") return undefined;

  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    if (!SVG_ELEMENTS.has(element.tagName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const unsafePaint =
        URL_PAINT_ATTRIBUTES.has(name) &&
        attribute.value.includes("url(") &&
        !/^url\(#[A-Za-z_][\w:.-]*\)$/.test(attribute.value);
      if (!SVG_ATTRIBUTES.has(name) || unsafePaint) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return svg;
}
