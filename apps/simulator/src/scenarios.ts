import { createHash } from "node:crypto";
import type { CreateEventRequest } from "@ops/contracts";

export const DEFAULT_SITE_IDS = {
  north: "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
  central: "c55f6935-40df-4aa7-9f84-5b9c8e5f9a60",
  coastal: "1b2e7c43-8c9a-4ca4-aef3-27b9a9b28e71"
} as const;

export type SiteIds = {
  north: string;
  central: string;
  coastal: string;
};

export type ScenarioName = "healthy-movement" | "sync-lag-divergence";

export type ScenarioDefinition = {
  name: ScenarioName;
  runId: string;
  description: string;
  onlineEvents: CreateEventRequest[];
  offlineReplayBatchId?: string;
  offlineEvents?: unknown[];
  expectedReplayStatus?: "completed" | "partial" | "failed";
  expectedAlert?: {
    ruleCode: string;
    assetId: string;
  };
};

// A short deterministic bucket gives immediate retries byte-for-byte stable
// identities while ensuring later runs use observations inside the live
// divergence window instead of replaying a permanently stale calendar date.
export const SCENARIO_BUCKET_MINUTES = 30;
const SCENARIO_BUCKET_MS = SCENARIO_BUCKET_MINUTES * 60 * 1_000;

