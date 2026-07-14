import type { FastifyInstance } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { getHttpServerSecurityConfig } from "./env";

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function hasValidBearerToken(header: string | undefined, expectedToken: string): boolean {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const suppliedToken = match[1];
  return timingSafeEqual(tokenDigest(suppliedToken), tokenDigest(expectedToken));
}

export function registerTestAuthentication(app: FastifyInstance): void {
  const { token, actor } = getHttpServerSecurityConfig();
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?", 1)[0];
    const isPublicHealth = ["/health", "/ready", "/api/v1/health", "/api/v1/ready"].includes(path);
    const requiresAuthentication =
      path === "/metrics" || path === "/api/v1/metrics" || path.startsWith("/api/v1/");
    if (isPublicHealth || !requiresAuthentication) return;
    if (!hasValidBearerToken(request.headers.authorization, token)) {
      return reply.status(401).send({
        error: { code: "AUTHENTICATION_REQUIRED", message: "A valid test bearer token is required" }
      });
    }
    request.testActor = actor;
  });
}

declare module "fastify" {
  interface FastifyRequest {
    testActor: string;
  }
}
