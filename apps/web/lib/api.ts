const DEFAULT_TIMEOUT_MS = 10_000;
const ALLOWED_TEST_API_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1", "api"]);

export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConfigurationError";
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "UPSTREAM_REQUEST_FAILED") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type JsonValidator<T> = (value: unknown) => value is T;

type FetchJsonOptions<T> = Omit<RequestInit, "headers" | "signal"> & {
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  validate?: JsonValidator<T>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiEnvelope(value: unknown): value is { data: unknown } {
  if (!isRecord(value) || !Object.hasOwn(value, "data")) {
    return false;
  }
  return Array.isArray(value.data) || isRecord(value.data);
}

export function validateTestApiBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim().replace(/\/$/, ""));
    if (
      url.protocol !== "http:" ||
      !ALLOWED_TEST_API_HOSTS.has(url.hostname) ||
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

export function apiConfiguration(): { baseUrl: string; token: string } {
  if (typeof window !== "undefined") {
    throw new ApiConfigurationError("The authenticated API client is server-only.");
  }

  const configuredBaseUrl = process.env.API_BASE_URL?.trim();
  const baseUrl = configuredBaseUrl ? validateTestApiBaseUrl(configuredBaseUrl) : null;
  const token = process.env.OPS_TEST_AUTH_TOKEN?.trim();

  if (!baseUrl || !token || token.length < 32) {
    throw new ApiConfigurationError(
      "Test API access is not configured within the loopback/Compose boundary."
    );
  }

  return { baseUrl, token };
}

export function apiReadinessUrl(baseUrl: string): string {
  return `${new URL(baseUrl).origin}/ready`;
}

export function isApiNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export async function fetchJson<T>(
  path: string,
  options: FetchJsonOptions<T> = {}
): Promise<T> {
  const { baseUrl, token } = apiConfiguration();
  const { timeoutMs = DEFAULT_TIMEOUT_MS, validate, headers, signal, ...requestOptions } = options;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...requestOptions,
      cache: "no-store",
      signal: requestSignal,
      headers: {
        accept: "application/json",
        ...(requestOptions.body ? { "content-type": "application/json" } : {}),
        ...(headers ?? {}),
        authorization: `Bearer ${token}`
      }
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new ApiError(`The test API timed out while requesting ${path}.`, 504, "UPSTREAM_TIMEOUT");
    }
    throw new ApiError(`The test API could not be reached for ${path}.`, 502, "UPSTREAM_UNAVAILABLE");
  }

  if (!response.ok) {
    let upstreamCode = "UPSTREAM_REQUEST_FAILED";
    try {
      const errorPayload: unknown = await response.json();
      if (isRecord(errorPayload) && isRecord(errorPayload.error)) {
        const candidate = errorPayload.error.code;
        if (typeof candidate === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(candidate)) {
          upstreamCode = candidate;
        }
      }
    } catch {
      // A structured upstream error is optional; never surface raw response text.
    }
    throw new ApiError(
      `The test API rejected ${path} with status ${String(response.status)}.`,
      response.status,
      upstreamCode
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(`The test API returned invalid JSON for ${path}.`, 502, "INVALID_UPSTREAM_JSON");
  }

  const isValid = validate ? validate(payload) : isApiEnvelope(payload);
  if (!isValid) {
    throw new ApiError(
      `The test API returned an unexpected response shape for ${path}.`,
      502,
      "INVALID_UPSTREAM_RESPONSE"
    );
  }

  return payload as T;
}
