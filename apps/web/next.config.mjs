import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Repository-level ESLint runs as an explicit zero-warning CI gate.
  eslint: {
    ignoreDuringBuilds: true
  },
  output: "standalone",
  outputFileTracingRoot: path.join(projectDirectory, "../..")
};

export default nextConfig;
