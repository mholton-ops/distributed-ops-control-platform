import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { closeDatabase, db, pool } from "../src/db/client";
import {
  alerts,
  assetProjection,
  eventLog,
  reconciliationCases,
  sites,
  syncBatches
} from "../src/db/schema";
import { runDivergenceScan } from "../src/domain/divergence-service";
import { ingestEvent, ingestSyncReplay } from "../src/domain/event-service";
import {
  openReconciliationCase,
  resolveReconciliationCase
} from "../src/domain/query-service";
import { ApiError } from "../src/lib/errors";
import { buildScenarios } from "../../simulator/src/scenarios";

const integrationEnabled = process.env.OPS_RUN_DB_INTEGRATION === "1";
const databaseDescribe = integrationEnabled ? describe.sequential : describe.skip;

const SITE_A = "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1";
const SITE_B = "c55f6935-40df-4aa7-9f84-5b9c8e5f9a60";
const ASSET_A = "7b4b2d2f-88fb-4d8d-931a-6a5645f1e7c2";

async function seedSites(): Promise<void> {
  await db.insert(sites).values([
    { id: SITE_A, code: "A", name: "Site A", lastSyncCompletedAt: new Date() },
    { id: SITE_B, code: "B", name: "Site B", lastSyncCompletedAt: new Date() }
  ]);
}

async function registerAsset(sourceSiteEventId = "register-asset-a"): Promise<void> {
  await ingestEvent(db, {
    eventType: "asset_registered",
    assetId: ASSET_A,
    siteId: SITE_A,
    transferOrderId: null,
    occurredAt: new Date().toISOString(),
    sourceSiteEventId,
    payload: {
      serialNumber: "SERIAL-A",
      containerId: "CONTAINER-A",
      registeredBy: "integration-test"
    }
  });
}

async function waitForProcessingBatch(batchId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [batch] = await db
      .select({ status: syncBatches.status })
      .from(syncBatches)
      .where(eq(syncBatches.id, batchId))
      .limit(1);
    if (batch?.status === "processing") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for replay batch to enter processing state");
}

