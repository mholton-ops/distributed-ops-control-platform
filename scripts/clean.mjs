import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const generatedPaths = [
  "apps/api/dist",
  "apps/simulator/dist",
  "apps/web/.next",
  "packages/contracts/dist",
  "packages/domain/dist",
  "packages/ui/dist",
  "coverage",
  "playwright-report",
  "test-results"
];

for (const relativePath of generatedPaths) {
  rmSync(join(root, relativePath), { force: true, recursive: true });
}
