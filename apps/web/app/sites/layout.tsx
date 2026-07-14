import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sites" };

export default function SitesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
