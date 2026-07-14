import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyValue } from "../../../components/copy-value";
import { EventInspector } from "../../../components/event-inspector";
import { ReconciliationActions } from "../../../components/reconciliation-actions";
import { StatusBadge } from "../../../components/status-badge";
import { fetchJson, isApiNotFound } from "../../../lib/api";
import {
  formatCodeLabel,
  formatTimestampWithAge,
  shortId,
  summarizeEventPayload
} from "../../../lib/format";

type CaseDetailsResponse = {
  data: {
    case: {
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
      version: number;
    };
    sourceAlert: {
      id: string;
      ruleCode: string;
      severity: string;
      status: string;
      summary: string;
      details: Record<string, unknown>;
      detectedAt: string;
    } | null;
    projection: {
      assetId: string;
      status: string;
      currentSiteId: string | null;
      lastEventType: string;
      lastEventAt: string;
      lastSequence: number;
      version: number;
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
    linkedTransferId: string | null;
    linkedSyncBatches: Array<{
      id: string;
      siteId: string;
      status: string;
      startedAt: string;
      completedAt: string | null;
      acceptedEventCount: number;
      rejectedEventCount: number;
    }>;
    operatorNoteHistory: Array<{
      type: "opened" | "resolved";
      recordedBy: string;
      recordedAt: string;
      note: string;
    }>;
    resolutionEvent: {
      id: string;
      sequence_number: number;
      event_type: string;
      site_id: string;
      occurred_at: string;
      ingested_at: string;
    } | null;
    relatedEvents: Array<{
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
  };
};

export default async function ReconciliationCaseDetailPage({
  params
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  let details: CaseDetailsResponse;

  try {
    details = await fetchJson<CaseDetailsResponse>(`/reconciliation-cases/${caseId}`);
  } catch (error) {
    if (isApiNotFound(error)) {
      notFound();
    }
    throw error;
  }

  const record = details.data.case;

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="text-sm text-fgMuted">
        <Link href="/reconciliation">Reconciliation</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Case {shortId(record.id, 10)}</span>
      </nav>
      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="mb-1 text-lg font-semibold">Reconciliation Case Detail</h2>
        <p className="mb-3 text-xs text-fgMuted">
          Case context, source signal, linked state, and event chain for operator resolution.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Case ID</div>
            <div className="mt-1 flex items-center gap-2">
              <div className="font-mono text-sm">{shortId(record.id, 14)}</div>
              <CopyValue value={record.id} label="case id" />
            </div>
            <div className="mt-2">
              <StatusBadge value={record.status} />
            </div>
          </div>
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Opened</div>
            <div>{formatTimestampWithAge(record.openedAt)}</div>
            <div className="mt-2 text-xs text-fgMuted">By {record.openedBy}</div>
            {record.resolvedAt ? (
              <div className="mt-2 text-xs text-fgMuted">
                Resolved {formatTimestampWithAge(record.resolvedAt)} by {record.resolvedBy}
              </div>
            ) : null}
          </div>
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Linked Asset</div>
            {record.assetId ? (
              <Link href={`/assets/${record.assetId}`} className="font-mono text-xs text-fg">
                {shortId(record.assetId, 12)}
              </Link>
            ) : (
              <span className="text-sm text-fgMuted">None</span>
            )}
            <div className="mt-2 text-xs text-fgMuted">Linked Transfer</div>
            {details.data.linkedTransferId ? (
              <Link
                href={`/transfers/${details.data.linkedTransferId}`}
                className="font-mono text-xs text-fg"
              >
                {shortId(details.data.linkedTransferId, 12)}
              </Link>
            ) : (
              <span className="text-sm text-fgMuted">None</span>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Case Summary</h3>
        <p className="text-sm">
          <span className="font-medium">Title:</span> {record.title}
        </p>
        <p className="mt-2 text-sm">
          <span className="font-medium">Why Opened:</span> {record.description}
        </p>
        {record.resolutionSummary ? (
          <p className="mt-2 text-sm">
            <span className="font-medium">Resolution:</span> {record.resolutionSummary}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Source Alert</h3>
        {details.data.sourceAlert ? (
          <div className="grid gap-2 md:grid-cols-4">
            <div>
              <div className="text-xs text-fgMuted">Rule</div>
              <div>{formatCodeLabel(details.data.sourceAlert.ruleCode)}</div>
            </div>
            <div>
              <div className="text-xs text-fgMuted">Severity</div>
              <StatusBadge value={details.data.sourceAlert.severity} />
            </div>
            <div>
              <div className="text-xs text-fgMuted">Status</div>
              <StatusBadge value={details.data.sourceAlert.status} />
            </div>
            <div>
              <div className="text-xs text-fgMuted">Detected</div>
              <div>{formatTimestampWithAge(details.data.sourceAlert.detectedAt)}</div>
            </div>
            <div className="md:col-span-4">
              <div className="text-xs text-fgMuted">Summary</div>
              <div>{details.data.sourceAlert.summary}</div>
            </div>
            {Object.entries(details.data.sourceAlert.details)
              .filter(([, value]) =>
                typeof value === "string" || typeof value === "number" || typeof value === "boolean"
              )
              .slice(0, 8)
              .map(([key, value]) => (
                <div key={key}>
                  <div className="text-xs text-fgMuted">{formatCodeLabel(key)}</div>
                  <div className="break-words text-sm">{String(value)}</div>
                </div>
              ))}
            <div className="md:col-span-4">
              <div className="text-xs text-fgMuted">Alert Link</div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/reconciliation?q=${encodeURIComponent(details.data.sourceAlert.id)}`}
                  className="font-mono text-xs text-fg"
                >
                  {shortId(details.data.sourceAlert.id, 10)}
                </Link>
                <CopyValue value={details.data.sourceAlert.id} label="alert id" />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-fgMuted">No source alert is linked to this case.</p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Projection State</h3>
        {details.data.projection ? (
          <>
            <div className="grid gap-2 md:grid-cols-4">
              <div>
                <div className="text-xs text-fgMuted">Status</div>
                <StatusBadge value={details.data.projection.status} />
              </div>
              <div>
                <div className="text-xs text-fgMuted">Current Site</div>
                <div className="font-mono text-xs">{shortId(details.data.projection.currentSiteId, 10)}</div>
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
          <p className="text-sm text-fgMuted">No asset projection is linked to this case.</p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Operator Notes</h3>
        <div className="space-y-2">
          {details.data.operatorNoteHistory.map((note, index) => (
            <div key={`${note.type}-${String(index)}`} className="rounded border border-line bg-panelMuted p-2">
              <div className="text-xs text-fgMuted">
                {formatCodeLabel(note.type)} by {note.recordedBy} at {formatTimestampWithAge(note.recordedAt)}
              </div>
              <div className="text-sm">{note.note}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Resolution Event</h3>
        {details.data.resolutionEvent ? (
          <div className="grid gap-2 md:grid-cols-5">
            <div>
              <div className="text-xs text-fgMuted">Sequence</div>
              <div>{details.data.resolutionEvent.sequence_number}</div>
            </div>
            <div>
              <div className="text-xs text-fgMuted">Event Type</div>
              <div>{formatCodeLabel(details.data.resolutionEvent.event_type)}</div>
            </div>
            <div>
              <div className="text-xs text-fgMuted">Occurred</div>
              <div>{formatTimestampWithAge(details.data.resolutionEvent.occurred_at)}</div>
            </div>
            <div>
              <div className="text-xs text-fgMuted">Accepted</div>
              <div>{formatTimestampWithAge(details.data.resolutionEvent.ingested_at)}</div>
            </div>
            <div>
              <div className="text-xs text-fgMuted">Projection Outcome</div>
              {details.data.projectionState?.projectionBehindStream ? (
                <div className="text-critical">Lag still present</div>
              ) : (
                <div className="text-success">Projection aligned</div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-fgMuted">No resolution event has been written for this case.</p>
        )}
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
                    No sync batches are linked to this case.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Related Event Chain</h3>
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
                <th>Transfer</th>
                <th>Batch</th>
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
                  <td className="font-mono text-xs">{shortId(event.transfer_order_id, 10)}</td>
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

      {record.status === "open" ? (
        <section className="rounded-lg border border-line bg-panel p-4">
          <h3 className="app-section-title">Resolve after evidence review</h3>
          <p className="app-section-subtitle mb-4">
            Resolution is test-only and writes an auditable closing event. Verify the evidence shown
            above before confirming.
          </p>
          <ReconciliationActions
            caseId={record.id}
            expectedVersion={record.version}
            hasAsset={Boolean(record.assetId)}
          />
        </section>
      ) : null}
    </div>
  );
}
