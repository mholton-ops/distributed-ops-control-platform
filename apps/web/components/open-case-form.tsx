"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type MutationErrorBody = {
  error?: { message?: string };
};

export function OpenCaseForm({ sites }: { sites: Array<{ id: string; code: string }> }) {
  const router = useRouter();
  const [title, setTitle] = useState("Manual reconciliation review");
  const [description, setDescription] = useState(
    "Operator review opened due to an unresolved state mismatch."
  );
  const [siteId, setSiteId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(
    null
  );

  async function createCase(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/reconciliation-cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId, title, description })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as MutationErrorBody;
        throw new Error(body.error?.message ?? "The case could not be created.");
      }

      setFeedback({ tone: "success", message: "Case created. Refreshing the workbench." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "The case could not be created."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="rounded border border-line bg-panelMuted p-3" onSubmit={createCase}>
      <h3 className="mb-2 text-sm font-semibold">Open Reconciliation Case</h3>
      <p className="mb-3 text-xs text-fgMuted">
        Create a manual case when an operator needs to investigate drift outside alert automation.
        The authenticated test identity is recorded by the API.
      </p>
      <div className="grid min-w-0 gap-3 lg:grid-cols-12">
        <label className="flex min-w-0 flex-col gap-1 lg:col-span-3">
          <span className="text-left text-xs text-fgMuted">Case title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="app-control min-w-0"
            minLength={3}
            maxLength={160}
            required
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 lg:col-span-2">
          <span className="text-left text-xs text-fgMuted">Responsible site</span>
          <select
            value={siteId}
            onChange={(event) => setSiteId(event.target.value)}
            className="app-control min-w-0"
            required
          >
            <option value="">Select a site</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 lg:col-span-5">
          <span className="text-left text-xs text-fgMuted">Case description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            className="app-textarea min-w-0 resize-y"
            minLength={3}
            maxLength={8000}
            required
          />
        </label>
        <div className="lg:col-span-2 lg:flex lg:items-end lg:justify-end">
          <button
            type="submit"
            className="app-button h-fit w-full px-3 py-2 text-sm lg:w-auto"
            disabled={isSubmitting || !siteId}
          >
            {isSubmitting ? "Creating…" : "Create case"}
          </button>
        </div>
      </div>
      {feedback ? (
        <p
          className={`mt-3 text-sm ${feedback.tone === "error" ? "text-critical" : "text-success"}`}
          role={feedback.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {feedback.message}
        </p>
      ) : null}
    </form>
  );
}
