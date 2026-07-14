import { buildServer } from "./app";
import { closeDatabase } from "./db/client";
import { env } from "./lib/env";

const app = buildServer();
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Shutting down API");
  const forcedExit = setTimeout(() => process.exit(1), 10_000).unref();
  try {
    await app.close();
    await closeDatabase();
    clearTimeout(forcedExit);
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Graceful shutdown failed");
    process.exit(1);
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

app
  .listen({ host: env.HOST, port: env.PORT })
  .then(() => app.log.info({ host: env.HOST, port: env.PORT }, "API listening"))
  .catch(async (error) => {
    app.log.error(error, "Failed to start API server");
    await closeDatabase();
    process.exit(1);
  });
