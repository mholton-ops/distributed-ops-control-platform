"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type MutationErrorBody = {
  error?: { message?: string };
};

type ResolvedAssetStatus = "registered" | "in_transit" | "at_site" | "under_inspection";

export function ReconciliationActions({
  caseId,
  expectedVersion,
  hasAsset
}: {
  caseId: string;
  expectedVersion: number;
  hasAsset: boolean;
}) {
  const router = useRouter();
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [resolvedAssetStatus, setResolvedAssetStatus] = useState<ResolvedAssetStatus | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(
    null
  );

  async function resolveCase(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!reviewConfirmed) {
      setFeedback({ tone: "error", message: "Confirm the evidence review before resolving." });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch(`/api/reconciliation-cases/${caseId}/resolve`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resolutionSummary,
          expectedVersion,
          ...(hasAsset ? { resolvedAssetStatus } : {})
        })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as MutationErrorBody;
        throw new Error(body.error?.message ?? "The case could not be resolved.");
      }

      setFeedback({ tone: "success", message: "Case resolved. Refreshing the evidence view." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "The case could not be resolved."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={resolveCase}>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg">Resolution summary</span>
        <textarea
          rows={4}
          className="app-textarea w-full resize-y text-sm leading-5"
          value={resolutionSummary}
          onChange={(event) => setResolutionSummary(event.target.value)}
          minLength={12}
          maxLength={8000}
          placeholder="Describe the evidence reviewed and why the accepted state is now trustworthy."
          required
        />
      </label>
      {hasAsset ? <label className="block max-w-sm">
        <span className="mb-1 block text-xs font-medium text-fg">Verified asset status</span>
        <select
          className="app-control"
          value={resolvedAssetStatus}
          onChange={(event) =>
            setResolvedAssetStatus(event.target.value as ResolvedAssetStatus | "")
          }
          required
        >
          <option value="">Select the verified state</option>
          <option value="registered">Registered</option>
          <option value="in_transit">In transit</option>
          <option value="at_site">At site</option>
          <option value="under_inspection">Under inspection</option>
        </select>
      </label> : null}
      <label className="flex items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={reviewConfirmed}
          onChange={(event) => setReviewConfirmed(event.target.checked)}
        />
        <span>
          I reviewed the source alert, projection state, linked replay outcomes, and related event
          chain shown on this page.
        </span>
      </label>
      <button
        type="submit"
        className="app-button"
        disabled={
          isSubmitting ||
          !reviewConfirmed ||
          (hasAsset && !resolvedAssetStatus) ||
          resolutionSummary.trim().length < 12
        }
      >
        {isSubmitting ? "Resolving…" : "Resolve case"}
      </button>
      <p className="text-xs text-fgMuted">Submitting against case version {expectedVersion}.</p>
      {feedback ? (
        <p
          className={`text-sm ${feedback.tone === "error" ? "text-critical" : "text-success"}`}
          role={feedback.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {feedback.message}
        </p>
      ) : null}
    </form>
  );
}
