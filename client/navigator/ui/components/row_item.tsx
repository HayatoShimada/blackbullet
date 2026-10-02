import { RowText } from "../../../../plug-api/ui/row_text.tsx";
import type { Ref } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { highlightMatches } from "../../../../plug-api/ui/highlight.tsx";
import {
  type HoverTracker,
  useHovered,
} from "../../../../plug-api/ui/hover.ts";
import { Icon } from "../../../../plug-api/ui/icon.tsx";
import { RowActions } from "../../../../plug-api/ui/row_actions.tsx";
import type { RowState } from "../engine.ts";
import type { ActionMeta, Decoration, Row } from "../../types.ts";
import type { Anchor } from "../mediator/tree_mediator.ts";
import { MoreIcon } from "./chrome_icons.tsx";

/** How many of `actions` apply to a row in this state, in this mode. */
export function visibleActionCount(
  actions: ActionMeta[] | undefined,
  state: RowState | undefined,
  readOnly: boolean,
): number {
  return (actions ?? []).filter(
    (action, index) =>
      !(readOnly && action.requireMode === "rw") &&
      (!action.hasWhen || state?.actions?.[index] === true),
  ).length;
}

export function anchorOf(element: Element): Anchor {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { left, top, right, bottom };
}

export function Chip({ decoration }: { decoration: Decoration }) {
  return (
    <span
      className={"sb-nav-chip " + (decoration.cssClass ?? "")}
      title={decoration.title}
    >
      {decoration.text ?? decoration.icon}
    </span>
  );
}

function TrailingChips({ decorations }: { decorations: Decoration[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const widths = useRef<number[]>();
  const [visibleCount, setVisibleCount] = useState(decorations.length);
  const signature = decorations
    .map((decoration) =>
      [
        decoration.text,
        decoration.icon,
        decoration.cssClass,
        decoration.title,
      ].join("\u0000"),
    )
    .join("\u0001");

  useLayoutEffect(() => {
    widths.current = undefined;
    setVisibleCount(decorations.length);
  }, [decorations.length, signature]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      if (!widths.current && visibleCount === decorations.length) {
        widths.current = [...element.children].map(
          (child) => child.getBoundingClientRect().width,
        );
      }
      if (!widths.current) return;
      const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
      let used = 0;
      let count = 0;
      for (const width of widths.current) {
        const next = used + (count > 0 ? gap : 0) + width;
        if (next > element.clientWidth + 0.5) break;
        used = next;
        count++;
      }
      setVisibleCount((current) => (current === count ? current : count));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [decorations.length, signature, visibleCount]);

  return (
    <span ref={ref} className="sb-nav-trailing">
      {decorations.slice(0, visibleCount).map((decoration, index) => (
        <Chip key={index} decoration={decoration} />
      ))}
    </span>
  );
}

export function RowItem({
  row,
  index,
  selected,
  actions,
  actionIcons,
  hover,
  state,
  hasIcon,
  readOnly,
  phrase,
  onClick,
  onAction,
  onMenu,
  elRef,
}: {
  row: Row;
  /** Position in the rendered list -- the hover tracking reads it back. */
  index: number;
  selected: boolean;
  actions?: ActionMeta[];
  actionIcons?: (Element | undefined)[];
  /** Decides, per row, whether this one's actions are worth mounting. */
  hover: HoverTracker;
  state?: RowState;
  /** Whether the view defines row icons at all, i.e. reserves the slot. */
  hasIcon: boolean;
  readOnly: boolean;
  /** The phrase ranking rows, for matched-character highlighting -- undefined while it's empty. */
  phrase?: string;
  onClick?: () => void;
  onAction: (index: number) => void;
  /** With several actions to offer, one `⋯` asks for their menu instead. */
  onMenu?: (anchor: Anchor) => void;
  elRef?: Ref<HTMLDivElement>;
}) {
  const decorations = row.decorations ?? [];
  // Unconditional: a hook call behind `selected ||` would change the hook
  // order the moment the selection moved onto this row.
  const hovered = useHovered(hover, row);
  const passive = row.passive === true;
  const showActions = !passive && (selected || hovered);
  const menuRow = !!onMenu && visibleActionCount(actions, state, readOnly) > 1;
  const left = decorations.filter((d) => d.position === "left");
  const right = decorations.filter((d) => d.position !== "left");
  return (
    <div
      ref={elRef}
      className={
        "sb-nav-row" +
        (selected ? " sb-nav-selected" : "") +
        (!onClick ? " sb-nav-passive" : "") +
        (passive ? " sb-nav-row-passive" : "") +
        (row.cssClass ? ` ${row.cssClass}` : "")
      }
      data-index={index}
      aria-disabled={passive ? true : undefined}
      onClick={passive ? undefined : onClick}
    >
      {hasIcon &&
        !passive &&
        (state?.icon ? (
          <Icon node={state.icon} class="sb-nav-icon" />
        ) : (
          // Empty, not absent: rows stay aligned whether or not this object
          // resolved an icon.
          <span className="sb-nav-icon" />
        ))}
      {left.map((d, i) => (
        <Chip key={`l${i}`} decoration={d} />
      ))}
      <RowText
        primary={
          <span className="sb-nav-primary">
            {highlightMatches(row.primary, phrase)}
          </span>
        }
        description={row.description}
      />
      {right.length > 0 && <TrailingChips decorations={right} />}
      {actions && showActions && menuRow && (
        <span className="sb-row-actions">
          <button
            type="button"
            className="sb-row-action sb-row-more"
            tabIndex={-1}
            title="Actions"
            aria-label={`Actions for ${row.primary}`}
            aria-haspopup="menu"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onMenu?.(anchorOf(e.currentTarget));
            }}
          >
            <MoreIcon />
          </button>
        </span>
      )}
      {actions && showActions && !menuRow && (
        <RowActions
          actions={actions}
          icons={actionIcons}
          mask={state?.actions}
          readOnly={readOnly}
          onRun={onAction}
        />
      )}
    </div>
  );
}