export function scenarioEpoch(nowMs = Date.now()): number {
  if (!Number.isFinite(nowMs) || nowMs <= 0) {
    throw new TypeError("Simulator clock must be a positive finite timestamp.");
  }
  return Math.floor(nowMs / SCENARIO_BUCKET_MS) * SCENARIO_BUCKET_MS;
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildScenarios(
  nowMs = Date.now(),
  siteIds: SiteIds = DEFAULT_SITE_IDS
): Record<ScenarioName, ScenarioDefinition> {
  const epoch = scenarioEpoch(nowMs);
  const runId = Math.floor(epoch / 60_000).toString(36);
  const iso = (minutesAgo: number): string =>
    new Date(epoch - 1_000 * 60 * minutesAgo).toISOString();
  const id = (scenario: ScenarioName, label: string): string =>
    deterministicUuid(`${scenario}:${runId}:${label}`);
  const sourceId = (scenario: ScenarioName, label: string): string =>
    `sim-${scenario}-${runId}-${label}`;

  const healthyName = "healthy-movement" as const;
  const healthyAssetId = id(healthyName, "asset");
  const healthyTransferId = id(healthyName, "transfer");
  const healthyInspectionId = id(healthyName, "inspection");
  const healthyEvidenceId = id(healthyName, "evidence");

  const driftName = "sync-lag-divergence" as const;
  const driftAssetId = id(driftName, "asset");
  const centralInspectionId = id(driftName, "central-inspection");
  const coastalInspectionId = id(driftName, "coastal-inspection");

  return {
    [healthyName]: {
      name: healthyName,
      runId,
      description: "End-to-end transfer completion with inspection evidence and no replay errors.",
      onlineEvents: [
        {
          eventType: "asset_registered",
          assetId: healthyAssetId,
          siteId: siteIds.north,
          transferOrderId: null,
          occurredAt: iso(30),
          sourceSiteEventId: sourceId(healthyName, "asset-registered"),
          payload: {
            serialNumber: `SN-OPS-H-${runId}`,
            containerId: `CNT-H-${runId}`,
            registeredBy: "sim-operator"
          }
        },
        {
          eventType: "transfer_initiated",
          assetId: healthyAssetId,
          siteId: siteIds.north,
          transferOrderId: healthyTransferId,
          occurredAt: iso(25),
          sourceSiteEventId: sourceId(healthyName, "transfer-initiated"),
          payload: {
            transferOrderId: healthyTransferId,
            originSiteId: siteIds.north,
            destinationSiteId: siteIds.coastal,
            initiatedBy: "north-shift-a"
          }
        },
        {
          eventType: "asset_moved",
          assetId: healthyAssetId,
          siteId: siteIds.north,
          transferOrderId: healthyTransferId,
          occurredAt: iso(24),
          sourceSiteEventId: sourceId(healthyName, "asset-moved"),
          payload: {
            fromSiteId: siteIds.north,
            toSiteId: siteIds.coastal,
            reason: "Scheduled movement"
          }
        },
        {
          eventType: "asset_received",
          assetId: healthyAssetId,
          siteId: siteIds.coastal,
          transferOrderId: healthyTransferId,
          occurredAt: iso(20),
          sourceSiteEventId: sourceId(healthyName, "asset-received"),
          payload: {
            fromSiteId: siteIds.north,
            condition: "ok",
            receivedBy: "coastal-shift-c"
          }
        },
        {
          eventType: "transfer_completed",
          assetId: healthyAssetId,
          siteId: siteIds.coastal,
          transferOrderId: healthyTransferId,
          occurredAt: iso(18),
          sourceSiteEventId: sourceId(healthyName, "transfer-completed"),
          payload: {
            transferOrderId: healthyTransferId,
            completedBy: "coastal-shift-c",
            completionNote: "Arrival confirmed"
          }
        },
        {
          eventType: "inspection_recorded",
          assetId: healthyAssetId,
          siteId: siteIds.coastal,
          transferOrderId: healthyTransferId,
          occurredAt: iso(17),
          sourceSiteEventId: sourceId(healthyName, "inspection-recorded"),
          payload: {
            inspectionId: healthyInspectionId,
            status: "pass",
            notes: "Arrival inspection passed."
          }
        },
        {
          eventType: "evidence_attached",
          assetId: healthyAssetId,
          siteId: siteIds.coastal,
          transferOrderId: healthyTransferId,
          occurredAt: iso(16),
          sourceSiteEventId: sourceId(healthyName, "inspection-evidence"),
          payload: {
            inspectionId: healthyInspectionId,
            evidenceId: healthyEvidenceId,
            mimeType: "image/jpeg",
            sha256: "de0962967c21475fcd136b227ad45cb4bf8a18ba8624366ad2c40f84b314c458"
          }
        }
      ]
    },
    [driftName]: {
      name: driftName,
      runId,
      description:
        "Mixed online/offline flow with a partial replay and current-window conflicting site observations.",
      onlineEvents: [
        {
          eventType: "asset_registered",
          assetId: driftAssetId,
          siteId: siteIds.central,
          transferOrderId: null,
          occurredAt: iso(30),
          sourceSiteEventId: sourceId(driftName, "asset-registered"),
          payload: {
            serialNumber: `SN-OPS-D-${runId}`,
            containerId: `CNT-D-${runId}`,
            registeredBy: "sim-operator"
          }
        },
        {
          eventType: "inspection_recorded",
          assetId: driftAssetId,
          siteId: siteIds.central,
          transferOrderId: null,
          occurredAt: iso(24),
          sourceSiteEventId: sourceId(driftName, "central-inspection"),
          payload: {
            inspectionId: centralInspectionId,
            status: "review",
            notes: "Evidence pending while the site queue is delayed."
          }
        }
      ],
      offlineReplayBatchId: id(driftName, "replay-batch"),
      offlineEvents: [
        {
          eventType: "asset_received",
          assetId: driftAssetId,
          siteId: siteIds.coastal,
          transferOrderId: null,
          occurredAt: iso(10),
          sourceSiteEventId: sourceId(driftName, "offline-received"),
          payload: {
            fromSiteId: siteIds.central,
            condition: "ok",
            receivedBy: "coastal-shift-c"
          }
        },
        {
          eventType: "inspection_recorded",
          assetId: driftAssetId,
          siteId: siteIds.coastal,
          transferOrderId: null,
          occurredAt: iso(9),
          sourceSiteEventId: sourceId(driftName, "offline-inspection"),
          payload: {
            inspectionId: coastalInspectionId,
            status: "review",
            notes: "Offline inspection replayed."
          }
        },
        {
          eventType: "evidence_attached",
          assetId: driftAssetId,
          siteId: siteIds.coastal,
          transferOrderId: null,
          occurredAt: iso(8),
          sourceSiteEventId: sourceId(driftName, "invalid-evidence"),
          payload: {
            inspectionId: coastalInspectionId,
            evidenceId: id(driftName, "invalid-evidence"),
            mimeType: "image/jpeg",
            sha256: "invalid"
          }
        }
      ],
      expectedReplayStatus: "partial",
      expectedAlert: {
        ruleCode: "ASSET_OBSERVED_AT_MULTIPLE_SITES",
        assetId: driftAssetId
      }
    }
  };
}
