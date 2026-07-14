import Link from "next/link";
import { fetchJson } from "../../lib/api";
import { CopyValue } from "../../components/copy-value";
import { DataFreshness } from "../../components/data-freshness";
import { DetailsLink } from "../../components/details-link";
import { StatusBadge } from "../../components/status-badge";
import { OpenCaseForm } from "../../components/open-case-form";
import { formatCodeLabel, formatTimestampWithAge, shortId } from "../../lib/format";
import {
  buildPathWithSearchParams,
  isWithinWindow,
  matchesContains,
  readSearchParam,
  readWindowHours,
  type SearchParams
} from "../../lib/filters";

type CasesResponse = {
  data: Array<{
    id: string;
    alertId: string | null;
    assetId: string | null;
    siteId: string | null;
    status: string;
    title: string;
    description: string;
    openedBy: string;
    openedAt: string;
    resolvedBy: string | null;
    resolvedAt: string | null;
    resolutionSummary: string | null;
  }>;
};

type AlertsResponse = {
  data: Array<{
    id: string;
    ruleCode: string;
    severity: string;
    status: string;
    assetId: string | null;
    siteId: string | null;
    summary: string;
    details: Record<string, unknown>;
    detectedAt: string;
  }>;
};

type SitesResponse = {
  data: Array<{
    id: string;
    code: string;
  }>;
};

