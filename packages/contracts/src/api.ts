import { z } from "zod";

export const statusSchema = z.enum(["ok", "warning", "critical"]);

export const dashboardSummarySchema = z.object({
  openReconciliationCases: z.number().int().nonnegative(),
  staleSites: z.number().int().nonnegative(),
  assetsInTransit: z.number().int().nonnegative(),
  recentAlerts: z.number().int().nonnegative(),
  replaySuccessCount: z.number().int().nonnegative(),
  replayFailureCount: z.number().int().nonnegative(),
  unresolvedEvidenceGaps: z.number().int().nonnegative(),
  openHighSeverityAlerts: z.number().int().nonnegative(),
  openTransferTimeoutAlerts: z.number().int().nonnegative(),
  openDualSiteAlerts: z.number().int().nonnegative(),
  openProjectionLagAlerts: z.number().int().nonnegative(),
  openEvidenceGapAlerts: z.number().int().nonnegative(),
  openStaleSiteAlerts: z.number().int().nonnegative()
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
