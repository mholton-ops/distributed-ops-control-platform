import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspaceRoot = process.cwd();
const sourceStatic = path.join(workspaceRoot, "apps", "web", ".next", "static");
const standaloneRoot = path.join(
  workspaceRoot,
  "apps",
  "web",
  ".next",
  "standalone",
);
const targetStatic = path.join(
  standaloneRoot,
  "apps",
  "web",
  ".next",
  "static",
);
const serverEntry = path.join(standaloneRoot, "apps", "web", "server.js");

await mkdir(targetStatic, { recursive: true });
await cp(sourceStatic, targetStatic, { recursive: true, force: true });
await import(pathToFileURL(serverEntry).href);
