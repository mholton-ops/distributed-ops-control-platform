import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("workbench readiness", () => {
  beforeEach(() => {
    vi.stubEnv("API_BASE_URL", "http://127.0.0.1:4000/api/v1");
    vi.stubEnv("OPS_TEST_AUTH_TOKEN", "t".repeat(32));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports ready only when the configured API readiness probe succeeds", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/ready",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("reports not ready when the upstream API is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready", testApi: "unavailable" });
  });
});
