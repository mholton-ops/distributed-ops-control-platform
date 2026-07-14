import { describe, expect, it } from "vitest";
import { applyEventToProjection, replayProjection, type DomainEvent } from "./projection";

function makeEvent(overrides: Partial<DomainEvent>): DomainEvent {
  return {
    eventId: overrides.eventId ?? crypto.randomUUID(),
    eventType: overrides.eventType ?? "asset_registered",
    sequenceNumber: overrides.sequenceNumber ?? 1,
    assetId: overrides.assetId ?? "7b4b2d2f-88fb-4d8d-931a-6a5645f1e7c2",
    siteId: overrides.siteId ?? "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
    transferOrderId: overrides.transferOrderId ?? null,
    occurredAt: overrides.occurredAt ?? new Date().toISOString(),
    payload: overrides.payload ?? { serialNumber: "SN-1", registeredBy: "tester" }
  };
}

describe("projection reducer", () => {
  it("applies lifecycle events deterministically", () => {
    const registered = makeEvent({ eventType: "asset_registered", sequenceNumber: 1 });
    const moved = makeEvent({
      eventType: "asset_moved",
      sequenceNumber: 2,
      payload: {
        fromSiteId: "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
        toSiteId: "c55f6935-40df-4aa7-9f84-5b9c8e5f9a60",
        reason: "scheduled"
      }
    });
    const received = makeEvent({
      eventType: "asset_received",
      sequenceNumber: 3,
      siteId: "c55f6935-40df-4aa7-9f84-5b9c8e5f9a60",
      payload: {
        fromSiteId: "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
        condition: "ok",
        receivedBy: "receiver"
      }
    });

    const projection = replayProjection(null, [received, moved, registered]);

    expect(projection?.status).toBe("at_site");
    expect(projection?.currentSiteId).toBe("c55f6935-40df-4aa7-9f84-5b9c8e5f9a60");
    expect(projection?.lastSequence).toBe(3);
  });

  it("is idempotent when replayed from same event stream", () => {
    const events = [
      makeEvent({ eventType: "asset_registered", sequenceNumber: 1 }),
      makeEvent({
        eventType: "transfer_initiated",
        sequenceNumber: 2,
        payload: {
          transferOrderId: "6d55f8f7-5ddf-4c07-91f7-26d1b91a9f20",
          originSiteId: "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
          destinationSiteId: "c55f6935-40df-4aa7-9f84-5b9c8e5f9a60",
          initiatedBy: "ops"
        }
      })
    ];

    const firstReplay = replayProjection(null, events);
    const secondReplay = replayProjection(null, events);

    expect(secondReplay).toEqual(firstReplay);
  });

  it("ignores system-level events without asset id", () => {
    const systemEvent = makeEvent({
      eventType: "site_sync_started",
      assetId: null,
      payload: {
        syncBatchId: "cb16f437-d84e-4f7e-a3b8-66c4f7376d1d",
        queuedEventCount: 3
      }
    });

    const projection = applyEventToProjection(null, systemEvent);
    expect(projection).toBeNull();
  });

  it("does not regress when an older event arrives after a newer projection", () => {
    const registered = applyEventToProjection(
      null,
      makeEvent({ eventType: "asset_registered", sequenceNumber: 10 })
    );
    const stale = makeEvent({
      eventType: "asset_moved",
      sequenceNumber: 9,
      payload: {
        fromSiteId: "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
        toSiteId: "c55f6935-40df-4aa7-9f84-5b9c8e5f9a60",
        reason: "late replay"
      }
    });

    expect(applyEventToProjection(registered, stale)).toEqual(registered);
  });

  it("sets completed transfer custody to the destination event site", () => {
    const registered = applyEventToProjection(
      null,
      makeEvent({ eventType: "asset_registered", sequenceNumber: 1 })
    );
    const completed = applyEventToProjection(
      registered,
      makeEvent({
        eventType: "transfer_completed",
        sequenceNumber: 2,
        siteId: "c55f6935-40df-4aa7-9f84-5b9c8e5f9a60",
        payload: {
          transferOrderId: "6d55f8f7-5ddf-4c07-91f7-26d1b91a9f20",
          completedBy: "receiver"
        }
      })
    );

    expect(completed?.currentSiteId).toBe("c55f6935-40df-4aa7-9f84-5b9c8e5f9a60");
    expect(completed?.status).toBe("at_site");
  });

  it("uses the explicit resolved state from reconciliation", () => {
    const divergent = applyEventToProjection(
      null,
      makeEvent({
        eventType: "divergence_detected",
        sequenceNumber: 1,
        payload: { ruleCode: "TEST", severity: "high", summary: "Needs review" }
      })
    );
    const resolved = applyEventToProjection(
      divergent,
      makeEvent({
        eventType: "reconciliation_resolved",
        sequenceNumber: 2,
        payload: {
          caseId: "d62532db-3bf3-4116-9714-66afbbec8ca4",
          resolvedBy: "operator",
          resolutionSummary: "Asset remains in transit",
          resolvedAssetStatus: "in_transit",
          expectedCaseVersion: 1
        }
      })
    );

    expect(resolved?.status).toBe("in_transit");
  });

  it("projects an asset-linked manual case without creating stream lag", () => {
    const registered = applyEventToProjection(
      null,
      makeEvent({ eventType: "asset_registered", sequenceNumber: 1 })
    );
    const opened = applyEventToProjection(
      registered,
      makeEvent({
        eventType: "reconciliation_opened",
        sequenceNumber: 2,
        payload: {
          caseId: "d62532db-3bf3-4116-9714-66afbbec8ca4",
          alertId: null,
          title: "Manual review",
          description: "Operator requested a custody review.",
          openedBy: "operator"
        }
      })
    );

    expect(opened?.status).toBe("reconciliation_required");
    expect(opened?.lastSequence).toBe(2);
  });
});
