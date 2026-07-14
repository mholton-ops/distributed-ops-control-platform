import {
  createEventRequestSchema,
  externalEventTypeSchema,
  type CreateEventRequest
} from "@ops/contracts";
import {
  applyEventToProjection,
  type DivergenceRuleResult,
  type DomainEvent
} from "@ops/domain";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { db as databaseClient } from "../db/client";
import {
  alerts,
  assetProjection,
  assets,
  eventLog,
  evidenceMetadata,
  inspections,
  reconciliationCases,
  sites,
  syncBatchEventAttempts,
  syncBatches,
  transferOrders
} from "../db/schema";
import { ApiError } from "../lib/errors";
import { incrementCounter } from "../lib/metrics";

type Database = typeof databaseClient;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type IngestOptions = {
  syncBatchId?: string;
};

export type IngestResult = {
  eventId: string;
  sequenceNumber: number;
  deduplicated: boolean;
  eventHash: string;
};

export type ReplayEventDisposition = {
  index: number;
  sourceSiteEventId: string;
  eventHash: string;
  disposition: "accepted" | "deduplicated" | "rejected";
  eventId: string | null;
  sequenceNumber: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type ReplayResult = {
  syncBatchId: string;
  status: "completed" | "partial" | "failed";
  acceptedEventCount: number;
  rejectedEventCount: number;
  deduplicatedEventCount: number;
  rejectionReasons: string[];
  dispositions: ReplayEventDisposition[];
};

export type ReplayTiming = {
  startedAt?: Date;
  completedAt?: Date;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ApiError(400, "Event contains a non-finite number", undefined, "INVALID_EVENT");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new ApiError(400, "Event contains an unsupported value", undefined, "INVALID_EVENT");
}

export function hashCanonicalValue(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function hashEvent(event: CreateEventRequest): string {
  return hashCanonicalValue({
    eventType: event.eventType,
    assetId: event.assetId ?? null,
    siteId: event.siteId,
    transferOrderId: event.transferOrderId ?? null,
    occurredAt: new Date(event.occurredAt).toISOString(),
    sourceSiteEventId: event.sourceSiteEventId ?? null,
    payload: event.payload
  });
}

function needsAssetProjection(eventType: string): boolean {
  return !["site_sync_started", "site_sync_completed"].includes(eventType);
}

async function ensureSiteExists(db: Transaction, siteId: string): Promise<void> {
  const existing = await db.select({ id: sites.id }).from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!existing[0]) {
    throw new ApiError(400, "Unknown site", { siteId }, "UNKNOWN_SITE");
  }
}

async function ensureAssetExists(db: Transaction, assetId: string): Promise<void> {
  const existing = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!existing[0]) {
    throw new ApiError(400, "Unknown asset", { assetId }, "UNKNOWN_ASSET");
  }
}

function entityConflict(entity: string, id: string): never {
  throw new ApiError(
    409,
    `${entity} identifier is already bound to different data`,
    { entity, id },
    "ENTITY_IDENTITY_CONFLICT"
  );
}

function reconciliationTitleForRule(ruleCode: string): string {
  const labels: Record<string, string> = {
    TRANSFER_NOT_CONFIRMED: "Transfer confirmation overdue",
    ASSET_OBSERVED_AT_MULTIPLE_SITES: "Conflicting site observations",
    PROJECTION_SEQUENCE_BEHIND_EVENT_STREAM: "Projection lag detected"
  };
  return labels[ruleCode] ?? "Divergence requires operator review";
}

