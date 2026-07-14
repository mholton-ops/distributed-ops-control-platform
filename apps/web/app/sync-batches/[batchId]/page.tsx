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

type SyncBatchDetailsResponse = {
  data: {
    batch: {
      id: string;
      siteId: string;
      status: string;
      startedAt: string;
      completedAt: string | null;
      queuedEventCount: number;
      acceptedEventCount: number;
      rejectedEventCount: number;
      deduplicatedEventCount: number;
      replayResultSummary: string | null;
    };
    site: { id: string; code: string; name: string } | null;
    replayedEvents: Array<{
      id: string;
      sequence_number: number;
      event_type: string;
      asset_id: string | null;
      site_id: string;
      occurred_at: string;
      ingested_at: string;
      source_site_event_id: string | null;
      payload: Record<string, unknown>;
    }>;
    eventAttempts: Array<{
      id: string;
      event_index: number;
      source_site_event_id: string;
      event_hash: string;
      disposition: string;
      event_id: string | null;
      error_code: string | null;
      error_message: string | null;
      attempted_at: string;
      sequence_number: number | string | null;
      event_type: string | null;
      asset_id: string | null;
    }>;
    replayDiagnostics: {
      idempotencyModel: string;
      deduplicatedEventCount: number;
      rejectionReasons: string[];
    };
    affectedAssets: string[];
    affectedEventTypes: string[];
  };
};

export default async function SyncBatchDetailPage({
  params
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  let details: SyncBatchDetailsResponse;

  try {
    details = await fetchJson<SyncBatchDetailsResponse>(`/sync-batches/${batchId}`);
  } catch (error) {
    if (isApiNotFound(error)) {
      notFound();
    }
    throw error;
  }

  const batch = details.data.batch;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="mb-1 text-lg font-semibold">Sync Batch Detail</h2>
        <p className="mb-3 text-xs text-fgMuted">
          Replay batch execution details, ingestion outcomes, and idempotency handling context.
        </p>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Batch ID</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-xs">{shortId(batch.id, 14)}</span>
              <CopyValue value={batch.id} label="sync batch id" />
            </div>
            <div className="mt-2">
              <StatusBadge value={batch.status} />
            </div>
          </div>
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Source Site</div>
            <div className="flex items-center gap-2">
              <Link href={`/sites/${batch.siteId}`} className="font-medium text-fg">
                {details.data.site?.code ?? shortId(batch.siteId, 8)}
              </Link>
            </div>
            <div className="text-xs text-fgMuted">{details.data.site?.name ?? batch.siteId}</div>
          </div>
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Started</div>
            <div>{formatTimestampWithAge(batch.startedAt)}</div>
            <div className="mt-2 text-xs text-fgMuted">Completed</div>
            <div>{formatTimestampWithAge(batch.completedAt, "In Progress")}</div>
          </div>
          <div className="rounded border border-line bg-panelMuted p-3">
            <div className="text-xs text-fgMuted">Replay Counts</div>
            <div className="text-sm">Queued {batch.queuedEventCount}</div>
            <div className="text-sm">Accepted (including deduplicated) {batch.acceptedEventCount}</div>
            <div className="text-sm">Rejected {batch.rejectedEventCount}</div>
            <div className="text-sm">Deduplicated subset {details.data.replayDiagnostics.deduplicatedEventCount}</div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Replay Diagnostics</h3>
        <p className="text-sm text-fgMuted">{details.data.replayDiagnostics.idempotencyModel}</p>
        <div className="mt-2 text-xs text-fgMuted">
          Affected assets {details.data.affectedAssets.length} | event types{" "}
          {details.data.affectedEventTypes.length}
        </div>
        {details.data.affectedAssets.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {details.data.affectedAssets.map((assetId) => (
              <Link
                key={assetId}
                href={`/assets/${assetId}`}
                className="rounded border border-line px-2 py-0.5 font-mono text-xs text-fg"
                title={assetId}
              >
                {shortId(assetId, 10)}
              </Link>
            ))}
          </div>
        ) : null}
        {details.data.replayDiagnostics.rejectionReasons.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-fgMuted">
            {details.data.replayDiagnostics.rejectionReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-fgMuted">No replay rejections were recorded for this batch.</p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Replay Event Dispositions</h3>
        <p className="mb-3 text-xs text-fgMuted">
          One durable outcome per submitted queue position, including exact deduplication and rejection details.
        </p>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Index</th>
                <th>Disposition</th>
                <th>Event</th>
                <th>Asset</th>
                <th>Source Event ID</th>
                <th>Event Hash</th>
                <th>Ledger Link</th>
                <th>Attempted</th>
                <th>Failure</th>
              </tr>
            </thead>
            <tbody>
              {details.data.eventAttempts.map((attempt) => (
                <tr key={attempt.id}>
                  <td>{attempt.event_index}</td>
                  <td><StatusBadge value={attempt.disposition} /></td>
                  <td>{attempt.event_type ? formatCodeLabel(attempt.event_type) : "-"}</td>
                  <td className="font-mono text-xs" title={attempt.asset_id ?? undefined}>
                    {attempt.asset_id ? (
                      <Link href={`/assets/${attempt.asset_id}`} className="text-fg">
                        {shortId(attempt.asset_id, 10)}
                      </Link>
                    ) : "-"}
                  </td>
                  <td className="max-w-64 break-all font-mono text-xs">{attempt.source_site_event_id}</td>
                  <td className="font-mono text-xs" title={attempt.event_hash}>
                    {shortId(attempt.event_hash, 12)}
                  </td>
                  <td className="font-mono text-xs" title={attempt.event_id ?? undefined}>
                    {attempt.event_id ? `#${attempt.sequence_number ?? "?"} ${shortId(attempt.event_id, 8)}` : "-"}
                  </td>
                  <td>{formatTimestampWithAge(attempt.attempted_at)}</td>
                  <td>
                    {attempt.error_code ? (
                      <span title={attempt.error_message ?? undefined}>
                        {formatCodeLabel(attempt.error_code)}{attempt.error_message ? `: ${attempt.error_message}` : ""}
                      </span>
                    ) : "-"}
                  </td>
                </tr>
              ))}
              {details.data.eventAttempts.length === 0 ? (
                <tr><td colSpan={9} className="text-fgMuted">No queued event attempts were recorded.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h3 className="mb-2 text-base font-semibold">Batch Ledger Events</h3>
        <p className="mb-3 text-xs text-fgMuted">
          Newly appended operating events and server-owned sync lifecycle events. Deduplicated and rejected queue items remain visible in the disposition table above.
        </p>
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
                <th>Payload Summary</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {details.data.replayedEvents.map((event) => (
                <tr key={event.id}>
                  <td>{event.sequence_number}</td>
                  <td>{formatCodeLabel(event.event_type)}</td>
                  <td className="font-mono text-xs" title={event.asset_id ?? undefined}>
                    {event.asset_id ? (
                      <Link href={`/assets/${event.asset_id}`} className="text-fg">
                        {shortId(event.asset_id, 10)}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{formatTimestampWithAge(event.occurred_at)}</td>
                  <td>{formatTimestampWithAge(event.ingested_at)}</td>
                  <td className="font-mono text-xs">{event.source_site_event_id ?? "-"}</td>
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
    </div>
  );
}
