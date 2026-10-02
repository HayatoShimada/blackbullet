import type { Completion } from "@codemirror/autocomplete";

/**
 * What `@` offers besides the people the space can address: dates and pages.
 * Choosing one writes a plain `[[wikilink]]` -- the Markdown stays the same
 * whatever picked it -- while `@name` stays what it always was, an identity.
 *
 * The options are matched against the text from the `@` on, so each carries
 * the `@` in its `label` (what CodeMirror filters on) and shows `displayLabel`.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-10-02`, in the reader's own time zone: a date is where the user is. */
export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  // Calendar days, so a daylight-saving change cannot slide the date by one.
  const out = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

export function isRealIsoDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === mo - 1 &&
    date.getDate() === d
  );
}

const RELATIVE_DAYS: { words: string; shown: string; offset: number }[] = [
  { words: "today 今日", shown: "Today (今日)", offset: 0 },
  { words: "tomorrow 明日", shown: "Tomorrow (明日)", offset: 1 },
  { words: "yesterday 昨日", shown: "Yesterday (昨日)", offset: -1 },
];

/**
 * The days `@` offers: today, tomorrow and yesterday, plus the day typed out
 * when what follows the `@` is a date (`@2026-12-24`). `prefix` is the journal
 * prefix, so the link lands on the page the journal commands would open.
 */
export function dateTargets(
  now: Date,
  prefix: string,
  typed: string,
): Completion[] {
  const out: Completion[] = RELATIVE_DAYS.map(({ words, shown, offset }) => {
    const iso = isoDate(addDays(now, offset));
    return {
      label: `@${words}`,
      displayLabel: shown,
      apply: `[[${prefix}${iso}]]`,
      detail: iso,
      type: "date",
      boost: 5,
    };
  });
  if (isRealIsoDate(typed)) {
    out.unshift({
      label: `@${typed}`,
      displayLabel: typed,
      apply: `[[${prefix}${typed}]]`,
      detail: "date",
      type: "date",
      boost: 20,
    });
  }
  return out;
}

/**
 * Re-expresses what the `[[` completion offers as `@` options. That
 * completion already knows aliases, how links are written in this space and
 * how recently each page changed, so none of it is redone here: its `apply`
 * (the link target, as written inside the brackets) just gets its brackets.
 */
export function pageTargets(
  options: readonly (Completion & Record<string, any>)[] | undefined,
): Completion[] {
  return (options ?? []).map((option) => ({
    ...option,
    label: `@${option.label}`,
    displayLabel: option.displayLabel ?? option.label,
    apply: `[[${option.apply ?? option.label}]]`,
  }));
}