async function applyEventSideEffects(
  db: Transaction,
  event: CreateEventRequest,
  eventId: string,
  eventHash: string,
  occurredAt: Date
): Promise<void> {
  switch (event.eventType) {
    case "asset_registered": {
      const [inserted] = await db
        .insert(assets)
        .values({
          id: event.assetId,
          serialNumber: event.payload.serialNumber,
          containerId: event.payload.containerId ?? null,
          registeredSiteId: event.siteId
        })
        .onConflictDoNothing()
        .returning({ id: assets.id });
      if (!inserted) {
        entityConflict("asset", event.assetId);
      }
      break;
    }
    case "asset_moved": {
      await ensureAssetExists(db, event.assetId);
      await ensureSiteExists(db, event.payload.toSiteId);
      if (event.transferOrderId) {
        const [transfer] = await db
          .select()
          .from(transferOrders)
          .where(eq(transferOrders.id, event.transferOrderId))
          .limit(1);
        if (
          !transfer ||
          transfer.assetId !== event.assetId ||
          transfer.originSiteId !== event.payload.fromSiteId ||
          transfer.destinationSiteId !== event.payload.toSiteId ||
          transfer.status !== "initiated"
        ) {
          throw new ApiError(409, "Movement does not match an active transfer", undefined, "TRANSFER_STATE_CONFLICT");
        }
      }
      break;
    }
    case "asset_received": {
      await ensureAssetExists(db, event.assetId);
      if (event.transferOrderId) {
        const [transfer] = await db
          .select()
          .from(transferOrders)
          .where(eq(transferOrders.id, event.transferOrderId))
          .limit(1);
        if (
          !transfer ||
          transfer.assetId !== event.assetId ||
          transfer.originSiteId !== event.payload.fromSiteId ||
          transfer.destinationSiteId !== event.siteId ||
          transfer.status !== "initiated"
        ) {
          throw new ApiError(409, "Receipt does not match an active transfer", undefined, "TRANSFER_STATE_CONFLICT");
        }
      }
      break;
    }
    case "transfer_initiated": {
      await ensureAssetExists(db, event.assetId);
      await ensureSiteExists(db, event.payload.destinationSiteId);
      const [inserted] = await db
        .insert(transferOrders)
        .values({
          id: event.payload.transferOrderId,
          assetId: event.assetId,
          originSiteId: event.payload.originSiteId,
          destinationSiteId: event.payload.destinationSiteId,
          status: "initiated",
          initiatedBy: event.payload.initiatedBy,
          initiatedAt: occurredAt
        })
        .onConflictDoNothing()
        .returning({ id: transferOrders.id });
      if (!inserted) {
        entityConflict("transfer", event.payload.transferOrderId);
      }
      break;
    }
    case "transfer_completed": {
      const [transfer] = await db
        .select()
        .from(transferOrders)
        .where(eq(transferOrders.id, event.payload.transferOrderId))
        .for("update")
        .limit(1);
      if (!transfer) {
        throw new ApiError(400, "Unknown transfer", undefined, "UNKNOWN_TRANSFER");
      }
      if (transfer.assetId !== event.assetId || transfer.destinationSiteId !== event.siteId) {
        throw new ApiError(409, "Completion does not match transfer custody", undefined, "TRANSFER_STATE_CONFLICT");
      }
      if (transfer.status !== "initiated") {
        throw new ApiError(409, "Transfer is not active", undefined, "TRANSFER_ALREADY_COMPLETED");
      }
      await db
        .update(transferOrders)
        .set({
          status: "completed",
          completedAt: occurredAt,
          completionNote: event.payload.completionNote ?? null
        })
        .where(and(eq(transferOrders.id, transfer.id), eq(transferOrders.status, "initiated")));
      break;
    }
    case "inspection_recorded": {
      await ensureAssetExists(db, event.assetId);
      const [inserted] = await db
        .insert(inspections)
        .values({
          id: event.payload.inspectionId,
          assetId: event.assetId,
          siteId: event.siteId,
          status: event.payload.status,
          notes: event.payload.notes,
          inspectedAt: occurredAt,
          createdEventId: eventId
        })
        .onConflictDoNothing()
        .returning({ id: inspections.id });
      if (!inserted) {
        entityConflict("inspection", event.payload.inspectionId);
      }
      break;
    }
    case "evidence_attached": {
      const [inspection] = await db
        .select()
        .from(inspections)
        .where(eq(inspections.id, event.payload.inspectionId))
        .limit(1);
      if (!inspection || inspection.assetId !== event.assetId || inspection.siteId !== event.siteId) {
        throw new ApiError(409, "Evidence does not match the inspection", undefined, "INSPECTION_STATE_CONFLICT");
      }
      const storageRef = `urn:sha256:${event.payload.sha256.toLowerCase()}`;
      const [inserted] = await db
        .insert(evidenceMetadata)
        .values({
          id: event.payload.evidenceId,
          inspectionId: event.payload.inspectionId,
          mimeType: event.payload.mimeType,
          sha256: event.payload.sha256.toLowerCase(),
          storageRef
        })
        .onConflictDoNothing()
        .returning({ id: evidenceMetadata.id });
      if (!inserted) {
        entityConflict("evidence", event.payload.evidenceId);
      }
      break;
    }
    case "site_sync_started": {
      const [inserted] = await db
        .insert(syncBatches)
        .values({
          id: event.payload.syncBatchId,
          siteId: event.siteId,
          status: "processing",
          startedAt: occurredAt,
          queuedEventCount: event.payload.queuedEventCount,
          requestHash: eventHash
        })
        .onConflictDoNothing()
        .returning({ id: syncBatches.id });
      if (!inserted) {
        const [existing] = await db
          .select()
          .from(syncBatches)
          .where(eq(syncBatches.id, event.payload.syncBatchId))
          .limit(1);
        if (
          !existing ||
          existing.siteId !== event.siteId ||
          existing.queuedEventCount !== event.payload.queuedEventCount ||
          existing.status !== "processing"
        ) {
          entityConflict("sync batch", event.payload.syncBatchId);
        }
      }
      break;
    }
    case "site_sync_completed": {
      const status =
        event.payload.rejectedEventCount === 0
          ? "completed"
          : event.payload.acceptedEventCount > 0
            ? "partial"
            : "failed";
      const updated = await db
        .update(syncBatches)
        .set({
          status,
          completedAt: occurredAt,
          acceptedEventCount: event.payload.acceptedEventCount,
          rejectedEventCount: event.payload.rejectedEventCount,
          deduplicatedEventCount: event.payload.deduplicatedEventCount ?? 0,
          replayResultSummary: JSON.stringify({
            idempotencyModel: "site plus stable source event id plus canonical payload hash",
            rejectionReasons: event.payload.rejectionReasons ?? []
          })
        })
        .where(
          and(
            eq(syncBatches.id, event.payload.syncBatchId),
            eq(syncBatches.siteId, event.siteId),
            eq(syncBatches.status, "processing")
          )
        )
        .returning({ id: syncBatches.id });
      if (!updated[0]) {
        throw new ApiError(409, "Sync completion does not match its batch", undefined, "SYNC_BATCH_CONFLICT");
      }
      if (status === "completed") {
        await db
          .update(sites)
          .set({ lastSyncCompletedAt: occurredAt, updatedAt: new Date() })
          .where(eq(sites.id, event.siteId));
      }
      break;
    }
    case "divergence_detected": {
      const [prior] = await db
        .select()
        .from(alerts)
        .where(eq(alerts.fingerprint, event.payload.fingerprint))
        .for("update")
        .limit(1);
      if (prior && prior.id !== event.payload.alertId) {
        throw new ApiError(
          409,
          "Divergence event alert id does not match the existing fingerprint",
          undefined,
          "ALERT_IDENTITY_CONFLICT"
        );
      }
      const preservesAcknowledgement = prior?.status === "acknowledged";
      const [alert] = await db
        .insert(alerts)
        .values({
          id: event.payload.alertId,
          fingerprint: event.payload.fingerprint,
          ruleCode: event.payload.ruleCode,
          severity: event.payload.severity,
          status: "open",
          assetId: event.assetId ?? null,
          siteId: event.siteId,
          summary: event.payload.summary,
          details: event.payload.details,
          detectedAt: occurredAt,
          lastDetectedAt: occurredAt,
          occurrenceCount: 1
        })
        .onConflictDoUpdate({
          target: alerts.fingerprint,
          set: {
            severity: event.payload.severity,
            status: preservesAcknowledgement ? "acknowledged" : "open",
            summary: event.payload.summary,
            details: event.payload.details,
            lastDetectedAt: occurredAt,
            occurrenceCount: sql`${alerts.occurrenceCount} + 1`,
            resolvedAt: prior?.status === "resolved" ? null : prior?.resolvedAt,
            acknowledgedAt: preservesAcknowledgement ? prior.acknowledgedAt : null,
            acknowledgedBy: preservesAcknowledgement ? prior.acknowledgedBy : null
          }
        })
        .returning({ id: alerts.id });
      if (event.payload.severity === "high" && (!prior || prior.status === "resolved")) {
        const caseId = randomUUID();
        await ingestEventTransaction(
          db,
          createEventRequestSchema.parse({
            eventType: "reconciliation_opened",
            // Keep the system case event out of the asset reducer until the
            // outer divergence event has projected, while retaining the exact
            // alert/case relationship in the immutable payload.
            assetId: null,
            siteId: event.siteId,
            transferOrderId: null,
            occurredAt: occurredAt.toISOString(),
            sourceSiteEventId: `divergence-case:${alert.id}:${(prior?.occurrenceCount ?? 0) + 1}`,
            payload: {
              caseId,
              alertId: alert.id,
              title: reconciliationTitleForRule(event.payload.ruleCode),
              description: event.payload.summary,
              openedBy: "divergence-engine"
            }
          }),
          {}
        );
      }
      break;
    }
    case "divergence_cleared": {
      const [alert] = await db
        .select()
        .from(alerts)
        .where(eq(alerts.id, event.payload.alertId))
        .for("update")
        .limit(1);
      if (
        !alert ||
        alert.fingerprint !== event.payload.fingerprint ||
        alert.ruleCode !== event.payload.ruleCode
      ) {
        throw new ApiError(409, "Cleared divergence does not match its alert", undefined, "ALERT_IDENTITY_CONFLICT");
      }
      const [openCase] = await db
        .select({ id: reconciliationCases.id })
        .from(reconciliationCases)
        .where(
          and(
            eq(reconciliationCases.alertId, alert.id),
            eq(reconciliationCases.status, "open")
          )
        )
        .limit(1);
      if (openCase) {
        throw new ApiError(409, "Alert has an active reconciliation case", undefined, "ALERT_CASE_ALREADY_OPEN");
      }
      await db
        .update(alerts)
        .set({ status: "resolved", resolvedAt: occurredAt })
        .where(eq(alerts.id, alert.id));
      break;
    }
    case "reconciliation_opened": {
      let caseAssetId = event.assetId ?? null;
      if (event.payload.alertId) {
        const [sourceAlert] = await db
          .select()
          .from(alerts)
          .where(eq(alerts.id, event.payload.alertId))
          .for("update")
          .limit(1);
        if (!sourceAlert) {
          throw new ApiError(400, "Unknown alert", undefined, "UNKNOWN_ALERT");
        }
        if (sourceAlert.assetId && event.assetId && sourceAlert.assetId !== event.assetId) {
          throw new ApiError(409, "Case asset does not match its alert", undefined, "ALERT_CASE_CONFLICT");
        }
        caseAssetId = sourceAlert.assetId ?? caseAssetId;
        if (sourceAlert.siteId && sourceAlert.siteId !== event.siteId) {
          throw new ApiError(409, "Case site does not match its alert", undefined, "ALERT_CASE_CONFLICT");
        }
        if (sourceAlert.status === "resolved") {
          throw new ApiError(409, "Resolved alert cannot be attached to a new case", undefined, "ALERT_ALREADY_RESOLVED");
        }
        const [openCase] = await db
          .select({ id: reconciliationCases.id })
          .from(reconciliationCases)
          .where(
            and(
              eq(reconciliationCases.alertId, sourceAlert.id),
              eq(reconciliationCases.status, "open")
            )
          )
          .limit(1);
        if (openCase) {
          throw new ApiError(409, "Alert already has an open case", undefined, "ALERT_CASE_ALREADY_OPEN");
        }
        await db
          .update(alerts)
          .set({ status: "acknowledged", acknowledgedBy: event.payload.openedBy, acknowledgedAt: occurredAt })
          .where(eq(alerts.id, sourceAlert.id));
      }
      await db.insert(reconciliationCases).values({
        id: event.payload.caseId,
        alertId: event.payload.alertId,
        assetId: caseAssetId,
        siteId: event.siteId,
        status: "open",
        title: event.payload.title,
        description: event.payload.description,
        openedBy: event.payload.openedBy,
        openedAt: occurredAt,
        version: 1
      });
      break;
    }
    case "reconciliation_resolved": {
      const [current] = await db
        .select()
        .from(reconciliationCases)
        .where(eq(reconciliationCases.id, event.payload.caseId))
        .for("update")
        .limit(1);
      if (!current) {
        throw new ApiError(400, "Unknown reconciliation case", undefined, "UNKNOWN_RECONCILIATION_CASE");
      }
      if (current.status !== "open") {
        throw new ApiError(409, "Reconciliation case is already resolved", undefined, "CASE_ALREADY_RESOLVED");
      }
      if (current.version !== event.payload.expectedCaseVersion) {
        throw new ApiError(409, "Reconciliation case changed", { currentVersion: current.version }, "CASE_VERSION_CONFLICT");
      }
      if (current.assetId !== (event.assetId ?? null) || current.siteId !== event.siteId) {
        throw new ApiError(409, "Resolution does not match the case", undefined, "CASE_IDENTITY_CONFLICT");
      }
      if (current.assetId && !event.payload.resolvedAssetStatus) {
        throw new ApiError(400, "Asset-linked cases require a resolved status", undefined, "RESOLVED_ASSET_STATUS_REQUIRED");
      }
      if (!current.assetId && event.payload.resolvedAssetStatus) {
        throw new ApiError(400, "Site-level cases cannot set an asset status", undefined, "RESOLVED_ASSET_STATUS_NOT_APPLICABLE");
      }
      const resolved = await db
        .update(reconciliationCases)
        .set({
          status: "resolved",
          resolvedBy: event.payload.resolvedBy,
          resolvedAt: occurredAt,
          resolutionSummary: event.payload.resolutionSummary,
          version: current.version + 1
        })
        .where(
          and(
            eq(reconciliationCases.id, current.id),
            eq(reconciliationCases.version, event.payload.expectedCaseVersion),
            eq(reconciliationCases.status, "open")
          )
        )
        .returning({ id: reconciliationCases.id });
      if (!resolved[0]) {
        throw new ApiError(409, "Reconciliation case changed", undefined, "CASE_VERSION_CONFLICT");
      }
      if (current.alertId) {
        await db
          .update(alerts)
          .set({ status: "resolved", resolvedAt: occurredAt })
          .where(eq(alerts.id, current.alertId));
      }
      break;
    }
    default:
      break;
  }
}

