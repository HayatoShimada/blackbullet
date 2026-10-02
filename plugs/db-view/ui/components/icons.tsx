// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

/** The few glyphs the view draws, as inline SVG (no icon font, no requests).
 * They are decoration: the button that holds one carries the label. */
const svg = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.5,
  "stroke-linecap": "round" as const,
  "stroke-linejoin": "round" as const,
  "aria-hidden": true,
  focusable: "false" as const,
};

export const PencilIcon = ({ size = 14 }: { size?: number }) => (
  <svg {...svg} width={size} height={size}>
    <path d="M10.5 2.5l3 3L5 14H2v-3z" />
  </svg>
);

export const SearchIcon = () => (
  <svg {...svg}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </svg>
);

export const MoreIcon = () => (
  <svg {...svg} fill="currentColor" stroke="none">
    <circle cx="3.5" cy="8" r="1.4" />
    <circle cx="8" cy="8" r="1.4" />
    <circle cx="12.5" cy="8" r="1.4" />
  </svg>
);

export const ChevronIcon = ({ dir }: { dir: "left" | "right" }) => (
  <svg {...svg}>
    <path d={dir === "left" ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"} />
  </svg>
);
