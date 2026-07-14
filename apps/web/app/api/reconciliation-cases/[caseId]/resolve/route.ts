import { NextResponse } from "next/server";
import { fetchJson } from "../../../../../lib/api";
import {
  hasAllowedMutationOrigin,
  mutationErrorResponse,
  readRequiredText,
  validationErrorResponse
} from "../../../../../lib/route-errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOLVED_ASSET_STATUSES = new Set([
  "registered",
  "in_transit",
  "at_site",
  "under_inspection"
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ caseId: string }> }
): Promise<NextResponse> {
  if (!hasAllowedMutationOrigin(request)) {
    return NextResponse.json(
      { error: { code: "ORIGIN_NOT_ALLOWED", message: "Cross-origin mutations are not allowed." } },
      { status: 403 }
    );
  }

  const { caseId } = await context.params;
  if (!UUID_PATTERN.test(caseId)) {
    return validationErrorResponse("A valid reconciliation case ID is required.");
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
    const resolutionSummary = readRequiredText(
      body.resolutionSummary,
      "Resolution summary",
      12,
      8_000
    );
    const expectedVersion = body.expectedVersion;
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
      return validationErrorResponse("A positive case version is required.");
    }
    let resolvedAssetStatus: string | undefined;
    if (body.resolvedAssetStatus !== undefined && body.resolvedAssetStatus !== null) {
      resolvedAssetStatus = readRequiredText(
        body.resolvedAssetStatus,
        "Verified asset status",
        6,
        32
      );
      if (!RESOLVED_ASSET_STATUSES.has(resolvedAssetStatus)) {
        return validationErrorResponse("Select a valid verified asset status.");
      }
    }
    const result = await fetchJson<{ data: unknown }>(
      `/reconciliation-cases/${caseId}/resolve`,
      {
        method: "PATCH",
        body: JSON.stringify({
          resolutionSummary,
          expectedVersion,
          ...(resolvedAssetStatus ? { resolvedAssetStatus } : {})
        })
      }
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TypeError) {
      return validationErrorResponse(error.message);
    }
    return mutationErrorResponse(error);
  }
}