async function updateProjectionFromEvent(
  db: Transaction,
  event: CreateEventRequest,
  eventId: string,
  sequenceNumber: number
): Promise<void> {
  if (!event.assetId || !needsAssetProjection(event.eventType)) {
    return;
  }

  const [existingProjection] = await db
    .select()
    .from(assetProjection)
    .where(eq(assetProjection.assetId, event.assetId))
    .for("update")
    .limit(1);
  if (existingProjection && existingProjection.lastSequence >= sequenceNumber) {
    return;
  }

  const [assetRow] = await db.select().from(assets).where(eq(assets.id, event.assetId)).limit(1);
  if (!assetRow) {
    throw new ApiError(400, "Unknown asset", { assetId: event.assetId }, "UNKNOWN_ASSET");
  }

  const prior = existingProjection
    ? {
        assetId: existingProjection.assetId,
        serialNumber: existingProjection.serialNumber,
        currentSiteId: existingProjection.currentSiteId,
        containerId: existingProjection.containerId,
        status: existingProjection.status as
          | "registered"
          | "in_transit"
          | "at_site"
          | "under_inspection"
          | "reconciliation_required",
        lastEventType: existingProjection.lastEventType as DomainEvent["eventType"],
        lastEventAt: existingProjection.lastEventAt.toISOString(),
        lastSequence: existingProjection.lastSequence,
        version: existingProjection.version
      }
    : null;

  const next = applyEventToProjection(prior, {
    eventId,
    eventType: event.eventType,
    sequenceNumber,
    assetId: event.assetId,
    siteId: event.siteId,
    transferOrderId: event.transferOrderId ?? null,
    occurredAt: event.occurredAt,
    payload: event.payload
  });
  if (!next) {
    return;
  }

  await db
    .insert(assetProjection)
    .values({
      assetId: next.assetId,
      serialNumber: next.serialNumber === "unknown" ? assetRow.serialNumber : next.serialNumber,
      currentSiteId: next.currentSiteId,
      containerId: next.containerId,
      status: next.status,
      lastEventType: next.lastEventType,
      lastEventAt: new Date(next.lastEventAt),
      lastSequence: next.lastSequence,
      version: next.version,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: assetProjection.assetId,
      set: {
        currentSiteId: next.currentSiteId,
        containerId: next.containerId,
        status: next.status,
        lastEventType: next.lastEventType,
        lastEventAt: new Date(next.lastEventAt),
        lastSequence: next.lastSequence,
        version: next.version,
        updatedAt: new Date()
      },
      setWhere: sql`${assetProjection.lastSequence} < ${sequenceNumber}`
    });
}

