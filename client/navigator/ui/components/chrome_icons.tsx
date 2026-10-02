import type { JSX } from "preact";

export const CHROME_ICON_PROPS = {
  width: "16",
  height: "16",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5",
  "aria-hidden": "true",
} as const;

export function CopyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...CHROME_ICON_PROPS}>
      <rect x="6" y="6" width="8.5" height="8.5" rx="1.5" />
      <path d="M3.5 10H3A1.5 1.5 0 0 1 1.5 8.5V3A1.5 1.5 0 0 1 3 1.5h5.5A1.5 1.5 0 0 1 10 3v.5" />
    </svg>
  );
}

export function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...CHROME_ICON_PROPS} stroke-linecap="round">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

export function MoreIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      {...CHROME_ICON_PROPS}
      fill="currentColor"
      stroke="none"
    >
      <circle cx="3.5" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12.5" cy="8" r="1.25" />
    </svg>
  );
}

export function PlusIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...CHROME_ICON_PROPS} stroke-linecap="round">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function SearchIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...CHROME_ICON_PROPS} stroke-linecap="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}

export function JournalIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...CHROME_ICON_PROPS} stroke-linecap="round">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </svg>
  );
}

/** The `⋯` as a template node, for the places that draw icons from nodes. */
let moreNode: Element | undefined;
export function moreIconNode(): Element | undefined {
  if (moreNode || typeof document === "undefined") return moreNode;
  const template = document.createElement("template");
  template.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">' +
    '<circle cx="3.5" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="12.5" cy="8" r="1.25"/></svg>';
  moreNode = template.content.firstElementChild ?? undefined;
  return moreNode;
}
