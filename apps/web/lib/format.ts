const labelOverrides: Record<string, string> = {
  at_site: "At Site",
  in_transit: "In Transit",
  under_inspection: "Under Inspection",
  reconciliation_required: "Reconciliation Required",
  initiated: "Initiated",
  started: "Started",
  completed: "Completed",
  open: "Open",
  resolved: "Resolved",
  healthy: "Healthy",
  stale: "Stale",
  degraded: "Degraded",
  pass: "Pass",
  fail: "Fail",
  review: "Review",
  high: "High",
  medium: "Medium",
  low: "Low",
  TRANSFER_NOT_CONFIRMED: "Transfer Confirmation Overdue",
  ASSET_OBSERVED_AT_MULTIPLE_SITES: "Conflicting Site Observations",
  INSPECTION_MISSING_EVIDENCE: "Inspection Evidence Missing",
  SITE_PROJECTION_STALE: "Site Sync Stale",
  PROJECTION_SEQUENCE_BEHIND_EVENT_STREAM: "Projection Lag Detected"
};

export function formatCodeLabel(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  if (labelOverrides[value]) {
    return labelOverrides[value];
  }
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatTimestamp(
  value: string | null | undefined,
  emptyLabel = "Never"
): string {
  if (!value) {
    return emptyLabel;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Invalid timestamp";
  }
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(date);
}

export function formatRelativeAge(
  value: string | null | undefined,
  emptyLabel = "",
  now = Date.now()
): string {
  if (!value) {
    return emptyLabel;
  }

  const parsedTime = new Date(value).getTime();
  if (Number.isNaN(parsedTime)) {
    return "invalid time";
  }
  const diffMs = now - parsedTime;
  if (diffMs < 0) {
    return "just now";
  }

  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

export function formatTimestampWithAge(
  value: string | null | undefined,
  emptyLabel = "Never"
): string {
  if (!value) {
    return emptyLabel;
  }
  return `${formatTimestamp(value, emptyLabel)} (${formatRelativeAge(value)})`;
}

export function shortId(value: string | null | undefined, size = 8): string {
  if (!value) {
    return "-";
  }
  return value.length > size ? `${value.slice(0, size)}...` : value;
}

function asText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function summarizeEventPayload(
  eventType: string,
  payload: Record<string, unknown> | null | undefined
): string {
  if (!payload) {
    return "-";
  }

  switch (eventType) {
    case "asset_registered":
      return `Serial ${asText(payload.serialNumber) || "unknown"} registered`;
    case "asset_moved":
      return `Moved ${shortId(asText(payload.fromSiteId), 6)} -> ${shortId(asText(payload.toSiteId), 6)}`;
    case "asset_received":
      return `Received (${asText(payload.condition) || "unknown"})`;
    case "inspection_recorded":
      return `Inspection ${asText(payload.status) || "recorded"}`;
    case "evidence_attached":
      return `Evidence ${asText(payload.mimeType) || "attached"}`;
    case "transfer_initiated":
      return `Transfer to ${shortId(asText(payload.destinationSiteId), 6)} initiated`;
    case "transfer_completed":
      return "Transfer completed";
    case "site_sync_started":
      return `Replay started (${asText(payload.queuedEventCount) || "0"} queued)`;
    case "site_sync_completed":
      return `Replay completed (${asText(payload.acceptedEventCount) || "0"} accepted incl. dedup, ${asText(payload.rejectedEventCount) || "0"} rejected)`;
    case "divergence_detected":
      return asText(payload.summary) || "Divergence detected";
    case "reconciliation_opened":
      return `Case ${shortId(asText(payload.caseId), 8)} opened`;
    case "reconciliation_resolved":
      return `Case ${shortId(asText(payload.caseId), 8)} resolved`;
    default: {
      const keys = Object.keys(payload);
      if (keys.length === 0) {
        return "-";
      }
      const firstKey = keys[0];
      return `${formatCodeLabel(firstKey)}: ${asText(payload[firstKey]) || "..."}`;
    }
  }
}
