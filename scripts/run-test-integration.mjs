import { spawn } from "node:child_process";

if (process.env.OPS_RUN_DB_INTEGRATION !== "1") {
  throw new Error("Set OPS_RUN_DB_INTEGRATION=1 to run PostgreSQL integration tests.");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for PostgreSQL integration tests.");
}

const databaseUrl = new URL(connectionString);
const allowedProtocols = new Set(["postgres:", "postgresql:"]);
const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const databaseName = databaseUrl.pathname.replace(/^\//, "");

if (!allowedProtocols.has(databaseUrl.protocol)) {
  throw new Error("Only PostgreSQL test databases are supported by integration tests.");
}
if (!allowedHosts.has(databaseUrl.hostname)) {
  throw new Error("Integration tests are restricted to a loopback PostgreSQL host.");
}
if (
  databaseName !== "ops_control_test" ||
  databaseUrl.username !== "ops_test" ||
  databaseUrl.password.length < 24
) {
  throw new Error("Integration tests require the canonical ops_control_test database and user.");
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("npm_execpath is unavailable; run this integration guard through npm.");
}
const child = spawn(
  process.execPath,
  [npmCli, "run", "test:integration", "--workspace", "@ops/api"],
  {
    env: process.env,
    stdio: "inherit"
  }
);

child.once("error", (error) => {
  throw error;
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
