import { Database } from "lucide-react";
import { ClusterSelector } from "@/components/layout/ClusterSelector";
import { LiveIndicator } from "@/components/shared/LiveIndicator";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

const NAV_LINKS = [
  { href: "/dashboard",  label: "Dashboard"  },
  { href: "/insights",   label: "Insights"   },
  { href: "/query-plan", label: "Query Plan"  },
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
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
