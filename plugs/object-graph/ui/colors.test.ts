import { describe, expect, it } from "vitest";
import { colorForTag, UNTAGGED_COLOR_VAR } from "./colors.ts";

describe("colorForTag", () => {
  it("returns the untagged CSS variable for null", () => {
    expect(colorForTag(null)).toBe(UNTAGGED_COLOR_VAR);
  });

  it("is deterministic: same tag yields the same color", () => {
    expect(colorForTag("driver")).toBe(colorForTag("driver"));
    expect(colorForTag("research")).toBe(colorForTag("research"));
  });

  it("gives the well-known tags their own token, project and area apart", () => {
    expect(colorForTag("project")).toBe("var(--gv-tag-project)");
    expect(colorForTag("area")).toBe("var(--gv-tag-area)");
    expect(colorForTag("Journal")).toBe("var(--gv-tag-journal)");
    expect(colorForTag("project")).not.toBe(colorForTag("area"));
  });

  it("produces different colors for distinct free-form tags (typically)", () => {
    // Hash collisions are possible in principle; the F1 demo tags do not collide.
    expect(colorForTag("driver")).not.toBe(colorForTag("team"));
    expect(colorForTag("driver")).not.toBe(colorForTag("person"));
  });

  it("returns an hsl() expression with scheme tokens for other tags", () => {
    expect(colorForTag("anything")).toMatch(
      /^hsl\(\d+ var\(--gv-tag-s\) var\(--gv-tag-l\)\)$/,
    );
  });
});
