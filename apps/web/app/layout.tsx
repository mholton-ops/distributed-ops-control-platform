import type { Metadata } from "next";
import "./globals.css";
import { Navigation } from "../components/navigation";
import { ThemeToggle } from "../components/theme-toggle";

export const metadata: Metadata = {
  title: {
    default: "Dashboard | Distributed Ops Control Platform",
    template: "%s | Distributed Ops Control Platform"
  },
  description: "Operational workbench for serialized asset control"
};

// Operational data is authenticated and request-scoped. Never contact the test API at build time.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeScript = `
    (function () {
      try {
        var key = "ops_theme_mode";
        var saved = localStorage.getItem(key) || "system";
        var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        var resolved = saved === "system" ? (prefersDark ? "dark" : "light") : saved;
        var root = document.documentElement;
        root.classList.toggle("theme-dark", resolved === "dark");
        root.classList.toggle("theme-light", resolved === "light");
        root.setAttribute("data-theme", resolved);
      } catch (err) {
        document.documentElement.classList.add("theme-light");
      }
    })();
  `;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a href="#main-content" className="app-skip-link">
          Skip to main content
        </a>
        <div className="mx-auto min-h-screen max-w-[1480px] px-3 py-3 sm:px-4 md:px-6 md:py-5">
          <header className="mb-4 min-w-0 rounded-xl border border-line bg-panel px-4 py-3 md:px-5 md:py-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fgMuted">
                  Operations workbench
                </div>
                <h1 className="truncate text-xl font-semibold tracking-tight text-fg md:text-2xl">
                  Distributed Ops Control
                </h1>
              </div>
              <ThemeToggle />
            </div>
            <Navigation />
            {!process.env.API_BASE_URL || !process.env.OPS_TEST_AUTH_TOKEN ? (
              <p className="mt-3 rounded-lg border border-warning/80 bg-panelMuted px-3 py-2 text-sm text-fg" role="alert">
                Test API access is not configured. Set <code>API_BASE_URL</code> and the server-only{" "}
                <code>OPS_TEST_AUTH_TOKEN</code> before using this workbench.
              </p>
            ) : null}
          </header>
          <main id="main-content" tabIndex={-1} className="min-w-0">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
