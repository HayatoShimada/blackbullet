import { describe, expect, it } from "vitest";
import {
  addressTitle,
  classifyKind,
  collapseEdges,
  deriveTagFields,
  endpointMatchesRef,
  isCoreTag,
  type RelationRow,
  stripPagePos,
} from "./graph_builder.ts";

describe("stripPagePos", () => {
  it("returns bare refs unchanged", () => {
    expect(stripPagePos("Page")).toBe("Page");
    expect(stripPagePos("Drivers/Max Verstappen")).toBe(
      "Drivers/Max Verstappen",
    );
  });

  it("strips @pos, #header, $anchor", () => {
    expect(stripPagePos("Page@744")).toBe("Page");
    expect(stripPagePos("Page#header")).toBe("Page");
    expect(stripPagePos("Page$anchor")).toBe("Page");
  });

  it("leaves url and file refs untouched", () => {
    expect(stripPagePos("https://example.com/path#x")).toBe(
      "https://example.com/path#x",
    );
    expect(stripPagePos("docs.pdf")).toBe("docs.pdf");
  });
});

describe("endpointMatchesRef", () => {
  it("matches exact refs", () => {
    expect(endpointMatchesRef("Page", "Page")).toBe(true);
  });

  it("matches positional / header / anchor variants", () => {
    expect(endpointMatchesRef("Page@123", "Page")).toBe(true);
    expect(endpointMatchesRef("Page#h1", "Page")).toBe(true);
    expect(endpointMatchesRef("Page$anchor", "Page")).toBe(true);
  });

  it("rejects prefix overlap that isn't a real boundary", () => {
    expect(endpointMatchesRef("Pages", "Page")).toBe(false);
    expect(endpointMatchesRef("Page/sub", "Page")).toBe(false);
    expect(endpointMatchesRef("Page-x", "Page")).toBe(false);
  });

  it("rejects unrelated endpoints", () => {
    expect(endpointMatchesRef("Other", "Page")).toBe(false);
  });
});

describe("classifyKind", () => {
  it("identifies URLs", () => {
    expect(classifyKind("https://example.com")).toBe("url");
    expect(classifyKind("http://localhost:3000")).toBe("url");
  });

  it("identifies files (single dot, non-md)", () => {
    expect(classifyKind("doc.pdf")).toBe("file");
    expect(classifyKind("notes.txt")).toBe("file");
  });

  it("treats .md and pathy refs as pages", () => {
    expect(classifyKind("Notes")).toBe("page");
    expect(classifyKind("Notes/2025")).toBe("page");
    expect(classifyKind("Notes.md")).toBe("page");
  });
});

describe("isCoreTag", () => {
  it("recognises structural tags", () => {
    expect(isCoreTag("page")).toBe(true);
    expect(isCoreTag("item")).toBe(true);
    expect(isCoreTag("task")).toBe(true);
    expect(isCoreTag("block")).toBe(true);
  });

  it("recognises meta and meta/* tags", () => {
    expect(isCoreTag("meta")).toBe(true);
    expect(isCoreTag("meta/library")).toBe(true);
  });

  it("rejects user tags", () => {
    expect(isCoreTag("driver")).toBe(false);
    expect(isCoreTag("project")).toBe(false);
  });
});

describe("deriveTagFields", () => {
  it("uses hostTag as rootTag for ordinary structural objects", () => {
    const r = deriveTagFields(["page", "driver"], "page");
    expect(r.rootTag).toBe("page");
    expect(r.primaryTag).toBe("driver");
    expect(r.tags).toEqual(["driver"]);
  });

  it("promotes item to task when the task tag is present", () => {
    const r = deriveTagFields(["item", "task", "todo"], "item");
    expect(r.rootTag).toBe("task");
    expect(r.primaryTag).toBe("todo");
  });

  it("filters core + meta tags out of the user-tag list", () => {
    const r = deriveTagFields(
      ["page", "meta", "meta/template", "research"],
      "page",
    );
    expect(r.tags).toEqual(["research"]);
    expect(r.primaryTag).toBe("research");
  });

  it("returns null rootTag for non-core host tags", () => {
    expect(deriveTagFields(["foo"], "foo").rootTag).toBeNull();
  });
});

describe("collapseEdges", () => {
  const baseRow = (overrides: Partial<RelationRow>): RelationRow => ({
    from: "A",
    to: "B",
    kind: "mention",
    page: "A",
    ...overrides,
  });

  it("passes through a single mention as-is", () => {
    const out = collapseEdges([baseRow({})]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("A");
    expect(out[0].target).toBe("B");
    expect(out[0].label).toBe("mention");
    expect(out[0].undirected).toBe(false);
  });

  it("collapses reciprocal co-mention pairs into one undirected edge", () => {
    const rows: RelationRow[] = [
      baseRow({ kind: "co-mention", via: "page1" }),
      baseRow({
        from: "B",
        to: "A",
        kind: "co-mention",
        via: "page1",
        page: "page1",
      }),
    ];
    const out = collapseEdges(rows);
    expect(out).toHaveLength(1);
    expect(out[0].undirected).toBe(true);
    expect(out[0].refs).toHaveLength(2);
  });

  it("keeps distinct co-mention pairs separate when 'via' differs", () => {
    const rows: RelationRow[] = [
      baseRow({ kind: "co-mention", via: "p1" }),
      baseRow({
        from: "B",
        to: "A",
        kind: "co-mention",
        via: "p2",
      }),
    ];
    expect(collapseEdges(rows)).toHaveLength(2);
  });

  it("uses the relation kind as the edge label", () => {
    const out = collapseEdges([baseRow({ kind: "principal" })]);
    expect(out[0].label).toBe("principal");
  });

  it("preserves provenance positions from the range tuple", () => {
    const out = collapseEdges([baseRow({ range: [42, 60], snippet: "hello" })]);
    expect(out[0].refs[0]).toEqual({ page: "A", pos: 42, snippet: "hello" });
  });
});

describe("addressTitle", () => {
  it("reads a percent-encoded URL tail as the name it spells", () => {
    expect(
      addressTitle(
        "https://notes.example.com/Resources/%E8%AA%AD%E3%81%BF%E3%81%9F%E3%81%84%E8%AB%96%E6%96%87%E3%83%AA%E3%82%B9%E3%83%88",
      ),
    ).toBe("読みたい論文リスト");
  });

  it("leaves plain addresses and files as they are", () => {
    expect(addressTitle("https://example.com/docs/guide.html")).toBe(
      "guide.html",
    );
    expect(addressTitle("logo.png")).toBe("logo.png");
  });

  it("keeps a stray % rather than failing on it", () => {
    expect(addressTitle("https://example.com/100%")).toBe("100%");
    expect(addressTitle("https://example.com/a%zzb")).toBe("a%zzb");
  });

  it("falls back to the host for an address with no last part", () => {
    expect(addressTitle("https://example.com/")).toBe("example.com");
    expect(addressTitle("https://example.com:8080/")).toBe("example.com:8080");
  });
});
