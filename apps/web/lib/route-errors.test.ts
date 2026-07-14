import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiConfiguration, ApiConfigurationError, validateTestApiBaseUrl } from "./api";
import { hasAllowedMutationOrigin } from "./route-errors";

function mutationRequest(host: string, origin?: string): Request {
  return new Request("http://127.0.0.1:3000/api/reconciliation-cases", {
    method: "POST",
    headers: {
      host,
      ...(origin ? { origin } : {})
    }
  });
}

describe("web test boundary", () => {
  beforeEach(() => {
    vi.stubEnv("OPS_TEST_WEB_ORIGIN", "http://127.0.0.1:3000");
    vi.stubEnv("OPS_TEST_AUTH_TOKEN", "t".repeat(32));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only the configured canonical mutation origin and host", () => {
    expect(hasAllowedMutationOrigin(mutationRequest("127.0.0.1:3000", "http://127.0.0.1:3000"))).toBe(true);
    expect(hasAllowedMutationOrigin(mutationRequest("attacker.test", "http://attacker.test"))).toBe(false);
    expect(hasAllowedMutationOrigin(mutationRequest("127.0.0.1:3000"))).toBe(false);
  });

  it("rejects a non-loopback configured web origin", () => {
    vi.stubEnv("OPS_TEST_WEB_ORIGIN", "http://example.test:3000");
    expect(hasAllowedMutationOrigin(mutationRequest("example.test:3000", "http://example.test:3000"))).toBe(false);
  });

  it("allows only canonical loopback or Compose API targets", () => {
    expect(validateTestApiBaseUrl("http://127.0.0.1:4000/api/v1")).toBe(
      "http://127.0.0.1:4000/api/v1"
    );
    expect(validateTestApiBaseUrl("http://api:4000/api/v1")).toBe(
      "http://api:4000/api/v1"
    );
    expect(validateTestApiBaseUrl("http://10.0.0.200:4000/api/v1")).toBeNull();
    expect(validateTestApiBaseUrl("https://example.test/api/v1")).toBeNull();
  });

  it("does not expose the server bearer to an invalid API target", () => {
    vi.stubEnv("API_BASE_URL", "http://example.test:4000/api/v1");
    expect(() => apiConfiguration()).toThrow(ApiConfigurationError);
  });
});
