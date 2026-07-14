import { formatCodeLabel } from "../lib/format";

type Severity =
  | "low"
  | "medium"
  | "high"
  | "open"
  | "resolved"
  | "healthy"
  | "stale"
  | "degraded"
  | string;

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function StatusBadge({ value }: { value: Severity }) {
  const style = {
    high: "border-critical/80 text-critical",
    medium: "border-warning/80 text-warning",
    low: "border-sky-600/70 text-sky-700",
    open: "border-warning/80 text-warning",
    acknowledged: "border-sky-600/70 text-sky-700",
    resolved: "border-success/80 text-success",
    healthy: "border-success/80 text-success",
    stale: "border-critical/80 text-critical",
    degraded: "border-warning/80 text-warning",
    in_transit: "border-sky-600/70 text-sky-700",
    registered: "border-success/80 text-success",
    under_inspection: "border-warning/80 text-warning",
    reconciliation_required: "border-critical/80 text-critical",
    at_site: "border-success/80 text-success",
    initiated: "border-sky-600/70 text-sky-700",
    started: "border-warning/80 text-warning",
    processing: "border-warning/80 text-warning",
    partial: "border-warning/80 text-warning",
    failed: "border-critical/80 text-critical",
    completed: "border-success/80 text-success",
    pass: "border-success/80 text-success",
    fail: "border-critical/80 text-critical",
    review: "border-warning/80 text-warning",
    accepted: "border-success/80 text-success",
    deduplicated: "border-sky-600/70 text-sky-700",
    rejected: "border-critical/80 text-critical"
  }[value];

  return (
    <span
      className={cx(
        "whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold",
        style ?? "border-line text-fgMuted"
      )}
    >
      {formatCodeLabel(value)}
    </span>
  );
}
