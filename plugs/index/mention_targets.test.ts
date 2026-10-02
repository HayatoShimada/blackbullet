import { expect, test } from "vitest";
import {
  dateTargets,
  isoDate,
  isRealIsoDate,
  pageTargets,
} from "./mention_targets.ts";

// Noon, so that no time zone puts "today" on a different calendar day.
const now = new Date(2026, 9, 2, 12, 0, 0);

test("isoDate reads the local calendar, not UTC", () => {
  expect(isoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  expect(isoDate(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
});

test("today, tomorrow and yesterday link to the journal page of that day", () => {
  const out = dateTargets(now, "Journal/", "");
  expect(out.map((o) => [o.displayLabel, o.apply, o.detail])).toEqual([
    ["Today (今日)", "[[Journal/2026-10-02]]", "2026-10-02"],
    ["Tomorrow (明日)", "[[Journal/2026-10-03]]", "2026-10-03"],
    ["Yesterday (昨日)", "[[Journal/2026-10-01]]", "2026-10-01"],
  ]);
});

test("the days roll over month and year ends", () => {
  const out = dateTargets(new Date(2026, 11, 31, 12), "J/", "");
  expect(out[1].apply).toBe("[[J/2027-01-01]]");
  const leap = dateTargets(new Date(2028, 1, 29, 12), "J/", "");
  expect(leap[1].apply).toBe("[[J/2028-03-01]]");
});

test("the journal prefix is whatever the space configured", () => {
  expect(dateTargets(now, "", "")[0].apply).toBe("[[2026-10-02]]");
  expect(dateTargets(now, "Daily/", "")[0].apply).toBe("[[Daily/2026-10-02]]");
});

test("labels carry the @ and the Japanese words, so either language matches", () => {
  const [today] = dateTargets(now, "Journal/", "");
  expect(today.label).toBe("@today 今日");
});

test("a typed date comes first; a mistyped one is not offered", () => {
  const typed = dateTargets(now, "Journal/", "2026-12-24");
  expect(typed[0]).toMatchObject({
    label: "@2026-12-24",
    apply: "[[Journal/2026-12-24]]",
  });
  expect(typed).toHaveLength(4);
  expect(dateTargets(now, "Journal/", "2026-02-30")).toHaveLength(3);
  expect(dateTargets(now, "Journal/", "2026-1-5")).toHaveLength(3);
});

test("isRealIsoDate rejects what only looks like a date", () => {
  expect(isRealIsoDate("2026-10-02")).toBe(true);
  expect(isRealIsoDate("2026-02-29")).toBe(false);
  expect(isRealIsoDate("2028-02-29")).toBe(true);
  expect(isRealIsoDate("2026-13-01")).toBe(false);
  expect(isRealIsoDate("20261002")).toBe(false);
});

test("page options become @ options that write a wikilink", () => {
  expect(
    pageTargets([
      { label: "Plan", displayLabel: "📚 Plan", apply: "Projects/Plan|Plan" },
      { label: "Notes", type: "page", icon: "x" },
    ]),
  ).toEqual([
    {
      label: "@Plan",
      displayLabel: "📚 Plan",
      apply: "[[Projects/Plan|Plan]]",
    },
    {
      label: "@Notes",
      displayLabel: "Notes",
      apply: "[[Notes]]",
      type: "page",
      icon: "x",
    },
  ]);
});

test("no page options is no options", () => {
  expect(pageTargets(undefined)).toEqual([]);
});
