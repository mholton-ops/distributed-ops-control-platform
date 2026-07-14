import Link from "next/link";
import { notFound } from "next/navigation";
import { EventInspector } from "../../../components/event-inspector";
import { StatusBadge } from "../../../components/status-badge";
import { fetchJson, isApiNotFound } from "../../../lib/api";
import {
  formatCodeLabel,
  formatTimestampWithAge,
  shortId,
  summarizeEventPayload
} from "../../../lib/format";

type SiteDetailsResponse = {
  data: {
    site: {
      id: string;
      code: string;
      name: string;
      lastSyncCompletedAt: string | null;
      syncHealth: "healthy" | "stale";
      syncPosture: "healthy" | "stale" | "degraded";
    };
    staleThresholdMinutes: number;
    recentSyncBatches: Array<{
      id: string;
      status: string;
      startedAt: string;
      completedAt: string | null;
      queuedEventCount: number;
      acceptedEventCount: number;
      rejectedEventCount: number;
    }>;
    projectedAssets: Array<{
      asset_id: string;
      serial_number: string;
      status: string;
      last_event_type: string;
      last_event_at: string;
      last_sequence: number;
    }>;
    recentAlerts: Array<{
      id: string;
      rule_code: string;
      severity: string;
      status: string;
      summary: string;
      detected_at: string;
      last_detected_at: string;
    }>;
    recentEvents: Array<{
      id: string;
      sequence_number: number;
      event_type: string;
      asset_id: string | null;
      sync_batch_id: string | null;
      occurred_at: string;
      ingested_at: string;
      source_site_event_id: string | null;
      payload: Record<string, unknown>;
    }>;
  };
};

export default async function SiteDetailPage({
  params
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  let details: SiteDetailsResponse;

  try {
    details = await fetchJson<SiteDetailsResponse>(`/sites/${siteId}`);
  } catch (error) {
    if (isApiNotFound(error)) {
      notFound();
    }
    throw error;
  }

  const site = details.data.site;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="mb-1 text-lg font-semibold">Site Detail</h2>
        <p className="mb-3 text-xs text-fgMuted">
          Sync status, local projected assets, and site-linked divergence activity.
        </p>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Site</div>
            <div className="font-medium">{site.code}</div>
            <div className="text-xs text-fgMuted">{site.name}</div>
          </div>
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Sync Status</div>
            <div className="mt-1">
              <StatusBadge value={site.syncPosture} />
            </div>
            <div className="mt-2 text-xs text-fgMuted">
              Stale threshold {details.data.staleThresholdMinutes} minutes
            </div>
          </div>
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Last Successful Sync</div>
            <div>{formatTimestampWithAge(site.lastSyncCompletedAt)}</div>
          </div>
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Current Projection Footprint</div>
            <div className="text-lg font-semibold">{details.data.projectedAssets.length}</div>
            <div className="text-xs text-fgMuted">assets at site</div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Recent Sync Batches</h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Status</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Queued</th>
                <th>Accepted</th>
                <th>Rejected</th>
              </tr>
            </thead>
            <tbody>
              {details.data.recentSyncBatches.map((batch) => (
                <tr key={batch.id}>
                  <td className="font-mono text-xs">
                    <Link href={`/sync-batches/${batch.id}`} className="text-fg">
                      {shortId(batch.id, 10)}
                    </Link>
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
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Projected Assets At Site</h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Serial</th>
                <th>Status</th>
                <th>Last Event</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {details.data.projectedAssets.map((asset) => (
                <tr key={asset.asset_id}>
                  <td className="font-mono text-xs">
                    <Link href={`/assets/${asset.asset_id}`} className="text-fg">
                      {shortId(asset.asset_id, 10)}
                    </Link>
                  </td>
                  <td>{asset.serial_number}</td>
                  <td>
                    <StatusBadge value={asset.status} />
                  </td>
                  <td>{formatCodeLabel(asset.last_event_type)}</td>
                  <td>{formatTimestampWithAge(asset.last_event_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Recent Site Alerts</h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Rule</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Summary</th>
                <th>Last Detected</th>
              </tr>
            </thead>
            <tbody>
              {details.data.recentAlerts.map((alert) => (
                <tr key={alert.id}>
                  <td className="font-mono text-xs">{shortId(alert.id, 10)}</td>
                  <td>{formatCodeLabel(alert.rule_code)}</td>
                  <td>
                    <StatusBadge value={alert.severity} />
                  </td>
                  <td>
                    <StatusBadge value={alert.status} />
                  </td>
                  <td>{alert.summary}</td>
                  <td>{formatTimestampWithAge(alert.last_detected_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Recent Accepted Events</h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Sequence</th>
                <th>Event</th>
                <th>Asset</th>
                <th>Occurred</th>
                <th>Accepted</th>
                <th>Source Event ID</th>
                <th>Sync Batch</th>
                <th>Payload Summary</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {details.data.recentEvents.map((event) => (
                <tr key={event.id}>
                  <td>{event.sequence_number}</td>
                  <td>{formatCodeLabel(event.event_type)}</td>
                  <td className="font-mono text-xs">{shortId(event.asset_id, 10)}</td>
                  <td>{formatTimestampWithAge(event.occurred_at)}</td>
                  <td>{formatTimestampWithAge(event.ingested_at)}</td>
                  <td className="font-mono text-xs" title={event.source_site_event_id ?? undefined}>
                    {shortId(event.source_site_event_id, 14)}
                  </td>
                  <td className="font-mono text-xs">{shortId(event.sync_batch_id, 10)}</td>
                  <td>{summarizeEventPayload(event.event_type, event.payload)}</td>
                  <td>
                    <EventInspector
                      eventType={event.event_type}
                      sequenceNumber={event.sequence_number}
                      siteId={site.id}
                      sourceSiteEventId={event.source_site_event_id}
                      occurredAt={event.occurred_at}
                      acceptedAt={event.ingested_at}
                      payload={event.payload}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
