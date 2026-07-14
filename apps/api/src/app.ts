import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider
} from "fastify-type-provider-zod";
import { db } from "./db/client";
import { ApiError } from "./lib/errors";
import { env } from "./lib/env";
import { registerTestAuthentication } from "./lib/auth";
import { registerHealthRoutes } from "./routes/health";
import { registerV1Routes } from "./routes/v1";

export function buildServer() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: ["req.headers.authorization"],
        censor: "[REDACTED]"
      },
      base: {
        service: "distributed-ops-control-platform-api"
      }
    },
    bodyLimit: 1_048_576
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate("db", db);
  registerTestAuthentication(app);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      request.log.warn(
        {
          err: error,
          details: error.details
        },
        "API domain error"
      );
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.statusCode < 500 ? (error.details ?? null) : null
        }
      });
      return;
    }

    const validationError = error as {
      code?: string;
      statusCode?: number;
      validation?: unknown;
      message: string;
    };

    if (
      validationError.code === "FST_ERR_VALIDATION" ||
      (validationError.statusCode === 400 && Array.isArray(validationError.validation))
    ) {
      request.log.warn(
        {
          err: error,
          validation: validationError.validation ?? null
        },
        "API request validation error"
      );
      reply.status(400).send({
        error: {
          code: "REQUEST_VALIDATION_FAILED",
          message: "Request validation failed"
        }
      });
      return;
    }

    request.log.error({ err: error }, "Unhandled API error");
    reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error"
      }
    });
  });

  app.register(registerHealthRoutes);
  app.register(registerHealthRoutes, { prefix: "/api/v1" });
  app.register(registerV1Routes, { prefix: "/api/v1" });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: typeof db;
  }
}
