import { NextResponse } from "next/server";
import { ApiConfigurationError, ApiError } from "./api";

export function mutationErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiConfigurationError) {
    return NextResponse.json(
      {
        error: {
          code: "TEST_AUTH_NOT_CONFIGURED",
          message: "Test API authentication is not configured on the web server."
        }
      },
      { status: 503 }
    );
  }

  if (error instanceof ApiError) {
    const operatorMessage = {
      CASE_VERSION_CONFLICT: "This case changed after the page loaded. Refresh and review it again.",
      CASE_ALREADY_RESOLVED: "This case was already resolved. Refresh to see its current state."
    }[error.code];
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: operatorMessage ??
            (error.status === 404
              ? "The requested record no longer exists."
              : "The test API could not complete this operation.")
        }
      },
      { status: error.status >= 400 && error.status <= 599 ? error.status : 502 }
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "MUTATION_FAILED",
        message: "The operation could not be completed."
      }
    },
    { status: 500 }
  );
}

export function validationErrorResponse(message: string): NextResponse {
  return NextResponse.json(
    { error: { code: "INVALID_REQUEST", message } },
    { status: 400 }
  );
}

export function hasAllowedMutationOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  const host = request.headers.get("host");
  if (!host || host.includes(",") || /[\s/\\]/.test(host)) {
    return false;
  }

  try {
    const allowed = new URL(
      process.env.OPS_TEST_WEB_ORIGIN?.trim() || "http://127.0.0.1:3000"
    );
    const loopbackHostnames = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
    if (
      allowed.protocol !== "http:" ||
      !loopbackHostnames.has(allowed.hostname) ||
      allowed.username ||
      allowed.password ||
      allowed.search ||
      allowed.hash ||
      allowed.pathname !== "/"
    ) {
      return false;
    }
    const suppliedOrigin = new URL(origin);
    return (
      suppliedOrigin.href === `${suppliedOrigin.origin}/` &&
      suppliedOrigin.origin === allowed.origin &&
      host === allowed.host
    );
  } catch {
    return false;
  }
}

export function readRequiredText(
  value: unknown,
  label: string,
  minimumLength: number,
  maximumLength: number
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length < minimumLength || normalized.length > maximumLength) {
    throw new TypeError(
      `${label} must be between ${String(minimumLength)} and ${String(maximumLength)} characters.`
    );
  }
  return normalized;
}
