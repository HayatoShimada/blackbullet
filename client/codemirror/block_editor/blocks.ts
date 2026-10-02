/**
 * What the block editor treats as a block, derived from the syntax tree. No
 * data structure of its own is kept: a block is a range of whole lines.
 *
 * Blocks nest by range, and every one of them is draggable on its own:
 * - a **heading** is its whole section (down to the next heading of the same
 *   or a higher level), and the paragraphs, lists and sub-sections inside the
 *   section are blocks too;
 * - a **list item** is the item and its nested children, and each child is a
 *   block of its own;
 * - a paragraph, quote, code block, table, rule or HTML block is itself.
 * The front matter is not a block: it is not content to rearrange.
 */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export type BlockKind =
  | "heading"
  | "list-item"
  | "paragraph"
  | "quote"
  | "code"
  | "table"
  | "rule"
  | "html"
  | "other";

export type Block = {
  kind: BlockKind;
  /** Start of the first line. */
  from: number;
  /** End of the last line, newline not included. */
  to: number;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  /** A heading's level (1-6); 0 for everything else. */
  level: number;
  /** A list item's nesting depth (0 = top-level item); 0 for everything else. */
  depth: number;
};

const SIMPLE_KINDS: Record<string, BlockKind> = {
  Paragraph: "paragraph",
  Blockquote: "quote",
  FencedCode: "code",
  CodeBlock: "code",
  Table: "table",
  HorizontalRule: "rule",
  HTMLBlock: "html",
  CommentBlock: "other",
};

function headingLevel(name: string): number {
  const m = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
  return m ? Number(m[1]) : 0;
}

function blockOf(
  doc: Text,
  kind: BlockKind,
  fromPos: number,
  toPos: number,
  extra: { level?: number; depth?: number } = {},
): Block {
  const first = doc.lineAt(fromPos);
  const last = doc.lineAt(toPos);
  return {
    kind,
    from: first.from,
    to: last.to,
    startLine: first.number,
    endLine: last.number,
    level: extra.level ?? 0,
    depth: extra.depth ?? 0,
  };
}

function listItems(
  doc: Text,
  list: SyntaxNode,
  depth: number,
  out: Block[],
): void {
  for (let item = list.firstChild; item; item = item.nextSibling) {
    if (item.name !== "ListItem") continue;
    out.push(blockOf(doc, "list-item", item.from, item.to, { depth }));
    // Children of an item are the lists nested inside it.
    for (let child = item.firstChild; child; child = child.nextSibling) {
      if (child.name === "BulletList" || child.name === "OrderedList") {
        listItems(doc, child, depth + 1, out);
      }
    }
  }
}

/**
 * `parseBudgetMs`: how long to let the parser run to cover the whole document.
 * 0 (the default) takes the tree as it stands, which is all the viewport needs;
 * a drag asks for more, since a drop target below the parsed part has to exist.
 */
export function blocksOf(state: EditorState, parseBudgetMs = 0): Block[] {
  const doc = state.doc;
  const top: SyntaxNode[] = [];
  const tree =
    (parseBudgetMs > 0
      ? ensureSyntaxTree(state, state.doc.length, parseBudgetMs)
      : null) ?? syntaxTree(state);
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== "FrontMatter") top.push(node);
  }

  const out: Block[] = [];
  for (let i = 0; i < top.length; i++) {
    const node = top[i];
    const level = headingLevel(node.name);
    if (level > 0) {
      // The section runs until the next heading that is not deeper than this.
      let end = node;
      for (let j = i + 1; j < top.length; j++) {
        const next = headingLevel(top[j].name);
        if (next > 0 && next <= level) break;
        end = top[j];
      }
      out.push(blockOf(doc, "heading", node.from, end.to, { level }));
    } else if (node.name === "BulletList" || node.name === "OrderedList") {
      listItems(doc, node, 0, out);
    } else {
      out.push(
        blockOf(doc, SIMPLE_KINDS[node.name] ?? "other", node.from, node.to),
      );
    }
  }
  return out;
}

/** The innermost block that starts on `line` (1-based), if any. A heading and
 * its first paragraph never share a line, but a list item and its first child
 * can't either: every block starts on a line of its own. */
export function blockStartingAt(
  blocks: readonly Block[],
  line: number,
): Block | undefined {
  return blocks.find((b) => b.startLine === line);
}

export function isBlankLine(doc: Text, line: number): boolean {
  return doc.line(line).text.trim() === "";
}
