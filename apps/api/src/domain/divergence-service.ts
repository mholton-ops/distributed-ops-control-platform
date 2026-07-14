import {
  detectDualSiteObservations,
  detectInspectionEvidenceGaps,
  detectProjectionIntegrityIssues,
  detectStaleSites,
  detectTransferTimeouts,
  type DivergenceRuleResult
} from "@ops/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { db as databaseClient } from "../db/client";
import {
  alerts,
  assetProjection,
  assets,
  reconciliationCases,
  sites,
  transferOrders
} from "../db/schema";
import { env } from "../lib/env";
import { incrementCounter } from "../lib/metrics";
import {
  clearDivergenceAlert,
  divergenceFingerprint,
  ingestDivergenceFinding
} from "./event-service";

type Database = typeof databaseClient;

async function loadTransferFindings(db: Database, now: Date): Promise<DivergenceRuleResult[]> {
  const rows = await db.select().from(transferOrders).where(eq(transferOrders.status, "initiated"));
  return detectTransferTimeouts(
    rows.map((row) => ({
      transferOrderId: row.id,
      assetId: row.assetId,
      originSiteId: row.originSiteId,
      destinationSiteId: row.destinationSiteId,
      status: row.status as "initiated" | "completed",
      initiatedAt: row.initiatedAt,
      completedAt: row.completedAt
    })),
    now,
    env.TRANSFER_CONFIRMATION_HOURS
  );
}

async function loadDualObservationFindings(
  db: Database,
  now: Date
): Promise<DivergenceRuleResult[]> {
  const cutoff = new Date(now.getTime() - env.DUAL_SITE_OBSERVATION_MINUTES * 60 * 1_000);
  const [observationRows, activeTransfers] = await Promise.all([
    db.execute(sql`
      select e.asset_id as asset_id, e.site_id as site_id, max(e.occurred_at) as observed_at
      from event_log e
      where e.event_type in ('asset_received', 'inspection_recorded')
        and e.asset_id is not null
        and e.occurred_at >= ${cutoff}
      group by e.asset_id, e.site_id
    `),
    db.select().from(transferOrders).where(eq(transferOrders.status, "initiated"))
  ]);
  return detectDualSiteObservations(
    observationRows.rows.map((row) => ({
      assetId: String(row.asset_id),
      siteId: String(row.site_id),
      observedAt: new Date(String(row.observed_at))
    })),
    {
      now,
      observationWindowMinutes: env.DUAL_SITE_OBSERVATION_MINUTES,
      activeTransfers: activeTransfers.map((transfer) => ({
        assetId: transfer.assetId,
        originSiteId: transfer.originSiteId,
        destinationSiteId: transfer.destinationSiteId,
        initiatedAt: transfer.initiatedAt
      }))
    }
  );
}

async function loadEvidenceFindings(db: Database): Promise<DivergenceRuleResult[]> {
  const rows = await db.execute(sql`
    select i.id as inspection_id, i.asset_id as asset_id, i.site_id as site_id,
      count(em.id) as evidence_count
    from inspection i
    left join evidence_metadata em on em.inspection_id = i.id
    group by i.id, i.asset_id, i.site_id
  `);
  return detectInspectionEvidenceGaps(
    rows.rows.map((row) => ({
      inspectionId: String(row.inspection_id),
      assetId: String(row.asset_id),
      siteId: String(row.site_id),
      evidenceCount: Number(row.evidence_count)
    }))
  );
}

async function loadStaleSiteFindings(
  db: Database,
  now: Date
): Promise<DivergenceRuleResult[]> {
  const rows = await db.select().from(sites);
  return detectStaleSites(
    rows.map((row) => ({
      siteId: row.id,
      siteName: row.name,
      lastSyncCompletedAt: row.lastSyncCompletedAt,
      staleAfterMinutes: env.SYNC_STALE_MINUTES
    })),
    now
  );
}

