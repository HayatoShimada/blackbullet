import { editor, system } from "@silverbulletmd/silverbullet/syscalls";
import { hide } from "../navigator.ts";
import { baseMeta, type BuiltinView } from "./types.ts";

/** A row here is a registered command, not an indexed object -- no
 * `ref`/`tag` of its own -- exactly `system.listPaletteCommands()`'s own
 * return shape, plus what the empty palette adds around it. */
type CommandRow = {
  name: string;
  priority: number;
  lastRun?: number;
  hint?: string;
  /** A group title in the empty palette, not a command. */
  header?: string;
  /** A copy of a command under Recent or Suggested: only while nothing is typed. */
  shortcut?: boolean;
  /** Its own copy in the list below: already shown under Recent or Suggested,
   * so only a typed phrase ranks this one. */
  covered?: boolean;
};

/** What the empty palette offers first, in this order, when registered. */
export const SUGGESTED = [
  "Quick Note",
  "Journal: Today",
  "Search: Notes",
  "Ask: Notes",
  "New",
  "Navigate: Tree",
];

/** How many commands the empty palette remembers. */
export const RECENT_COUNT = 5;

/**
 * Commands that are for developers or cannot be taken back: found by typing
 * their name, never browsed into. (Not a field of the command: a command is
 * what a plug declared, and where it is offered is the palette's business.)
 */
export const HIDDEN_UNTIL_TYPED = [
  "Client: Wipe",
  "Client: Logout",
  "Client: Reload UI",
  "Client: Version",
  "Baked Sections: *",
  "Navigate: Meta Picker",
  "Navigate: Document Picker",
  "Page: Delete",
];

/**
 * The key chips of a hint: one per binding, none twice. `keyboardHint` joins a
 * command's bindings with " | ", and a chord such as `Ctrl-q q` is often bound
 * again as `Ctrl-q Ctrl-q` (the same keys with Ctrl still held), which would
 * read as a second, different shortcut.
 */
export function hintChips(hint: string | undefined): string[] {
  if (!hint) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const binding of hint.split("|")) {
    const chip = binding.trim();
    if (!chip) continue;
    const [first, ...rest] = chip.split(/\s+/);
    const identity = [
      first,
      ...rest.map((step) => step.replace(/^(Ctrl-|⌃)/, "")),
    ]
      .join(" ")
      .toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(chip);
  }
  return out;
}

export function isHiddenUntilTyped(name: string): boolean {
  return HIDDEN_UNTIL_TYPED.some((entry) =>
    entry.endsWith("*") ? name.startsWith(entry.slice(0, -1)) : name === entry,
  );
}

/** The part of "Page: New" before the colon; "Other" for the ones without. */
export function groupOf(name: string): string {
  const colon = name.indexOf(":");
  return colon > 0 ? name.slice(0, colon).trim() : "Other";
}

/**
 * The palette's rows for an empty phrase: Recent, Suggested, then everything
 * grouped by prefix. Rows marked `shortcut` and headers are shown only while
 * nothing is typed (see `Row.when`); the grouped copies are the ones a typed
 * phrase ranks.
 */
export function arrangeCommands(commands: CommandRow[]): CommandRow[] {
  const byName = new Map(commands.map((command) => [command.name, command]));
  const recent = commands
    .filter(
      (command) =>
        command.lastRun !== undefined && !isHiddenUntilTyped(command.name),
    )
    .sort((a, b) => (b.lastRun ?? 0) - (a.lastRun ?? 0))
    .slice(0, RECENT_COUNT);
  const taken = new Set(recent.map((command) => command.name));
  const suggested = SUGGESTED.filter(
    (name) => byName.has(name) && !taken.has(name),
  ).map((name) => byName.get(name)!);

  const out: CommandRow[] = [];
  const section = (title: string, rows: CommandRow[]) => {
    if (rows.length === 0) return;
    out.push({ name: title, priority: 0, header: title });
    for (const row of rows) out.push({ ...row, shortcut: true });
  };
  section("Recent", recent);
  section("Suggested", suggested);

  const shownAbove = new Set(
    [...recent, ...suggested].map((command) => command.name),
  );
  const groups = new Map<string, CommandRow[]>();
  for (const command of commands) {
    const group = groupOf(command.name);
    if (!groups.has(group)) groups.set(group, []);
    groups
      .get(group)!
      .push(
        shownAbove.has(command.name) ? { ...command, covered: true } : command,
      );
  }
  const titles = [...groups.keys()].sort((a, b) =>
    a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b),
  );
  for (const title of titles) {
    // A group of nothing but commands found by typing has nothing to show.
    if (groups.get(title)!.every((c) => isHiddenUntilTyped(c.name))) {
      for (const command of groups.get(title)!) out.push(command);
      continue;
    }
    const rows = groups
      .get(title)!
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
    // A title over nothing but copies of what is shown above would be a
    // heading with no row under it.
    if (!rows.every((c) => c.covered || isHiddenUntilTyped(c.name))) {
      out.push({ name: title, priority: 0, header: title });
    }
    for (const command of rows) out.push(command);
  }
  return out;
}

export const commandPalette: BuiltinView<CommandRow> = {
  meta: baseMeta({
    title: "Commands",
    label: "Run",
    placeholder: "Command",
    emptyText: "No command matches {phrase}.",
    filterFields: { primary: { weight: 1.0, segments: true } },
    // Which commands apply (the cursor's context, the client's mode) and
    // which you ran last are both only true at the moment you ask.
    refreshOnOpen: true,
    // Not the file events every other view wants: the command list changes
    // when plugs (re)load, and nothing else.
    refreshOn: ["plugs:loaded"],
  }),
  row: {
    primary: (obj) => obj.header ?? obj.name,
    passive: (obj) => obj.header !== undefined,
    // Headers and the Recent/Suggested copies are for the empty phrase; the
    // developer commands are for a typed one.
    when: (obj) =>
      obj.header !== undefined || obj.shortcut
        ? "empty"
        : obj.covered || isHiddenUntilTyped(obj.name)
          ? "typed"
          : undefined,
    cssClass: (obj) => (obj.header !== undefined ? "sb-nav-group" : undefined),
    decorations: (obj) => {
      const chips = hintChips(obj.hint);
      return chips.length > 0
        ? chips.map((text) => ({
            text,
            position: "right" as const,
            cssClass: "sb-nav-chip-hint sb-nav-chip-key",
          }))
        : undefined;
    },
    icon: (obj) => (obj.header !== undefined ? undefined : "terminal"),
  },
  source: async () =>
    arrangeCommands([...(await system.listPaletteCommands())]),
  onSelect: async (obj) => {
    // The palette has to be out of the way *before* the command runs: a
    // command that opens another navigator view would otherwise have its
    // panel closed again by this one's own dismissal.
    await hide("modal");
    // Records the run (which is what orders the palette) and then runs it. A
    // command returning false is one that took the focus deliberately.
    if ((await system.runPaletteCommand(obj.name)) !== false) {
      await editor.focus();
    }
    return false;
  },
};
