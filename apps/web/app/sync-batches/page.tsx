import Link from "next/link";
import { fetchJson } from "../../lib/api";
import { CopyValue } from "../../components/copy-value";
import { DataFreshness } from "../../components/data-freshness";
import { DetailsLink } from "../../components/details-link";
import { StatusBadge } from "../../components/status-badge";
import { formatTimestampWithAge, shortId } from "../../lib/format";
import {
  buildPathWithSearchParams,
  isWithinWindow,
  matchesContains,
  readSearchParam,
  readWindowHours,
  type SearchParams
} from "../../lib/filters";

type SyncBatchResponse = {
  data: Array<{
    id: string;
    siteId: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    queuedEventCount: number;
    acceptedEventCount: number;
    rejectedEventCount: number;
    replayResultSummary: string | null;
  }>;
};

type SitesResponse = {
  data: Array<{
    id: string;
    code: string;
  }>;
};

export default async function SyncBatchesPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [batches, sites, params] = await Promise.all([
    fetchJson<SyncBatchResponse>("/sync-batches"),
    fetchJson<SitesResponse>("/sites"),
    searchParams
  ]);

  const statusFilter = readSearchParam(params.status);
  const siteFilter = readSearchParam(params.siteId);
  const query = readSearchParam(params.q).trim();
  const selectedBatchId = readSearchParam(params.selected);
  const windowHours = readWindowHours(params.windowHours);

  const filteredBatches = batches.data.filter((batch) => {
    if (statusFilter && batch.status !== statusFilter) {
      return false;
    }
    if (siteFilter && batch.siteId !== siteFilter) {
      return false;
    }
    if (query && !matchesContains(batch.id, query) && !matchesContains(batch.siteId, query)) {
      return false;
    }
    if (!isWithinWindow(batch.startedAt, windowHours)) {
      return false;
    }
    return true;
  });

  const snapshotAt = new Date().toISOString();
  const completedCount = filteredBatches.filter((batch) => batch.status === "completed").length;
  const inProgressCount = filteredBatches.filter((batch) => batch.status !== "completed").length;
  const totalRejected = filteredBatches.reduce((sum, batch) => sum + batch.rejectedEventCount, 0);
  const batchesWithRejections = filteredBatches.filter((batch) => batch.rejectedEventCount > 0).length;
  const latestRejectedBatch =
    filteredBatches.find((batch) => batch.rejectedEventCount > 0) ?? null;
  const selectedBatch =
    filteredBatches.find((batch) => batch.id === selectedBatchId) ?? filteredBatches[0] ?? null;
  const selectedBatchSite = selectedBatch
    ? sites.data.find((site) => site.id === selectedBatch.siteId) ?? null
    : null;
  const selectionHref = (batchId: string): string =>
    buildPathWithSearchParams("/sync-batches", params, { selected: batchId });

  return (
    <div className="space-y-6">
      <section className="app-page-header">
        <h2 className="app-page-title">Sync Batch Outcomes</h2>
        <p className="app-page-subtitle">
          Batch replay outcomes with queued, accepted, and rejected event counts per site submission.
        </p>
        <DataFreshness snapshotAt={snapshotAt} />
        <div className="grid gap-3 md:grid-cols-5">
          <div className="app-summary-chip">
            <div className="app-summary-label">Filtered Batches</div>
            <div className="app-summary-value">{filteredBatches.length}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Completed Batches</div>
            <div className="app-summary-value">{completedCount}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">In Progress</div>
            <div className="app-summary-value">{inProgressCount}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Rejected Events</div>
            <div className="app-summary-value">{totalRejected}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Batches With Rejections</div>
            <div className="app-summary-value">{batchesWithRejections}</div>
          </div>
        </div>
        {latestRejectedBatch ? (
          <div className="mt-3 rounded border border-line bg-panelMuted px-3 py-2 text-xs text-fgMuted">
            Rejected replay example: batch{" "}
            <Link href={`/sync-batches/${latestRejectedBatch.id}`} className="font-mono text-fg">
              {shortId(latestRejectedBatch.id, 10)}
            </Link>{" "}
            has {latestRejectedBatch.rejectedEventCount} rejected event(s).
          </div>
        ) : null}
        <form className="mt-4 grid gap-2 md:grid-cols-5" method="get">
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Batch ID or site ID"
            aria-label="Search by sync batch or site ID"
            className="app-control"
          />
          <select
            name="status"
            defaultValue={statusFilter}
            className="app-control"
            aria-label="Filter by sync batch status"
          >
            <option value="">All statuses</option>
            <option value="started">Started</option>
            <option value="completed">Completed</option>
          </select>
          <select
            name="siteId"
            defaultValue={siteFilter}
            className="app-control"
            aria-label="Filter sync batches by site"
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
            aria-label="Filter sync batches by start time"
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
              href="/sync-batches"
              className="app-button-secondary"
            >
              Clear
            </Link>
          </div>
        </form>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="app-card p-2">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Site</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Queued</th>
                  <th>Accepted (incl. dedup)</th>
                  <th>Rejected</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.map((batch) => {
                  const isSelected = selectedBatch?.id === batch.id;
                  return (
                    <tr key={batch.id} className={isSelected ? "app-row-selected" : undefined}>
                      <td title={batch.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-fg">{shortId(batch.id, 10)}</span>
                          {isSelected ? <CopyValue value={batch.id} label="sync batch id" /> : null}
                          <DetailsLink
                            href={selectionHref(batch.id)}
                            label={isSelected ? "Selected" : "Select"}
                            accessibleLabel={`${isSelected ? "Selected" : "Select"} sync batch ${shortId(batch.id, 10)}`}
                          />
                        </div>
                      </td>
                      <td className="font-mono text-xs" title={batch.siteId}>
                        {shortId(batch.siteId, 8)}
                      </td>
                      <td>
                        <StatusBadge value={batch.status} />
                      </td>
                      <td>{formatTimestampWithAge(batch.startedAt)}</td>
                      <td>{formatTimestampWithAge(batch.completedAt, "In Progress")}</td>
                      <td>{batch.queuedEventCount}</td>
                      <td>{batch.acceptedEventCount}</td>
                      <td>{batch.rejectedEventCount}</td>
                    </tr>
                  );
                })}
                {filteredBatches.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-sm text-fgMuted">
                      No sync batches match the current filter set.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="app-selection-panel">
          <h3 className="app-selection-title">Selected Sync Batch</h3>
          {selectedBatch ? (
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <div className="app-selection-label">Batch ID</div>
                <div className="app-selection-value break-all font-mono text-xs" title={selectedBatch.id}>
                  {selectedBatch.id}
                </div>
              </div>
              <div>
                <div className="app-selection-label">Source Site</div>
                <div className="app-selection-value">
                  {selectedBatchSite?.code ?? selectedBatch.siteId}
                </div>
              </div>
              <div>
                <div className="app-selection-label">Status</div>
                <StatusBadge value={selectedBatch.status} />
              </div>
              <div>
                <div className="app-selection-label">Started</div>
                <div className="app-selection-value">{formatTimestampWithAge(selectedBatch.startedAt)}</div>
              </div>
              <div>
                <div className="app-selection-label">Completed</div>
                <div className="app-selection-value">{formatTimestampWithAge(selectedBatch.completedAt, "In Progress")}</div>
              </div>
              <div>
                <div className="app-selection-label">Replay Counts</div>
                <div className="app-selection-value">
                  queued {selectedBatch.queuedEventCount} / accepted incl. dedup {selectedBatch.acceptedEventCount} /
                  rejected {selectedBatch.rejectedEventCount}
                </div>
              </div>
              <div className="pt-1">
                <Link
                  href={`/sync-batches/${selectedBatch.id}`}
                  className="app-pill-action inline-flex"
                >
                  Open Detail
                </Link>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-fgMuted">
              Select a batch row to inspect replay outcomes and open detail.
            </p>
          )}
        </aside>
      </section>
    </div>
  );
}
