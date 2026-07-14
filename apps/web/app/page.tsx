import Link from "next/link";
import { DataFreshness } from "../components/data-freshness";
import { StatusBadge } from "../components/status-badge";
import { fetchJson } from "../lib/api";
import { formatCodeLabel, formatTimestampWithAge } from "../lib/format";

type DashboardResponse = {
  data: {
    summary: {
      openReconciliationCases: number;
      staleSites: number;
      assetsInTransit: number;
      recentAlerts: number;
      replaySuccessCount: number;
      replayFailureCount: number;
      unresolvedEvidenceGaps: number;
      openHighSeverityAlerts: number;
      openTransferTimeoutAlerts: number;
      openDualSiteAlerts: number;
      openProjectionLagAlerts: number;
      openEvidenceGapAlerts: number;
      openStaleSiteAlerts: number;
    };
    policy: {
      syncStaleMinutes: number;
      transferConfirmationHours: number;
      dualSiteObservationMinutes: number;
    };
    recentTransfers: Array<Record<string, unknown>>;
    recentAlerts: Array<Record<string, unknown>>;
    recentSyncBatches: Array<Record<string, unknown>>;
  };
};

type SitesResponse = {
  data: Array<{
    id: string;
    code: string;
    syncHealth: "healthy" | "stale";
    syncPosture: "healthy" | "stale" | "degraded";
    lastSyncCompletedAt: string | null;
  }>;
};

const metrics = [
  { key: "openReconciliationCases", label: "Open Reconciliation Cases", href: "/reconciliation" },
  { key: "staleSites", label: "Sites With Stale Sync", href: "/sites" },
  { key: "assetsInTransit", label: "Assets In Transit", href: "/transfers" },
  { key: "recentAlerts", label: "Alerts Raised (24h)", href: "/reconciliation" },
  { key: "replaySuccessCount", label: "Replay Events Accepted (24h)", href: "/sync-batches" },
  { key: "replayFailureCount", label: "Replay Events Rejected (24h)", href: "/sync-batches" },
  { key: "unresolvedEvidenceGaps", label: "Inspections With Evidence Gaps", href: "/assets" }
] as const;

type StatusTone = "healthy" | "warning" | "critical";

