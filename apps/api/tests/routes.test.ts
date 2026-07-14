import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const testSecurity = vi.hoisted(() => {
  const token = `vitest-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  process.env.OPS_TEST_AUTH_TOKEN = token;
  process.env.OPS_TEST_ACTOR = "vitest-operator";
  return { token };
});

vi.mock("../src/domain/event-service", () => ({
  ingestEvent: vi.fn(async () => ({
    eventId: "dc1e5f53-22ec-4593-9e7f-77e83ccf4f74",
    sequenceNumber: 42,
    deduplicated: false,
    eventHash: "a".repeat(64)
  })),
  ingestSyncReplay: vi.fn(async () => ({
    syncBatchId: "cb16f437-d84e-4f7e-a3b8-66c4f7376d1d",
    acceptedEventCount: 2,
    rejectedEventCount: 0
  }))
}));

vi.mock("../src/domain/divergence-service", () => ({
  runDivergenceScan: vi.fn(async () => ({
    findingsEvaluated: 5,
    alertsCreated: 2
  }))
}));

vi.mock("../src/domain/query-service", () => ({
  listSites: vi.fn(async () => []),
  listAssets: vi.fn(async () => []),
  getAssetById: vi.fn(async () => ({ projection: {}, timeline: [], inspections: [] })),
  listTransfers: vi.fn(async () => []),
  listAlerts: vi.fn(async () => []),
  listReconciliationCases: vi.fn(async () => []),
  listSyncBatches: vi.fn(async () => []),
  dashboardSummary: vi.fn(async () => ({
    openReconciliationCases: 1,
    staleSites: 1,
    assetsInTransit: 2,
    recentAlerts: 3,
    replaySuccessCount: 4,
    replayFailureCount: 0,
    unresolvedEvidenceGaps: 1
    ,openHighSeverityAlerts: 1,
    openTransferTimeoutAlerts: 1,
    openDualSiteAlerts: 0,
    openProjectionLagAlerts: 0,
    openEvidenceGapAlerts: 1,
    openStaleSiteAlerts: 1
  })),
  recentTransfers: vi.fn(async () => []),
  recentAlerts: vi.fn(async () => []),
  recentBatches: vi.fn(async () => []),
  openReconciliationCase: vi.fn(async () => ({ id: "rc-1" })),
  resolveReconciliationCase: vi.fn(async () => ({ id: "rc-1", status: "resolved" }))
}));

import { buildServer } from "../src/app";
import { closeDatabase } from "../src/db/client";
import { dashboardSummary } from "../src/domain/query-service";

describe("api routes", () => {
  const app = buildServer();
  const authorization = { authorization: `Bearer ${testSecurity.token}` };

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });

  it("returns healthy status", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.status).toBe("ok");
  });

  it("accepts valid event payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: authorization,
      payload: {
        eventType: "asset_registered",
        assetId: "7b4b2d2f-88fb-4d8d-931a-6a5645f1e7c2",
        siteId: "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
        transferOrderId: null,
        occurredAt: new Date().toISOString(),
        sourceSiteEventId: "test-1",
        payload: {
          serialNumber: "SN-TEST-1",
          containerId: "CNT-TEST",
          registeredBy: "tester"
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.sequenceNumber).toBe(42);
  });

  it("rejects invalid event payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: authorization,
      payload: {
        eventType: "asset_registered",
        assetId: "7b4b2d2f-88fb-4d8d-931a-6a5645f1e7c2",
        siteId: "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
        transferOrderId: null,
        occurredAt: new Date().toISOString(),
        sourceSiteEventId: "test-2",
        payload: {
          serialNumber: "SN-TEST-1"
        }
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns dashboard aggregate data", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/dashboard", headers: authorization });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.summary.openReconciliationCases).toBe(1);
  });

  it("requires authentication for API and metrics routes", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/dashboard" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    expect(vi.mocked(dashboardSummary)).not.toHaveBeenCalled();
  });

  it("rejects replay payloads above the synchronous hard cap", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/sync/replay",
      headers: authorization,
      payload: {
        siteId: "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
        syncBatchId: "cb16f437-d84e-4f7e-a3b8-66c4f7376d1d",
        events: Array.from({ length: 501 }, () => ({}))
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("REQUEST_VALIDATION_FAILED");
  });

  it("rejects internal event types on the generic event endpoint", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: authorization,
      payload: {
        eventType: "site_sync_started",
        assetId: null,
        siteId: "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
        transferOrderId: null,
        occurredAt: new Date().toISOString(),
        sourceSiteEventId: "forbidden-internal-event",
        payload: {
          syncBatchId: "cb16f437-d84e-4f7e-a3b8-66c4f7376d1d",
          queuedEventCount: 0
        }
      }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("INTERNAL_EVENT_FORBIDDEN");
  });
});
