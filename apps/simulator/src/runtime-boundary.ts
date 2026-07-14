const ALLOWED_SIMULATOR_API_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1",
  "api"
]);

export function validateSimulatorApiBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim().replace(/\/$/, ""));
    if (
      url.protocol !== "http:" ||
      !ALLOWED_SIMULATOR_API_HOSTS.has(url.hostname) ||
      url.port !== "4000" ||
      url.pathname !== "/api/v1" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `${url.origin}/api/v1`;
  } catch {
    return null;
  }
}