export default async function ReconciliationPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [cases, alerts, sites, params] = await Promise.all([
    fetchJson<CasesResponse>("/reconciliation-cases"),
    fetchJson<AlertsResponse>("/alerts"),
    fetchJson<SitesResponse>("/sites"),
    searchParams
  ]);

  const statusFilter = readSearchParam(params.status);
  const severityFilter = readSearchParam(params.severity);
  const siteFilter = readSearchParam(params.siteId);
  const assetQuery = readSearchParam(params.q).trim();
  const selectedCaseId = readSearchParam(params.selected);
  const windowHours = readWindowHours(params.windowHours);

  const filteredAlerts = alerts.data.filter((alert) => {
    if (statusFilter && alert.status !== statusFilter) {
      return false;
    }
    if (severityFilter && alert.severity !== severityFilter) {
      return false;
    }
    if (siteFilter && alert.siteId !== siteFilter) {
      return false;
    }
    if (
      assetQuery &&
      !matchesContains(alert.assetId, assetQuery) &&
      !matchesContains(alert.id, assetQuery) &&
      !matchesContains(alert.summary, assetQuery)
    ) {
      return false;
    }
    if (!isWithinWindow(alert.detectedAt, windowHours)) {
      return false;
    }
    return true;
  });

  const alertById = new Map(alerts.data.map((alert) => [alert.id, alert]));
  const filteredCases = cases.data.filter((record) => {
    const sourceAlert = record.alertId ? alertById.get(record.alertId) : undefined;
    if (statusFilter && record.status !== statusFilter) {
      return false;
    }
    if (siteFilter && record.siteId !== siteFilter) {
      return false;
    }
    const matchesCaseQuery =
      matchesContains(record.assetId, assetQuery) ||
      matchesContains(record.id, assetQuery) ||
      matchesContains(record.title, assetQuery);
    const matchesLinkedAlertQuery =
      matchesContains(sourceAlert?.id, assetQuery) ||
      matchesContains(sourceAlert?.assetId, assetQuery) ||
      matchesContains(sourceAlert?.summary, assetQuery);
    if (assetQuery && !matchesCaseQuery && !matchesLinkedAlertQuery) {
      return false;
    }
    if (!isWithinWindow(record.openedAt, windowHours)) {
      return false;
    }

    if (severityFilter) {
      if (!record.alertId) {
        return false;
      }
      if (!sourceAlert || sourceAlert.severity !== severityFilter) {
        return false;
      }
    }

    return true;
  });

  const snapshotAt = new Date().toISOString();
  const openCaseCount = filteredCases.filter((record) => record.status === "open").length;
  const resolvedCaseCount = filteredCases.filter((record) => record.status === "resolved").length;
  const highSeverityAlerts = filteredAlerts.filter((alert) => alert.severity === "high").length;
  const latestResolvedCase = filteredCases.find((record) => record.status === "resolved") ?? null;
  const selectedCase =
    filteredCases.find((record) => record.id === selectedCaseId) ?? filteredCases[0] ?? null;
  const selectedCaseSourceAlert = selectedCase?.alertId
    ? alerts.data.find((alert) => alert.id === selectedCase.alertId) ?? null
    : null;
  const caseSelectionHref = (caseId: string): string =>
    buildPathWithSearchParams("/reconciliation", params, { selected: caseId });

  return (
    <div className="space-y-6">
      <section className="app-page-header p-4 md:p-5">
        <h2 className="app-page-title">Reconciliation Workbench</h2>
        <p className="app-page-subtitle">
          Alert triage and operator-managed case resolution linked to immutable event history.
        </p>
        <DataFreshness snapshotAt={snapshotAt} />
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="app-summary-chip">
            <div className="app-summary-label">Open Cases</div>
            <div className="app-summary-value">{openCaseCount}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Resolved Cases</div>
            <div className="app-summary-value">{resolvedCaseCount}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">High Severity Alerts</div>
            <div className="app-summary-value">{highSeverityAlerts}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Filtered Alerts</div>
            <div className="app-summary-value">{filteredAlerts.length}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Filtered Cases</div>
            <div className="app-summary-value">{filteredCases.length}</div>
          </div>
        </div>
        {latestResolvedCase ? (
          <p className="mt-2 text-xs text-fgMuted">
            Latest resolved case{" "}
            <Link href={`/reconciliation/${latestResolvedCase.id}`} className="font-mono text-fg">
              {shortId(latestResolvedCase.id, 10)}
            </Link>{" "}
            closed {formatTimestampWithAge(latestResolvedCase.resolvedAt, "just now")}.
          </p>
        ) : null}
        <form
          className="mt-3 grid gap-2 lg:grid-cols-[minmax(12rem,1.4fr)_repeat(4,minmax(8.5rem,1fr))_auto]"
          method="get"
        >
          <input
            type="text"
            name="q"
            defaultValue={assetQuery}
            placeholder="Alert/case/asset"
            aria-label="Search by alert, case, or asset"
            className="app-control"
          />
          <select
            name="status"
            defaultValue={statusFilter}
            className="app-control"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
          <select
            name="severity"
            defaultValue={severityFilter}
            className="app-control"
            aria-label="Filter by severity"
          >
            <option value="">All severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            name="siteId"
            defaultValue={siteFilter}
            className="app-control"
            aria-label="Filter by site"
          >
            <option value="">All sites</option>
            {sites.data.map((site) => (
              <option key={site.id} value={site.id}>
                {site.code}
              </option>
            ))}
          </select>
          <select
            name="windowHours"
            defaultValue={windowHours ? String(windowHours) : ""}
            className="app-control"
            aria-label="Filter by time window"
          >
            <option value="">Any time</option>
            <option value="1">Last 1 hour</option>
            <option value="6">Last 6 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="72">Last 72 hours</option>
          </select>
          <div className="flex gap-2">
            <button
              type="submit"
              className="app-button"
            >
              Apply
            </button>
            <Link
              href="/reconciliation"
              className="app-button-secondary"
            >
              Clear
            </Link>
          </div>
        </form>
      </section>

      <section className="app-card">
        <h2 className="app-section-title">Divergence Alerts</h2>
        <p className="app-page-subtitle mb-4">
          Alerts are generated from transfer, inspection evidence, sync staleness, and projection
          integrity rules.
        </p>
        <div className="max-h-[22rem] overflow-auto rounded-lg border border-line">
          <table>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Rule</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Asset</th>
                <th>Summary</th>
                <th>Detected At</th>
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((alert) => (
                <tr key={alert.id}>
                  <td title={alert.id}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{shortId(alert.id, 10)}</span>
                      <CopyValue value={alert.id} label="alert id" />
                    </div>
                  </td>
                  <td>{formatCodeLabel(alert.ruleCode)}</td>
                  <td>
                    <StatusBadge value={alert.severity} />
                  </td>
                  <td>
                    <StatusBadge value={alert.status} />
                  </td>
                  <td className="font-mono text-xs" title={alert.assetId ?? undefined}>
                    {shortId(alert.assetId, 10)}
                  </td>
                  <td>{alert.summary}</td>
                  <td>{formatTimestampWithAge(alert.detectedAt)}</td>
                </tr>
              ))}
              {filteredAlerts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-sm text-fgMuted">
                    No alerts match the current filter set.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="app-card">
        <h2 className="app-section-title">Reconciliation Cases</h2>
        <p className="app-page-subtitle mb-4">
          Open cases represent active operator investigations. Resolution writes a closing event
          back to the stream.
        </p>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3">
            <OpenCaseForm sites={sites.data} />
            <div className="max-h-[26rem] overflow-auto rounded-lg border border-line">
              <table>
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Status</th>
                    <th>Title</th>
                    <th>Asset</th>
                    <th>Opened By</th>
                    <th>Opened At</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCases.map((record) => {
                    const isSelected = selectedCase?.id === record.id;
                    return (
                      <tr key={record.id} className={isSelected ? "app-row-selected" : undefined}>
                        <td title={record.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-fg">{shortId(record.id, 10)}</span>
                            {isSelected ? <CopyValue value={record.id} label="case id" /> : null}
                            <DetailsLink
                              href={caseSelectionHref(record.id)}
                              label={isSelected ? "Selected" : "Select"}
                              accessibleLabel={`${isSelected ? "Selected" : "Select"} reconciliation case ${record.title}`}
                            />
                          </div>
                        </td>
                        <td>
                          <StatusBadge value={record.status} />
                        </td>
                        <td className="font-medium">{record.title}</td>
                        <td className="font-mono text-xs" title={record.assetId ?? undefined}>
                          {shortId(record.assetId, 10)}
                        </td>
                        <td>{record.openedBy}</td>
                        <td>{formatTimestampWithAge(record.openedAt)}</td>
                        <td>
                          {record.status === "open" ? (
                            <Link
                              href={`/reconciliation/${record.id}`}
                              className="app-pill-action inline-flex"
                              aria-label={`Review reconciliation case ${record.title}`}
                            >
                              Review evidence
                            </Link>
                          ) : (
                            <span className="text-xs text-fgMuted">
                              Resolved by {record.resolvedBy} ({formatTimestampWithAge(record.resolvedAt)})
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredCases.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-sm text-fgMuted">
                        No cases match the current filter set.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="app-selection-panel">
            <h3 className="app-selection-title">Selected Case</h3>
            {selectedCase ? (
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <div className="app-selection-label">Case ID</div>
                  <div className="app-selection-value break-all font-mono text-xs" title={selectedCase.id}>
                    {selectedCase.id}
                  </div>
                </div>
                <div>
                  <div className="app-selection-label">Title</div>
                  <div className="app-selection-value">{selectedCase.title}</div>
                </div>
                <div>
                  <div className="app-selection-label">Status</div>
                  <StatusBadge value={selectedCase.status} />
                </div>
                <div>
                  <div className="app-selection-label">Opened</div>
                  <div className="app-selection-value">{formatTimestampWithAge(selectedCase.openedAt)}</div>
                </div>
                <div>
                  <div className="app-selection-label">Source Alert</div>
                  <div className="app-selection-value">
                    {selectedCaseSourceAlert
                      ? selectedCaseSourceAlert.summary
                      : "No source alert linked"}
                  </div>
                </div>
                <div>
                  <div className="app-selection-label">Linked Asset</div>
                  <div className="app-selection-value break-all font-mono text-xs" title={selectedCase.assetId ?? undefined}>
                    {selectedCase.assetId ?? "-"}
                  </div>
                </div>
                <div className="pt-1">
                <Link
                  href={`/reconciliation/${selectedCase.id}`}
                  className="app-pill-action inline-flex"
                >
                  Open Detail
                </Link>
              </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-fgMuted">
                Select a case row to inspect context and open detail.
              </p>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