export default async function HomePage() {
  const [dashboard, sites] = await Promise.all([
    fetchJson<DashboardResponse>("/dashboard"),
    fetchJson<SitesResponse>("/sites")
  ]);

  const snapshotAt = new Date().toISOString();
  const scenarioLabel =
    process.env.NEXT_PUBLIC_SCENARIO_LABEL ??
    "sync lag + conflicting observations + missing evidence";

  const healthySites = sites.data.filter((site) => site.syncPosture === "healthy").length;
  const degradedSites = sites.data.filter((site) => site.syncPosture === "degraded").length;
  const staleSites = sites.data.filter((site) => site.syncPosture === "stale").length;
  const lastReplayAt = dashboard.data.recentSyncBatches[0]?.startedAt as string | undefined;

  const recentAlerts = dashboard.data.recentAlerts as Array<{
    severity?: string;
    status?: string;
    detectedAt?: string;
    lastDetectedAt?: string;
  }>;
  const recentTransfers = dashboard.data.recentTransfers as Array<{
    status?: string;
  }>;

  const highAlerts = recentAlerts.filter(
    (alert) => String(alert.severity ?? "") === "high"
  ).length;
  const mediumAlerts = recentAlerts.filter((alert) => String(alert.severity ?? "") === "medium").length;
  const lowAlerts = recentAlerts.filter((alert) => String(alert.severity ?? "") === "low").length;
  const initiatedTransfers = recentTransfers.filter(
    (transfer) => String(transfer.status ?? "") === "initiated"
  ).length;
  const completedTransfers = recentTransfers.filter(
    (transfer) => String(transfer.status ?? "") === "completed"
  ).length;

  const totalPosture = Math.max(1, healthySites + degradedSites + staleSites);
  const replayAccepted = dashboard.data.summary.replaySuccessCount;
  const replayRejected = dashboard.data.summary.replayFailureCount;
  const replayTotal = Math.max(1, replayAccepted + replayRejected);
  const openHighSeverityAlerts = dashboard.data.summary.openHighSeverityAlerts ?? 0;
  const openCriticalConditionAlerts =
    (dashboard.data.summary.openStaleSiteAlerts ?? 0) +
    (dashboard.data.summary.openDualSiteAlerts ?? 0) +
    (dashboard.data.summary.openProjectionLagAlerts ?? 0);
  const openWarningConditionAlerts =
    (dashboard.data.summary.openTransferTimeoutAlerts ?? 0) +
    (dashboard.data.summary.openEvidenceGapAlerts ?? 0);

  const globalStatus: { label: string; detail: string; tone: StatusTone } =
    openHighSeverityAlerts > 0 || openCriticalConditionAlerts > 0 || replayRejected > 0
      ? {
          label: "Attention Required",
          detail: `${String(openHighSeverityAlerts)} open high-severity alert(s), ${String(openCriticalConditionAlerts)} open integrity condition(s), and ${String(replayRejected)} rejected replay event(s).`,
          tone: "critical"
        }
      : degradedSites > 0 || openWarningConditionAlerts > 0
        ? {
            label: "Monitor",
            detail: `${String(openWarningConditionAlerts)} open transfer/evidence condition(s) require monitoring.`,
            tone: "warning"
          }
        : {
            label: "Stable",
            detail: "No active stale-site or high-severity risk conditions detected.",
            tone: "healthy"
          };

  const globalStatusClass = {
    healthy: "border-success/60 bg-success/10 text-success",
    warning: "border-warning/60 bg-warning/10 text-warning",
    critical: "border-critical/60 bg-critical/10 text-critical"
  }[globalStatus.tone];

  const postureSegments = [
    {
      key: "healthy",
      label: "Healthy",
      count: healthySites,
      widthPct: (healthySites / totalPosture) * 100,
      barClass: "bg-success/80"
    },
    {
      key: "degraded",
      label: "Degraded",
      count: degradedSites,
      widthPct: (degradedSites / totalPosture) * 100,
      barClass: "bg-warning/80"
    },
    {
      key: "stale",
      label: "Stale",
      count: staleSites,
      widthPct: (staleSites / totalPosture) * 100,
      barClass: "bg-critical/80"
    }
  ];

  const alertMixBars = [
    { label: "High", value: highAlerts, className: "bg-critical/80" },
    { label: "Medium", value: mediumAlerts, className: "bg-warning/80" },
    { label: "Low", value: lowAlerts, className: "bg-sky-500/80" }
  ];
  const maxAlertBarValue = Math.max(1, ...alertMixBars.map((bar) => bar.value));

  return (
    <div className="space-y-6">
      <section className="grid items-stretch gap-4 lg:grid-cols-[22rem_minmax(0,1fr)_20rem]">
        <article className="app-card h-full">
          <h2 className="app-section-title">Operational Policy</h2>
          <DataFreshness snapshotAt={snapshotAt} />
          <div className="mt-3 space-y-1 text-sm text-fgMuted">
            <p>
              Site is stale after{" "}
              <span className="font-semibold text-fg">
                {dashboard.data.policy.syncStaleMinutes} minutes
              </span>{" "}
              without completed sync.
            </p>
            <p>
              Transfer is overdue after{" "}
              <span className="font-semibold text-fg">
                {dashboard.data.policy.transferConfirmationHours} hours
              </span>{" "}
              without confirmation.
            </p>
            <p>
              Conflicting observations are compared within{" "}
              <span className="font-semibold text-fg">
                {dashboard.data.policy.dualSiteObservationMinutes} minutes
              </span>.
            </p>
          </div>
        </article>

        <article className="app-card h-full">
          <h2 className="app-section-title">Scenario State</h2>
          <p className="mt-1 text-base">
            Scenario: <span className="font-medium">{scenarioLabel}</span>
          </p>
          <p className="mt-1 text-sm text-fgMuted">
            Site sync status: {healthySites} healthy, {degradedSites} degraded, {staleSites} stale.
            Last replay batch observed {formatTimestampWithAge(lastReplayAt ?? null, "Not observed")}.
          </p>
        </article>

        <article className="app-card h-full">
          <h2 className="app-section-title">Global Status</h2>
          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${globalStatusClass}`}>
            {globalStatus.label}
          </div>
          <p className="mt-2 text-sm text-fgMuted">{globalStatus.detail}</p>
        </article>
      </section>

      <section className="grid items-stretch gap-4 xl:grid-cols-3">
        <article className="app-card h-full">
          <h2 className="app-section-title">Site Sync Status</h2>
          <p className="app-section-subtitle">
            Current distribution across healthy, degraded, and stale sites.
          </p>
          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full border border-line bg-panelMuted">
            {postureSegments.map((segment) => (
              <div
                key={segment.key}
                className={segment.barClass}
                style={{ width: `${segment.widthPct}%` }}
                title={`${segment.label}: ${segment.count}`}
              />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            {postureSegments.map((segment) => (
              <div key={segment.key} className="rounded border border-line bg-panelMuted px-2 py-1.5">
                <div className="text-fgMuted">{segment.label}</div>
                <div className="text-base font-semibold text-fg">{segment.count}</div>
              </div>
            ))}
          </div>
        </article>

        <article className="app-card h-full">
          <h2 className="app-section-title">Alert Severity Mix</h2>
          <p className="app-section-subtitle">Breakdown of recent alerts by severity.</p>
          <div className="mt-4 space-y-3">
            {alertMixBars.map((bar) => (
              <div key={bar.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs text-fgMuted">
                  <span>{bar.label}</span>
                  <span className="font-semibold text-fg">{bar.value}</span>
                </div>
                <div className="h-2 rounded-full border border-line bg-panelMuted">
                  <div
                    className={`h-full rounded-full ${bar.className}`}
                    style={{ width: `${bar.value === 0 ? 0 : (bar.value / maxAlertBarValue) * 100}%` }}
                    role="img"
                    aria-label={`${bar.label} alerts: ${String(bar.value)}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="app-card h-full">
          <h2 className="app-section-title">Replay & Transfer Flow</h2>
          <p className="app-section-subtitle">Recent replay outcomes and transfer completion mix.</p>
          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-fgMuted">
                <span>Replay acceptance (including deduplicated)</span>
                <span className="font-semibold text-fg">
                  {replayAccepted} accepted / {replayRejected} rejected
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full border border-line bg-panelMuted">
                <div className="bg-success/80" style={{ width: `${(replayAccepted / replayTotal) * 100}%` }} />
                <div className="bg-critical/80" style={{ width: `${(replayRejected / replayTotal) * 100}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-fgMuted">
                <span>Transfer completion</span>
                <span className="font-semibold text-fg">
                  {completedTransfers} completed / {initiatedTransfers} pending
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full border border-line bg-panelMuted">
                <div
                  className="bg-success/80"
                  style={{
                    width: `${(completedTransfers / Math.max(1, completedTransfers + initiatedTransfers)) * 100}%`
                  }}
                />
                <div
                  className="bg-warning/80"
                  style={{
                    width: `${(initiatedTransfers / Math.max(1, completedTransfers + initiatedTransfers)) * 100}%`
                  }}
                />
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="space-y-3">
        <header className="app-card py-3">
          <h2 className="app-section-title">Operational Summary</h2>
          <p className="app-section-subtitle">
            Current counts for risk, synchronization, and in-transit operations.
          </p>
        </header>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <Link key={metric.key} href={metric.href} className="app-kpi-card">
              <article>
                <h3 className="text-sm font-semibold text-fg">{metric.label}</h3>
                <p className="mt-2 text-4xl font-semibold tracking-tight">
                  {dashboard.data.summary[metric.key]}
                </p>
              </article>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="app-card">
          <h3 className="app-section-title">Recent Transfers</h3>
          <p className="app-section-subtitle">Latest transfer orders and confirmation state at destination.</p>
          <div className="app-scroll-panel mt-3 space-y-2 text-sm">
            {dashboard.data.recentTransfers.map((transfer) => (
              <div key={String(transfer.id)} className="app-stream-card">
                <div className="flex items-center justify-between">
                  <div className="break-all font-mono text-xs text-fg" title={String(transfer.id)}>
                    Transfer {String(transfer.id)}
                  </div>
                  <StatusBadge value={String(transfer.status)} />
                </div>
                <div className="mt-2 text-xs text-fgMuted">
                  Initiated {formatTimestampWithAge(String(transfer.initiatedAt ?? ""))}
                </div>
                <div className="mt-1 text-xs text-fgMuted">
                  Confirmed{" "}
                  {formatTimestampWithAge(
                    (transfer.completedAt as string | null | undefined) ?? null,
                    "Pending"
                  )}
                </div>
                <Link href={`/transfers/${String(transfer.id)}`} className="app-pill-action mt-2 inline-flex">
                  Open detail
                </Link>
              </div>
            ))}
          </div>
        </div>

        <div className="app-card">
          <h3 className="app-section-title">Recent Alerts</h3>
          <p className="app-section-subtitle">Divergence conditions that require operator review.</p>
          <div className="app-scroll-panel mt-3 space-y-2 text-sm">
            {dashboard.data.recentAlerts.map((alert) => (
              <div key={String(alert.id)} className="app-stream-card">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-fg">{String(alert.summary)}</div>
                  <StatusBadge value={String(alert.severity)} />
                </div>
                <div className="mt-1 text-xs text-fgMuted">Rule: {formatCodeLabel(String(alert.ruleCode))}</div>
                <div className="mt-1 text-xs text-fgMuted">
                  Last detected {formatTimestampWithAge(String(alert.lastDetectedAt ?? alert.detectedAt ?? ""))}
                </div>
                <Link
                  href={`/reconciliation?q=${encodeURIComponent(String(alert.id))}`}
                  className="app-pill-action mt-2 inline-flex"
                >
                  Open Detail
                </Link>
              </div>
            ))}
          </div>
        </div>

        <div className="app-card">
          <h3 className="app-section-title">Recent Sync Batches</h3>
          <p className="app-section-subtitle">Replay outcomes from recent site synchronization batches.</p>
          <div className="app-scroll-panel mt-3 space-y-2 text-sm">
            {dashboard.data.recentSyncBatches.map((batch) => (
              <div key={String(batch.id)} className="app-stream-card">
                <div className="flex items-center justify-between">
                  <div className="break-all font-mono text-xs text-fg" title={String(batch.id)}>
                    Batch {String(batch.id)}
                  </div>
                  <StatusBadge value={String(batch.status)} />
                </div>
                <div className="mt-1 text-xs text-fgMuted">
                  Replay outcome: accepted incl. dedup {String(batch.acceptedEventCount)}, rejected{" "}
                  {String(batch.rejectedEventCount)}
                </div>
                <div className="mt-1 text-xs text-fgMuted">
                  Started {formatTimestampWithAge(String(batch.startedAt ?? ""))}
                </div>
                <div className="mt-1 text-xs text-fgMuted">
                  Completed{" "}
                  {formatTimestampWithAge(
                    (batch.completedAt as string | null | undefined) ?? null,
                    "In Progress"
                  )}
                </div>
                <Link
                  href={`/sync-batches/${String(batch.id)}`}
                  className="app-pill-action mt-2 inline-flex"
                >
                  Open Detail
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
