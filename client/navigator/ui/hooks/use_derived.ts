import { useMemo, useRef } from "preact/hooks";
import {
  buildDisplayTree,
  expandTreeDisplay,
  type TreeDisplay,
  type TreeNode,
  type VisibleRow,
} from "../../../../plug-api/ui/tree_model.ts";
import type { SegmentMeta } from "../../types.ts";
import { applyDropdown, dropdownIndexFor } from "../dropdown.ts";
import type { NavigatorEngine, RankedRow } from "../engine.ts";
import { type RankCacheEntry, rankIncrementally } from "../incremental_rank.ts";
import type { ActiveView } from "../panel.ts";
import { matchesTags, splitHashtags } from "../phrase.ts";
import { createTarget } from "../../views/create_target.ts";
import { applySegment, revealedNames } from "../segments.ts";
import { leadingPassive, settleSelectable } from "../selection.ts";

/** Rendered rows when the view doesn't set `presentation.limit`. */
const DEFAULT_LIMIT = 200;

// Sentinel `selectedPath` for the tree's create row -- it lives outside the
// tree, so it has no node path of its own, and a NUL byte can't collide with
// a real object name.
export const CREATE_PATH = "\u0000create";

// Drag-and-drop is desktop-only: HTML5 drag events don't fire
// on touch at all, so a `draggable` row there only breaks scrolling.
const POINTER_FINE =
  globalThis.matchMedia?.("(pointer: fine)").matches ?? false;

/**
 * Everything the panel shows, and everything its keys and commands act on,
 * derived from the active view and the four pieces of input state (phrase,
 * segment, selection, expansion). Pure, and memoized per input rather than
 * per render: at 5000 rows this is the keystroke's whole cost.
 */
export type DerivedView = {
  sourceMode: boolean;
  segments?: SegmentMeta[];
  /** The option the selected dropdown value names; -1 is the built-in "All". */
  dropdownIndex: number;
  /** The phrase ranking runs on: no hashtags, no `stripPrefix` sigil. */
  rankPhrase: string;
  trimmedPhrase: string;
  visible: RankedRow[];
  /** `visible` with the create slot spliced in, as the list actually renders. */
  listItems: (RankedRow | undefined)[];
  /** The ranked row at a list index; undefined when that index is the create row. */
  rowAtIndex: (index: number) => RankedRow | undefined;
  /**
   * The nearest row that can be selected, from `index` going `direction`
   * (and the other way when nothing is left that way). Passive rows -- counts
   * and sentences -- are never selected.
   */
  settleIndex: (index: number, direction: 1 | -1) => number;
  canCreate: boolean;
  createIndex: number;
  createSelected: boolean;
  createSelectedInTree: boolean;
  activeIndex: number;
  lastIndex: number;
  error?: string;
  fatalError: boolean;
  segmentUnavailable: boolean;
  dropdownUnavailable: boolean;
  isTreeMode: boolean;
  treeFiltering: boolean;
  truncated: number;
  canDrag: boolean;
  treeDisplay?: TreeDisplay;
  treeVisible: VisibleRow[];
  treeLastIndex: number;
  activeTreeIndex: number;
  activeTreeNode?: TreeNode;
};

