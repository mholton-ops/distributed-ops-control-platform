import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyValue } from "../../../components/copy-value";
import { EventInspector } from "../../../components/event-inspector";
import { StatusBadge } from "../../../components/status-badge";
import { fetchJson, isApiNotFound } from "../../../lib/api";
import {
  formatCodeLabel,
  formatTimestampWithAge,
  shortId,
  summarizeEventPayload
} from "../../../lib/format";

type TransferDetailsResponse = {
  data: {
    transfer: {
      id: string;
      assetId: string;
      originSiteId: string;
      destinationSiteId: string;
      status: string;
      initiatedBy: string;
      initiatedAt: string;
      completedAt: string | null;
      completionNote: string | null;
    };
    overdue: boolean;
    originSite: { id: string; code: string; name: string } | null;
    destinationSite: { id: string; code: string; name: string } | null;
    projection: {
      assetId: string;
      status: string;
      currentSiteId: string | null;
      lastEventType: string;
      lastEventAt: string;
      lastSequence: number;
    } | null;
    projectionState: {
      currentStatus: string;
      lastProjectionSequence: number;
      lastAcceptedEventSequence: number;
      projectionBehindStream: boolean;
      projectionLag: number;
      hasPendingReplay: boolean;
      hasRejectedReplay: boolean;
      hasStaleSite: boolean;
      lagReason: string;
      lagTriggeredBy: string | null;
    } | null;
    relatedEvents: Array<{
      id: string;
      sequence_number: number;
      event_type: string;
      site_id: string;
      sync_batch_id: string | null;
      source_site_event_id: string | null;
      occurred_at: string;
      ingested_at: string;
      payload: Record<string, unknown>;
    }>;
    relatedAlerts: Array<{
      id: string;
      rule_code: string;
      severity: string;
      status: string;
      summary: string;
      detected_at: string;
    }>;
    relatedCases: Array<{
      id: string;
      status: string;
      title: string;
      opened_at: string;
      resolved_at: string | null;
    }>;
    linkedSyncBatches: Array<{
      id: string;
      siteId: string;
      status: string;
      startedAt: string;
      completedAt: string | null;
      queuedEventCount: number;
      acceptedEventCount: number;
      rejectedEventCount: number;
    }>;
  };
};

