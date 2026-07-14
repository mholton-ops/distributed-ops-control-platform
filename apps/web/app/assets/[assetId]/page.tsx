import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchJson, isApiNotFound } from "../../../lib/api";
import { CopyValue } from "../../../components/copy-value";
import { EventInspector } from "../../../components/event-inspector";
import { StatusBadge } from "../../../components/status-badge";
import {
  formatCodeLabel,
  formatTimestampWithAge,
  shortId,
  summarizeEventPayload
} from "../../../lib/format";

type AssetDetailsResponse = {
  data: {
    projection: {
      assetId: string;
      serialNumber: string;
      currentSiteId: string | null;
      status: string;
      lastEventType: string;
      lastEventAt: string;
      lastSequence: number;
      version: number;
    };
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
    };
    timeline: Array<{
      id: string;
      sequence_number: number;
      event_type: string;
      site_id: string;
      transfer_order_id: string | null;
      sync_batch_id: string | null;
      source_site_event_id: string | null;
      occurred_at: string;
      ingested_at: string;
      payload: Record<string, unknown>;
    }>;
    divergenceReasons: Array<{
      id: string;
      rule_code: string;
      severity: string;
      status: string;
      summary: string;
      detected_at: string;
    }>;
    inspections: Array<{
      id: string;
      status: string;
      notes: string;
      inspected_at: string;
      evidence_count: number;
    }>;
    evidenceMetadata: Array<{
      id: string;
      inspection_id: string;
      mime_type: string;
      sha256: string;
      storage_ref: string;
      recorded_at: string;
    }>;
    relatedTransfers: Array<{
      id: string;
      status: string;
      originSiteId: string;
      destinationSiteId: string;
      initiatedAt: string;
      completedAt: string | null;
    }>;
    relatedCases: Array<{
      id: string;
      status: string;
      title: string;
      openedAt: string;
      resolvedAt: string | null;
    }>;
    relatedSyncBatches: Array<{
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

export default async function AssetPage({
  params
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  let asset: AssetDetailsResponse;

  try {
    asset = await fetchJson<AssetDetailsResponse>(`/assets/${assetId}`);
  } catch (error) {
    if (isApiNotFound(error)) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="mb-3 text-lg font-semibold">Asset Projection</h2>
        <p className="mb-3 text-xs text-fgMuted">
          Current projection and accepted stream position for this asset.
        </p>
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <div className="text-xs uppercase text-fgMuted">Asset ID</div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{asset.data.projection.assetId}</span>
              <CopyValue value={asset.data.projection.assetId} label="asset id" />
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-fgMuted">Serial Number</div>
            <div>{asset.data.projection.serialNumber}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-fgMuted">Current Site</div>
            <div
              className="font-mono text-sm"
              title={asset.data.projection.currentSiteId ?? undefined}
            >
              {shortId(asset.data.projection.currentSiteId, 12)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-fgMuted">Status</div>
            <StatusBadge value={asset.data.projection.status} />
          </div>
          <div>
            <div className="text-xs uppercase text-fgMuted">Last Event</div>
            <div>{formatCodeLabel(asset.data.projection.lastEventType)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-fgMuted">Last Updated</div>
            <div>{formatTimestampWithAge(asset.data.projection.lastEventAt)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-fgMuted">Projection Sequence</div>
            <div className="font-mono text-sm">{asset.data.projectionState.lastProjectionSequence}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-fgMuted">Last Accepted Event Sequence</div>
            <div className="font-mono text-sm">{asset.data.projectionState.lastAcceptedEventSequence}</div>
          </div>
        </div>
        <div className="mt-3 rounded border border-line bg-panelMuted p-3">
          <div className="text-xs text-fgMuted">Projection Stream Consistency</div>
          {asset.data.projectionState.projectionBehindStream ? (
            <>
              <div className="text-sm text-critical">
                Projection is behind stream by {asset.data.projectionState.projectionLag} event(s).
              </div>
              <div className="mt-1 text-sm text-fgMuted">{asset.data.projectionState.lagReason}</div>
              {asset.data.projectionState.lagTriggeredBy ? (
                <div className="mt-1 text-xs text-fgMuted">
                  Triggered by alert: {asset.data.projectionState.lagTriggeredBy}
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-sm text-success">Projection is aligned with accepted event stream.</div>
          )}
          <div className="mt-2 text-xs text-fgMuted">
            Sequence gap means accepted events are ahead of the projection reducer position.
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-3 text-base font-semibold">Divergence Signals</h3>
        {asset.data.divergenceReasons.length > 0 ? (
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
                {asset.data.divergenceReasons.map((alert) => (
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
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-fgMuted">No active divergence alerts are linked to this asset.</p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-3 text-base font-semibold">Accepted Event Timeline</h3>
        <p className="mb-3 text-xs text-fgMuted">
          Use <span className="font-medium">Inspect</span> on any row to view normalized payload fields.
        </p>
        <div className="overflow-x-auto">
          <table>
          <thead>
              <tr>
                <th>Sequence</th>
                <th>Event Type</th>
                <th>Source Site</th>
                <th>Occurred</th>
                <th>Accepted</th>
                <th>Source Event ID</th>
                <th>Sync Batch</th>
                <th>Payload Summary</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody>
            {asset.data.timeline.map((event) => (
              <tr key={event.id}>
                <td>{event.sequence_number}</td>
                <td>{formatCodeLabel(event.event_type)}</td>
                <td className="font-mono text-xs" title={event.site_id}>
                  {shortId(event.site_id, 10)}
                </td>
                <td>{formatTimestampWithAge(event.occurred_at)}</td>
                <td>{formatTimestampWithAge(event.ingested_at)}</td>
                <td className="font-mono text-xs" title={event.source_site_event_id ?? undefined}>
                  {shortId(event.source_site_event_id, 14)}
                </td>
                <td className="font-mono text-xs" title={event.sync_batch_id ?? undefined}>
                  {shortId(event.sync_batch_id, 10)}
                </td>
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
        <h3 className="mb-2 text-base font-semibold">Linked Transfers</h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Transfer</th>
                <th>Status</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Initiated</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {asset.data.relatedTransfers.map((transfer) => (
                <tr key={transfer.id}>
                  <td className="font-mono text-xs" title={transfer.id}>
                    <Link href={`/transfers/${transfer.id}`} className="text-fg">
                      {shortId(transfer.id, 10)}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge value={transfer.status} />
                  </td>
                  <td className="font-mono text-xs" title={transfer.originSiteId}>
                    {shortId(transfer.originSiteId, 10)}
                  </td>
                  <td className="font-mono text-xs" title={transfer.destinationSiteId}>
                    {shortId(transfer.destinationSiteId, 10)}
                  </td>
                  <td>{formatTimestampWithAge(transfer.initiatedAt)}</td>
                  <td>{formatTimestampWithAge(transfer.completedAt, "Pending")}</td>
                </tr>
              ))}
              {asset.data.relatedTransfers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-sm text-fgMuted">
                    No transfer orders are linked to this asset.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Linked Reconciliation Cases</h3>
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
              {asset.data.relatedCases.map((record) => (
                <tr key={record.id}>
                  <td className="font-mono text-xs" title={record.id}>
                    <Link href={`/reconciliation/${record.id}`} className="text-fg">
                      {shortId(record.id, 10)}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge value={record.status} />
                  </td>
                  <td>{record.title}</td>
                  <td>{formatTimestampWithAge(record.openedAt)}</td>
                  <td>{formatTimestampWithAge(record.resolvedAt, "Open")}</td>
                </tr>
              ))}
              {asset.data.relatedCases.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-sm text-fgMuted">
                    No reconciliation cases are linked to this asset.
                  </td>
                </tr>
              ) : null}
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
                <th>Queued</th>
                <th>Accepted</th>
                <th>Rejected</th>
              </tr>
            </thead>
            <tbody>
              {asset.data.relatedSyncBatches.map((batch) => (
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
                  <td>{batch.queuedEventCount}</td>
                  <td>{batch.acceptedEventCount}</td>
                  <td>{batch.rejectedEventCount}</td>
                </tr>
              ))}
              {asset.data.relatedSyncBatches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-sm text-fgMuted">
                    No sync batches are linked to this asset.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-3 text-base font-semibold">Inspections</h3>
        <div className="overflow-x-auto">
          <table>
          <thead>
            <tr>
              <th>Inspection</th>
              <th>Status</th>
              <th>Evidence Count</th>
              <th>Recorded At</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {asset.data.inspections.map((inspection) => (
              <tr key={inspection.id}>
                <td className="font-mono text-xs" title={inspection.id}>
                  {shortId(inspection.id, 10)}
                </td>
                <td>
                  <StatusBadge value={inspection.status} />
                </td>
                <td>{inspection.evidence_count}</td>
                <td>{formatTimestampWithAge(inspection.inspected_at)}</td>
                <td>{inspection.notes}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-3 text-base font-semibold">Evidence Metadata</h3>
        <div className="overflow-x-auto">
          <table>
          <thead>
            <tr>
              <th>Evidence</th>
              <th>Inspection</th>
              <th>MIME Type</th>
              <th>SHA256</th>
              <th>Recorded At</th>
            </tr>
          </thead>
          <tbody>
            {asset.data.evidenceMetadata.map((evidence) => (
              <tr key={evidence.id}>
                <td className="font-mono text-xs" title={evidence.id}>
                  {shortId(evidence.id, 10)}
                </td>
                <td className="font-mono text-xs" title={evidence.inspection_id}>
                  {shortId(evidence.inspection_id, 10)}
                </td>
                <td>{evidence.mime_type}</td>
                <td className="font-mono text-xs" title={evidence.sha256}>
                  {shortId(evidence.sha256, 20)}
                </td>
                <td>{formatTimestampWithAge(evidence.recorded_at)}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Linked Views</h3>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/transfers" className="rounded border border-line px-3 py-1 text-fg">View Transfers</Link>
          <Link href="/reconciliation" className="rounded border border-line px-3 py-1 text-fg">View Reconciliation</Link>
        </div>
      </section>
    </div>
  );
}
