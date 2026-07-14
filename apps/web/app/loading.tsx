export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-label="Loading operational data">
      <div className="app-card animate-pulse">
        <div className="h-6 w-48 rounded bg-panelMuted" />
        <div className="mt-3 h-4 max-w-xl rounded bg-panelMuted" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="app-card animate-pulse">
            <div className="h-4 w-28 rounded bg-panelMuted" />
            <div className="mt-4 h-10 w-20 rounded bg-panelMuted" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading operational data…</span>
    </div>
  );
}
