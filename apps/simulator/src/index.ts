import { buildScenarios, DEFAULT_SITE_IDS, type ScenarioName } from "./scenarios";
import { validateSimulatorApiBaseUrl } from "./runtime-boundary";

const API_BASE_URL = validateSimulatorApiBaseUrl(
  process.env.API_BASE_URL ?? "http://127.0.0.1:4000/api/v1"
);
const TEST_AUTH_TOKEN = process.env.OPS_TEST_AUTH_TOKEN;

if (!API_BASE_URL) {
  throw new Error("API_BASE_URL must target the allowlisted loopback or Compose test API.");
}

if (!TEST_AUTH_TOKEN || TEST_AUTH_TOKEN.length < 32) {
  throw new Error(
    "OPS_TEST_AUTH_TOKEN must be at least 32 characters and supplied at runtime; never store it in source."
  );
}

async function post(path: string, payload: unknown): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TEST_AUTH_TOKEN}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`POST ${path} failed with HTTP ${response.status}`);
  }

  return response.json();
}

async function get(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${TEST_AUTH_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error(`GET ${path} failed with HTTP ${response.status}`);
  }

  return response.json();
}

function resolveScenarioName(): ScenarioName {
  const argValue = process.argv.find((value) => value.startsWith("--scenario="));
  const fromArg = argValue?.split("=")[1];
  const fromEnv = process.env.SIM_SCENARIO;
  const raw = (fromArg ?? fromEnv ?? "sync-lag-divergence").trim();

  if (raw === "healthy-movement" || raw === "sync-lag-divergence") {
    return raw;
  }
  throw new Error(
    "Unknown simulator scenario. Use healthy-movement or sync-lag-divergence."
  );
}

async function run(): Promise<void> {
  const scenarioName = resolveScenarioName();
  const scenarios = buildScenarios();
  const scenario = scenarios[scenarioName];

  // eslint-disable-next-line no-console
  console.log(`Running simulator scenario: ${scenario.name}`);
  // eslint-disable-next-line no-console
  console.log(scenario.description);
  // eslint-disable-next-line no-console
  console.log(`Scenario run bucket: ${scenario.runId}`);

  for (const event of scenario.onlineEvents) {
    await post("/events", event);
  }

  if (scenario.offlineReplayBatchId && scenario.offlineEvents && scenario.offlineEvents.length > 0) {
    const replay = await post("/sync/replay", {
      siteId: DEFAULT_SITE_IDS.coastal,
      syncBatchId: scenario.offlineReplayBatchId,
      events: scenario.offlineEvents
    });
    const replayStatus = (replay as { data?: { status?: unknown } }).data?.status;
    if (scenario.expectedReplayStatus && replayStatus !== scenario.expectedReplayStatus) {
      throw new Error(
        `Scenario expected replay status ${scenario.expectedReplayStatus}, received ${String(replayStatus)}`
      );
    }
  }

  const divergence = await post("/divergence/scan", {});
  if (scenario.expectedAlert) {
    const alertResponse = await get("/alerts");
    const alertRows = (alertResponse as { data?: unknown }).data;
    const found =
      Array.isArray(alertRows) &&
      alertRows.some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          (row as { ruleCode?: unknown }).ruleCode === scenario.expectedAlert?.ruleCode &&
          (row as { assetId?: unknown }).assetId === scenario.expectedAlert?.assetId
      );
    if (!found) {
      throw new Error(
        `Scenario did not produce ${scenario.expectedAlert.ruleCode} for ${scenario.expectedAlert.assetId}`
      );
    }
  }
  // eslint-disable-next-line no-console
  console.log("Simulation completed", divergence);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
