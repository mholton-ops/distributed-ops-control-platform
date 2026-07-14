import { NextResponse } from "next/server";
import { apiConfiguration, apiReadinessUrl } from "../../../lib/api";

export async function GET(): Promise<NextResponse> {
  try {
    const { baseUrl } = apiConfiguration();
    const upstream = await fetch(apiReadinessUrl(baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000)
    });
    if (!upstream.ok) {
      throw new Error("Test API is not ready");
    }
    return NextResponse.json({ status: "ok", testApi: "ready" });
  } catch {
    return NextResponse.json(
      { status: "not_ready", testApi: "unavailable" },
      { status: 503 }
    );
  }
}
