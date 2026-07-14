"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatRelativeAge, formatTimestamp } from "../lib/format";

const AUTO_REFRESH_MS = 30_000;

export function DataFreshness({ snapshotAt }: { snapshotAt: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [now, setNow] = useState<number | null>(null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    setNow(Date.now());
    const onVisibilityChange = (): void => setIsVisible(document.visibilityState === "visible");
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    const ageTimer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(ageTimer);
    };
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }
    const refreshTimer = window.setInterval(() => {
      startTransition(() => router.refresh());
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(refreshTimer);
  }, [isVisible, router]);

  function refresh(): void {
    startTransition(() => router.refresh());
  }

  return (
    <div className="app-data-freshness" role="status" aria-live="polite">
      <span>
        Data snapshot{" "}
        <time dateTime={snapshotAt} title={formatTimestamp(snapshotAt)}>
          {now === null ? formatTimestamp(snapshotAt) : formatRelativeAge(snapshotAt, "Unknown", now)}
        </time>
      </span>
      <span aria-hidden="true">·</span>
      <span>{isVisible ? "Auto-refresh 30s" : "Refresh paused while hidden"}</span>
      <button type="button" className="app-pill-action" onClick={refresh} disabled={isPending}>
        {isPending ? "Refreshing…" : "Refresh now"}
      </button>
    </div>
  );
}
