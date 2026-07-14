import type { EventType } from "@ops/contracts";

export type AssetLifecycleStatus =
  | "registered"
  | "in_transit"
  | "at_site"
  | "under_inspection"
  | "reconciliation_required";

export type AssetProjection = {
  assetId: string;
  serialNumber: string;
  currentSiteId: string | null;
  containerId: string | null;
  status: AssetLifecycleStatus;
  lastEventType: EventType;
  lastEventAt: string;
  lastSequence: number;
  version: number;
};

export type DomainEvent = {
  eventId: string;
  eventType: EventType;
  sequenceNumber: number;
  assetId: string | null;
  siteId: string;
  transferOrderId: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export function applyEventToProjection(
  previous: AssetProjection | null,
  event: DomainEvent
): AssetProjection | null {
  if (["site_sync_started", "site_sync_completed"].includes(event.eventType)) {
    return previous;
  }

  if (!event.assetId) {
    return previous;
  }

  // A projection may be updated by concurrent replay workers. Never let an
  // older ledger position overwrite a state already derived from a newer one.
  if (previous && event.sequenceNumber <= previous.lastSequence) {
    return previous;
  }

  const next: AssetProjection = previous
    ? { ...previous }
    : {
        assetId: event.assetId,
        serialNumber: String(event.payload.serialNumber ?? "unknown"),
        currentSiteId: null,
        containerId: null,
        status: "registered",
        lastEventType: event.eventType,
        lastEventAt: event.occurredAt,
        lastSequence: event.sequenceNumber,
        version: 0
      };

  switch (event.eventType) {
    case "asset_registered":
      next.serialNumber = String(event.payload.serialNumber ?? next.serialNumber);
      next.containerId =
        (event.payload.containerId as string | null | undefined) ?? next.containerId;
      next.currentSiteId = event.siteId;
      next.status = "at_site";
      break;
    case "asset_moved":
      next.status = "in_transit";
      break;
    case "asset_received":
      next.currentSiteId = event.siteId;
      next.status = "at_site";
      break;
    case "inspection_recorded":
      next.status = event.payload.status === "review" ? "under_inspection" : "at_site";
      break;
    case "transfer_initiated":
      next.status = "in_transit";
      break;
    case "transfer_completed":
      next.currentSiteId = event.siteId;
      next.status = "at_site";
      break;
    case "divergence_detected":
      if (event.payload.severity === "high") {
        next.status = "reconciliation_required";
      }
      break;
    case "reconciliation_opened":
      next.status = "reconciliation_required";
      break;
    case "reconciliation_resolved":
      next.status = String(event.payload.resolvedAssetStatus) as Exclude<
        AssetLifecycleStatus,
        "reconciliation_required"
      >;
      break;
    default:
      break;
  }

  next.lastEventType = event.eventType;
  next.lastEventAt = event.occurredAt;
  next.lastSequence = event.sequenceNumber;
  next.version += 1;

  return next;
}

export function replayProjection(
  initial: AssetProjection | null,
  events: DomainEvent[]
): AssetProjection | null {
  return [...events]
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .reduce((projection, event) => applyEventToProjection(projection, event), initial);
}
