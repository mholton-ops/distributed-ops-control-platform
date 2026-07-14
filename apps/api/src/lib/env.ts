import { z } from "zod";
import { isAllowedTestDatabaseUrl, UNIT_TEST_DATABASE_URL } from "./test-boundaries";

const nodeEnvironment = process.env.NODE_ENV
  ? z.enum(["development", "test", "production"]).parse(process.env.NODE_ENV)
  : "development";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  HOST: z.ipv4().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1).refine(
    (value) => isAllowedTestDatabaseUrl(value, nodeEnvironment),
    "DATABASE_URL must target the guarded ops_test/ops_control_test PostgreSQL test database on loopback or the Compose postgres service"
  ),
  OPS_TEST_AUTH_TOKEN: z.string().min(32).optional(),
  OPS_TEST_ACTOR: z.string().trim().min(2).max(96).optional(),
  SYNC_STALE_MINUTES: z.coerce.number().int().positive().default(45),
  TRANSFER_CONFIRMATION_HOURS: z.coerce.number().int().positive().default(4),
  DUAL_SITE_OBSERVATION_MINUTES: z.coerce.number().int().positive().default(60)
});

export const env = envSchema.parse({
  ...process.env,
  NODE_ENV: nodeEnvironment,
  DATABASE_URL:
    process.env.DATABASE_URL ?? (nodeEnvironment === "test" ? UNIT_TEST_DATABASE_URL : undefined)
});

export function getHttpServerSecurityConfig(): { token: string; actor: string } {
  const token = env.OPS_TEST_AUTH_TOKEN;
  const actor = env.OPS_TEST_ACTOR;
  if (!token || !actor) {
    throw new Error(
      "OPS_TEST_AUTH_TOKEN and OPS_TEST_ACTOR are required to start the test API"
    );
  }
  return { token, actor };
}