async function ingestEventTransaction(
  db: Transaction,
  event: CreateEventRequest,
  options: IngestOptions
): Promise<IngestResult> {
  await ensureSiteExists(db, event.siteId);
  if (event.assetId) {
    // PostgreSQL sequences allocate before commit. Serialize all events for one
    // asset before appending so ledger order and reducer order cannot diverge.
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${event.assetId}, 0))`);
  }
  const eventHash = hashEvent(event);
  const values = {
    id: randomUUID(),
    eventType: event.eventType,
    assetId: event.assetId ?? null,
    siteId: event.siteId,
    transferOrderId: event.transferOrderId ?? null,
    syncBatchId: options.syncBatchId ?? null,
    sourceSiteEventId: event.sourceSiteEventId ?? null,
    eventHash,
    occurredAt: new Date(event.occurredAt),
    payload: event.payload
  };

  const inserted = event.sourceSiteEventId
    ? await db
        .insert(eventLog)
        .values(values)
        .onConflictDoNothing({ target: [eventLog.siteId, eventLog.sourceSiteEventId] })
        .returning({ id: eventLog.id, sequenceNumber: eventLog.sequenceNumber })
    : await db
        .insert(eventLog)
        .values(values)
        .returning({ id: eventLog.id, sequenceNumber: eventLog.sequenceNumber });

  if (!inserted[0] && event.sourceSiteEventId) {
    const [existing] = await db
      .select({
        id: eventLog.id,
        sequenceNumber: eventLog.sequenceNumber,
        eventHash: eventLog.eventHash,
        eventType: eventLog.eventType,
        assetId: eventLog.assetId,
        siteId: eventLog.siteId,
        transferOrderId: eventLog.transferOrderId,
        occurredAt: eventLog.occurredAt,
        sourceSiteEventId: eventLog.sourceSiteEventId,
        payload: eventLog.payload
      })
      .from(eventLog)
      .where(
        and(
          eq(eventLog.siteId, event.siteId),
          eq(eventLog.sourceSiteEventId, event.sourceSiteEventId)
        )
      )
      .limit(1);
    if (!existing) {
      throw new ApiError(409, "Event idempotency race could not be resolved", undefined, "IDEMPOTENCY_RACE");
    }
    const legacyMigrationHash = createHash("sha256").update(existing.id).digest("hex");
    const reconstructedHash = hashCanonicalValue({
      eventType: existing.eventType,
      assetId: existing.assetId,
      siteId: existing.siteId,
      transferOrderId: existing.transferOrderId,
      occurredAt: existing.occurredAt.toISOString(),
      sourceSiteEventId: existing.sourceSiteEventId,
      payload: existing.payload
    });
    const exactLegacyReplay =
      existing.eventHash === legacyMigrationHash && reconstructedHash === eventHash;
    if (existing.eventHash !== eventHash && !exactLegacyReplay) {
      throw new ApiError(
        409,
        "Source event id was reused with different event content",
        { siteId: event.siteId, sourceSiteEventId: event.sourceSiteEventId },
        "IDEMPOTENCY_PAYLOAD_CONFLICT"
      );
    }
    return {
      eventId: existing.id,
      sequenceNumber: existing.sequenceNumber,
      deduplicated: true,
      eventHash
    };
  }

  const accepted = inserted[0];
  if (!accepted) {
    throw new ApiError(500, "Event append failed", undefined, "EVENT_APPEND_FAILED");
  }
  await applyEventSideEffects(db, event, accepted.id, eventHash, values.occurredAt);
  await updateProjectionFromEvent(db, event, accepted.id, accepted.sequenceNumber);
  return {
    eventId: accepted.id,
    sequenceNumber: accepted.sequenceNumber,
    deduplicated: false,
    eventHash
  };
}

export async function ingestEvent(
  db: Database,
  input: CreateEventRequest,
  options: IngestOptions = {}
): Promise<IngestResult> {
  const parsed = createEventRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(400, "Invalid event payload", { issues: parsed.error.issues }, "INVALID_EVENT");
  }
  const result = await db.transaction((transaction) =>
    ingestEventTransaction(transaction, parsed.data, options)
  );
  incrementCounter(result.deduplicated ? "eventsDeduplicated" : "eventsIngested");
  return result;
}

export async function ingestDivergenceFinding(
  db: Database,
  finding: DivergenceRuleResult,
  siteId: string,
  observedAt = new Date()
): Promise<{ event: IngestResult; createdOrReopened: boolean }> {
  const fingerprint = hashCanonicalValue({
    ruleCode: finding.ruleCode,
    assetId: finding.assetId,
    siteId: finding.siteId
  });
  const result = await db.transaction(async (transaction) => {
    if (finding.assetId) {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${finding.assetId}, 0))`
      );
    }
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${fingerprint}, 0))`
    );
    const [existing] = await transaction
      .select()
      .from(alerts)
      .where(eq(alerts.fingerprint, fingerprint))
      .for("update")
      .limit(1);
    const event = createEventRequestSchema.parse({
      eventType: "divergence_detected",
      assetId: finding.assetId,
      siteId,
      transferOrderId: null,
      occurredAt: observedAt.toISOString(),
      sourceSiteEventId: `divergence:${fingerprint}:${(existing?.occurrenceCount ?? 0) + 1}`,
      payload: {
        alertId: existing?.id ?? randomUUID(),
        fingerprint,
        ruleCode: finding.ruleCode,
        severity: finding.severity,
        summary: finding.summary,
        details: finding.details
      }
    });
    return {
      event: await ingestEventTransaction(transaction, event, {}),
      createdOrReopened: !existing || existing.status === "resolved"
    };
  });
  incrementCounter(result.event.deduplicated ? "eventsDeduplicated" : "eventsIngested");
  return result;
}

export function divergenceFingerprint(finding: Pick<DivergenceRuleResult, "ruleCode" | "assetId" | "siteId">): string {
  return hashCanonicalValue({
    ruleCode: finding.ruleCode,
    assetId: finding.assetId,
    siteId: finding.siteId
  });
}

export async function clearDivergenceAlert(
  db: Database,
  input: {
    alertId: string;
    fingerprint: string;
    ruleCode: string;
    assetId: string | null;
    siteId: string;
    occurrenceCount: number;
  },
  observedAt = new Date()
): Promise<IngestResult | null> {
  const result = await db.transaction(async (transaction) => {
    if (input.assetId) {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.assetId}, 0))`
      );
    }
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.fingerprint}, 0))`
    );
    const [current] = await transaction
      .select({ status: alerts.status, occurrenceCount: alerts.occurrenceCount })
      .from(alerts)
      .where(eq(alerts.id, input.alertId))
      .for("update")
      .limit(1);
    if (!current || current.status === "resolved") return null;
    const event = createEventRequestSchema.parse({
      eventType: "divergence_cleared",
      assetId: input.assetId,
      siteId: input.siteId,
      transferOrderId: null,
      occurredAt: observedAt.toISOString(),
      sourceSiteEventId: `divergence-clear:${input.fingerprint}:${current.occurrenceCount}`,
      payload: {
        alertId: input.alertId,
        fingerprint: input.fingerprint,
        ruleCode: input.ruleCode,
        resolvedBy: "divergence-engine",
        summary: "Condition no longer present in the current divergence scan"
      }
    });
    return ingestEventTransaction(transaction, event, {});
  });
  if (!result) return null;
  incrementCounter(result.deduplicated ? "eventsDeduplicated" : "eventsIngested");
  return result;
}

type ReplayInput = {
  siteId: string;
  syncBatchId: string;
  events: unknown[];
};

function replayStatus(accepted: number, rejected: number): ReplayResult["status"] {
  if (rejected === 0) return "completed";
  return accepted > 0 ? "partial" : "failed";
}

function replayError(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message.slice(0, 500) };
  }
  return { code: "REPLAY_EVENT_REJECTED", message: "Replay event could not be accepted" };
}

async function priorReplayResult(db: Database, batchId: string): Promise<ReplayResult> {
  const [batch, attempts] = await Promise.all([
    db.select().from(syncBatches).where(eq(syncBatches.id, batchId)).limit(1),
    db
      .select()
      .from(syncBatchEventAttempts)
      .where(eq(syncBatchEventAttempts.syncBatchId, batchId))
      .orderBy(desc(syncBatchEventAttempts.attemptedAt))
  ]);
  const row = batch[0];
  if (!row || row.status === "processing") {
    throw new ApiError(409, "Sync batch is still processing", undefined, "SYNC_BATCH_IN_PROGRESS");
  }
  const latestByIndex = new Map<number, (typeof attempts)[number]>();
  for (const attempt of attempts) {
    if (!latestByIndex.has(attempt.eventIndex)) latestByIndex.set(attempt.eventIndex, attempt);
  }
  let summary: { rejectionReasons?: string[] } = {};
  try {
    summary = row.replayResultSummary ? JSON.parse(row.replayResultSummary) : {};
  } catch {
    summary = {};
  }
  const eventIds = [...latestByIndex.values()]
    .map((attempt) => attempt.eventId)
    .filter((eventId): eventId is string => Boolean(eventId));
  const eventRows = eventIds.length
    ? await db
        .select({ id: eventLog.id, sequenceNumber: eventLog.sequenceNumber })
        .from(eventLog)
        .where(inArray(eventLog.id, eventIds))
    : [];
  const sequenceByEventId = new Map(eventRows.map((event) => [event.id, event.sequenceNumber]));
  return {
    syncBatchId: row.id,
    status: row.status as ReplayResult["status"],
    acceptedEventCount: row.acceptedEventCount,
    rejectedEventCount: row.rejectedEventCount,
    deduplicatedEventCount: row.deduplicatedEventCount,
    rejectionReasons: summary.rejectionReasons ?? [],
    dispositions: [...latestByIndex.values()]
      .sort((left, right) => left.eventIndex - right.eventIndex)
      .map((attempt) => ({
        index: attempt.eventIndex,
        sourceSiteEventId: attempt.sourceSiteEventId,
        eventHash: attempt.eventHash,
        disposition: attempt.disposition as ReplayEventDisposition["disposition"],
        eventId: attempt.eventId,
        sequenceNumber: attempt.eventId ? (sequenceByEventId.get(attempt.eventId) ?? null) : null,
        errorCode: attempt.errorCode,
        errorMessage: attempt.errorMessage
      }))
  };
}

export async function ingestSyncReplay(
  db: Database,
  input: ReplayInput,
  timing: ReplayTiming = {}
): Promise<ReplayResult> {
  for (const rawEvent of input.events) {
    if (
      typeof rawEvent === "object" &&
      rawEvent !== null &&
      "siteId" in rawEvent &&
      (rawEvent as { siteId?: unknown }).siteId !== input.siteId
    ) {
      throw new ApiError(
        403,
        "Every replay event must belong to the envelope site",
        undefined,
        "REPLAY_SITE_MISMATCH"
      );
    }
  }

  const startedAt = timing.startedAt ? new Date(timing.startedAt.getTime()) : new Date();
  const suppliedCompletedAt = timing.completedAt
    ? new Date(timing.completedAt.getTime())
    : undefined;
  const timingValidationNow = Date.now();
  if (Number.isNaN(startedAt.getTime()) || startedAt.getTime() > timingValidationNow) {
    throw new ApiError(400, "Sync replay start time is invalid", undefined, "INVALID_REPLAY_TIMING");
  }
  if (suppliedCompletedAt && (
    Number.isNaN(suppliedCompletedAt.getTime()) ||
    suppliedCompletedAt < startedAt ||
    suppliedCompletedAt.getTime() > timingValidationNow
  )) {
    throw new ApiError(
      400,
      "Sync replay completion time must be valid and no earlier than its start",
      undefined,
      "INVALID_REPLAY_TIMING"
    );
  }

  const requestHash = hashCanonicalValue({ siteId: input.siteId, events: input.events });
  const batchState = await db.transaction(async (transaction) => {
    await ensureSiteExists(transaction, input.siteId);
    const [inserted] = await transaction
      .insert(syncBatches)
      .values({
        id: input.syncBatchId,
        siteId: input.siteId,
        status: "processing",
        startedAt,
        queuedEventCount: input.events.length,
        requestHash
      })
      .onConflictDoNothing()
      .returning({ id: syncBatches.id });
    const [batch] = await transaction
      .select()
      .from(syncBatches)
      .where(eq(syncBatches.id, input.syncBatchId))
      .for("update")
      .limit(1);
    if (
      !batch ||
      batch.siteId !== input.siteId ||
      batch.requestHash !== requestHash ||
      batch.queuedEventCount !== input.events.length
    ) {
      throw new ApiError(
        409,
        "Sync batch id was reused with different content",
        undefined,
        "SYNC_BATCH_CONTENT_CONFLICT"
      );
    }
    if (!inserted && batch.status === "processing") {
      throw new ApiError(
        409,
        "Sync batch is already being processed",
        undefined,
        "SYNC_BATCH_IN_PROGRESS"
      );
    }
    if (inserted) {
      await ingestEventTransaction(
        transaction,
        createEventRequestSchema.parse({
          eventType: "site_sync_started",
          assetId: null,
          siteId: input.siteId,
          transferOrderId: null,
          occurredAt: batch.startedAt.toISOString(),
          sourceSiteEventId: `${input.syncBatchId}:lifecycle:start`,
          payload: {
            syncBatchId: input.syncBatchId,
            queuedEventCount: input.events.length
          }
        }),
        { syncBatchId: input.syncBatchId }
      );
    }
    return { isNew: Boolean(inserted), status: batch.status };
  });

  if (!batchState.isNew && batchState.status !== "processing") {
    return priorReplayResult(db, input.syncBatchId);
  }

  const dispositions: ReplayEventDisposition[] = [];
  for (let index = 0; index < input.events.length; index += 1) {
    const rawEvent = input.events[index];
    const rawHash = hashCanonicalValue(rawEvent);
    const parsed = createEventRequestSchema.safeParse(rawEvent);
    const sourceSiteEventId =
      typeof rawEvent === "object" && rawEvent !== null && "sourceSiteEventId" in rawEvent
        ? String((rawEvent as { sourceSiteEventId?: unknown }).sourceSiteEventId ?? "")
        : "";
    let rejection: { code: string; message: string } | null = null;
    if (!parsed.success) {
      rejection = { code: "INVALID_EVENT", message: "Replay event payload is invalid" };
    } else if (!externalEventTypeSchema.safeParse(parsed.data.eventType).success) {
      rejection = { code: "INTERNAL_EVENT_FORBIDDEN", message: "Internal event types cannot be replayed" };
    } else if (!parsed.data.sourceSiteEventId) {
      rejection = { code: "SOURCE_EVENT_ID_REQUIRED", message: "Replay events require a stable source event id" };
    }

    if (rejection || !parsed.success) {
      const error = rejection ?? { code: "INVALID_EVENT", message: "Replay event payload is invalid" };
      await db.insert(syncBatchEventAttempts).values({
        id: randomUUID(),
        syncBatchId: input.syncBatchId,
        eventIndex: index,
        sourceSiteEventId: sourceSiteEventId || `<missing:${index}>`,
        eventHash: rawHash,
        disposition: "rejected",
        errorCode: error.code,
        errorMessage: error.message
      });
      dispositions.push({
        index,
        sourceSiteEventId: sourceSiteEventId || `<missing:${index}>`,
        eventHash: rawHash,
        disposition: "rejected",
        eventId: null,
        sequenceNumber: null,
        errorCode: error.code,
        errorMessage: error.message
      });
      continue;
    }

    try {
      const result = await db.transaction(async (transaction) => {
        const accepted = await ingestEventTransaction(transaction, parsed.data, {
          syncBatchId: input.syncBatchId
        });
        await transaction.insert(syncBatchEventAttempts).values({
          id: randomUUID(),
          syncBatchId: input.syncBatchId,
          eventIndex: index,
          sourceSiteEventId: parsed.data.sourceSiteEventId!,
          eventHash: accepted.eventHash,
          disposition: accepted.deduplicated ? "deduplicated" : "accepted",
          eventId: accepted.eventId
        });
        return accepted;
      });
      dispositions.push({
        index,
        sourceSiteEventId: parsed.data.sourceSiteEventId!,
        eventHash: result.eventHash,
        disposition: result.deduplicated ? "deduplicated" : "accepted",
        eventId: result.eventId,
        sequenceNumber: result.sequenceNumber,
        errorCode: null,
        errorMessage: null
      });
    } catch (error) {
      const rejected = replayError(error);
      await db.insert(syncBatchEventAttempts).values({
        id: randomUUID(),
        syncBatchId: input.syncBatchId,
        eventIndex: index,
        sourceSiteEventId: parsed.data.sourceSiteEventId!,
        eventHash: hashEvent(parsed.data),
        disposition: "rejected",
        errorCode: rejected.code,
        errorMessage: rejected.message
      });
      dispositions.push({
        index,
        sourceSiteEventId: parsed.data.sourceSiteEventId!,
        eventHash: hashEvent(parsed.data),
        disposition: "rejected",
        eventId: null,
        sequenceNumber: null,
        errorCode: rejected.code,
        errorMessage: rejected.message
      });
    }
  }

  const acceptedEventCount = dispositions.filter((item) => item.disposition !== "rejected").length;
  const rejectedEventCount = dispositions.filter((item) => item.disposition === "rejected").length;
  const deduplicatedEventCount = dispositions.filter(
    (item) => item.disposition === "deduplicated"
  ).length;
  const rejectionReasons = [
    ...new Set(
      dispositions
        .filter((item) => item.errorCode)
        .map((item) => `${item.errorCode}: ${item.errorMessage}`.slice(0, 500))
    )
  ].slice(0, 20) as string[];
  const status = replayStatus(acceptedEventCount, rejectedEventCount);
  const completedAt = suppliedCompletedAt ?? new Date();

  await db.transaction(async (transaction) => {
    const [lockedBatch] = await transaction
      .select()
      .from(syncBatches)
      .where(
        and(
          eq(syncBatches.id, input.syncBatchId),
          eq(syncBatches.siteId, input.siteId),
          eq(syncBatches.requestHash, requestHash),
          eq(syncBatches.status, "processing")
        )
      )
      .for("update")
      .limit(1);
    if (!lockedBatch) {
      throw new ApiError(409, "Sync batch changed before completion", undefined, "SYNC_BATCH_STATE_CONFLICT");
    }
    await ingestEventTransaction(
      transaction,
      createEventRequestSchema.parse({
        eventType: "site_sync_completed",
        assetId: null,
        siteId: input.siteId,
        transferOrderId: null,
        occurredAt: completedAt.toISOString(),
        sourceSiteEventId: `${input.syncBatchId}:lifecycle:complete`,
        payload: {
          syncBatchId: input.syncBatchId,
          acceptedEventCount,
          rejectedEventCount,
          deduplicatedEventCount,
          rejectionReasons
        }
      }),
      { syncBatchId: input.syncBatchId }
    );
    const [completedBatch] = await transaction
      .select({ status: syncBatches.status })
      .from(syncBatches)
      .where(eq(syncBatches.id, input.syncBatchId))
      .limit(1);
    if (completedBatch?.status !== status) {
      throw new ApiError(409, "Sync batch completion was not persisted", undefined, "SYNC_BATCH_STATE_CONFLICT");
    }
  });

  incrementCounter("syncReplayAccepted", acceptedEventCount);
  incrementCounter("syncReplayRejected", rejectedEventCount);
  return {
    syncBatchId: input.syncBatchId,
    status,
    acceptedEventCount,
    rejectedEventCount,
    deduplicatedEventCount,
    rejectionReasons,
    dispositions
  };
}

export async function fetchEventsForAsset(db: Database, assetId: string): Promise<DomainEvent[]> {
  const rows = await db
    .select()
    .from(eventLog)
    .where(eq(eventLog.assetId, assetId))
    .orderBy(desc(eventLog.sequenceNumber))
    .limit(200);
  return rows.map((row) => ({
    eventId: row.id,
    eventType: row.eventType as DomainEvent["eventType"],
    sequenceNumber: row.sequenceNumber,
    assetId: row.assetId,
    siteId: row.siteId,
    transferOrderId: row.transferOrderId,
    occurredAt: row.occurredAt.toISOString(),
    payload: row.payload as Record<string, unknown>
  }));
}

export async function fetchLatestEventSequence(db: Database, assetId: string): Promise<number | null> {
  const rows = await db
    .select({ sequenceNumber: eventLog.sequenceNumber })
    .from(eventLog)
    .where(eq(eventLog.assetId, assetId))
    .orderBy(desc(eventLog.sequenceNumber))
    .limit(1);
  return rows[0]?.sequenceNumber ?? null;
}
