import { z } from "zod";

export const eventTypeSchema = z.enum([
  "asset_registered",
  "asset_moved",
  "asset_received",
  "inspection_recorded",
  "evidence_attached",
  "transfer_initiated",
  "transfer_completed",
  "site_sync_started",
  "site_sync_completed",
  "divergence_detected",
  "divergence_cleared",
  "reconciliation_opened",
  "reconciliation_resolved"
]);

export const externalEventTypeSchema = z.enum([
  "asset_registered",
  "asset_moved",
  "asset_received",
  "inspection_recorded",
  "evidence_attached",
  "transfer_initiated",
  "transfer_completed"
]);

export type EventType = z.infer<typeof eventTypeSchema>;

const actorSchema = z.string().trim().min(2).max(96);
const optionalSourceEventIdSchema = z.string().trim().min(1).max(128).nullable().optional();
const nullableTransferOrderIdSchema = z.string().uuid().nullable().optional();
const nullableAssetIdSchema = z.string().uuid().nullable().optional();
const occurredAtSchema = z.string().datetime({ offset: true });

const commonFields = {
  siteId: z.string().uuid(),
  occurredAt: occurredAtSchema,
  sourceSiteEventId: optionalSourceEventIdSchema
};

export const assetRegisteredPayloadSchema = z
  .object({
    serialNumber: z.string().trim().min(3).max(96),
    containerId: z.string().trim().min(1).max(96).nullable().optional(),
    registeredBy: actorSchema
  })
  .strict();

export const assetMovedPayloadSchema = z
  .object({
    fromSiteId: z.string().uuid(),
    toSiteId: z.string().uuid(),
    reason: z.string().trim().min(1).max(500)
  })
  .strict();

export const assetReceivedPayloadSchema = z
  .object({
    fromSiteId: z.string().uuid(),
    condition: z.enum(["ok", "damaged", "quarantined"]),
    receivedBy: actorSchema
  })
  .strict();

export const inspectionRecordedPayloadSchema = z
  .object({
    inspectionId: z.string().uuid(),
    status: z.enum(["pass", "fail", "review"]),
    notes: z.string().trim().min(1).max(4_000)
  })
  .strict();

export const evidenceAttachedPayloadSchema = z
  .object({
    inspectionId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    mimeType: z.string().trim().min(3).max(96),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i, "sha256 must be exactly 64 hexadecimal characters")
  })
  .strict();

export const transferInitiatedPayloadSchema = z
  .object({
    transferOrderId: z.string().uuid(),
    originSiteId: z.string().uuid(),
    destinationSiteId: z.string().uuid(),
    initiatedBy: actorSchema
  })
  .strict();

export const transferCompletedPayloadSchema = z
  .object({
    transferOrderId: z.string().uuid(),
    completedBy: actorSchema,
    completionNote: z.string().trim().min(1).max(4_000).optional()
  })
  .strict();

export const syncStartedPayloadSchema = z
  .object({
    syncBatchId: z.string().uuid(),
    queuedEventCount: z.number().int().nonnegative().max(10_000)
  })
  .strict();

export const syncCompletedPayloadSchema = z
  .object({
    syncBatchId: z.string().uuid(),
    acceptedEventCount: z.number().int().nonnegative(),
    rejectedEventCount: z.number().int().nonnegative(),
    deduplicatedEventCount: z.number().int().nonnegative().optional(),
    rejectionReasons: z.array(z.string().trim().min(3).max(500)).max(20).optional()
  })
  .strict();

