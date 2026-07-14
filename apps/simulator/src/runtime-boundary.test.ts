import { describe, expect, it } from "vitest";
import { validateSimulatorApiBaseUrl } from "./runtime-boundary";

describe("simulator API boundary", () => {
  it("allows only the canonical loopback and Compose API", () => {
    expect(validateSimulatorApiBaseUrl("http://127.0.0.1:4000/api/v1")).toBe(
      "http://127.0.0.1:4000/api/v1"
    );
    expect(validateSimulatorApiBaseUrl("http://api:4000/api/v1")).toBe(
      "http://api:4000/api/v1"
    );
    expect(validateSimulatorApiBaseUrl("http://10.0.0.200:4000/api/v1")).toBeNull();
    expect(validateSimulatorApiBaseUrl("https://example.test/api/v1")).toBeNull();
  });
});
