import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const task = process.argv[2];
if (task !== "migrate" && task !== "seed") {
  throw new Error("Expected a test database task of either 'migrate' or 'seed'.");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for guarded test database tasks.");
}

const databaseUrl = new URL(connectionString);
const allowedProtocols = new Set(["postgres:", "postgresql:"]);
const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1", "postgres"]);
const databaseName = databaseUrl.pathname.replace(/^\//, "");

if (!allowedProtocols.has(databaseUrl.protocol)) {
  throw new Error("Only PostgreSQL test databases are supported by this task.");
}
if (!allowedHosts.has(databaseUrl.hostname)) {
  throw new Error("Refusing a database host outside the loopback or test Compose network.");
}
if (
  databaseName !== "ops_control_test" ||
  databaseUrl.username !== "ops_test" ||
  databaseUrl.password.length < 24
) {
  throw new Error("Refusing a database that is not the canonical ops_control_test test database.");
}
if (task === "seed" && process.env.OPS_ALLOW_DEMO_SEED !== "ops_control_test") {
  throw new Error(
    "Demo seeding is destructive and requires OPS_ALLOW_DEMO_SEED=ops_control_test."
  );
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = join(scriptDirectory, "..", "apps", "api");
const entryPoint = join(apiDirectory, "dist", "db", `${task}.js`);

if (!existsSync(entryPoint)) {
  throw new Error(`Missing ${entryPoint}. Run npm run build before ${task}.`);
}

const child = spawn(process.execPath, [entryPoint], {
  cwd: apiDirectory,
  env: process.env,
  stdio: "inherit"
});

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
