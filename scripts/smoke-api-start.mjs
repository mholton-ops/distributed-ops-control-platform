import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDirectory, "..");
const apiEntry = join(root, "apps", "api", "dist", "index.js");
const port = 4187;
const smokePassword = randomBytes(24).toString("hex");
const smokeToken = randomBytes(32).toString("hex");

if (!existsSync(apiEntry)) {
  throw new Error("The compiled API entry point is missing. Run npm run build first.");
}

let output = "";
const child = spawn(process.execPath, [apiEntry], {
  cwd: join(root, "apps", "api"),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    LOG_LEVEL: "silent",
    DATABASE_URL: `postgresql://ops_test:${smokePassword}@127.0.0.1:1/ops_control_test`,
    OPS_TEST_AUTH_TOKEN: smokeToken,
    OPS_TEST_ACTOR: "compiled-start-smoke"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output += chunk;
  });
}

const deadline = Date.now() + 15_000;
let verified = false;

try {
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The compiled API exited early.\n${output}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        verified = true;
        break;
      }
    } catch {
      // The listener may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (!verified) {
    throw new Error(`The compiled API did not become healthy.\n${output}`);
  }

  console.log("Compiled API start smoke passed.");
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
  }
}
