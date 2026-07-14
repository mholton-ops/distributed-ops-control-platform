import { count, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { db as databaseClient } from "../db/client";
import {
  alerts,
  assetProjection,
  reconciliationCases,
  sites,
  syncBatches,
  transferOrders
} from "../db/schema";
import { env } from "../lib/env";
import { ApiError } from "../lib/errors";
import { ingestEvent } from "./event-service";

type Database = typeof databaseClient;

async function readAssetStreamPosition(
  db: Database,
  assetId: string,
  sequenceNumber: number
): Promise<{ latestAcceptedEventSequence: number; projectionLag: number }> {
  const result = await db.execute(sql`
    select
      coalesce(max(sequence_number), ${sequenceNumber}) as latest_sequence,
      count(*) filter (where sequence_number > ${sequenceNumber})::int as lag_event_count
    from event_log
    where asset_id = ${assetId}
  `);
  return {
    latestAcceptedEventSequence: Number(result.rows[0]?.latest_sequence ?? sequenceNumber),
    projectionLag: Number(result.rows[0]?.lag_event_count ?? 0)
  };
}

function computeSyncHealth(lastSyncCompletedAt: Date | null): "healthy" | "stale" {
  if (!lastSyncCompletedAt) {
    return "stale";
  }

  const ageMinutes = (Date.now() - lastSyncCompletedAt.getTime()) / (1000 * 60);
  return ageMinutes > env.SYNC_STALE_MINUTES ? "stale" : "healthy";
}

function computeSyncPosture(input: {
  lastSyncCompletedAt: Date | null;
  latestBatch:
    | {
        status: string;
        startedAt: Date;
        rejectedEventCount: number;
      }
    | null;
}): "healthy" | "stale" | "degraded" {
  const baseHealth = computeSyncHealth(input.lastSyncCompletedAt);
  if (baseHealth === "stale") {
    return "stale";
  }

  if (!input.latestBatch) {
    return "healthy";
  }

  const minutesSinceBatchStart =
    (Date.now() - input.latestBatch.startedAt.getTime()) / (1000 * 60);
  const recentlyReplayed = minutesSinceBatchStart <= env.SYNC_STALE_MINUTES;
  const hasReplayWarnings =
    input.latestBatch.status !== "completed" || input.latestBatch.rejectedEventCount > 0;

  if (recentlyReplayed && hasReplayWarnings) {
    return "degraded";
  }

  return "healthy";
}

function parseReplayDiagnostics(
  replayResultSummary: string | null,
  rejectedEventCount: number,
  deduplicatedEventCount: number
): {
  idempotencyModel: string;
  deduplicatedEventCount: number;
  rejectionReasons: string[];
} {
  const fallback = {
    idempotencyModel:
      "Replay uses source-site deduplication key (site_id, source_site_event_id). Duplicate events are accepted without duplicate side effects.",
    deduplicatedEventCount,
    rejectionReasons:
      rejectedEventCount > 0
        ? ["One or more events were rejected during replay; inspect batch event timeline for context."]
        : []
  };

  if (!replayResultSummary) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(replayResultSummary) as {
      idempotencyModel?: string;
      deduplicatedEventCount?: number;
      rejectionReasons?: string[];
    };

    return {
      idempotencyModel: parsed.idempotencyModel ?? fallback.idempotencyModel,
      deduplicatedEventCount:
        typeof parsed.deduplicatedEventCount === "number"
          ? parsed.deduplicatedEventCount
          : fallback.deduplicatedEventCount,
      rejectionReasons:
        Array.isArray(parsed.rejectionReasons) && parsed.rejectionReasons.length > 0
          ? parsed.rejectionReasons
          : fallback.rejectionReasons
    };
  } catch {
    return fallback;
  }
}

