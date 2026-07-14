import { describe, expect, it } from "vitest";
import { buildScenarios, SCENARIO_BUCKET_MINUTES } from "./scenarios";

describe("simulator scenarios", () => {
  it("is byte-for-byte stable inside a run bucket and rotates identity afterward", () => {
    const now = Date.parse("2026-07-13T12:14:00.000Z");
    const first = buildScenarios(now);
    const retry = buildScenarios(now + 5 * 60_000);
    const later = buildScenarios(now + SCENARIO_BUCKET_MINUTES * 60_000);

    expect(retry).toEqual(first);
    expect(later["healthy-movement"].runId).not.toBe(first["healthy-movement"].runId);
    expect(later["healthy-movement"].onlineEvents[0]?.assetId).not.toBe(
      first["healthy-movement"].onlineEvents[0]?.assetId
    );
  });

  it("defines a partial drift replay with an asserted dual-site outcome", () => {
    const drift = buildScenarios(Date.parse("2026-07-13T12:14:00.000Z"))[
      "sync-lag-divergence"
    ];

    expect(drift.expectedReplayStatus).toBe("partial");
    expect(drift.expectedAlert?.ruleCode).toBe("ASSET_OBSERVED_AT_MULTIPLE_SITES");
    expect(drift.offlineEvents).toHaveLength(3);
  });
});
