import Link from "next/link";

export function DetailsLink({
  href,
  label = "Select",
  accessibleLabel
}: {
  href: string;
  label?: string;
  accessibleLabel?: string;
}) {
  const selected = label.toLowerCase() === "selected";
  return (
    <Link
      href={href}
      className={`app-pill-action ${selected ? "app-pill-action-selected" : ""}`}
      aria-label={accessibleLabel ?? label}
    >
      {label}
    </Link>
  );
}
