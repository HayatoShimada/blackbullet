import { describe, expect, it } from "vitest";
import {
  defaultFilters,
  defaultSemanticSettings,
  migrateFilters,
  LEGACY_SEMANTIC_THRESHOLD,
  migrateSemanticSettings,
  SEMANTIC_SETTINGS_VERSION,
} from "./model.ts";

describe("migrateSemanticSettings", () => {
  it("uses the defaults when nothing is saved", () => {
    const m = migrateSemanticSettings(undefined);
    expect(m.threshold).toBe(defaultSemanticSettings.threshold);
    expect(m.version).toBe(SEMANTIC_SETTINGS_VERSION);
  });

  it("resets an unversioned legacy threshold once", () => {
    const m = migrateSemanticSettings({ threshold: LEGACY_SEMANTIC_THRESHOLD });
    expect(m.threshold).toBe(defaultSemanticSettings.threshold);
  });

  it("keeps a legacy-valued threshold that was saved after the migration", () => {
    const first = migrateSemanticSettings({
      threshold: LEGACY_SEMANTIC_THRESHOLD,
    });
    const chosen = { ...first, threshold: LEGACY_SEMANTIC_THRESHOLD };
    expect(migrateSemanticSettings(chosen).threshold).toBe(
      LEGACY_SEMANTIC_THRESHOLD,
    );
  });

  it("keeps other saved values", () => {
    const m = migrateSemanticSettings({ threshold: 0.7, k: 5 });
    expect(m.threshold).toBe(0.7);
    expect(m.k).toBe(5);
  });

  it("moves the old default radius and count to one hop and two, once", () => {
    const m = migrateSemanticSettings({ version: 2, hops: 0, k: 3 });
    expect(m).toMatchObject({ hops: 1, k: 2, version: 3 });
    const chosen = migrateSemanticSettings({ ...m, hops: 0, k: 3 });
    expect(chosen).toMatchObject({ hops: 0, k: 3 });
    expect(migrateSemanticSettings({ version: 2, hops: 2 }).hops).toBe(2);
  });
});

describe("migrateFilters", () => {
  it("hides the words on the lines by default, once for old saved filters", () => {
    expect(migrateFilters(undefined).hideEdgeLabels).toBe(true);
    const old = migrateFilters({ ...defaultFilters, hideEdgeLabels: false });
    expect(old.hideEdgeLabels).toBe(true);
    const chosen = migrateFilters({ ...old, hideEdgeLabels: false });
    expect(chosen.hideEdgeLabels).toBe(false);
  });
});