export function useDerived({
  engine,
  view,
  bootError,
  phrase,
  segmentIndex,
  dropdownValue,
  selectedIndex,
  selectedPath,
  expanded,
  readOnly,
  createFolder,
}: {
  engine: NavigatorEngine;
  view?: ActiveView;
  bootError?: string;
  phrase: string;
  segmentIndex: number;
  dropdownValue: unknown;
  selectedIndex: number;
  selectedPath?: string;
  expanded: Set<string>;
  readOnly: boolean;
  /** Where a typed name is created (`createInFolder` views): it counts as
   * existing when the page *there* does. */
  createFolder?: string;
}): DerivedView {
  // Source mode: the source already answered this phrase and segment, in the
  // order it wants them shown -- ranking them again here would overrule it.
  const sourceMode = view?.meta.search === "source";

  // Hashtag pre-filtering: a `#tag` in the phrase is a filter, not something
  // to fuzzy-match a name against. Source mode is exempt -- its source is
  // handed the raw phrase and decides for itself what a `#` means.
  const hashtagFilter = !!view?.meta.hashtagFilter && !sourceMode;
  const { tags, rest: rankPhrase } = useMemo(() => {
    // A view whose rows are named without the sigil people reach for -- the
    // tag picker's rows are `work`, not `#work` -- drops it before ranking, so
    // typing it and not typing it both find the row.
    const strip = view?.meta.stripPrefix;
    const typed =
      strip && phrase.startsWith(strip) ? phrase.slice(strip.length) : phrase;
    return hashtagFilter ? splitHashtags(typed) : { tags: [], rest: typed };
  }, [hashtagFilter, phrase, view?.meta.stripPrefix]);
  // Use a stable tag key so filtering stays memoized across untagged keystrokes.
  // NUL separates tags because a tag can contain spaces.
  const tagKey = tags.join("\u0000");

  // Use batched masks to switch filters without syscalls. Source-mode views
  // already apply segments, but dropdown filtering is always the panel’s job.
  const dropdownIndex = dropdownIndexFor(view?.dropdownOptions, dropdownValue);

  // Typing `Library/` brings back what the segment keeps out of the way. A
  // string so the rows below recompute only when the set actually changes.
  const revealedKey = revealedNames(
    view?.meta.segments?.[segmentIndex],
    phrase,
  ).join("\u0000");

  const emptyPhrase = rankPhrase.trim() === "";
  const filteredRows = useMemo(() => {
    if (!view) return [];
    const rows = applyDropdown(
      sourceMode
        ? view.rows
        : applySegment(
            view.rows,
            segmentIndex,
            view.meta.segments,
            view.segmentMasks,
            revealedKey ? revealedKey.split("\u0000") : [],
          ),
      dropdownIndex,
      view.dropdownMasks,
    );
    // Some rows are for the empty phrase only (group titles, the Recent
    // copies) and some for a typed one (found by name, never browsed into).
    const timed = rows.some((row) => row.when !== undefined)
      ? rows.filter(
          (row) =>
            row.when === undefined || (row.when === "empty") === emptyPhrase,
        )
      : rows;
    if (sourceMode || !tagKey) return timed;
    const wanted = tagKey.split("\u0000");
    return timed.filter((row) => matchesTags(row, wanted));
  }, [
    view,
    sourceMode,
    segmentIndex,
    dropdownIndex,
    tagKey,
    revealedKey,
    emptyPhrase,
  ]);

  const rankCacheRef = useRef<RankCacheEntry>();
  const ranked = useMemo(() => {
    if (!view) return [];
    if (sourceMode) return filteredRows.map((row) => ({ row, score: 0 }));
    const result = rankIncrementally(
      rankCacheRef.current,
      view,
      filteredRows,
      rankPhrase,
      (rows, phrase) => engine.rankRows(rows, phrase, view.meta),
    );
    rankCacheRef.current = result.next;
    return result.ranked;
  }, [view, sourceMode, filteredRows, rankPhrase]);

  const limit = view?.meta.limit || DEFAULT_LIMIT;
  const visible = ranked.length > limit ? ranked.slice(0, limit) : ranked;

  const segments = view?.meta.segments;

  // Use the ranking phrase for creation so hashtag filters stay out of the name.
  const trimmedPhrase = rankPhrase.trim();
  // Same trigger as FilterList's `allowNew`: a non-empty phrase that no row
  // already carries (ignoring case: "tasks" opens Tasks, it does not offer a
  // second page). Scanning `view.rows` (not `ranked`) keeps this
  // honest when the fuzzy ranker drops an exact match off the visible list.
  const canCreate =
    !!view?.meta.hasCreate &&
    !readOnly &&
    trimmedPhrase.length > 0 &&
    !view.rows.some((r) => {
      const primary = r.primary.toLowerCase();
      return (
        primary === trimmedPhrase.toLowerCase() ||
        (!!view.meta.createInFolder &&
          primary === createTarget(trimmedPhrase, createFolder).toLowerCase())
      );
    });

  const lastIndex = visible.length - 1 + (canCreate ? 1 : 0);
  // Passive rows lead a list (a count, a sentence); they take no selection.
  const passiveLead = leadingPassive(visible);
  /**
   * Where the create row sits among the list's rows: **second**, right under
   * the best match, which is where `FilterList` spliced it and what makes
   * one ArrowDown from the top mean "create it instead". With nothing
   * matching it is the only row there is, so it is first. (A tree keeps its
   * own pinned-below-the-tree placement -- see the render.)
   */
  const createIndex =
    !canCreate || view?.meta.mode === "tree"
      ? -1
      : visible.length <= passiveLead
        ? visible.length
        : passiveLead + 1;
  const rowAtIndex = (index: number) =>
    index === createIndex
      ? undefined
      : visible[createIndex >= 0 && index > createIndex ? index - 1 : index];
  const listItems = useMemo(() => {
    if (createIndex < 0) return visible;
    const out: (RankedRow | undefined)[] = [...visible];
    out.splice(createIndex, 0, undefined);
    return out;
  }, [visible, createIndex]);
  const isPassiveAt = (index: number) => {
    const item = listItems[index];
    return item !== undefined && item.row.passive === true;
  };
  const settleIndex = (index: number, direction: 1 | -1): number =>
    settleSelectable(isPassiveAt, lastIndex, index, direction);
  const activeIndex = settleIndex(selectedIndex, 1);
  const error = bootError ?? view?.error;
  // Keep existing rows under source errors; a bad phrase must not clear the screen.
  const fatalError = !!error && ranked.length === 0;
  // The `where` masks never arrived (their batch failed), so this segment can
  // only fail closed -- which on its own looks exactly like "nothing matched".
  const segmentUnavailable =
    !sourceMode && !!segments?.[segmentIndex]?.hasWhere && !view?.segmentMasks;
  // Same failure shape for the dropdown: a selected option whose masks never
  // arrived fails closed, indistinguishable from "nothing matched" without
  // saying so.
  const dropdownUnavailable = dropdownIndex >= 0 && !view?.dropdownMasks;

  const isTreeMode = view?.meta.mode === "tree";
  const treeFiltering = isTreeMode && phrase.trim().length > 0;
  // An unfiltered tree is bounded by what's expanded, so it renders whole; a
  // filtered one auto-expands every match, which is what the cap is for.
  const truncated =
    !isTreeMode || treeFiltering ? ranked.length - visible.length : 0;
  // While filtering, the pruned tree isn't the real structure -- a "folder"
  // on screen may be missing most of its children -- so a drop into it would
  // mean something other than what the user sees.
  const canDrag =
    !!view?.meta.hasMove && !treeFiltering && POINTER_FINE && !readOnly;

  // Reuses `visible` (already ranked with the same fields config, already
  // capped) instead of calling `rankRows` a second time.
  const treeScores = useMemo(() => {
    if (!treeFiltering) return undefined;
    return new Map(visible.map((r) => [String(r.row.obj.name), r.score]));
  }, [treeFiltering, visible]);

  const expandAll = view?.meta.expandAll === true;
  const displayTree = useMemo(() => {
    if (!view || !isTreeMode) return undefined;
    // The filtered subset, not every row: the folders its rows hang off are
    // rebuilt from their names, so ancestors come back without pruning twice.
    return buildDisplayTree(
      filteredRows,
      view.meta.hierarchy.separator,
      view.meta.foldersFirst,
      treeScores,
    );
  }, [view, isTreeMode, filteredRows, treeScores]);
  const treeDisplay = useMemo(
    () =>
      displayTree
        ? expandTreeDisplay(
            displayTree,
            { expanded, expandAll },
            treeScores !== undefined,
          )
        : undefined,
    [displayTree, expanded, expandAll, treeScores],
  );

  const treeVisible = treeDisplay?.visible ?? [];
  // The create row is pinned one slot past the last tree row, so tree
  // keyboard nav walks straight onto it.
  const treeLastIndex = treeVisible.length - 1 + (canCreate ? 1 : 0);
  const treeIndex =
    canCreate && selectedPath === CREATE_PATH
      ? treeVisible.length
      : selectedPath
        ? treeVisible.findIndex((v) => v.node.path === selectedPath)
        : -1;
  const activeTreeIndex =
    treeIndex >= 0 ? treeIndex : treeLastIndex >= 0 ? 0 : -1;
  const activeTreeNode =
    activeTreeIndex >= 0 && activeTreeIndex < treeVisible.length
      ? treeVisible[activeTreeIndex].node
      : undefined;
  // Derive from the index so an empty filtered tree selects its sole create row.
  const createSelectedInTree =
    canCreate && activeTreeIndex >= 0 && activeTreeIndex >= treeVisible.length;
  const createSelected = isTreeMode
    ? createSelectedInTree
    : activeIndex === createIndex;

  return {
    sourceMode,
    segments,
    dropdownIndex,
    rankPhrase,
    trimmedPhrase,
    visible,
    listItems,
    rowAtIndex,
    settleIndex,
    canCreate,
    createIndex,
    createSelected,
    createSelectedInTree,
    activeIndex,
    lastIndex,
    error,
    fatalError,
    segmentUnavailable,
    dropdownUnavailable,
    isTreeMode,
    treeFiltering,
    truncated,
    canDrag,
    treeDisplay,
    treeVisible,
    treeLastIndex,
    activeTreeIndex,
    activeTreeNode,
  };
}
