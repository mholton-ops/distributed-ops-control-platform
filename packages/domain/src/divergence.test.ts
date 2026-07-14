import { describe, expect, it } from "vitest";
import {
  detectDualSiteObservations,
  detectInspectionEvidenceGaps,
  detectProjectionIntegrityIssues,
  detectStaleSites,
  detectTransferTimeouts
} from "./divergence";

describe("divergence rules", () => {
  it("flags transfer orders not confirmed in threshold", () => {
    const findings = detectTransferTimeouts(
      [
        {
          transferOrderId: "t-1",
          assetId: "a-1",
          originSiteId: "s-1",
          destinationSiteId: "s-2",
          status: "initiated",
          initiatedAt: new Date("2026-01-01T00:00:00.000Z"),
          completedAt: null
        }
      ],
      new Date("2026-01-01T06:30:00.000Z"),
      4
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("TRANSFER_NOT_CONFIRMED");
  });

  it("flags dual site observations", () => {
    const findings = detectDualSiteObservations([
      {
        assetId: "a-2",
        siteId: "s-1",
        observedAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        assetId: "a-2",
        siteId: "s-2",
        observedAt: new Date("2026-01-01T00:10:00.000Z")
      }
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("ASSET_OBSERVED_AT_MULTIPLE_SITES");
  });

  it("does not treat historical custody changes as a current dual-site conflict", () => {
    const findings = detectDualSiteObservations(
      [
        { assetId: "a-2", siteId: "s-1", observedAt: new Date("2026-01-01T00:00:00.000Z") },
        { assetId: "a-2", siteId: "s-2", observedAt: new Date("2026-01-02T00:00:00.000Z") }
      ],
      {
        now: new Date("2026-01-02T00:00:00.000Z"),
        observationWindowMinutes: 60
      }
    );

    expect(findings).toHaveLength(0);
  });

  it("allows origin and destination observations during an active transfer", () => {
    const findings = detectDualSiteObservations(
      [
        { assetId: "a-2", siteId: "s-1", observedAt: new Date("2026-01-01T00:05:00.000Z") },
        { assetId: "a-2", siteId: "s-2", observedAt: new Date("2026-01-01T00:10:00.000Z") }
      ],
      {
        now: new Date("2026-01-01T00:15:00.000Z"),
        observationWindowMinutes: 60,
        activeTransfers: [
          {
            assetId: "a-2",
            originSiteId: "s-1",
            destinationSiteId: "s-2",
            initiatedAt: new Date("2026-01-01T00:00:00.000Z")
          }
        ]
      }
    );

    expect(findings).toHaveLength(0);
  });

  it("flags inspections without evidence metadata", () => {
    const findings = detectInspectionEvidenceGaps([
      {
        inspectionId: "i-1",
        assetId: "a-3",
        siteId: "s-3",
        evidenceCount: 0
      }
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("INSPECTION_MISSING_EVIDENCE");
  });

  it("flags stale sites with no recent sync", () => {
    const findings = detectStaleSites(
      [
        {
          siteId: "s-1",
          siteName: "North",
          lastSyncCompletedAt: new Date("2026-01-01T00:00:00.000Z"),
          staleAfterMinutes: 60
        }
      ],
      new Date("2026-01-01T04:00:00.000Z")
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("SITE_PROJECTION_STALE");
  });

  it("flags projection sequence behind event stream", () => {
    const findings = detectProjectionIntegrityIssues([
      {
        assetId: "a-4",
        projectionSequence: 10,
        latestEventSequence: 12
      }
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe("PROJECTION_SEQUENCE_BEHIND_EVENT_STREAM");
  });
});
