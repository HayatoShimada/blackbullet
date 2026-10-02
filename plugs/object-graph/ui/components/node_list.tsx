// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { revealInContainer } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ObjectNode } from "../../src/model.ts";
import type { GraphEvent } from "../mediator/graph_mediator.ts";

type Props = {
  nodes: ObjectNode[];
  selectedRef: string | null;
  emit: (event: GraphEvent) => void;
};

// A long list costs nothing to scroll but a lot to lay out; the rest is one
// press away.
const SHOW_LIMIT = 200;

function nameOf(n: ObjectNode): string {
  const i = n.title.lastIndexOf("/");
  const name = i === -1 ? n.title : n.title.slice(i + 1);
  return n.prefix ? `${n.prefix}${name}` : name;
}

/** What kind of thing a node is, for the chip beside its name. */
function kindOf(n: ObjectNode): string {
  if (n.dangling) return "missing";
  return n.primaryTag ?? n.kind;
}

/**
 * The graph as a list: the way to reach every visible node with a keyboard or
 * a screen reader, and a plainer way to find one. A listbox whose selection is
 * the Mediator's own (the canvas highlights the same node); ArrowUp/Down,
 * Home and End move it, Enter opens the page, exactly as a double click on the
 * canvas does.
 */
export function NodeList({ nodes, selectedRef, emit }: Props) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const [all, setAll] = useState(false);
  const sorted = useMemo(
    () =>
      [...nodes].sort((a, b) =>
        nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" }),
      ),
    [nodes],
  );
  const selectedIndex = sorted.findIndex((n) => n.ref === selectedRef);
  // Never cut off the row that is selected.
  const shown =
    all || sorted.length <= SHOW_LIMIT
      ? sorted
      : sorted.slice(0, Math.max(SHOW_LIMIT, selectedIndex + 1));

  // A selection made on the canvas brings its row into view (inside the list
  // only: scrolling the panel would drag the sidebar with it).
  useEffect(() => {
    const list = listRef.current;
    if (!list || selectedIndex < 0) return;
    const row = list.querySelector('[aria-selected="true"]');
    if (row) revealInContainer(row, list);
  }, [selectedRef, selectedIndex]);

  const select = (index: number) => {
    const n = shown[Math.max(0, Math.min(shown.length - 1, index))];
    if (n) emit({ type: "node.select", ref: n.ref });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "ArrowDown":
        select(selectedIndex < 0 ? 0 : selectedIndex + 1);
        break;
      case "ArrowUp":
        select(selectedIndex < 0 ? shown.length - 1 : selectedIndex - 1);
        break;
      case "Home":
        select(0);
        break;
      case "End":
        select(shown.length - 1);
        break;
      case "Enter": {
        const n = sorted[selectedIndex];
        if (!n) return;
        emit({ type: "node.open", ref: n.ref, kind: n.kind });
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  };

  if (sorted.length === 0) {
    return <div class="gv-semantic-note">No pages to show.</div>;
  }
  return (
    <>
      <ul
        ref={listRef}
        class="gv-node-list"
        role="listbox"
        tabIndex={0}
        aria-label="Pages in the graph"
        aria-activedescendant={
          selectedIndex >= 0 ? `gv-node-${selectedIndex}` : undefined
        }
        onKeyDown={onKeyDown}
      >
        {shown.map((n, i) => (
          <li
            key={n.ref}
            id={`gv-node-${i}`}
            role="option"
            aria-selected={n.ref === selectedRef}
            class="gv-node-option"
            onClick={() => emit({ type: "node.select", ref: n.ref })}
            onDblClick={() =>
              emit({ type: "node.open", ref: n.ref, kind: n.kind })
            }
          >
            <span class="gv-node-name">{nameOf(n)}</span>
            <span class="sb-chip gv-node-kind">{kindOf(n)}</span>
          </li>
        ))}
      </ul>
      {shown.length < sorted.length && (
        <button
          type="button"
          class="gv-more gv-link-button"
          onClick={() => setAll(true)}
        >
          show {sorted.length - shown.length} more
        </button>
      )}
    </>
  );
}
