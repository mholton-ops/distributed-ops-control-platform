import Link from "next/link";

export default function NotFound() {
  return (
    <section className="app-card">
      <h2 className="app-page-title">Record not found</h2>
      <p className="app-page-subtitle">
        This record may have been removed, or the link may no longer match the current test data.
      </p>
      <Link href="/" className="app-button-secondary mt-4 inline-flex">
        Return to dashboard
      </Link>
    </section>
  );
}
