import { eq, sql } from "drizzle-orm";
import type { CreateEventRequest } from "@ops/contracts";
import { db, closeDatabase } from "./client";
import { reconciliationCases, sites } from "./schema";
import { ingestEvent, ingestSyncReplay } from "../domain/event-service";
import { runDivergenceScan } from "../domain/divergence-service";
import { resolveReconciliationCase } from "../domain/query-service";

const SITE_IDS = {
  north: "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
  central: "c55f6935-40df-4aa7-9f84-5b9c8e5f9a60",
  coastal: "1b2e7c43-8c9a-4ca4-aef3-27b9a9b28e71"
} as const;

const ASSET_IDS = {
  a1: "7b4b2d2f-88fb-4d8d-931a-6a5645f1e7c2",
  a2: "5f1c31f1-08d4-4e74-a4d2-213df560bd95",
  a3: "20fb2e4a-7423-4f0f-b3ca-31a6cc37cd55",
  a4: "27585a6c-10ad-4cb9-a2fd-b194ab613193",
  a5: "37adf48f-f6dd-44fb-8f93-9f34af297d6d",
  a6: "4d35f7a5-41d2-4b13-8f0f-ccca4f0e8b15",
  a7: "b364a85f-5125-4466-8da9-7db4f273f760",
  a8: "0fe63de3-e307-4602-9ef3-fc7a843a95c7",
  a9: "8b52d725-1f24-4f08-97eb-e9449b6d81a5",
  a10: "e15ff2f6-6f18-4b98-8d4a-c7b1f2f5f95e",
  a11: "6fb39e43-b8d0-49d6-b9ad-2a9f86d3973d",
  a12: "91f4f1a3-f2c4-4ce7-bf54-38e67f5db25f"
} as const;

const TRANSFER_IDS = {
  t1: "6d55f8f7-5ddf-4c07-91f7-26d1b91a9f20",
  t2: "bf2c91a2-0a0a-4cc2-91ef-713d723445a1",
  t3: "d5be7f19-f7cd-4a30-b684-9299eec21f49",
  t4: "7f345098-9a20-4c18-a8f6-f4d2f2500e95",
  t5: "c856f081-f956-4a4f-ab6f-f8db4bdf9d71",
  t6: "9a331f4e-4218-48e0-93a5-9f6f87dc6fa7",
  t7: "f2f1f672-ec95-44be-8f3a-824df8de3fc3",
  t8: "0e3270f5-7915-4233-9140-d0103bb4f0a2",
  t9: "495ca911-bd13-4c17-b7c4-ee3f7d5b8541",
  t10: "3cccec82-c48f-4d0a-b1cc-c2ffc4eaf0a7",
  t11: "1bd9f7a2-9fb3-4f3e-b29b-1c0a2e84ed11"
} as const;

async function seedSites(): Promise<void> {
  await db
    .insert(sites)
    .values([
      { id: SITE_IDS.north, code: "NORTH", name: "North Site" },
      { id: SITE_IDS.central, code: "CENTRAL", name: "Central Site" },
      { id: SITE_IDS.coastal, code: "COASTAL", name: "Coastal Site" }
    ])
    .onConflictDoNothing();
}

async function resetDemoData(): Promise<void> {
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
}