export async function listSites(db: Database): Promise<unknown[]> {
  const [rows, latestBatchRows] = await Promise.all([
    db.select().from(sites).orderBy(sites.code).limit(500),
    db.select().from(syncBatches).orderBy(desc(syncBatches.startedAt)).limit(2_000)
  ]);

  const latestBatchBySiteId = new Map<string, (typeof latestBatchRows)[number]>();
  for (const batch of latestBatchRows) {
    if (!latestBatchBySiteId.has(batch.siteId)) {
      latestBatchBySiteId.set(batch.siteId, batch);
    }
  }

  return rows.map((row) => ({
    ...row,
    syncHealth: computeSyncHealth(row.lastSyncCompletedAt),
    syncPosture: computeSyncPosture({
      lastSyncCompletedAt: row.lastSyncCompletedAt,
      latestBatch: latestBatchBySiteId.get(row.id) ?? null
    })
  }));
}

export async function listAssets(db: Database): Promise<unknown[]> {
  return db
    .select({
      assetId: assetProjection.assetId,
      serialNumber: assetProjection.serialNumber,
      currentSiteId: assetProjection.currentSiteId,
      status: assetProjection.status,
      lastEventType: assetProjection.lastEventType,
      lastEventAt: assetProjection.lastEventAt,
      lastSequence: assetProjection.lastSequence,
      version: assetProjection.version
    })
    .from(assetProjection)
    .orderBy(desc(assetProjection.lastEventAt))
    .limit(500);
}