export default async function TransferDetailPage({
  params
}: {
  params: Promise<{ transferId: string }>;
}) {
  const { transferId } = await params;
  let details: TransferDetailsResponse;

  try {
    details = await fetchJson<TransferDetailsResponse>(`/transfers/${transferId}`);
  } catch (error) {
    if (isApiNotFound(error)) {
      notFound();
    }
    throw error;
  }

  const transfer = details.data.transfer;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="mb-1 text-lg font-semibold">Transfer Detail</h2>
        <p className="mb-3 text-xs text-fgMuted">
          Lifecycle state, linked events, and exception signals for one transfer order.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Transfer ID</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-sm">{shortId(transfer.id, 14)}</span>
              <CopyValue value={transfer.id} label="transfer id" />
            </div>
            <div className="mt-2">
              <StatusBadge value={transfer.status} />
              {details.data.overdue ? <span className="ml-2 text-xs text-critical">Overdue</span> : null}
            </div>
          </div>
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Origin</div>
            <div className="font-medium">{details.data.originSite?.code ?? shortId(transfer.originSiteId, 8)}</div>
            <div className="text-xs text-fgMuted">{details.data.originSite?.name ?? transfer.originSiteId}</div>
            <div className="mt-2 text-xs text-fgMuted">Destination</div>
            <div className="font-medium">
              {details.data.destinationSite?.code ?? shortId(transfer.destinationSiteId, 8)}
            </div>
            <div className="text-xs text-fgMuted">
              {details.data.destinationSite?.name ?? transfer.destinationSiteId}
            </div>
          </div>
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Lifecycle</div>
            <div className="text-sm">Initiated {formatTimestampWithAge(transfer.initiatedAt)}</div>
            <div className="text-sm">Completed {formatTimestampWithAge(transfer.completedAt, "Pending")}</div>
            <div className="mt-2 text-xs text-fgMuted">Initiated by {transfer.initiatedBy}</div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Linked Asset Projection</h3>
        {details.data.projection ? (
          <>
            <div className="grid gap-2 md:grid-cols-4">
              <div>
                <div className="text-xs text-fgMuted">Asset</div>
                <Link className="font-mono text-xs text-fg" href={`/assets/${details.data.projection.assetId}`}>
                  {shortId(details.data.projection.assetId, 12)}
                </Link>
              </div>
              <div>
                <div className="text-xs text-fgMuted">Status</div>
                <StatusBadge value={details.data.projection.status} />
              </div>
              <div>
                <div className="text-xs text-fgMuted">Last Event</div>
                <div>{formatCodeLabel(details.data.projection.lastEventType)}</div>
              </div>
              <div>
                <div className="text-xs text-fgMuted">Last Updated</div>
                <div>{formatTimestampWithAge(details.data.projection.lastEventAt)}</div>
              </div>
            </div>
            {details.data.projectionState ? (
              <div className="mt-3 rounded border border-line bg-panelMuted p-3">
                <div className="text-xs text-fgMuted">Projection Stream Consistency</div>
                <div className="text-sm">
                  Projection sequence {details.data.projectionState.lastProjectionSequence} / accepted
                  sequence {details.data.projectionState.lastAcceptedEventSequence}
                </div>
                {details.data.projectionState.projectionBehindStream ? (
                  <>
                    <div className="text-sm text-critical">
                      Projection lag detected ({details.data.projectionState.projectionLag} event(s)).
                    </div>
                    <div className="mt-1 text-sm text-fgMuted">{details.data.projectionState.lagReason}</div>
                    {details.data.projectionState.lagTriggeredBy ? (
                      <div className="mt-1 text-xs text-fgMuted">
                        Triggered by alert: {details.data.projectionState.lagTriggeredBy}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="text-sm text-success">Projection is aligned with accepted stream.</div>
                )}
                <div className="mt-2 text-xs text-fgMuted">
                  Sequence gap indicates accepted events are ahead of projected state.
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-fgMuted">No projection record was found for this transfer's asset.</p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Related Alerts</h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Rule</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Summary</th>
                <th>Detected</th>
              </tr>
            </thead>
            <tbody>
              {details.data.relatedAlerts.map((alert) => (
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
                  <td>{formatTimestampWithAge(alert.detected_at)}</td>
                </tr>
              ))}
              {details.data.relatedAlerts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-sm text-fgMuted">
                    No alerts are currently linked to this transfer.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Related Reconciliation Cases</h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Status</th>
                <th>Title</th>
                <th>Opened</th>
                <th>Resolved</th>
              </tr>
            </thead>
            <tbody>
              {details.data.relatedCases.map((record) => (
                <tr key={record.id}>
                  <td className="font-mono text-xs">
                    <Link href={`/reconciliation/${record.id}`} className="text-fg">
                      {shortId(record.id, 10)}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge value={record.status} />
                  </td>
                  <td>{record.title}</td>
                  <td>{formatTimestampWithAge(record.opened_at)}</td>
                  <td>{formatTimestampWithAge(record.resolved_at, "Open")}</td>
                </tr>
              ))}
              {details.data.relatedCases.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-sm text-fgMuted">
                    No reconciliation cases are linked to this transfer.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Transfer Event Timeline</h3>
        <p className="mb-3 text-xs text-fgMuted">
          Use <span className="font-medium">Inspect</span> on any row to view normalized payload fields.
        </p>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Sequence</th>
                <th>Event</th>
                <th>Site</th>
                <th>Occurred</th>
                <th>Accepted</th>
                <th>Source Event ID</th>
                <th>Sync Batch</th>
                <th>Payload Summary</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {details.data.relatedEvents.map((event) => (
                <tr key={event.id}>
                  <td>{event.sequence_number}</td>
                  <td>{formatCodeLabel(event.event_type)}</td>
                  <td className="font-mono text-xs">{shortId(event.site_id, 10)}</td>
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
                      siteId={event.site_id}
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

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Linked Sync Batches</h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Status</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Accepted</th>
                <th>Rejected</th>
              </tr>
            </thead>
            <tbody>
              {details.data.linkedSyncBatches.map((batch) => (
                <tr key={batch.id}>
                  <td className="font-mono text-xs" title={batch.id}>
                    <Link href={`/sync-batches/${batch.id}`} className="text-fg">
                      {shortId(batch.id, 10)}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge value={batch.status} />
                  </td>
                  <td>{formatTimestampWithAge(batch.startedAt)}</td>
                  <td>{formatTimestampWithAge(batch.completedAt, "In Progress")}</td>
                  <td>{batch.acceptedEventCount}</td>
                  <td>{batch.rejectedEventCount}</td>
                </tr>
              ))}
              {details.data.linkedSyncBatches.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-sm text-fgMuted">
                    No sync batches are linked to this transfer.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