databaseDescribe("PostgreSQL event integrity", () => {
  beforeEach(async () => {
    await db.execute(sql`
      truncate table
        sync_batch_event_attempt,
        reconciliation_case,
        alert,
        evidence_metadata,
        inspection,
        asset_projection,
        event_log,
        sync_batch,
        transfer_order,
        asset,
        site
      restart identity cascade
    `);
    await seedSites();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("runs with the restricted app role instead of the bootstrap administrator", async () => {
    const result = await pool.query<{
      role_name: string;
      database_name: string;
      is_superuser: boolean;
      can_create_database: boolean;
      can_create_role: boolean;
      can_replicate: boolean;
      can_bypass_rls: boolean;
      has_role_memberships: boolean;
      can_create_database_objects: boolean;
      can_use_public_schema: boolean;
      can_create_in_public_schema: boolean;
    }>(`
      select
        current_user::text as role_name,
        current_database()::text as database_name,
        r.rolsuper as is_superuser,
        r.rolcreatedb as can_create_database,
        r.rolcreaterole as can_create_role,
        r.rolreplication as can_replicate,
        r.rolbypassrls as can_bypass_rls,
        exists (select 1 from pg_auth_members m where m.member = r.oid) as has_role_memberships,
        has_database_privilege(current_user, current_database(), 'CREATE') as can_create_database_objects,
        has_schema_privilege(current_user, 'public', 'USAGE') as can_use_public_schema,
        has_schema_privilege(current_user, 'public', 'CREATE') as can_create_in_public_schema
      from pg_roles r
      where r.rolname = current_user
    `);

    expect(result.rows[0]).toEqual({
      role_name: "ops_test",
      database_name: "ops_control_test",
      is_superuser: false,
      can_create_database: false,
      can_create_role: false,
      can_replicate: false,
      can_bypass_rls: false,
      has_role_memberships: false,
      can_create_database_objects: false,
      can_use_public_schema: true,
      can_create_in_public_schema: true
    });
  });

  it("rolls back the ledger append when a side effect fails", async () => {
    await expect(
      ingestEvent(db, {
        eventType: "asset_received",
        assetId: ASSET_A,
        siteId: SITE_A,
        transferOrderId: null,
        occurredAt: new Date().toISOString(),
        sourceSiteEventId: "unknown-asset-receipt",
        payload: { fromSiteId: SITE_B, condition: "ok", receivedBy: "integration-test" }
      })
    ).rejects.toMatchObject({ code: "UNKNOWN_ASSET" });

    const events = await db.select({ id: eventLog.id }).from(eventLog);
    expect(events).toHaveLength(0);
  });

  it("deduplicates exact retries and rejects payload changes for the same source id", async () => {
    const event = {
      eventType: "asset_registered" as const,
      assetId: ASSET_A,
      siteId: SITE_A,
      transferOrderId: null,
      occurredAt: new Date().toISOString(),
      sourceSiteEventId: "stable-registration",
      payload: {
        serialNumber: "SERIAL-A",
        containerId: "CONTAINER-A",
        registeredBy: "integration-test"
      }
    };
    const first = await ingestEvent(db, event);
    const exactRetry = await ingestEvent(db, event);
    expect(exactRetry).toMatchObject({
      eventId: first.eventId,
      sequenceNumber: first.sequenceNumber,
      deduplicated: true
    });

    await expect(
      ingestEvent(db, {
        ...event,
        payload: { ...event.payload, serialNumber: "SERIAL-CHANGED" }
      })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_PAYLOAD_CONFLICT" });
    expect(await db.select({ id: eventLog.id }).from(eventLog)).toHaveLength(1);
  });

  it("rejects reused business identifiers under a different source identity", async () => {
    const registeredAt = new Date().toISOString();
    await registerAsset("business-id-registration");
    await expect(
      ingestEvent(db, {
        eventType: "asset_registered",
        assetId: ASSET_A,
        siteId: SITE_A,
        transferOrderId: null,
        occurredAt: registeredAt,
        sourceSiteEventId: "business-id-registration-alias",
        payload: {
          serialNumber: "SERIAL-A",
          containerId: "CONTAINER-A",
          registeredBy: "integration-test"
        }
      })
    ).rejects.toMatchObject({ code: "ENTITY_IDENTITY_CONFLICT" });

    const transferOrderId = "6d55f8f7-5ddf-4c07-91f7-26d1b91a9f20";
    const initiatedAt = new Date().toISOString();
    const transferInitiated = {
      eventType: "transfer_initiated" as const,
      assetId: ASSET_A,
      siteId: SITE_A,
      transferOrderId,
      occurredAt: initiatedAt,
      sourceSiteEventId: "business-id-transfer",
      payload: {
        transferOrderId,
        originSiteId: SITE_A,
        destinationSiteId: SITE_B,
        initiatedBy: "integration-test"
      }
    };
    await ingestEvent(db, transferInitiated);
    await ingestEvent(db, {
      eventType: "transfer_completed",
      assetId: ASSET_A,
      siteId: SITE_B,
      transferOrderId,
      occurredAt: new Date().toISOString(),
      sourceSiteEventId: "business-id-transfer-completed",
      payload: { transferOrderId, completedBy: "integration-test" }
    });
    await expect(
      ingestEvent(db, {
        ...transferInitiated,
        sourceSiteEventId: "business-id-transfer-alias"
      })
    ).rejects.toMatchObject({ code: "ENTITY_IDENTITY_CONFLICT" });

    const [projection] = await db
      .select()
      .from(assetProjection)
      .where(eq(assetProjection.assetId, ASSET_A));
    expect(projection.status).toBe("at_site");
    expect(projection.lastEventType).toBe("transfer_completed");

    const inspectionId = "74c53fe2-34f7-4282-a35d-848d3ce67c34";
    const inspection = {
      eventType: "inspection_recorded" as const,
      assetId: ASSET_A,
      siteId: SITE_B,
      transferOrderId,
      occurredAt: new Date().toISOString(),
      sourceSiteEventId: "business-id-inspection",
      payload: { inspectionId, status: "pass" as const, notes: "Business identity test" }
    };
    await ingestEvent(db, inspection);
    await expect(
      ingestEvent(db, { ...inspection, sourceSiteEventId: "business-id-inspection-alias" })
    ).rejects.toMatchObject({ code: "ENTITY_IDENTITY_CONFLICT" });

    const evidence = {
      eventType: "evidence_attached" as const,
      assetId: ASSET_A,
      siteId: SITE_B,
      transferOrderId,
      occurredAt: new Date().toISOString(),
      sourceSiteEventId: "business-id-evidence",
      payload: {
        inspectionId,
        evidenceId: "f87d9a37-208e-4acd-ad07-758f24526440",
        mimeType: "image/jpeg",
        sha256: "de0962967c21475fcd136b227ad45cb4bf8a18ba8624366ad2c40f84b314c458"
      }
    };
    await ingestEvent(db, evidence);
    await expect(
      ingestEvent(db, { ...evidence, sourceSiteEventId: "business-id-evidence-alias" })
    ).rejects.toMatchObject({ code: "ENTITY_IDENTITY_CONFLICT" });

    expect(await db.select({ id: eventLog.id }).from(eventLog)).toHaveLength(5);
  });

  it("rejects a second worker for an in-progress batch and preserves retry provenance", async () => {
    await registerAsset();
    const batchId = "cb16f437-d84e-4f7e-a3b8-66c4f7376d1d";
    const replay = {
      siteId: SITE_A,
      syncBatchId: batchId,
      events: [
        {
          eventType: "inspection_recorded",
          assetId: ASSET_A,
          siteId: SITE_A,
          transferOrderId: null,
          occurredAt: new Date().toISOString(),
          sourceSiteEventId: "blocked-replay-inspection",
          payload: {
            inspectionId: "d62532db-3bf3-4116-9714-66afbbec8ca4",
            status: "pass",
            notes: "Concurrency test"
          }
        }
      ]
    };

    const lockClient = await pool.connect();
    try {
      await lockClient.query("select pg_advisory_lock(hashtextextended($1, 0))", [ASSET_A]);
      const firstWorker = ingestSyncReplay(db, replay);
      await waitForProcessingBatch(batchId);
      await expect(ingestSyncReplay(db, replay)).rejects.toMatchObject({
        code: "SYNC_BATCH_IN_PROGRESS"
      });
      await lockClient.query("select pg_advisory_unlock(hashtextextended($1, 0))", [ASSET_A]);
      const completed = await firstWorker;
      const exactBatchRetry = await ingestSyncReplay(db, replay);
      expect(exactBatchRetry).toEqual(completed);
      const lifecycle = await db
        .select({ eventType: eventLog.eventType })
        .from(eventLog)
        .where(eq(eventLog.syncBatchId, batchId));
      expect(lifecycle.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["site_sync_started", "site_sync_completed"])
      );
      await expect(
        ingestEvent(db, {
          eventType: "site_sync_started",
          assetId: null,
          siteId: SITE_A,
          transferOrderId: null,
          occurredAt: new Date().toISOString(),
          sourceSiteEventId: `${batchId}:second-start`,
          payload: {
            syncBatchId: batchId,
            queuedEventCount: 1
          }
        })
      ).rejects.toMatchObject({ code: "ENTITY_IDENTITY_CONFLICT" });
      await expect(
        ingestEvent(db, {
          eventType: "site_sync_completed",
          assetId: null,
          siteId: SITE_A,
          transferOrderId: null,
          occurredAt: new Date().toISOString(),
          sourceSiteEventId: `${batchId}:second-completion`,
          payload: {
            syncBatchId: batchId,
            acceptedEventCount: 1,
            rejectedEventCount: 0,
            deduplicatedEventCount: 0,
            rejectionReasons: []
          }
        })
      ).rejects.toMatchObject({ code: "SYNC_BATCH_CONFLICT" });
      const completionEvents = await db
        .select({ id: eventLog.id })
        .from(eventLog)
        .where(
          and(
            eq(eventLog.syncBatchId, batchId),
            eq(eventLog.eventType, "site_sync_completed")
          )
        );
      expect(completionEvents).toHaveLength(1);
    } finally {
      await lockClient.query("select pg_advisory_unlock(hashtextextended($1, 0))", [ASSET_A]);
      lockClient.release();
    }
  });

  it("serializes different events for one asset before ledger sequence allocation", async () => {
    await registerAsset();
    await Promise.all([
      ingestEvent(db, {
        eventType: "inspection_recorded",
        assetId: ASSET_A,
        siteId: SITE_A,
        transferOrderId: null,
        occurredAt: new Date().toISOString(),
        sourceSiteEventId: "concurrent-inspection-1",
        payload: {
          inspectionId: "74c53fe2-34f7-4282-a35d-848d3ce67c34",
          status: "pass",
          notes: "First concurrent event"
        }
      }),
      ingestEvent(db, {
        eventType: "inspection_recorded",
        assetId: ASSET_A,
        siteId: SITE_A,
        transferOrderId: null,
        occurredAt: new Date().toISOString(),
        sourceSiteEventId: "concurrent-inspection-2",
        payload: {
          inspectionId: "c75b930e-3611-4768-bf38-af7f8956d38c",
          status: "review",
          notes: "Second concurrent event"
        }
      })
    ]);
    const [projection] = await db
      .select()
      .from(assetProjection)
      .where(eq(assetProjection.assetId, ASSET_A));
    const [latest] = await db
      .select({ sequenceNumber: eventLog.sequenceNumber, eventType: eventLog.eventType })
      .from(eventLog)
      .where(eq(eventLog.assetId, ASSET_A))
      .orderBy(desc(eventLog.sequenceNumber))
      .limit(1);
    expect(projection.version).toBe(3);
    expect(projection.lastSequence).toBe(latest.sequenceNumber);
    expect(projection.lastEventType).toBe(latest.eventType);
  });

  it("keeps the simulator drift run current, partial, divergent, and exactly rerunnable", async () => {
    await db
      .update(sites)
      .set({ lastSyncCompletedAt: new Date(Date.now() - 90 * 60 * 1_000) })
      .where(eq(sites.id, SITE_B));
    const scenario = buildScenarios(Date.now(), {
      north: SITE_A,
      central: SITE_A,
      coastal: SITE_B
    })["sync-lag-divergence"];

    const firstOnlineResults = [];
    for (const event of scenario.onlineEvents) {
      firstOnlineResults.push(await ingestEvent(db, event));
    }
    expect(firstOnlineResults.every((result) => !result.deduplicated)).toBe(true);

    const replayInput = {
      siteId: SITE_B,
      syncBatchId: scenario.offlineReplayBatchId!,
      events: scenario.offlineEvents!
    };
    const firstReplay = await ingestSyncReplay(db, replayInput);
    expect(firstReplay).toMatchObject({
      status: "partial",
      acceptedEventCount: 2,
      rejectedEventCount: 1,
      deduplicatedEventCount: 0
    });

    const retryOnlineResults = [];
    for (const event of scenario.onlineEvents) {
      retryOnlineResults.push(await ingestEvent(db, event));
    }
    expect(retryOnlineResults.every((result) => result.deduplicated)).toBe(true);
    expect(await ingestSyncReplay(db, replayInput)).toEqual(firstReplay);

    await runDivergenceScan(db);
    const [dualSiteAlert] = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.ruleCode, "ASSET_OBSERVED_AT_MULTIPLE_SITES"),
          eq(alerts.assetId, scenario.expectedAlert!.assetId)
        )
      );
    const [staleSiteAlert] = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.ruleCode, "SITE_PROJECTION_STALE"),
          eq(alerts.siteId, SITE_B)
        )
      );
    expect(dualSiteAlert).toBeDefined();
    expect(staleSiteAlert).toBeDefined();
  });

  it("allows only one optimistic resolver to close a case", async () => {
    const created = (await openReconciliationCase(
      db,
      {
        siteId: SITE_A,
        title: "Site-level reconciliation",
        description: "Validate the site projection before closure."
      },
      "integration-operator"
    )) as { id: string; version: number };
    const resolution = {
      resolutionSummary: "Validated and reconciled by integration test.",
      expectedVersion: created.version,
      resolvedAssetStatus: null
    };
    const results = await Promise.allSettled([
      resolveReconciliationCase(db, created.id, resolution, "integration-operator"),
      resolveReconciliationCase(db, created.id, resolution, "integration-operator")
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: "CASE_ALREADY_RESOLVED"
    });
    const [caseRow] = await db
      .select()
      .from(reconciliationCases)
      .where(eq(reconciliationCases.id, created.id));
    expect(caseRow).toMatchObject({ status: "resolved", version: 2 });
  });

  it("resolves absent scan conditions and reopens them when they recur", async () => {
    await db.update(sites).set({ lastSyncCompletedAt: null }).where(eq(sites.id, SITE_A));
    await runDivergenceScan(db);
    const [initial] = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.ruleCode, "SITE_PROJECTION_STALE"),
          eq(alerts.siteId, SITE_A)
        )
      );
    expect(initial.status).toBe("open");

    await db.update(sites).set({ lastSyncCompletedAt: new Date() }).where(eq(sites.id, SITE_A));
    await runDivergenceScan(db);
    const [cleared] = await db.select().from(alerts).where(eq(alerts.id, initial.id));
    expect(cleared.status).toBe("resolved");
    expect(cleared.resolvedAt).not.toBeNull();

    await db.update(sites).set({ lastSyncCompletedAt: null }).where(eq(sites.id, SITE_A));
    await runDivergenceScan(db);
    const [reopened] = await db.select().from(alerts).where(eq(alerts.id, initial.id));
    expect(reopened.status).toBe("open");
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.occurrenceCount).toBeGreaterThan(initial.occurrenceCount);
  });
});
