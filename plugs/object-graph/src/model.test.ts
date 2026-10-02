import { describe, expect, it } from "vitest";
import {
  defaultSemanticSettings,
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
});
