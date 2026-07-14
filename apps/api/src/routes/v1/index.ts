import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createEventRequestSchema, externalEventTypeSchema, resolvedAssetStatusSchema } from "@ops/contracts";
import { fetchEventsForAsset, ingestEvent, ingestSyncReplay } from "../../domain/event-service";
import { runDivergenceScan } from "../../domain/divergence-service";
import {
  dashboardSummary,
  getAssetById,
  getReconciliationCaseById,
  getSiteById,
  getSyncBatchById,
  getTransferById,
  listEvidenceMetadata,
  listAlerts,
  listAssets,
  listReconciliationCases,
  listSites,
  listSyncBatches,
  listTransfers,
  openReconciliationCase,
  recentAlerts,
  recentBatches,
  recentTransfers,
  resolveReconciliationCase
} from "../../domain/query-service";
import { ApiError } from "../../lib/errors";
import { env } from "../../lib/env";

export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  const assetParamsSchema = z.object({
    assetId: z.string().uuid()
  });
  const siteParamsSchema = z.object({
    siteId: z.string().uuid()
  });
  const transferParamsSchema = z.object({
    transferId: z.string().uuid()
  });
  const syncBatchParamsSchema = z.object({
    syncBatchId: z.string().uuid()
  });
  const syncReplayBodySchema = z.object({
    siteId: z.string().uuid(),
    syncBatchId: z.string().uuid(),
    events: z.array(z.unknown()).max(500)
  }).strict();
  const openCaseBodySchema = z.object({
    alertId: z.string().uuid().optional(),
    assetId: z.string().uuid().optional(),
    siteId: z.string().uuid(),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(3).max(8_000)
  }).strict();
  const resolveCaseParamsSchema = z.object({
    caseId: z.string().uuid()
  });
  const resolveCaseBodySchema = z.object({
    resolutionSummary: z.string().trim().min(12).max(8_000),
    expectedVersion: z.number().int().positive(),
    resolvedAssetStatus: resolvedAssetStatusSchema.nullable().optional()
  }).strict();

  app.get("/sites", async () => ({ data: await listSites(app.db) }));
  app.get(
    "/sites/:siteId",
    {
      schema: {
        params: siteParamsSchema
      }
    },
    async (request) => {
      const { siteId } = request.params as z.infer<typeof siteParamsSchema>;
      const details = await getSiteById(app.db, siteId);
      if (!details) {
        throw new ApiError(404, "Site not found");
      }
      return { data: details };
    }
  );

  app.get("/assets", async () => ({ data: await listAssets(app.db) }));

  app.get(
    "/assets/:assetId",
    {
      schema: {
        params: assetParamsSchema
      }
    },
    async (request) => {
      const { assetId } = request.params as z.infer<typeof assetParamsSchema>;
      const details = await getAssetById(app.db, assetId);
      if (!details) {
        throw new ApiError(404, "Asset not found");
      }
      return { data: details };
    }
  );

  app.get(
    "/assets/:assetId/events",
    {
      schema: {
        params: assetParamsSchema
      }
    },
    async (request) => {
      const { assetId } = request.params as z.infer<typeof assetParamsSchema>;
      return { data: await fetchEventsForAsset(app.db, assetId) };
    }
  );

  app.get("/transfers", async () => ({ data: await listTransfers(app.db) }));
  app.get(
    "/transfers/:transferId",
    {
      schema: {
        params: transferParamsSchema
      }
    },
    async (request) => {
      const { transferId } = request.params as z.infer<typeof transferParamsSchema>;
      const details = await getTransferById(app.db, transferId);
      if (!details) {
        throw new ApiError(404, "Transfer not found");
      }
      return { data: details };
    }
  );
  app.get("/alerts", async () => ({ data: await listAlerts(app.db) }));
  app.get("/evidence-metadata", async () => ({ data: await listEvidenceMetadata(app.db) }));
  app.get("/reconciliation-cases", async () => ({ data: await listReconciliationCases(app.db) }));
  app.get(
    "/reconciliation-cases/:caseId",
    {
      schema: {
        params: resolveCaseParamsSchema
      }
    },
    async (request) => {
      const { caseId } = request.params as z.infer<typeof resolveCaseParamsSchema>;
      const details = await getReconciliationCaseById(app.db, caseId);
      if (!details) {
        throw new ApiError(404, "Reconciliation case not found");
      }
      return { data: details };
    }
  );
  app.get("/sync-batches", async () => ({ data: await listSyncBatches(app.db) }));
  app.get(
    "/sync-batches/:syncBatchId",
    {
      schema: {
        params: syncBatchParamsSchema
      }
    },
    async (request) => {
      const { syncBatchId } = request.params as z.infer<typeof syncBatchParamsSchema>;
      const details = await getSyncBatchById(app.db, syncBatchId);
      if (!details) {
        throw new ApiError(404, "Sync batch not found");
      }
      return { data: details };
    }
  );

  app.get("/dashboard", async () => ({
    data: {
      summary: await dashboardSummary(app.db),
      policy: {
        syncStaleMinutes: env.SYNC_STALE_MINUTES,
        transferConfirmationHours: env.TRANSFER_CONFIRMATION_HOURS,
        dualSiteObservationMinutes: env.DUAL_SITE_OBSERVATION_MINUTES
      },
      recentTransfers: await recentTransfers(app.db),
      recentAlerts: await recentAlerts(app.db),
      recentSyncBatches: await recentBatches(app.db)
    }
  }));

  app.post(
    "/events",
    {
      schema: {
        body: createEventRequestSchema
      }
    },
    async (request) => {
      const body = request.body as z.infer<typeof createEventRequestSchema>;
      if (!externalEventTypeSchema.safeParse(body.eventType).success) {
        throw new ApiError(403, "Internal event types cannot be submitted directly", undefined, "INTERNAL_EVENT_FORBIDDEN");
      }
      if (!body.sourceSiteEventId) {
        throw new ApiError(400, "A stable sourceSiteEventId is required", undefined, "SOURCE_EVENT_ID_REQUIRED");
      }
      const result = await ingestEvent(app.db, body);
      return {
        data: result
      };
    }
  );

  app.post(
    "/sync/replay",
    {
      schema: {
        body: syncReplayBodySchema
      }
    },
    async (request) => {
      const body = request.body as z.infer<typeof syncReplayBodySchema>;
      const result = await ingestSyncReplay(app.db, body);
      return { data: result };
    }
  );

  app.post("/divergence/scan", async () => {
    const result = await runDivergenceScan(app.db);
    return { data: result };
  });

  app.post(
    "/reconciliation-cases",
    {
      schema: {
        body: openCaseBodySchema
      }
    },
    async (request) => {
      const body = request.body as z.infer<typeof openCaseBodySchema>;
      return { data: await openReconciliationCase(app.db, body, request.testActor) };
    }
  );

  app.patch(
    "/reconciliation-cases/:caseId/resolve",
    {
      schema: {
        params: resolveCaseParamsSchema,
        body: resolveCaseBodySchema
      }
    },
    async (request) => {
      const { caseId } = request.params as z.infer<typeof resolveCaseParamsSchema>;
      const body = request.body as z.infer<typeof resolveCaseBodySchema>;
      const caseRecord = await resolveReconciliationCase(app.db, caseId, body, request.testActor);
      if (!caseRecord) {
        throw new ApiError(404, "Reconciliation case not found");
      }
      return { data: caseRecord };
    }
  );
}
