import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { readCounters } from "../lib/metrics";
import { checkDatabaseReadiness } from "../db/client";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: z.object({
            status: z.literal("ok"),
            timestamp: z.string().datetime(),
            uptimeSeconds: z.number()
          })
        }
      }
    },
    async () => ({
      status: "ok" as const,
      timestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime()
    })
  );

  app.get(
    "/ready",
    {
      schema: {
        response: {
          200: z.object({ status: z.literal("ready"), timestamp: z.string().datetime() }),
          503: z.object({ status: z.literal("not_ready"), reason: z.string(), timestamp: z.string().datetime() })
        }
      }
    },
    async (_request, reply) => {
      const database = await checkDatabaseReadiness();
      const timestamp = new Date().toISOString();
      if (!database.ready) {
        return reply.status(503).send({
          status: "not_ready" as const,
          reason: database.reason ?? "database is unavailable",
          timestamp
        });
      }
      return { status: "ready" as const, timestamp };
    }
  );

  app.get(
    "/metrics",
    {
      schema: {
        response: {
          200: z.object({
            counters: z.record(z.string(), z.number())
          })
        }
      }
    },
    async () => ({
      counters: readCounters()
    })
  );
}
