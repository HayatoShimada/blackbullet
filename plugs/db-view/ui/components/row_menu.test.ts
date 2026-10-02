import { describe, expect, test } from "vitest";
import type { DbRow } from "../../src/model.ts";
import { hasMenu, renameDefault } from "./row_menu.tsx";

const row = (page: string, title: string, kind = "page") =>
  ({ id: page, kind, page, title, values: {} }) as unknown as DbRow;

describe("row menu", () => {
  test("only a page row has a menu", () => {
    expect(hasMenu(row("A", "A"))).toBe(true);
    expect(hasMenu(row("A", "A", "task"))).toBe(false);
  });
  test("rename starts from the page's own name, not the display name", () => {
    expect(renameDefault(row("Projects/Alpha", "Shown"))).toBe("Alpha");
    expect(renameDefault(row("Plain", "Plain"))).toBe("Plain");
  });
});
