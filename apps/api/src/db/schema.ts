import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

export const sites = pgTable("site", {
  id: uuid("id").primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastSyncCompletedAt: timestamp("last_sync_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const assets = pgTable("asset", {
  id: uuid("id").primaryKey(),
  serialNumber: varchar("serial_number", { length: 96 }).notNull().unique(),
  containerId: varchar("container_id", { length: 96 }),
  registeredSiteId: uuid("registered_site_id")
    .notNull()
    .references(() => sites.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const transferOrders = pgTable("transfer_order", {
  id: uuid("id").primaryKey(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  originSiteId: uuid("origin_site_id")
    .notNull()
    .references(() => sites.id),
  destinationSiteId: uuid("destination_site_id")
    .notNull()
    .references(() => sites.id),
  status: varchar("status", { length: 24 }).notNull(),
  initiatedBy: varchar("initiated_by", { length: 96 }).notNull(),
  initiatedAt: timestamp("initiated_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completionNote: text("completion_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const syncBatches = pgTable("sync_batch", {
  id: uuid("id").primaryKey(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id),
  status: varchar("status", { length: 24 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  queuedEventCount: integer("queued_event_count").notNull().default(0),
  acceptedEventCount: integer("accepted_event_count").notNull().default(0),
  rejectedEventCount: integer("rejected_event_count").notNull().default(0),
  deduplicatedEventCount: integer("deduplicated_event_count").notNull().default(0),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  replayResultSummary: text("replay_result_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const eventLog = pgTable(
  "event_log",
  {
    id: uuid("id").primaryKey(),
    sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    assetId: uuid("asset_id"),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    transferOrderId: uuid("transfer_order_id"),
    syncBatchId: uuid("sync_batch_id"),
    sourceSiteEventId: varchar("source_site_event_id", { length: 128 }),
    eventHash: varchar("event_hash", { length: 64 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull()
  },
  (table) => ({
    dedupeIndex: uniqueIndex("event_log_site_source_event_unq").on(
      table.siteId,
      table.sourceSiteEventId
    ),
    assetSequenceIndex: index("idx_event_log_asset_sequence").on(table.assetId, table.sequenceNumber),
    siteOccurredAtIndex: index("idx_event_log_site_occurred_at").on(table.siteId, table.occurredAt),
    transferOrderIndex: index("idx_event_log_transfer_order_id").on(table.transferOrderId),
    syncBatchIndex: index("idx_event_log_sync_batch_id").on(table.syncBatchId)
  })
);

export const syncBatchEventAttempts = pgTable(
  "sync_batch_event_attempt",
  {
    id: uuid("id").primaryKey(),
    syncBatchId: uuid("sync_batch_id")
      .notNull()
      .references(() => syncBatches.id),
    eventIndex: integer("event_index").notNull(),
    sourceSiteEventId: varchar("source_site_event_id", { length: 128 }).notNull(),
    eventHash: varchar("event_hash", { length: 64 }).notNull(),
    disposition: varchar("disposition", { length: 24 }).notNull(),
    eventId: uuid("event_id").references(() => eventLog.id),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: varchar("error_message", { length: 500 }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    batchIndex: index("idx_sync_batch_event_attempt_batch").on(
      table.syncBatchId,
      table.eventIndex
    ),
    sourceIndex: index("idx_sync_batch_event_attempt_source").on(
      table.sourceSiteEventId
    )
  })
);

export const assetProjection = pgTable("asset_projection", {
  assetId: uuid("asset_id")
    .primaryKey()
    .references(() => assets.id),
  serialNumber: varchar("serial_number", { length: 96 }).notNull(),
  currentSiteId: uuid("current_site_id").references(() => sites.id),
  containerId: varchar("container_id", { length: 96 }),
  status: varchar("status", { length: 32 }).notNull(),
  lastEventType: varchar("last_event_type", { length: 64 }).notNull(),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
  lastSequence: bigint("last_sequence", { mode: "number" }).notNull(),
  version: integer("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const inspections = pgTable("inspection", {
  id: uuid("id").primaryKey(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id),
  status: varchar("status", { length: 24 }).notNull(),
  notes: text("notes").notNull(),
  inspectedAt: timestamp("inspected_at", { withTimezone: true }).notNull(),
  createdEventId: uuid("created_event_id")
    .notNull()
    .references(() => eventLog.id)
});

export const evidenceMetadata = pgTable("evidence_metadata", {
  id: uuid("id").primaryKey(),
  inspectionId: uuid("inspection_id")
    .notNull()
    .references(() => inspections.id),
  mimeType: varchar("mime_type", { length: 96 }).notNull(),
  sha256: varchar("sha256", { length: 128 }).notNull(),
  storageRef: varchar("storage_ref", { length: 256 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow()
});

export const alerts = pgTable(
  "alert",
  {
    id: uuid("id").primaryKey(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    ruleCode: varchar("rule_code", { length: 128 }).notNull(),
    severity: varchar("severity", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    assetId: uuid("asset_id").references(() => assets.id),
    siteId: uuid("site_id").references(() => sites.id),
    summary: text("summary").notNull(),
    details: jsonb("details").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    lastDetectedAt: timestamp("last_detected_at", { withTimezone: true }).notNull().defaultNow(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    acknowledgedBy: varchar("acknowledged_by", { length: 96 }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
  },
  (table) => ({
    fingerprintIndex: uniqueIndex("alert_fingerprint_unq").on(table.fingerprint)
  })
);

export const reconciliationCases = pgTable("reconciliation_case", {
  id: uuid("id").primaryKey(),
  alertId: uuid("alert_id").references(() => alerts.id),
  assetId: uuid("asset_id").references(() => assets.id),
  siteId: uuid("site_id").references(() => sites.id),
  status: varchar("status", { length: 24 }).notNull().default("open"),
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description").notNull(),
  openedBy: varchar("opened_by", { length: 96 }).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedBy: varchar("resolved_by", { length: 96 }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionSummary: text("resolution_summary"),
  version: integer("version").notNull().default(1)
});

export type Site = typeof sites.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type EventLogRecord = typeof eventLog.$inferSelect;
