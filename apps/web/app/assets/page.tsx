import Link from "next/link";
import { fetchJson } from "../../lib/api";
import { CopyValue } from "../../components/copy-value";
import { DataFreshness } from "../../components/data-freshness";
import { DetailsLink } from "../../components/details-link";
import { StatusBadge } from "../../components/status-badge";
import { formatCodeLabel, formatTimestampWithAge, shortId } from "../../lib/format";
import {
  buildPathWithSearchParams,
  isWithinWindow,
  matchesContains,
  readSearchParam,
  readWindowHours,
  type SearchParams
} from "../../lib/filters";

type AssetsResponse = {
  data: Array<{
    assetId: string;
    serialNumber: string;
    currentSiteId: string | null;
    status: string;
    lastEventType: string;
    lastEventAt: string;
    lastSequence: number;
    version: number;
  }>;
};

type SitesResponse = {
  data: Array<{
    id: string;
    code: string;
    name: string;
  }>;
};

export default async function AssetsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [assets, sites, params] = await Promise.all([
    fetchJson<AssetsResponse>("/assets"),
    fetchJson<SitesResponse>("/sites"),
    searchParams
  ]);

  const statusFilter = readSearchParam(params.status);
  const siteFilter = readSearchParam(params.siteId);
  const assetQuery = readSearchParam(params.q).trim();
  const selectedAssetId = readSearchParam(params.selected);
  const windowHours = readWindowHours(params.windowHours);

  const filteredAssets = assets.data.filter((asset) => {
    if (statusFilter && asset.status !== statusFilter) {
      return false;
    }
    if (siteFilter && asset.currentSiteId !== siteFilter) {
      return false;
    }
    if (
      assetQuery &&
      !matchesContains(asset.assetId, assetQuery) &&
      !matchesContains(asset.serialNumber, assetQuery)
    ) {
      return false;
    }
    if (!isWithinWindow(asset.lastEventAt, windowHours)) {
      return false;
    }
    return true;
  });

  const snapshotAt = new Date().toISOString();
  const inTransitCount = filteredAssets.filter((asset) => asset.status === "in_transit").length;
  const requiresReviewCount = filteredAssets.filter(
    (asset) => asset.status === "reconciliation_required"
  ).length;
  const selectedAsset =
    filteredAssets.find((asset) => asset.assetId === selectedAssetId) ??
    filteredAssets[0] ??
    null;
  const selectedSite = selectedAsset
    ? sites.data.find((site) => site.id === selectedAsset.currentSiteId) ?? null
    : null;
  const selectionHref = (assetId: string): string =>
    buildPathWithSearchParams("/assets", params, { selected: assetId });

  return (
    <div className="space-y-6">
      <section className="app-page-header">
        <h2 className="app-page-title">Assets</h2>
        <p className="app-page-subtitle">
          Projected asset state from the accepted event stream, including current custody and
          lifecycle status.
        </p>
        <DataFreshness snapshotAt={snapshotAt} />
        <div className="grid gap-3 md:grid-cols-4">
          <div className="app-summary-chip">
            <div className="app-summary-label">Filtered Assets</div>
            <div className="app-summary-value">{filteredAssets.length}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">In Transit</div>
            <div className="app-summary-value">{inTransitCount}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Requires Reconciliation</div>
            <div className="app-summary-value">{requiresReviewCount}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Total Tracked</div>
            <div className="app-summary-value">{assets.data.length}</div>
          </div>
        </div>
        <form className="mt-4 grid gap-2 md:grid-cols-5" method="get">
          <input
            type="text"
            name="q"
            defaultValue={assetQuery}
            placeholder="Asset ID or serial"
            aria-label="Search by asset ID or serial number"
            className="app-control"
          />
          <select
            name="status"
            defaultValue={statusFilter}
            className="app-control"
            aria-label="Filter by asset status"
          >
            <option value="">All statuses</option>
            <option value="at_site">At Site</option>
            <option value="in_transit">In Transit</option>
            <option value="under_inspection">Under Inspection</option>
            <option value="reconciliation_required">Reconciliation Required</option>
          </select>
          <select
            name="siteId"
            defaultValue={siteFilter}
            className="app-control"
            aria-label="Filter assets by current site"
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
            aria-label="Filter assets by last event time"
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
            <Link href="/assets" className="app-button-secondary">
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
                  <th>Asset</th>
                  <th>Serial</th>
                  <th>Current Site</th>
                  <th>Status</th>
                  <th>Last Event</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map((asset) => {
                  const isSelected = selectedAsset?.assetId === asset.assetId;
                  return (
                    <tr key={asset.assetId} className={isSelected ? "app-row-selected" : undefined}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-fg" title={asset.assetId}>
                            {shortId(asset.assetId, 10)}
                          </span>
                          {isSelected ? <CopyValue value={asset.assetId} label="asset id" /> : null}
                          <DetailsLink
                            href={selectionHref(asset.assetId)}
                            label={isSelected ? "Selected" : "Select"}
                            accessibleLabel={`${isSelected ? "Selected" : "Select"} asset ${asset.serialNumber}`}
                          />
                        </div>
                      </td>
                      <td className="font-medium">{asset.serialNumber}</td>
                      <td className="font-mono text-xs" title={asset.currentSiteId ?? undefined}>
                        {shortId(asset.currentSiteId, 8)}
                      </td>
                      <td>
                        <StatusBadge value={asset.status} />
                      </td>
                      <td>{formatCodeLabel(asset.lastEventType)}</td>
                      <td>{formatTimestampWithAge(asset.lastEventAt)}</td>
                    </tr>
                  );
                })}
                {filteredAssets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-sm text-fgMuted">
                      No assets match the current filter set.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="app-selection-panel">
          <h3 className="app-selection-title">Selected Asset</h3>
          {selectedAsset ? (
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <div className="app-selection-label">Asset ID</div>
                <div className="app-selection-value break-all font-mono text-xs" title={selectedAsset.assetId}>
                  {selectedAsset.assetId}
                </div>
              </div>
              <div>
                <div className="app-selection-label">Serial</div>
                <div className="app-selection-value">{selectedAsset.serialNumber}</div>
              </div>
              <div>
                <div className="app-selection-label">Current Site</div>
                <div className="app-selection-value">
                  {selectedSite?.code ?? selectedAsset.currentSiteId ?? "-"}
                </div>
              </div>
              <div>
                <div className="app-selection-label">Status</div>
                <StatusBadge value={selectedAsset.status} />
              </div>
              <div>
                <div className="app-selection-label">Last Event</div>
                <div className="app-selection-value">{formatCodeLabel(selectedAsset.lastEventType)}</div>
              </div>
              <div>
                <div className="app-selection-label">Last Updated</div>
                <div className="app-selection-value">{formatTimestampWithAge(selectedAsset.lastEventAt)}</div>
              </div>
              <div className="pt-1">
                <Link
                  href={`/assets/${selectedAsset.assetId}`}
                  className="app-pill-action inline-flex"
                >
                  Open Detail
                </Link>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-fgMuted">
              Select an asset row to inspect status and open detail.
            </p>
          )}
        </aside>
      </section>
    </div>
  );
}