async function loadProjectionIntegrityFindings(db: Database): Promise<DivergenceRuleResult[]> {
  const rows = await db.execute(sql`
    select p.asset_id as asset_id,
           p.last_sequence as projection_sequence,
           max(e.sequence_number) as latest_event_sequence
    from asset_projection p
    join event_log e on e.asset_id = p.asset_id
    group by p.asset_id, p.last_sequence
  `);
  return detectProjectionIntegrityIssues(
    rows.rows.map((row) => ({
      assetId: String(row.asset_id),
      projectionSequence: Number(row.projection_sequence),
      latestEventSequence: Number(row.latest_event_sequence)
    }))
  );
}

async function resolveFindingSite(db: Database, finding: DivergenceRuleResult): Promise<string> {
  if (finding.siteId) return finding.siteId;
  if (finding.assetId) {
    const [projection] = await db
      .select({ currentSiteId: assetProjection.currentSiteId })
      .from(assetProjection)
      .where(eq(assetProjection.assetId, finding.assetId))
      .limit(1);
    if (projection?.currentSiteId) return projection.currentSiteId;
    const [asset] = await db
      .select({ registeredSiteId: assets.registeredSiteId })
      .from(assets)
      .where(eq(assets.id, finding.assetId))
      .limit(1);
    if (asset) return asset.registeredSiteId;
  }
  throw new Error(`Divergence finding ${finding.ruleCode} has no attributable site`);
}

export async function runDivergenceScan(db: Database): Promise<{
  findingsEvaluated: number;
  alertsCreated: number;
  alertsResolved: number;
}> {
  incrementCounter("divergenceScans");
  const now = new Date();
  const [transferFindings, dualSiteFindings, evidenceFindings, staleSiteFindings, projectionFindings] =
    await Promise.all([
      loadTransferFindings(db, now),
      loadDualObservationFindings(db, now),
      loadEvidenceFindings(db),
      loadStaleSiteFindings(db, now),
      loadProjectionIntegrityFindings(db)
    ]);
  const combined = [
    ...transferFindings,
    ...dualSiteFindings,
    ...evidenceFindings,
    ...staleSiteFindings,
    ...projectionFindings
  ];
  let alertsCreated = 0;
  for (const finding of combined) {
    const siteId = await resolveFindingSite(db, finding);
    const result = await ingestDivergenceFinding(db, finding, siteId, now);
    if (result.createdOrReopened) alertsCreated += 1;
  }

  const currentFingerprints = new Set(combined.map((finding) => divergenceFingerprint(finding)));
  const managedRuleCodes = [
    "TRANSFER_NOT_CONFIRMED",
    "ASSET_OBSERVED_AT_MULTIPLE_SITES",
    "INSPECTION_MISSING_EVIDENCE",
    "SITE_PROJECTION_STALE",
    "PROJECTION_SEQUENCE_BEHIND_EVENT_STREAM"
  ];
  const activeAlerts = await db
    .select()
    .from(alerts)
    .where(
      and(
        inArray(alerts.status, ["open", "acknowledged"]),
        inArray(alerts.ruleCode, managedRuleCodes)
      )
    );
  let alertsResolved = 0;
  for (const alert of activeAlerts) {
    if (currentFingerprints.has(alert.fingerprint)) continue;
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
    if (openCase) continue;
    const siteId = await resolveFindingSite(db, {
      ruleCode: alert.ruleCode,
      severity: alert.severity as "low" | "medium" | "high",
      assetId: alert.assetId,
      siteId: alert.siteId,
      summary: alert.summary,
      details: alert.details as Record<string, unknown>
    });
    const cleared = await clearDivergenceAlert(
      db,
      {
        alertId: alert.id,
        fingerprint: alert.fingerprint,
        ruleCode: alert.ruleCode,
        assetId: alert.assetId,
        siteId,
        occurrenceCount: alert.occurrenceCount
      },
      now
    );
    if (cleared) alertsResolved += 1;
  }
  return { findingsEvaluated: combined.length, alertsCreated, alertsResolved };
}