export const divergenceDetectedPayloadSchema = z
  .object({
    alertId: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
    ruleCode: z.string().trim().min(1).max(128),
    severity: z.enum(["low", "medium", "high"]),
    summary: z.string().trim().min(3).max(1_000),
    details: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const divergenceClearedPayloadSchema = z
  .object({
    alertId: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
    ruleCode: z.string().trim().min(1).max(128),
    resolvedBy: actorSchema,
    summary: z.string().trim().min(3).max(1_000)
  })
  .strict();

export const reconciliationOpenedPayloadSchema = z
  .object({
    caseId: z.string().uuid(),
    alertId: z.string().uuid().nullable(),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(3).max(8_000),
    openedBy: actorSchema
  })
  .strict();

export const resolvedAssetStatusSchema = z.enum([
  "registered",
  "in_transit",
  "at_site",
  "under_inspection"
]);

export const reconciliationResolvedPayloadSchema = z
  .object({
    caseId: z.string().uuid(),
    resolvedBy: actorSchema,
    resolutionSummary: z.string().trim().min(3).max(8_000),
    resolvedAssetStatus: resolvedAssetStatusSchema.nullable().optional(),
    expectedCaseVersion: z.number().int().positive()
  })
  .strict();

export const eventPayloadSchemas = {
  asset_registered: assetRegisteredPayloadSchema,
  asset_moved: assetMovedPayloadSchema,
  asset_received: assetReceivedPayloadSchema,
  inspection_recorded: inspectionRecordedPayloadSchema,
  evidence_attached: evidenceAttachedPayloadSchema,
  transfer_initiated: transferInitiatedPayloadSchema,
  transfer_completed: transferCompletedPayloadSchema,
  site_sync_started: syncStartedPayloadSchema,
  site_sync_completed: syncCompletedPayloadSchema,
  divergence_detected: divergenceDetectedPayloadSchema,
  divergence_cleared: divergenceClearedPayloadSchema,
  reconciliation_opened: reconciliationOpenedPayloadSchema,
  reconciliation_resolved: reconciliationResolvedPayloadSchema
} satisfies Record<EventType, z.ZodType>;

const eventSchemas = [
  z.object({
    eventType: z.literal("asset_registered"),
    assetId: z.string().uuid(),
    transferOrderId: z.null().optional(),
    payload: assetRegisteredPayloadSchema,
    ...commonFields
  }).strict(),
  z.object({
    eventType: z.literal("asset_moved"),
    assetId: z.string().uuid(),
    transferOrderId: nullableTransferOrderIdSchema,
    payload: assetMovedPayloadSchema,
    ...commonFields
  }).strict(),
  z.object({
    eventType: z.literal("asset_received"),
    assetId: z.string().uuid(),
    transferOrderId: nullableTransferOrderIdSchema,
    payload: assetReceivedPayloadSchema,
    ...commonFields
  }).strict(),
  z.object({
    eventType: z.literal("inspection_recorded"),
    assetId: z.string().uuid(),
    transferOrderId: nullableTransferOrderIdSchema,
    payload: inspectionRecordedPayloadSchema,
    ...commonFields
  }).strict(),
  z.object({
    eventType: z.literal("evidence_attached"),
    assetId: z.string().uuid(),
    transferOrderId: nullableTransferOrderIdSchema,
    payload: evidenceAttachedPayloadSchema,
    ...commonFields
  }).strict(),
  z.object({
    eventType: z.literal("transfer_initiated"),
    assetId: z.string().uuid(),
    transferOrderId: z.string().uuid(),
    payload: transferInitiatedPayloadSchema,
    ...commonFields
  }).strict(),
  z.object({
    eventType: z.literal("transfer_completed"),
    assetId: z.string().uuid(),
    transferOrderId: z.string().uuid(),
    payload: transferCompletedPayloadSchema,
    ...commonFields
  }).strict(),
  z.object({
    eventType: z.literal("site_sync_started"),
    assetId: z.null().optional(),
    transferOrderId: z.null().optional(),
    payload: syncStartedPayloadSchema,
    ...commonFields
  }).strict(),
  z.object({
    eventType: z.literal("site_sync_completed"),
    assetId: z.null().optional(),
    transferOrderId: z.null().optional(),
    payload: syncCompletedPayloadSchema,
    ...commonFields
  }).strict(),
  z.object({
    eventType: z.literal("divergence_detected"),
    assetId: nullableAssetIdSchema,
    transferOrderId: z.null().optional(),
    payload: divergenceDetectedPayloadSchema,
    ...commonFields
  }).strict(),
  z.object({
    eventType: z.literal("divergence_cleared"),
    assetId: nullableAssetIdSchema,
    transferOrderId: z.null().optional(),
    payload: divergenceClearedPayloadSchema,
    ...commonFields
  }).strict(),
  z.object({
    eventType: z.literal("reconciliation_opened"),
    assetId: nullableAssetIdSchema,
    transferOrderId: nullableTransferOrderIdSchema,
    payload: reconciliationOpenedPayloadSchema,
    ...commonFields
  }).strict(),
  z.object({
    eventType: z.literal("reconciliation_resolved"),
    assetId: nullableAssetIdSchema,
    transferOrderId: nullableTransferOrderIdSchema,
    payload: reconciliationResolvedPayloadSchema,
    ...commonFields
  }).strict()
] as const;

export const baseEventSchema = z.object({
  eventType: eventTypeSchema,
  assetId: nullableAssetIdSchema,
  siteId: z.string().uuid(),
  transferOrderId: nullableTransferOrderIdSchema,
  occurredAt: occurredAtSchema,
  sourceSiteEventId: optionalSourceEventIdSchema,
  payload: z.record(z.string(), z.unknown())
});

export const createEventRequestSchema = z
  .discriminatedUnion("eventType", eventSchemas)
  .superRefine((value, ctx) => {
    if (new Date(value.occurredAt).getTime() > Date.now() + 5 * 60 * 1_000) {
      ctx.addIssue({
        code: "custom",
        path: ["occurredAt"],
        message: "occurredAt cannot be more than five minutes in the future"
      });
    }

    switch (value.eventType) {
      case "asset_moved":
        if (value.siteId !== value.payload.fromSiteId) {
          ctx.addIssue({ code: "custom", path: ["siteId"], message: "siteId must equal fromSiteId" });
        }
        if (value.payload.fromSiteId === value.payload.toSiteId) {
          ctx.addIssue({ code: "custom", path: ["payload", "toSiteId"], message: "movement must change sites" });
        }
        break;
      case "asset_received":
        if (value.siteId === value.payload.fromSiteId) {
          ctx.addIssue({ code: "custom", path: ["payload", "fromSiteId"], message: "receiving site must differ from source site" });
        }
        break;
      case "transfer_initiated":
        if (value.transferOrderId !== value.payload.transferOrderId) {
          ctx.addIssue({ code: "custom", path: ["transferOrderId"], message: "transferOrderId must match payload" });
        }
        if (value.siteId !== value.payload.originSiteId) {
          ctx.addIssue({ code: "custom", path: ["siteId"], message: "siteId must equal originSiteId" });
        }
        if (value.payload.originSiteId === value.payload.destinationSiteId) {
          ctx.addIssue({ code: "custom", path: ["payload", "destinationSiteId"], message: "transfer destination must differ from origin" });
        }
        break;
      case "transfer_completed":
        if (value.transferOrderId !== value.payload.transferOrderId) {
          ctx.addIssue({ code: "custom", path: ["transferOrderId"], message: "transferOrderId must match payload" });
        }
        break;
      default:
        break;
    }
  });

export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;
