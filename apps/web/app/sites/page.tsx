import Link from "next/link";
import { fetchJson } from "../../lib/api";
import { DetailsLink } from "../../components/details-link";
import { DataFreshness } from "../../components/data-freshness";
import { StatusBadge } from "../../components/status-badge";
import { formatTimestampWithAge } from "../../lib/format";
import {
  buildPathWithSearchParams,
  isWithinWindow,
  matchesContains,
  readSearchParam,
  readWindowHours,
  type SearchParams
} from "../../lib/filters";

type SitesResponse = {
  data: Array<{
    id: string;
    code: string;
    name: string;
    lastSyncCompletedAt: string | null;
    syncHealth: "healthy" | "stale";
    syncPosture: "healthy" | "stale" | "degraded";
  }>;
};

export default async function SitesPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [sites, params] = await Promise.all([fetchJson<SitesResponse>("/sites"), searchParams]);
  const statusFilter = readSearchParam(params.status);
  const query = readSearchParam(params.q).trim();
  const selectedSiteId = readSearchParam(params.selected);
  const windowHours = readWindowHours(params.windowHours);

  const filteredSites = sites.data.filter((site) => {
    if (statusFilter && site.syncPosture !== statusFilter) {
      return false;
    }
    if (query && !matchesContains(site.code, query) && !matchesContains(site.name, query)) {
      return false;
    }
    if (!isWithinWindow(site.lastSyncCompletedAt, windowHours)) {
      return false;
    }
    return true;
  });

  const snapshotAt = new Date().toISOString();
  const staleCount = filteredSites.filter((site) => site.syncPosture === "stale").length;
  const healthyCount = filteredSites.filter((site) => site.syncPosture === "healthy").length;
  const degradedCount = filteredSites.filter((site) => site.syncPosture === "degraded").length;
  const selectedSite =
    filteredSites.find((site) => site.id === selectedSiteId) ?? filteredSites[0] ?? null;
  const selectionHref = (siteId: string): string =>
    buildPathWithSearchParams("/sites", params, { selected: siteId });

  return (
    <div className="space-y-6">
      <section className="app-page-header">
        <h2 className="app-page-title">Site Sync Status</h2>
        <p className="app-page-subtitle">
          Site synchronization status against stale thresholds and most recent successful sync
          completion.
        </p>
        <DataFreshness snapshotAt={snapshotAt} />
        <div className="grid gap-3 md:grid-cols-4">
          <div className="app-summary-chip">
            <div className="app-summary-label">Healthy</div>
            <div className="app-summary-value">{healthyCount}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Degraded</div>
            <div className="app-summary-value">{degradedCount}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Stale</div>
            <div className="app-summary-value">{staleCount}</div>
          </div>
          <div className="app-summary-chip">
            <div className="app-summary-label">Filtered Sites</div>
            <div className="app-summary-value">{filteredSites.length}</div>
          </div>
        </div>
        <form className="mt-4 grid gap-2 md:grid-cols-4" method="get">
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Site code or name"
            aria-label="Search by site code or name"
            className="app-control"
          />
          <select
            name="status"
            defaultValue={statusFilter}
            className="app-control"
            aria-label="Filter by synchronization posture"
          >
            <option value="">All sync states</option>
            <option value="healthy">Healthy</option>
            <option value="degraded">Degraded</option>
            <option value="stale">Stale</option>
          </select>
          <select
            name="windowHours"
            defaultValue={windowHours ? String(windowHours) : ""}
            className="app-control"
            aria-label="Filter sites by last synchronization time"
          >
            <option value="">Any last-sync time</option>
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
            <Link href="/sites" className="app-button-secondary">
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
                  <th>Site</th>
                  <th>Name</th>
                  <th>Last Sync Completed</th>
                  <th>Sync Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredSites.map((site) => {
                  const isSelected = selectedSite?.id === site.id;
                  return (
                    <tr key={site.id} className={isSelected ? "app-row-selected" : undefined}>
                      <td className="font-medium">
                        <div className="flex items-center gap-2">
                          <span className="text-fg">{site.code}</span>
                          <DetailsLink
                            href={selectionHref(site.id)}
                            label={isSelected ? "Selected" : "Select"}
                            accessibleLabel={`${isSelected ? "Selected" : "Select"} site ${site.code}`}
                          />
                        </div>
                      </td>
                      <td>{site.name}</td>
                      <td>{formatTimestampWithAge(site.lastSyncCompletedAt)}</td>
                      <td>
                        <StatusBadge value={site.syncPosture} />
                      </td>
                    </tr>
                  );
                })}
                {filteredSites.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-sm text-fgMuted">
                      No sites match the current filter set.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="app-selection-panel">
          <h3 className="app-selection-title">Selected Site</h3>
          {selectedSite ? (
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <div className="app-selection-label">Site Code</div>
                <div className="app-selection-value font-medium">{selectedSite.code}</div>
              </div>
              <div>
                <div className="app-selection-label">Name</div>
                <div className="app-selection-value">{selectedSite.name}</div>
              </div>
                <div>
                <div className="app-selection-label">Sync Status</div>
                <StatusBadge value={selectedSite.syncPosture} />
              </div>
              <div>
                <div className="app-selection-label">Last Sync Completed</div>
                <div className="app-selection-value">{formatTimestampWithAge(selectedSite.lastSyncCompletedAt)}</div>
              </div>
              <div className="pt-1">
                <Link
                  href={`/sites/${selectedSite.id}`}
                  className="app-pill-action inline-flex"
                >
                  Open Detail
                </Link>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-fgMuted">
              Select a site row to inspect sync status and open detail.
            </p>
          )}
        </aside>
      </section>
    </div>
  );
}
