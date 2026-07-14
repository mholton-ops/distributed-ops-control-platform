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

type TransfersResponse = {
  data: Array<{
    id: string;
    assetId: string;
    originSiteId: string;
    destinationSiteId: string;
    status: string;
    initiatedAt: string;
    completedAt: string | null;
  }>;
};

type SitesResponse = {
  data: Array<{
    id: string;
    code: string;
  }>;
};

export default async function TransfersPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [transfers, sites, params] = await Promise.all([
    fetchJson<TransfersResponse>("/transfers"),
    fetchJson<SitesResponse>("/sites"),
    searchParams
  ]);

  const statusFilter = readSearchParam(params.status);
  const siteFilter = readSearchParam(params.siteId);
  const assetQuery = readSearchParam(params.q).trim();
  const selectedTransferId = readSearchParam(params.selected);
  const windowHours = readWindowHours(params.windowHours);

  const filteredTransfers = transfers.data.filter((transfer) => {
    if (statusFilter && transfer.status !== statusFilter) {
      return false;
    }
    if (
      siteFilter &&
      transfer.originSiteId !== siteFilter &&
      transfer.destinationSiteId !== siteFilter
    ) {
      return false;
    }
    if (assetQuery && !matchesContains(transfer.assetId, assetQuery) && !matchesContains(transfer.id, assetQuery)) {
      return false;
    }
    if (!isWithinWindow(transfer.initiatedAt, windowHours)) {
      return false;
    }
    return true;
  });

  const snapshotAt = new Date().toISOString();
  const pendingCount = filteredTransfers.filter((transfer) => transfer.status !== "completed").length;
  const completedCount = filteredTransfers.filter((transfer) => transfer.status === "completed").length;
  const selectedTransfer =
    filteredTransfers.find((transfer) => transfer.id === selectedTransferId) ??
    filteredTransfers[0] ??
    null;
  const originSite = selectedTransfer
    ? sites.data.find((site) => site.id === selectedTransfer.originSiteId) ?? null
    : null;
  const destinationSite = selectedTransfer
    ? sites.data.find((site) => site.id === selectedTransfer.destinationSiteId) ?? null
    : null;
  const selectionHref = (transferId: string): string =>
    buildPathWithSearchParams("/transfers", params, { selected: transferId });

  return (
    <div className="space-y-6">
      <section className="app-page-header">
        <h2 className="app-page-title">Transfer Timeline</h2>
        <p className="app-page-subtitle">
          Transfer orders with lifecycle state, origin/destination custody, and confirmation timing.
        </p>
        <DataFreshness snapshotAt={snapshotAt} />
        <div className="grid gap-3 md:grid-cols-4">
          <div className="app-summary-chip">
            <div className="app-summary-label">Filtered Transfers</div>
            <div className="app-summary-value">{filteredTransfers.length}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Open Transfers</div>
            <div className="app-summary-value">{pendingCount}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Completed Transfers</div>
            <div className="app-summary-value">{completedCount}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Total Transfers</div>
            <div className="app-summary-value">{transfers.data.length}</div>
          </div>
        </div>
        <form className="mt-4 grid gap-2 md:grid-cols-5" method="get">
          <input
            type="text"
            name="q"
            defaultValue={assetQuery}
            placeholder="Transfer ID or asset ID"
            aria-label="Search by transfer or asset ID"
            className="app-control"
          />
          <select
            name="status"
            defaultValue={statusFilter}
            className="app-control"
            aria-label="Filter by transfer status"
          >
            <option value="">All statuses</option>
            <option value="initiated">Initiated</option>
            <option value="completed">Completed</option>
          </select>
          <select
            name="siteId"
            defaultValue={siteFilter}
            className="app-control"
            aria-label="Filter transfers by site"
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
            aria-label="Filter transfers by initiation time"
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
            <Link href="/transfers" className="app-button-secondary">
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
                  <th>Transfer</th>
                  <th>Asset</th>
                  <th>Origin</th>
                  <th>Destination</th>
                  <th>Status</th>
                  <th>Initiated</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransfers.map((transfer) => {
                  const isSelected = selectedTransfer?.id === transfer.id;
                  return (
                    <tr key={transfer.id} className={isSelected ? "app-row-selected" : undefined}>
                      <td title={transfer.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-fg">{shortId(transfer.id, 10)}</span>
                          {isSelected ? <CopyValue value={transfer.id} label="transfer id" /> : null}
                          <DetailsLink
                            href={selectionHref(transfer.id)}
                            label={isSelected ? "Selected" : "Select"}
                            accessibleLabel={`${isSelected ? "Selected" : "Select"} transfer ${shortId(transfer.id, 10)}`}
                          />
                        </div>
                      </td>
                      <td title={transfer.assetId}>
                        <Link href={`/assets/${transfer.assetId}`} className="font-mono text-xs text-fg">
                          {shortId(transfer.assetId, 10)}
                        </Link>
                      </td>
                      <td className="font-mono text-xs" title={transfer.originSiteId}>
                        {shortId(transfer.originSiteId, 8)}
                      </td>
                      <td className="font-mono text-xs" title={transfer.destinationSiteId}>
                        {shortId(transfer.destinationSiteId, 8)}
                      </td>
                      <td>
                        <StatusBadge value={transfer.status} />
                      </td>
                      <td>{formatTimestampWithAge(transfer.initiatedAt)}</td>
                      <td>{formatTimestampWithAge(transfer.completedAt, "Pending")}</td>
                    </tr>
                  );
                })}
                {filteredTransfers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-sm text-fgMuted">
                      No transfers match the current filter set.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="app-selection-panel">
          <h3 className="app-selection-title">Selected Transfer</h3>
          {selectedTransfer ? (
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <div className="app-selection-label">Transfer ID</div>
                <div className="app-selection-value break-all font-mono text-xs" title={selectedTransfer.id}>
                  {selectedTransfer.id}
                </div>
              </div>
              <div>
                <div className="app-selection-label">Asset</div>
                <Link href={`/assets/${selectedTransfer.assetId}`} className="inline-block break-all font-mono text-xs text-fg">
                  {selectedTransfer.assetId}
                </Link>
              </div>
              <div>
                <div className="app-selection-label">Origin</div>
                <div className="app-selection-value">
                  {originSite?.code ?? selectedTransfer.originSiteId}
                </div>
              </div>
              <div>
                <div className="app-selection-label">Destination</div>
                <div className="app-selection-value">
                  {destinationSite?.code ?? selectedTransfer.destinationSiteId}
                </div>
              </div>
              <div>
                <div className="app-selection-label">Status</div>
                <StatusBadge value={selectedTransfer.status} />
              </div>
              <div>
                <div className="app-selection-label">Initiated</div>
                <div className="app-selection-value">{formatTimestampWithAge(selectedTransfer.initiatedAt)}</div>
              </div>
              <div>
                <div className="app-selection-label">Completed</div>
                <div className="app-selection-value">{formatTimestampWithAge(selectedTransfer.completedAt, "Pending")}</div>
              </div>
              <div className="pt-1">
                <Link
                  href={`/transfers/${selectedTransfer.id}`}
                  className="app-pill-action inline-flex"
                >
                  Open Detail
                </Link>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-fgMuted">
              Select a transfer row to inspect lifecycle and open detail.
            </p>
          )}
        </aside>
      </section>
    </div>
  );
}