export async function getAssetById(db: Database, assetId: string): Promise<unknown | null> {
  const [projection] = await db
    .select()
    .from(assetProjection)
    .where(eq(assetProjection.assetId, assetId))
    .limit(1);

  if (!projection) {
    return null;
  }

  const [timelineRows, inspectionsRows, evidenceRows, alertRows, transferRows, caseRows] = await Promise.all([
    db
      .execute(sql`
        select id, sequence_number, event_type, site_id, transfer_order_id, sync_batch_id, source_site_event_id, occurred_at, ingested_at, payload
        from event_log
        where asset_id = ${assetId}
        order by sequence_number desc
        limit 200
      `),
    db.execute(sql`
      select i.id, i.status, i.notes, i.inspected_at,
             count(em.id) as evidence_count
      from inspection i
      left join evidence_metadata em on em.inspection_id = i.id
      where i.asset_id = ${assetId}
      group by i.id, i.status, i.notes, i.inspected_at
      order by i.inspected_at desc
      limit 100
    `),
    db.execute(sql`
      select em.id, em.inspection_id, em.mime_type, em.sha256, em.storage_ref, em.recorded_at
      from evidence_metadata em
      join inspection i on i.id = em.inspection_id
      where i.asset_id = ${assetId}
      order by em.recorded_at desc
      limit 100
    `),
    db.execute(sql`
      select id, rule_code, severity, status, summary, details, detected_at
      from alert
      where asset_id = ${assetId}
      order by detected_at desc
      limit 20
    `),
    db
      .select()
      .from(transferOrders)
      .where(eq(transferOrders.assetId, assetId))
      .orderBy(desc(transferOrders.initiatedAt))
      .limit(20),
    db
      .select()
      .from(reconciliationCases)
      .where(eq(reconciliationCases.assetId, assetId))
      .orderBy(desc(reconciliationCases.openedAt))
      .limit(20)
  ]);

  const timeline = timelineRows.rows as Array<{
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

  const { latestAcceptedEventSequence, projectionLag } = await readAssetStreamPosition(
    db,
    assetId,
    projection.lastSequence
  );

  const siteIdsInTimeline = Array.from(new Set(timeline.map((event) => event.site_id)));
  const syncBatchIds = Array.from(
    new Set(
      timeline
        .map((event) => event.sync_batch_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );

  const [siteRows, relatedSyncBatches] = await Promise.all([
    siteIdsInTimeline.length > 0
      ? db.select().from(sites).where(inArray(sites.id, siteIdsInTimeline))
      : Promise.resolve([]),
    syncBatchIds.length > 0
      ? db.select().from(syncBatches).where(inArray(syncBatches.id, syncBatchIds))
      : Promise.resolve([])
  ]);

  const hasPendingReplay = relatedSyncBatches.some((batch) => batch.status !== "completed");
  const hasRejectedReplay = relatedSyncBatches.some((batch) => batch.rejectedEventCount > 0);
  const hasStaleSite = siteRows.some((site) => computeSyncHealth(site.lastSyncCompletedAt) === "stale");
  const projectionLagAlert = alertRows.rows.find(
    (row) => String(row.rule_code) === "PROJECTION_SEQUENCE_BEHIND_EVENT_STREAM"
  );

  const projectionLagReason =
    projectionLag > 0
      ? hasPendingReplay
        ? "Projection is behind because one or more replay batches for this asset are still in progress."
        : hasRejectedReplay
          ? "Projection is behind because one or more replayed events were rejected and require operator review."
          : hasStaleSite
            ? "Projection is behind because at least one source site is stale and has not completed sync within threshold."
            : "Projection is behind because accepted events are ahead of the current projection reducer position."
      : "Projection is aligned with the accepted event stream.";

  const projectionLagTriggerSummary =
    projectionLagAlert && typeof projectionLagAlert.summary === "string"
      ? projectionLagAlert.summary
      : null;
  const orderedRelatedSyncBatches = [...relatedSyncBatches].sort(
    (left, right) => right.startedAt.getTime() - left.startedAt.getTime()
  );

  return {
    projection,
    projectionState: {
      currentStatus: projection.status,
      lastProjectionSequence: projection.lastSequence,
      lastAcceptedEventSequence: latestAcceptedEventSequence,
      projectionBehindStream: projectionLag > 0,
      projectionLag,
      hasPendingReplay,
      hasRejectedReplay,
      hasStaleSite,
      lagReason: projectionLagReason,
      lagTriggeredBy: projectionLagTriggerSummary
    },
    timeline,
    inspections: inspectionsRows.rows,
    evidenceMetadata: evidenceRows.rows,
    divergenceReasons: alertRows.rows,
    relatedTransfers: transferRows,
    relatedCases: caseRows,
    relatedSyncBatches: orderedRelatedSyncBatches
  };
}

export async function getTransferById(db: Database, transferId: string): Promise<unknown | null> {
  const [transfer] = await db
    .select()
    .from(transferOrders)
    .where(eq(transferOrders.id, transferId))
    .limit(1);

  if (!transfer) {
    return null;
  }

  const [originSite, destinationSite, projection, eventsRows, alertRows, caseRows] =
    await Promise.all([
      db.select().from(sites).where(eq(sites.id, transfer.originSiteId)).limit(1),
      db.select().from(sites).where(eq(sites.id, transfer.destinationSiteId)).limit(1),
      db
        .select()
        .from(assetProjection)
        .where(eq(assetProjection.assetId, transfer.assetId))
        .limit(1),
      db.execute(sql`
        select id, sequence_number, event_type, site_id, sync_batch_id, source_site_event_id, occurred_at, ingested_at, payload
        from event_log
        where transfer_order_id = ${transferId}
        order by sequence_number desc
        limit 200
      `),
      db.execute(sql`
        select id, rule_code, severity, status, summary, detected_at
        from alert
        where asset_id = ${transfer.assetId}
        order by detected_at desc
        limit 20
      `),
      db.execute(sql`
        select id, status, title, opened_at, resolved_at
        from reconciliation_case
        where asset_id = ${transfer.assetId}
        order by opened_at desc
        limit 20
      `)
    ]);

  const overdue =
    transfer.status !== "completed" &&
    (Date.now() - transfer.initiatedAt.getTime()) / (1000 * 60 * 60) > env.TRANSFER_CONFIRMATION_HOURS;

  const relatedEvents = eventsRows.rows as Array<{
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

  const lastProjectionSequence = projection[0]?.lastSequence ?? 0;
  const streamPosition = projection[0]
    ? await readAssetStreamPosition(db, transfer.assetId, lastProjectionSequence)
    : { latestAcceptedEventSequence: 0, projectionLag: 0 };
  const { latestAcceptedEventSequence, projectionLag } = streamPosition;
  const relatedSyncBatchIds = Array.from(
    new Set(
      relatedEvents
        .map((event) => event.sync_batch_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
  const relatedSiteIds = Array.from(new Set(relatedEvents.map((event) => event.site_id)));
  const [linkedSyncBatches, relatedSites] = await Promise.all([
    relatedSyncBatchIds.length > 0
      ? db.select().from(syncBatches).where(inArray(syncBatches.id, relatedSyncBatchIds))
      : Promise.resolve([]),
    relatedSiteIds.length > 0
      ? db.select().from(sites).where(inArray(sites.id, relatedSiteIds))
      : Promise.resolve([])
  ]);
  const hasPendingReplay = linkedSyncBatches.some((batch) => batch.status !== "completed");
  const hasRejectedReplay = linkedSyncBatches.some((batch) => batch.rejectedEventCount > 0);
  const hasStaleSite = relatedSites.some((site) => computeSyncHealth(site.lastSyncCompletedAt) === "stale");
  const projectionLagAlert = alertRows.rows.find(
    (row) => String(row.rule_code) === "PROJECTION_SEQUENCE_BEHIND_EVENT_STREAM"
  );
  const lagReason =
    projectionLag > 0
      ? hasPendingReplay
        ? "Projection is behind because one or more linked replay batches are still in progress."
        : hasRejectedReplay
          ? "Projection is behind because one or more linked replay events were rejected."
          : hasStaleSite
            ? "Projection is behind because one or more linked sites are stale."
            : "Projection is behind because accepted events are ahead of the current projection sequence."
      : "Projection is aligned with accepted event stream.";
  const orderedLinkedSyncBatches = [...linkedSyncBatches].sort(
    (left, right) => right.startedAt.getTime() - left.startedAt.getTime()
  );

  return {
    transfer,
    overdue,
    originSite: originSite[0] ?? null,
    destinationSite: destinationSite[0] ?? null,
    projection: projection[0] ?? null,
    projectionState: projection[0]
      ? {
          currentStatus: projection[0].status,
          lastProjectionSequence,
          lastAcceptedEventSequence: latestAcceptedEventSequence,
          projectionBehindStream: projectionLag > 0,
          projectionLag,
          hasPendingReplay,
          hasRejectedReplay,
          hasStaleSite,
          lagReason,
          lagTriggeredBy:
            projectionLagAlert && typeof projectionLagAlert.summary === "string"
              ? projectionLagAlert.summary
              : null
        }
      : null,
    relatedEvents,
    linkedSyncBatches: orderedLinkedSyncBatches,
    relatedAlerts: alertRows.rows,
    relatedCases: caseRows.rows
  };
}

export async function getSyncBatchById(db: Database, syncBatchId: string): Promise<unknown | null> {
  const [batch] = await db
    .select()
    .from(syncBatches)
    .where(eq(syncBatches.id, syncBatchId))
    .limit(1);

  if (!batch) {
    return null;
  }

  const [site, replayedEventsRows, eventAttemptsRows] = await Promise.all([
    db.select().from(sites).where(eq(sites.id, batch.siteId)).limit(1),
    db.execute(sql`
      select id, sequence_number, event_type, asset_id, site_id, occurred_at, ingested_at, source_site_event_id, payload
      from event_log
      where sync_batch_id = ${syncBatchId}
      order by sequence_number asc
      limit 1000
    `),
    db.execute(sql`
      select
        a.id,
        a.event_index,
        a.source_site_event_id,
        a.event_hash,
        a.disposition,
        a.event_id,
        a.error_code,
        a.error_message,
        a.attempted_at,
        e.sequence_number,
        e.event_type,
        e.asset_id
      from sync_batch_event_attempt a
      left join event_log e on e.id = a.event_id
      where a.sync_batch_id = ${syncBatchId}
      order by a.event_index, a.attempted_at
      limit 1000
    `)
  ]);

  const replayedEvents = replayedEventsRows.rows as Array<{
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
  const eventAttempts = eventAttemptsRows.rows as Array<{
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
  const replayDiagnostics = parseReplayDiagnostics(
    batch.replayResultSummary,
    batch.rejectedEventCount,
    batch.deduplicatedEventCount
  );
  const affectedAssetIds = new Set(
    eventAttempts
      .map((event) => event.asset_id)
      .filter((assetId): assetId is string => Boolean(assetId))
  );

  return {
    batch,
    site: site[0] ?? null,
    replayedEvents,
    eventAttempts,
    replayDiagnostics,
    affectedAssets: Array.from(affectedAssetIds),
    affectedEventTypes: Array.from(
      new Set(
        eventAttempts
          .map((event) => event.event_type)
          .filter((eventType): eventType is string => Boolean(eventType))
      )
    )
  };
}

export async function getSiteById(db: Database, siteId: string): Promise<unknown | null> {
  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);

  if (!site) {
    return null;
  }

  const [recentBatchesRows, projectedAssetsRows, alertRows, eventRows] = await Promise.all([
    db
      .select()
      .from(syncBatches)
      .where(eq(syncBatches.siteId, siteId))
      .orderBy(desc(syncBatches.startedAt))
      .limit(20),
    db.execute(sql`
      select asset_id, serial_number, status, last_event_type, last_event_at, last_sequence
      from asset_projection
      where current_site_id = ${siteId}
      order by last_event_at desc
      limit 50
    `),
    db.execute(sql`
      select id, rule_code, severity, status, summary, detected_at, last_detected_at
      from alert
      where site_id = ${siteId}
      order by last_detected_at desc
      limit 30
    `),
    db.execute(sql`
      select id, sequence_number, event_type, asset_id, sync_batch_id, source_site_event_id, occurred_at, ingested_at, payload
      from event_log
      where site_id = ${siteId}
      order by sequence_number desc
      limit 30
    `)
  ]);

  return {
    site: {
      ...site,
      syncHealth: computeSyncHealth(site.lastSyncCompletedAt),
      syncPosture: computeSyncPosture({
        lastSyncCompletedAt: site.lastSyncCompletedAt,
        latestBatch:
          recentBatchesRows[0] ?? null
      })
    },
    staleThresholdMinutes: env.SYNC_STALE_MINUTES,
    recentSyncBatches: recentBatchesRows,
    projectedAssets: projectedAssetsRows.rows,
    recentAlerts: alertRows.rows,
    recentEvents: eventRows.rows
  };
}

export async function getReconciliationCaseById(
  db: Database,
  caseId: string
): Promise<unknown | null> {
  const [caseRow] = await db
    .select()
    .from(reconciliationCases)
    .where(eq(reconciliationCases.id, caseId))
    .limit(1);

  if (!caseRow) {
    return null;
  }

  const [alertRow, projectionRow, relatedEventsRows] = await Promise.all([
    caseRow.alertId
      ? db.select().from(alerts).where(eq(alerts.id, caseRow.alertId)).limit(1)
      : Promise.resolve([]),
    caseRow.assetId
      ? db
          .select()
          .from(assetProjection)
          .where(eq(assetProjection.assetId, caseRow.assetId))
          .limit(1)
      : Promise.resolve([]),
    db.execute(sql`
      select id, sequence_number, event_type, site_id, transfer_order_id, sync_batch_id, source_site_event_id, occurred_at, ingested_at, payload
      from event_log
      where (payload ->> 'caseId' = ${caseId}) ${
        caseRow.assetId ? sql`or asset_id = ${caseRow.assetId}` : sql``
      }
      order by sequence_number desc
      limit 40
    `)
  ]);

  const relatedEvents = relatedEventsRows.rows as Array<{
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
  const eventSiteIds = Array.from(new Set(relatedEvents.map((event) => event.site_id)));
  const relatedSyncBatchIds = Array.from(
    new Set(
      relatedEvents
        .map((event) => event.sync_batch_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
  const [siteRows, linkedSyncBatches] = await Promise.all([
    eventSiteIds.length > 0
      ? db.select().from(sites).where(inArray(sites.id, eventSiteIds))
      : Promise.resolve([]),
    relatedSyncBatchIds.length > 0
      ? db.select().from(syncBatches).where(inArray(syncBatches.id, relatedSyncBatchIds))
      : Promise.resolve([])
  ]);
  const lastProjectionSequence = projectionRow[0]?.lastSequence ?? 0;
  const streamPosition = caseRow.assetId && projectionRow[0]
    ? await readAssetStreamPosition(db, caseRow.assetId, lastProjectionSequence)
    : { latestAcceptedEventSequence: lastProjectionSequence, projectionLag: 0 };
  const { latestAcceptedEventSequence, projectionLag } = streamPosition;
  const linkedTransferId =
    relatedEvents.find((event) => event.transfer_order_id)?.transfer_order_id ?? null;
  const resolutionEvent =
    relatedEvents.find(
      (event) =>
        event.event_type === "reconciliation_resolved" &&
        String((event.payload as { caseId?: string }).caseId ?? "") === caseId
    ) ?? null;
  const hasPendingReplay = linkedSyncBatches.some((batch) => batch.status !== "completed");
  const hasRejectedReplay = linkedSyncBatches.some((batch) => batch.rejectedEventCount > 0);
  const hasStaleSite = siteRows.some((site) => computeSyncHealth(site.lastSyncCompletedAt) === "stale");
  const lagTriggeredBy =
    alertRow[0] && alertRow[0].ruleCode === "PROJECTION_SEQUENCE_BEHIND_EVENT_STREAM"
      ? alertRow[0].summary
      : null;
  const lagReason =
    projectionLag > 0
      ? hasPendingReplay
        ? "Projection lag is likely due to replay not yet completed for one or more linked batches."
        : hasRejectedReplay
          ? "Projection lag is likely due to one or more rejected replay events requiring operator action."
          : hasStaleSite
            ? "Projection lag is likely due to stale site sync across linked event sources."
            : "Projection lag indicates accepted events are ahead of current projection state."
      : "Projection is aligned with accepted event stream.";
  const orderedLinkedSyncBatches = [...linkedSyncBatches].sort(
    (left, right) => right.startedAt.getTime() - left.startedAt.getTime()
  );

  return {
    case: caseRow,
    sourceAlert: alertRow[0] ?? null,
    projection: projectionRow[0] ?? null,
    projectionState: projectionRow[0]
      ? {
          currentStatus: projectionRow[0].status,
          lastProjectionSequence,
          lastAcceptedEventSequence: latestAcceptedEventSequence,
          projectionBehindStream: projectionLag > 0,
          projectionLag,
          hasPendingReplay,
          hasRejectedReplay,
          hasStaleSite,
          lagReason,
          lagTriggeredBy
        }
      : null,
    linkedTransferId,
    linkedSyncBatches: orderedLinkedSyncBatches,
    operatorNoteHistory: [
      {
        type: "opened",
        recordedBy: caseRow.openedBy,
        recordedAt: caseRow.openedAt,
        note: caseRow.description
      },
      ...(caseRow.resolutionSummary && caseRow.resolvedBy && caseRow.resolvedAt
        ? [
            {
              type: "resolved",
              recordedBy: caseRow.resolvedBy,
              recordedAt: caseRow.resolvedAt,
              note: caseRow.resolutionSummary
            }
          ]
        : [])
    ],
    resolutionEvent,
    relatedEvents
  };
}

export async function listTransfers(db: Database): Promise<unknown[]> {
  return db.select().from(transferOrders).orderBy(desc(transferOrders.initiatedAt)).limit(500);
}

export async function listAlerts(db: Database): Promise<unknown[]> {
  return db.select().from(alerts).orderBy(desc(alerts.lastDetectedAt)).limit(500);
}

export async function listReconciliationCases(db: Database): Promise<unknown[]> {
  return db
    .select()
    .from(reconciliationCases)
    .orderBy(desc(reconciliationCases.openedAt))
    .limit(500);
}

export async function listEvidenceMetadata(db: Database): Promise<unknown[]> {
  const rows = await db.execute(sql`
    select em.id, em.inspection_id, em.mime_type, em.sha256, em.storage_ref, em.recorded_at, i.asset_id
    from evidence_metadata em
    join inspection i on i.id = em.inspection_id
    order by em.recorded_at desc
    limit 500
  `);

  return rows.rows;
}

export async function openReconciliationCase(
  db: Database,
  input: {
    alertId?: string;
    assetId?: string;
    siteId: string;
    title: string;
    description: string;
  },
  actor: string
): Promise<unknown> {
  const [site] = await db.select({ id: sites.id }).from(sites).where(eq(sites.id, input.siteId)).limit(1);
  if (!site) {
    throw new ApiError(400, "Unknown site", undefined, "UNKNOWN_SITE");
  }

  const [sourceAlert] = input.alertId
    ? await db.select().from(alerts).where(eq(alerts.id, input.alertId)).limit(1)
    : [];
  if (input.alertId && !sourceAlert) {
    throw new ApiError(400, "Unknown alert", undefined, "UNKNOWN_ALERT");
  }
  if (sourceAlert?.siteId && sourceAlert.siteId !== input.siteId) {
    throw new ApiError(409, "Selected site does not match the alert", undefined, "ALERT_CASE_CONFLICT");
  }
  if (sourceAlert?.assetId && input.assetId && sourceAlert.assetId !== input.assetId) {
    throw new ApiError(409, "Selected asset does not match the alert", undefined, "ALERT_CASE_CONFLICT");
  }
  const assetId = sourceAlert?.assetId ?? input.assetId ?? null;
  if (assetId) {
    const [asset] = await db
      .select({ assetId: assetProjection.assetId })
      .from(assetProjection)
      .where(eq(assetProjection.assetId, assetId))
      .limit(1);
    if (!asset) throw new ApiError(400, "Unknown asset", undefined, "UNKNOWN_ASSET");
  }

  const id = randomUUID();
  const occurredAt = new Date().toISOString();
  await ingestEvent(db, {
    eventType: "reconciliation_opened",
    assetId,
    siteId: input.siteId,
    transferOrderId: null,
    sourceSiteEventId: `operator-case:${id}:open`,
    occurredAt,
    payload: {
      caseId: id,
      alertId: input.alertId ?? null,
      title: input.title,
      description: input.description,
      openedBy: actor
    }
  });

  const [created] = await db
    .select()
    .from(reconciliationCases)
    .where(eq(reconciliationCases.id, id))
    .limit(1);

  return created;
}

export async function resolveReconciliationCase(
  db: Database,
  caseId: string,
  input: {
    resolutionSummary: string;
    expectedVersion: number;
    resolvedAssetStatus?: "registered" | "in_transit" | "at_site" | "under_inspection" | null;
  },
  actor: string
): Promise<unknown | null> {
  const [current] = await db
    .select()
    .from(reconciliationCases)
    .where(eq(reconciliationCases.id, caseId))
    .limit(1);
  if (!current) {
    return null;
  }
  if (current.status !== "open") {
    throw new ApiError(409, "Reconciliation case is already resolved", undefined, "CASE_ALREADY_RESOLVED");
  }
  if (current.version !== input.expectedVersion) {
    throw new ApiError(
      409,
      "Reconciliation case changed",
      { currentVersion: current.version },
      "CASE_VERSION_CONFLICT"
    );
  }

  if (!current.siteId) {
    throw new ApiError(409, "Reconciliation case has no attributable site", undefined, "CASE_IDENTITY_CONFLICT");
  }
  if (current.assetId && !input.resolvedAssetStatus) {
    throw new ApiError(
      400,
      "Asset-linked cases require an explicit resolved asset status",
      undefined,
      "RESOLVED_ASSET_STATUS_REQUIRED"
    );
  }
  if (!current.assetId && input.resolvedAssetStatus) {
    throw new ApiError(
      400,
      "Site-level cases cannot set an asset status",
      undefined,
      "RESOLVED_ASSET_STATUS_NOT_APPLICABLE"
    );
  }
  await ingestEvent(db, {
    eventType: "reconciliation_resolved",
    assetId: current.assetId,
    siteId: current.siteId,
    transferOrderId: null,
    occurredAt: new Date().toISOString(),
    // The case row/version is the concurrency token. Avoid manufacturing an
    // idempotency key from mutable timestamps for this server-owned action.
    sourceSiteEventId: null,
    payload: {
      caseId,
      resolvedBy: actor,
      resolutionSummary: input.resolutionSummary,
      resolvedAssetStatus: input.resolvedAssetStatus ?? null,
      expectedCaseVersion: input.expectedVersion
    }
  });

  const [updated] = await db
    .select()
    .from(reconciliationCases)
    .where(eq(reconciliationCases.id, caseId))
    .limit(1);

  return updated ?? null;
}

export async function listSyncBatches(db: Database): Promise<unknown[]> {
  return db.select().from(syncBatches).orderBy(desc(syncBatches.startedAt)).limit(500);
}

export async function dashboardSummary(db: Database): Promise<Record<string, number>> {
  const [openCaseCount, staleSiteCount, inTransitCount, recentAlertCount, replayStats, evidenceGapCount, openAlertStats] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(reconciliationCases)
        .where(eq(reconciliationCases.status, "open")),
      db.execute(sql`
        select count(*)::int as value
        from site
        where last_sync_completed_at is null
          or now() - last_sync_completed_at > (${env.SYNC_STALE_MINUTES} || ' minutes')::interval
      `),
      db
        .select({ value: count() })
        .from(assetProjection)
        .where(eq(assetProjection.status, "in_transit")),
      db.execute(sql`
        select count(*)::int as value
        from alert
        where last_detected_at > now() - interval '24 hours'
      `),
      db.execute(sql`
        select
          coalesce(sum(accepted_event_count), 0)::int as replay_success_count,
          coalesce(sum(rejected_event_count), 0)::int as replay_failure_count
        from sync_batch
        where started_at > now() - interval '24 hours'
      `),
      db.execute(sql`
        select count(*)::int as value
        from (
          select i.id
          from inspection i
          left join evidence_metadata em on em.inspection_id = i.id
          group by i.id
          having count(em.id) = 0
        ) gaps
      `),
      db.execute(sql`
        select
          count(*) filter (where severity = 'high')::int as open_high_severity_alerts,
          count(*) filter (where rule_code = 'TRANSFER_NOT_CONFIRMED')::int as transfer_timeout_alerts,
          count(*) filter (where rule_code = 'ASSET_OBSERVED_AT_MULTIPLE_SITES')::int as dual_site_alerts,
          count(*) filter (where rule_code = 'PROJECTION_SEQUENCE_BEHIND_EVENT_STREAM')::int as projection_lag_alerts,
          count(*) filter (where rule_code = 'INSPECTION_MISSING_EVIDENCE')::int as evidence_gap_alerts,
          count(*) filter (where rule_code = 'SITE_PROJECTION_STALE')::int as stale_site_alerts
        from alert
        where status in ('open', 'acknowledged')
      `)
    ]);

  return {
    openReconciliationCases: Number(openCaseCount[0]?.value ?? 0),
    staleSites: Number(staleSiteCount.rows[0]?.value ?? 0),
    assetsInTransit: Number(inTransitCount[0]?.value ?? 0),
    recentAlerts: Number(recentAlertCount.rows[0]?.value ?? 0),
    replaySuccessCount: Number(replayStats.rows[0]?.replay_success_count ?? 0),
    replayFailureCount: Number(replayStats.rows[0]?.replay_failure_count ?? 0),
    unresolvedEvidenceGaps: Number(evidenceGapCount.rows[0]?.value ?? 0),
    openHighSeverityAlerts: Number(openAlertStats.rows[0]?.open_high_severity_alerts ?? 0),
    openTransferTimeoutAlerts: Number(openAlertStats.rows[0]?.transfer_timeout_alerts ?? 0),
    openDualSiteAlerts: Number(openAlertStats.rows[0]?.dual_site_alerts ?? 0),
    openProjectionLagAlerts: Number(openAlertStats.rows[0]?.projection_lag_alerts ?? 0),
    openEvidenceGapAlerts: Number(openAlertStats.rows[0]?.evidence_gap_alerts ?? 0),
    openStaleSiteAlerts: Number(openAlertStats.rows[0]?.stale_site_alerts ?? 0)
  };
}

export async function recentTransfers(db: Database): Promise<unknown[]> {
  return db.select().from(transferOrders).orderBy(desc(transferOrders.initiatedAt)).limit(10);
}

export async function recentAlerts(db: Database): Promise<unknown[]> {
  return db.select().from(alerts).orderBy(desc(alerts.lastDetectedAt)).limit(10);
}

export async function recentBatches(db: Database): Promise<unknown[]> {
  return db.select().from(syncBatches).orderBy(desc(syncBatches.startedAt)).limit(10);
}
