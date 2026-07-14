export const UNIT_TEST_DATABASE_URL = "postgresql://test:test@test.invalid:5432/test";

const allowedDatabaseHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1", "postgres"]);

export function isAllowedTestDatabaseUrl(
  value: string,
  nodeEnvironment: "development" | "test" | "production"
): boolean {
  if (nodeEnvironment === "test" && value === UNIT_TEST_DATABASE_URL) {
    return true;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
      allowedDatabaseHosts.has(url.hostname) &&
      url.username === "ops_test" &&
      url.password.length >= 24 &&
      url.pathname === "/ops_control_test" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
