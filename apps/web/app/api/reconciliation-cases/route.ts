import { NextResponse } from "next/server";
import { fetchJson } from "../../../lib/api";
import {
  hasAllowedMutationOrigin,
  mutationErrorResponse,
  readRequiredText,
  validationErrorResponse
} from "../../../lib/route-errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasAllowedMutationOrigin(request)) {
    return NextResponse.json(
      { error: { code: "ORIGIN_NOT_ALLOWED", message: "Cross-origin mutations are not allowed." } },
      { status: 403 }
    );
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return validationErrorResponse("A JSON request body is required.");
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationErrorResponse("The request body must be a JSON object.");
  }

  try {
    const body = input as Record<string, unknown>;
    const siteId = readRequiredText(body.siteId, "Responsible site", 36, 36);
    if (!UUID_PATTERN.test(siteId)) {
      return validationErrorResponse("A valid responsible site is required.");
    }
    const title = readRequiredText(body.title, "Case title", 3, 160);
    const description = readRequiredText(body.description, "Case description", 3, 8_000);
    const result = await fetchJson<{ data: unknown }>("/reconciliation-cases", {
      method: "POST",
      body: JSON.stringify({ siteId, title, description })
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof TypeError) {
      return validationErrorResponse(error.message);
    }
    return mutationErrorResponse(error);
  }
}
