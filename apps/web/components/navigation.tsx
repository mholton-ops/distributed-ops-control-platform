"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/sites", label: "Sites" },
  { href: "/assets", label: "Assets" },
  { href: "/transfers", label: "Transfers" },
  { href: "/reconciliation", label: "Reconciliation" },
  { href: "/sync-batches", label: "Sync Batches" }
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="app-shell-nav mt-3 flex gap-2 overflow-x-auto pb-1 text-sm" aria-label="Primary">
      {links.map((link) => {
        const isActive =
          link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
        <Link
          key={link.href}
          href={link.href}
          className={`app-nav-link shrink-0 ${isActive ? "app-nav-link-active" : ""}`}
          aria-current={isActive ? "page" : undefined}
        >
          {link.label}
        </Link>
        );
      })}
    </nav>
  );
}