async function seedEvents(): Promise<void> {
  const baseTime = Date.now();
  const minutesAgo = (minutes: number): string =>
    new Date(baseTime - 1000 * 60 * minutes).toISOString();

  const emit = (event: CreateEventRequest): Promise<unknown> => ingestEvent(db, event);

  const registrations = [
    { assetId: ASSET_IDS.a1, serialNumber: "SN-OPS-1001", containerId: "CNT-A1", siteId: SITE_IDS.north, minutes: 720 },
    { assetId: ASSET_IDS.a2, serialNumber: "SN-OPS-1002", containerId: "CNT-A2", siteId: SITE_IDS.central, minutes: 710 },
    { assetId: ASSET_IDS.a3, serialNumber: "SN-OPS-1003", containerId: "CNT-A3", siteId: SITE_IDS.coastal, minutes: 700 },
    { assetId: ASSET_IDS.a4, serialNumber: "SN-OPS-1004", containerId: "CNT-A4", siteId: SITE_IDS.north, minutes: 690 },
    { assetId: ASSET_IDS.a5, serialNumber: "SN-OPS-1005", containerId: "CNT-A5", siteId: SITE_IDS.central, minutes: 680 },
    { assetId: ASSET_IDS.a6, serialNumber: "SN-OPS-1006", containerId: "CNT-A6", siteId: SITE_IDS.central, minutes: 670 },
    { assetId: ASSET_IDS.a7, serialNumber: "SN-OPS-1007", containerId: "CNT-A7", siteId: SITE_IDS.north, minutes: 660 },
    { assetId: ASSET_IDS.a8, serialNumber: "SN-OPS-1008", containerId: "CNT-A8", siteId: SITE_IDS.coastal, minutes: 650 },
    { assetId: ASSET_IDS.a9, serialNumber: "SN-OPS-1009", containerId: "CNT-A9", siteId: SITE_IDS.north, minutes: 640 },
    { assetId: ASSET_IDS.a10, serialNumber: "SN-OPS-1010", containerId: "CNT-B0", siteId: SITE_IDS.central, minutes: 630 },
    { assetId: ASSET_IDS.a11, serialNumber: "SN-OPS-1011", containerId: "CNT-B1", siteId: SITE_IDS.coastal, minutes: 620 },
    { assetId: ASSET_IDS.a12, serialNumber: "SN-OPS-1012", containerId: "CNT-B2", siteId: SITE_IDS.coastal, minutes: 610 }
  ];

  for (const registration of registrations) {
    await emit({
      eventType: "asset_registered",
      assetId: registration.assetId,
      siteId: registration.siteId,
      transferOrderId: null,
      occurredAt: minutesAgo(registration.minutes),
      sourceSiteEventId: `seed-register-${registration.assetId}`,
      payload: {
        serialNumber: registration.serialNumber,
        containerId: registration.containerId,
        registeredBy: "bootstrap-loader"
      }
    });
  }

  const transferTimeline: CreateEventRequest[] = [
    {
      eventType: "transfer_initiated",
      assetId: ASSET_IDS.a1,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t1,
      occurredAt: minutesAgo(540),
      sourceSiteEventId: "seed-t1-init",
      payload: {
        transferOrderId: TRANSFER_IDS.t1,
        originSiteId: SITE_IDS.north,
        destinationSiteId: SITE_IDS.central,
        initiatedBy: "north-shift-a"
      }
    },
    {
      eventType: "asset_moved",
      assetId: ASSET_IDS.a1,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t1,
      occurredAt: minutesAgo(535),
      sourceSiteEventId: "seed-t1-moved",
      payload: {
        fromSiteId: SITE_IDS.north,
        toSiteId: SITE_IDS.central,
        reason: "Scheduled transfer window"
      }
    },
    {
      eventType: "asset_received",
      assetId: ASSET_IDS.a1,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t1,
      occurredAt: minutesAgo(500),
      sourceSiteEventId: "seed-t1-received",
      payload: {
        fromSiteId: SITE_IDS.north,
        condition: "ok",
        receivedBy: "central-receiver"
      }
    },
    {
      eventType: "transfer_completed",
      assetId: ASSET_IDS.a1,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t1,
      occurredAt: minutesAgo(495),
      sourceSiteEventId: "seed-t1-completed",
      payload: {
        transferOrderId: TRANSFER_IDS.t1,
        completedBy: "central-receiver",
        completionNote: "Received and confirmed at destination."
      }
    },
    {
      eventType: "transfer_initiated",
      assetId: ASSET_IDS.a2,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t2,
      occurredAt: minutesAgo(520),
      sourceSiteEventId: "seed-t2-init",
      payload: {
        transferOrderId: TRANSFER_IDS.t2,
        originSiteId: SITE_IDS.central,
        destinationSiteId: SITE_IDS.coastal,
        initiatedBy: "central-shift-b"
      }
    },
    {
      eventType: "asset_moved",
      assetId: ASSET_IDS.a2,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t2,
      occurredAt: minutesAgo(515),
      sourceSiteEventId: "seed-t2-moved",
      payload: {
        fromSiteId: SITE_IDS.central,
        toSiteId: SITE_IDS.coastal,
        reason: "Priority dispatch"
      }
    },
    {
      eventType: "transfer_initiated",
      assetId: ASSET_IDS.a3,
      siteId: SITE_IDS.coastal,
      transferOrderId: TRANSFER_IDS.t3,
      occurredAt: minutesAgo(480),
      sourceSiteEventId: "seed-t3-init",
      payload: {
        transferOrderId: TRANSFER_IDS.t3,
        originSiteId: SITE_IDS.coastal,
        destinationSiteId: SITE_IDS.north,
        initiatedBy: "coastal-shift-a"
      }
    },
    {
      eventType: "asset_moved",
      assetId: ASSET_IDS.a3,
      siteId: SITE_IDS.coastal,
      transferOrderId: TRANSFER_IDS.t3,
      occurredAt: minutesAgo(475),
      sourceSiteEventId: "seed-t3-moved",
      payload: {
        fromSiteId: SITE_IDS.coastal,
        toSiteId: SITE_IDS.north,
        reason: "Return route balancing"
      }
    },
    {
      eventType: "asset_received",
      assetId: ASSET_IDS.a3,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t3,
      occurredAt: minutesAgo(450),
      sourceSiteEventId: "seed-t3-received",
      payload: {
        fromSiteId: SITE_IDS.coastal,
        condition: "ok",
        receivedBy: "north-receiver"
      }
    },
    {
      eventType: "transfer_completed",
      assetId: ASSET_IDS.a3,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t3,
      occurredAt: minutesAgo(445),
      sourceSiteEventId: "seed-t3-completed",
      payload: {
        transferOrderId: TRANSFER_IDS.t3,
        completedBy: "north-receiver",
        completionNote: "Inbound confirmation posted."
      }
    },
    {
      eventType: "transfer_initiated",
      assetId: ASSET_IDS.a4,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t4,
      occurredAt: minutesAgo(430),
      sourceSiteEventId: "seed-t4-init",
      payload: {
        transferOrderId: TRANSFER_IDS.t4,
        originSiteId: SITE_IDS.north,
        destinationSiteId: SITE_IDS.coastal,
        initiatedBy: "north-shift-b"
      }
    },
    {
      eventType: "asset_moved",
      assetId: ASSET_IDS.a4,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t4,
      occurredAt: minutesAgo(425),
      sourceSiteEventId: "seed-t4-moved",
      payload: {
        fromSiteId: SITE_IDS.north,
        toSiteId: SITE_IDS.coastal,
        reason: "Container rebalance"
      }
    },
    {
      eventType: "asset_received",
      assetId: ASSET_IDS.a4,
      siteId: SITE_IDS.coastal,
      transferOrderId: TRANSFER_IDS.t4,
      occurredAt: minutesAgo(390),
      sourceSiteEventId: "seed-t4-received",
      payload: {
        fromSiteId: SITE_IDS.north,
        condition: "ok",
        receivedBy: "coastal-receiver"
      }
    },
    {
      eventType: "transfer_completed",
      assetId: ASSET_IDS.a4,
      siteId: SITE_IDS.coastal,
      transferOrderId: TRANSFER_IDS.t4,
      occurredAt: minutesAgo(385),
      sourceSiteEventId: "seed-t4-completed",
      payload: {
        transferOrderId: TRANSFER_IDS.t4,
        completedBy: "coastal-receiver",
        completionNote: "Destination confirmed."
      }
    },
    {
      eventType: "transfer_initiated",
      assetId: ASSET_IDS.a5,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t5,
      occurredAt: minutesAgo(360),
      sourceSiteEventId: "seed-t5-init",
      payload: {
        transferOrderId: TRANSFER_IDS.t5,
        originSiteId: SITE_IDS.central,
        destinationSiteId: SITE_IDS.north,
        initiatedBy: "central-shift-c"
      }
    },
    {
      eventType: "asset_moved",
      assetId: ASSET_IDS.a5,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t5,
      occurredAt: minutesAgo(355),
      sourceSiteEventId: "seed-t5-moved",
      payload: {
        fromSiteId: SITE_IDS.central,
        toSiteId: SITE_IDS.north,
        reason: "Cross-site allocation"
      }
    },
    {
      eventType: "transfer_initiated",
      assetId: ASSET_IDS.a6,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t6,
      occurredAt: minutesAgo(330),
      sourceSiteEventId: "seed-t6-init",
      payload: {
        transferOrderId: TRANSFER_IDS.t6,
        originSiteId: SITE_IDS.central,
        destinationSiteId: SITE_IDS.north,
        initiatedBy: "central-shift-c"
      }
    },
    {
      eventType: "asset_moved",
      assetId: ASSET_IDS.a6,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t6,
      occurredAt: minutesAgo(325),
      sourceSiteEventId: "seed-t6-moved",
      payload: {
        fromSiteId: SITE_IDS.central,
        toSiteId: SITE_IDS.north,
        reason: "Routine transfer"
      }
    },
    {
      eventType: "asset_received",
      assetId: ASSET_IDS.a6,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t6,
      occurredAt: minutesAgo(300),
      sourceSiteEventId: "seed-t6-received",
      payload: {
        fromSiteId: SITE_IDS.central,
        condition: "ok",
        receivedBy: "north-receiver"
      }
    },
    {
      eventType: "transfer_completed",
      assetId: ASSET_IDS.a6,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t6,
      occurredAt: minutesAgo(295),
      sourceSiteEventId: "seed-t6-completed",
      payload: {
        transferOrderId: TRANSFER_IDS.t6,
        completedBy: "north-receiver",
        completionNote: "Transfer closed after count verification."
      }
    },
    {
      eventType: "transfer_initiated",
      assetId: ASSET_IDS.a7,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t7,
      occurredAt: minutesAgo(260),
      sourceSiteEventId: "seed-t7-init",
      payload: {
        transferOrderId: TRANSFER_IDS.t7,
        originSiteId: SITE_IDS.north,
        destinationSiteId: SITE_IDS.central,
        initiatedBy: "north-shift-c"
      }
    },
    {
      eventType: "asset_moved",
      assetId: ASSET_IDS.a7,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t7,
      occurredAt: minutesAgo(255),
      sourceSiteEventId: "seed-t7-moved",
      payload: {
        fromSiteId: SITE_IDS.north,
        toSiteId: SITE_IDS.central,
        reason: "Dispatch window"
      }
    },
    {
      eventType: "asset_received",
      assetId: ASSET_IDS.a7,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t7,
      occurredAt: minutesAgo(220),
      sourceSiteEventId: "seed-t7-received",
      payload: {
        fromSiteId: SITE_IDS.north,
        condition: "ok",
        receivedBy: "central-receiver"
      }
    },
    {
      eventType: "transfer_completed",
      assetId: ASSET_IDS.a7,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t7,
      occurredAt: minutesAgo(215),
      sourceSiteEventId: "seed-t7-completed",
      payload: {
        transferOrderId: TRANSFER_IDS.t7,
        completedBy: "central-receiver",
        completionNote: "Transfer closed."
      }
    },
    {
      eventType: "transfer_initiated",
      assetId: ASSET_IDS.a8,
      siteId: SITE_IDS.coastal,
      transferOrderId: TRANSFER_IDS.t8,
      occurredAt: minutesAgo(210),
      sourceSiteEventId: "seed-t8-init",
      payload: {
        transferOrderId: TRANSFER_IDS.t8,
        originSiteId: SITE_IDS.coastal,
        destinationSiteId: SITE_IDS.central,
        initiatedBy: "coastal-shift-b"
      }
    },
    {
      eventType: "asset_moved",
      assetId: ASSET_IDS.a8,
      siteId: SITE_IDS.coastal,
      transferOrderId: TRANSFER_IDS.t8,
      occurredAt: minutesAgo(205),
      sourceSiteEventId: "seed-t8-moved",
      payload: {
        fromSiteId: SITE_IDS.coastal,
        toSiteId: SITE_IDS.central,
        reason: "Allocation balancing"
      }
    },
    {
      eventType: "asset_received",
      assetId: ASSET_IDS.a8,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t8,
      occurredAt: minutesAgo(175),
      sourceSiteEventId: "seed-t8-received",
      payload: {
        fromSiteId: SITE_IDS.coastal,
        condition: "ok",
        receivedBy: "central-receiver"
      }
    },
    {
      eventType: "transfer_completed",
      assetId: ASSET_IDS.a8,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t8,
      occurredAt: minutesAgo(170),
      sourceSiteEventId: "seed-t8-completed",
      payload: {
        transferOrderId: TRANSFER_IDS.t8,
        completedBy: "central-receiver",
        completionNote: "Transfer confirmed."
      }
    },
    {
      eventType: "transfer_initiated",
      assetId: ASSET_IDS.a9,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t9,
      occurredAt: minutesAgo(150),
      sourceSiteEventId: "seed-t9-init",
      payload: {
        transferOrderId: TRANSFER_IDS.t9,
        originSiteId: SITE_IDS.north,
        destinationSiteId: SITE_IDS.coastal,
        initiatedBy: "north-shift-c"
      }
    },
    {
      eventType: "asset_moved",
      assetId: ASSET_IDS.a9,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t9,
      occurredAt: minutesAgo(145),
      sourceSiteEventId: "seed-t9-moved",
      payload: {
        fromSiteId: SITE_IDS.north,
        toSiteId: SITE_IDS.coastal,
        reason: "Scheduled shipment"
      }
    },
    {
      eventType: "asset_received",
      assetId: ASSET_IDS.a9,
      siteId: SITE_IDS.coastal,
      transferOrderId: TRANSFER_IDS.t9,
      occurredAt: minutesAgo(125),
      sourceSiteEventId: "seed-t9-received",
      payload: {
        fromSiteId: SITE_IDS.north,
        condition: "ok",
        receivedBy: "coastal-receiver"
      }
    },
    {
      eventType: "transfer_completed",
      assetId: ASSET_IDS.a9,
      siteId: SITE_IDS.coastal,
      transferOrderId: TRANSFER_IDS.t9,
      occurredAt: minutesAgo(120),
      sourceSiteEventId: "seed-t9-completed",
      payload: {
        transferOrderId: TRANSFER_IDS.t9,
        completedBy: "coastal-receiver",
        completionNote: "Closed after inbound count."
      }
    },
    {
      eventType: "transfer_initiated",
      assetId: ASSET_IDS.a10,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t10,
      occurredAt: minutesAgo(110),
      sourceSiteEventId: "seed-t10-init",
      payload: {
        transferOrderId: TRANSFER_IDS.t10,
        originSiteId: SITE_IDS.central,
        destinationSiteId: SITE_IDS.north,
        initiatedBy: "central-shift-a"
      }
    },
    {
      eventType: "asset_moved",
      assetId: ASSET_IDS.a10,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t10,
      occurredAt: minutesAgo(105),
      sourceSiteEventId: "seed-t10-moved",
      payload: {
        fromSiteId: SITE_IDS.central,
        toSiteId: SITE_IDS.north,
        reason: "Pending handoff"
      }
    }
  ];

  for (const event of transferTimeline) {
    await emit(event);
  }

  const inspections: CreateEventRequest[] = [
    {
      eventType: "inspection_recorded",
      assetId: ASSET_IDS.a1,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t1,
      occurredAt: minutesAgo(490),
      sourceSiteEventId: "seed-insp-a1",
      payload: {
        inspectionId: "74c53fe2-34f7-4282-a35d-848d3ce67c34",
        status: "pass",
        notes: "Arrival inspection passed."
      }
    },
    {
      eventType: "evidence_attached",
      assetId: ASSET_IDS.a1,
      siteId: SITE_IDS.central,
      transferOrderId: TRANSFER_IDS.t1,
      occurredAt: minutesAgo(489),
      sourceSiteEventId: "seed-evidence-a1",
      payload: {
        inspectionId: "74c53fe2-34f7-4282-a35d-848d3ce67c34",
        evidenceId: "f87d9a37-208e-4acd-ad07-758f24526440",
        mimeType: "image/jpeg",
        sha256: "aacceeff11223344556677889900aabbccddeeff00112233445566778899aabb"
      }
    },
    {
      eventType: "inspection_recorded",
      assetId: ASSET_IDS.a3,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t3,
      occurredAt: minutesAgo(440),
      sourceSiteEventId: "seed-insp-a3",
      payload: {
        inspectionId: "d62532db-3bf3-4116-9714-66afbbec8ca4",
        status: "pass",
        notes: "Inbound verification complete."
      }
    },
    {
      eventType: "evidence_attached",
      assetId: ASSET_IDS.a3,
      siteId: SITE_IDS.north,
      transferOrderId: TRANSFER_IDS.t3,
      occurredAt: minutesAgo(439),
      sourceSiteEventId: "seed-evidence-a3",
      payload: {
        inspectionId: "d62532db-3bf3-4116-9714-66afbbec8ca4",
        evidenceId: "6fa0b5ea-6a57-4783-965e-d6e20a4d5b1a",
        mimeType: "image/jpeg",
        sha256: "13ccb08e6786a54f11274d3d35d2f1804d17f69ee74f2a14d6e3ce0ce9ab944f"
      }
    },
    {
      eventType: "inspection_recorded",
      assetId: ASSET_IDS.a11,
      siteId: SITE_IDS.coastal,
      transferOrderId: null,
      occurredAt: minutesAgo(90),
      sourceSiteEventId: "seed-insp-a11-missing-evidence",
      payload: {
        inspectionId: "c75b930e-3611-4768-bf38-af7f8956d38c",
        status: "review",
        notes: "Seal mismatch observed; operator note logged."
      }
    }
  ];

  for (const event of inspections) {
    await emit(event);
  }

  // Conflicting observations for two assets.
  await emit({
    eventType: "asset_received",
    assetId: ASSET_IDS.a2,
    siteId: SITE_IDS.north,
    transferOrderId: null,
    occurredAt: minutesAgo(50),
    sourceSiteEventId: "seed-a2-observed-north",
    payload: {
      fromSiteId: SITE_IDS.central,
      condition: "ok",
      receivedBy: "north-receiver"
    }
  });
  await emit({
    eventType: "asset_received",
    assetId: ASSET_IDS.a2,
    siteId: SITE_IDS.coastal,
    transferOrderId: null,
    occurredAt: minutesAgo(45),
    sourceSiteEventId: "seed-a2-observed-coastal",
    payload: {
      fromSiteId: SITE_IDS.central,
      condition: "ok",
      receivedBy: "coastal-receiver"
    }
  });
  await emit({
    eventType: "asset_received",
    assetId: ASSET_IDS.a8,
    siteId: SITE_IDS.north,
    transferOrderId: null,
    occurredAt: minutesAgo(40),
    sourceSiteEventId: "seed-a8-observed-north",
    payload: {
      fromSiteId: SITE_IDS.central,
      condition: "ok",
      receivedBy: "north-receiver"
    }
  });
  await emit({
    eventType: "asset_received",
    assetId: ASSET_IDS.a8,
    siteId: SITE_IDS.central,
    transferOrderId: null,
    occurredAt: minutesAgo(35),
    sourceSiteEventId: "seed-a8-observed-central",
    payload: {
      fromSiteId: SITE_IDS.north,
      condition: "ok",
      receivedBy: "central-receiver"
    }
  });

  // One stale replay batch with deterministic duplicate handling.
  await ingestSyncReplay(
    db,
    {
      siteId: SITE_IDS.coastal,
      syncBatchId: "9f1f9d4a-4505-4906-8f11-b18d20d2f41a",
      events: [
      {
        eventType: "transfer_initiated",
        assetId: ASSET_IDS.a12,
        siteId: SITE_IDS.coastal,
        transferOrderId: TRANSFER_IDS.t11,
        occurredAt: minutesAgo(360),
        sourceSiteEventId: "coastal-offline-a12-transfer-init",
        payload: {
          transferOrderId: TRANSFER_IDS.t11,
          originSiteId: SITE_IDS.coastal,
          destinationSiteId: SITE_IDS.north,
          initiatedBy: "coastal-offline-operator"
        }
      },
      {
        eventType: "transfer_initiated",
        assetId: ASSET_IDS.a12,
        siteId: SITE_IDS.coastal,
        transferOrderId: TRANSFER_IDS.t11,
        occurredAt: minutesAgo(360),
        sourceSiteEventId: "coastal-offline-a12-transfer-init",
        payload: {
          transferOrderId: TRANSFER_IDS.t11,
          originSiteId: SITE_IDS.coastal,
          destinationSiteId: SITE_IDS.north,
          initiatedBy: "coastal-offline-operator"
        }
      },
      {
        eventType: "asset_moved",
        assetId: ASSET_IDS.a12,
        siteId: SITE_IDS.coastal,
        transferOrderId: TRANSFER_IDS.t11,
        occurredAt: minutesAgo(355),
        sourceSiteEventId: "coastal-offline-a12-moved",
        payload: {
          fromSiteId: SITE_IDS.coastal,
          toSiteId: SITE_IDS.north,
          reason: "Offline queue replayed after reconnect"
        }
      }
      ]
    },
    { startedAt: new Date(baseTime - 70 * 60_000), completedAt: new Date(baseTime - 69 * 60_000) }
  );

  // Give central a recent successful baseline. Its newer partial replay below
  // then reads as degraded instead of falsely claiming a completed sync.
  const centralBaselineSyncBatchId = "e86f9b05-cf30-4cbb-9fc5-e7c76328c2bf";
  await emit({
    eventType: "site_sync_started",
    assetId: null,
    siteId: SITE_IDS.central,
    transferOrderId: null,
    occurredAt: minutesAgo(40),
    sourceSiteEventId: "seed-central-baseline-sync-started",
    payload: { syncBatchId: centralBaselineSyncBatchId, queuedEventCount: 0 }
  });
  await emit({
    eventType: "site_sync_completed",
    assetId: null,
    siteId: SITE_IDS.central,
    transferOrderId: null,
    occurredAt: minutesAgo(39),
    sourceSiteEventId: "seed-central-baseline-sync-completed",
    payload: {
      syncBatchId: centralBaselineSyncBatchId,
      acceptedEventCount: 0,
      rejectedEventCount: 0,
      deduplicatedEventCount: 0,
      rejectionReasons: []
    }
  });

  // One recent replay batch with a rejected event that produces an evidence-gap outcome.
  await ingestSyncReplay(db, {
    siteId: SITE_IDS.central,
    syncBatchId: "2aa4f613-3e6a-4f8e-9641-29a1d0b607a5",
    events: [
      {
        eventType: "inspection_recorded",
        assetId: ASSET_IDS.a7,
        siteId: SITE_IDS.central,
        transferOrderId: TRANSFER_IDS.t7,
        occurredAt: minutesAgo(30),
        sourceSiteEventId: "central-offline-a7-inspection",
        payload: {
          inspectionId: "ebf428a8-41ca-4652-ab43-f0edf2c74a8c",
          status: "review",
          notes: "Deferred replay inspection; evidence upload validation failed."
        }
      },
      {
        eventType: "evidence_attached",
        assetId: ASSET_IDS.a7,
        siteId: SITE_IDS.central,
        transferOrderId: TRANSFER_IDS.t7,
        occurredAt: minutesAgo(29),
        sourceSiteEventId: "central-offline-a7-invalid-evidence",
        payload: {
          inspectionId: "ebf428a8-41ca-4652-ab43-f0edf2c74a8c",
          evidenceId: "invalid-evidence-id",
          mimeType: "image/jpeg",
          sha256: "short"
        }
      }
    ]
  });

  // Keep north healthy with a recent completed sync marker.
  const northSyncBatchId = "cb16f437-d84e-4f7e-a3b8-66c4f7376d1d";
  await emit({
    eventType: "site_sync_started",
    assetId: null,
    siteId: SITE_IDS.north,
    transferOrderId: null,
    occurredAt: minutesAgo(12),
    sourceSiteEventId: "seed-north-sync-started",
    payload: {
      syncBatchId: northSyncBatchId,
      queuedEventCount: 0
    }
  });
  await emit({
    eventType: "site_sync_completed",
    assetId: null,
    siteId: SITE_IDS.north,
    transferOrderId: null,
    occurredAt: minutesAgo(11),
    sourceSiteEventId: "seed-north-sync-completed",
    payload: {
      syncBatchId: northSyncBatchId,
      acceptedEventCount: 0,
      rejectedEventCount: 0,
      deduplicatedEventCount: 0,
      rejectionReasons: []
    }
  });

  // Deliberately move one projection sequence behind the stream for divergence visibility.
  await db.execute(sql`
    update asset_projection
    set last_sequence = greatest(last_sequence - 1, 0),
        updated_at = now()
    where asset_id = ${ASSET_IDS.a10}
  `);
}

async function main(): Promise<void> {
  if (process.env.OPS_ALLOW_DEMO_SEED !== "ops_control_test") {
    throw new Error(
      "Refusing destructive demo seed without OPS_ALLOW_DEMO_SEED=ops_control_test."
    );
  }
  await resetDemoData();
  await seedSites();
  await seedEvents();
  await runDivergenceScan(db);
  const [caseToResolve] = await db
    .select({ id: reconciliationCases.id, assetId: reconciliationCases.assetId, version: reconciliationCases.version })
    .from(reconciliationCases)
    .where(eq(reconciliationCases.status, "open"))
    .limit(1);
  if (caseToResolve) {
    await resolveReconciliationCase(db, caseToResolve.id, {
      resolutionSummary: "Replay completed and projection verified against accepted event stream.",
      expectedVersion: caseToResolve.version,
      resolvedAssetStatus: caseToResolve.assetId ? "at_site" : null
    }, "ops-supervisor");
  }
  // eslint-disable-next-line no-console
  console.log("Seed complete");
}

main()
  .then(() => closeDatabase())
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    await closeDatabase();
    process.exit(1);
  });
