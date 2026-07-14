"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep diagnostic detail in the server/browser console; never render upstream error text.
    console.error(error);
  }, [error]);

  return (
    <section className="app-card" role="alert">
      <h2 className="app-page-title">Operational data is unavailable</h2>
      <p className="app-page-subtitle">
        Confirm that the private test API is running and that the web server has both{" "}
        <code>API_BASE_URL</code> and the server-only <code>OPS_TEST_AUTH_TOKEN</code> configured.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="app-button" onClick={reset}>
          Try again
        </button>
      </div>
      {error.digest ? <p className="mt-3 text-xs text-fgMuted">Reference: {error.digest}</p> : null}
    </section>
  );
}
