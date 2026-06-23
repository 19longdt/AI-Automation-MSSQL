import { Database } from "lucide-react";
import { ClusterSelector } from "@/components/layout/ClusterSelector";
import { LiveIndicator } from "@/components/shared/LiveIndicator";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

const NAV_LINKS = [
  { href: "/dashboard",  label: "Dashboard"  },
  { href: "/insights",   label: "Insights"   },
  { href: "/query-plan", label: "Query Plan"  },
  { href: "/maintenance", label: "Maintenance" },
  { href: "/settings",   label: "Settings"   },
] as const;

export function Topbar() {
  const pathname = window.location.pathname;

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)]/90 backdrop-blur-md shrink-0">
      <div className="flex h-full items-center gap-4 px-4 max-w-screen-2xl mx-auto">
        {/* Logo */}
        <a href="/dashboard" className="flex items-center gap-2 shrink-0 no-underline">
          <Database className="w-4 h-4 text-[var(--color-primary)]" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-[var(--color-text)]">MSSQL Monitor</span>
        </a>

        {/* Nav */}
        <nav aria-label="Main navigation" className="flex items-center gap-0.5">
          {NAV_LINKS.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(href);
            return (
              <a
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={[
                  "px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors duration-150 no-underline",
                  active
                    ? "text-[var(--color-primary)] bg-[var(--color-primary-soft)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-row-hover)]",
                ].join(" ")}
              >
                {label}
              </a>
            );
          })}
        </nav>

        {/* Right */}
        <div className="ml-auto flex items-center gap-2">
          <ClusterSelector />
          <LiveIndicator />
          <a
            href="https://github.com/19longdt/AI-Automation-MSSQL"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Source code on GitHub"
            className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-row-hover)] transition-colors duration-150"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
            </svg>
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
