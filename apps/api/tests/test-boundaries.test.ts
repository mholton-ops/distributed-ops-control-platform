import { describe, expect, it } from "vitest";
import {
  isAllowedTestDatabaseUrl,
  UNIT_TEST_DATABASE_URL
} from "../src/lib/test-boundaries";

describe("test database boundary", () => {
  it("allows only the canonical loopback and Compose test database identity", () => {
    expect(
      isAllowedTestDatabaseUrl(
        "postgresql://ops_test:ephemeral-password-value@127.0.0.1:5433/ops_control_test",
        "production"
      )
    ).toBe(true);
    expect(
      isAllowedTestDatabaseUrl(
        "postgresql://ops_test:ephemeral-password-value@postgres:5432/ops_control_test",
        "production"
      )
    ).toBe(true);
    expect(
      isAllowedTestDatabaseUrl(
        "postgresql://ops_test:ephemeral-password-value@10.0.0.200:5432/ops_control_test",
        "production"
      )
    ).toBe(false);
    expect(
      isAllowedTestDatabaseUrl(
        "postgresql://postgres:ephemeral-password-value@127.0.0.1:5433/ops_control_test",
        "production"
      )
    ).toBe(false);
    expect(
      isAllowedTestDatabaseUrl(
        "postgresql://ops_test:ephemeral-password-value@127.0.0.1:5433/postgres",
        "production"
      )
    ).toBe(false);
  });

  it("allows the non-routable unit-test sentinel only in test mode", () => {
    expect(isAllowedTestDatabaseUrl(UNIT_TEST_DATABASE_URL, "test")).toBe(true);
    expect(isAllowedTestDatabaseUrl(UNIT_TEST_DATABASE_URL, "production")).toBe(false);
  });
});
