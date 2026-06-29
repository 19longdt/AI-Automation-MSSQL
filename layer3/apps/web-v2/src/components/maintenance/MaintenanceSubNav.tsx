import { navigate } from "@/lib/navigate";
import { MaintGlossaryTip } from "./MaintGlossaryTip";

interface MaintenanceSubNavProps {
  hasCriticalCampaign?: boolean;
}

export function MaintenanceSubNav({ hasCriticalCampaign = false }: MaintenanceSubNavProps) {
  const pathname = window.location.pathname;
  const isCatalog = pathname.startsWith("/maintenance/catalog");
  const isCampaign = !isCatalog && pathname.startsWith("/maintenance");

  return (
    <nav
      aria-label="Maintenance sections"
      className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-sm"
    >
      <button
        type="button"
        onClick={() => navigate("/maintenance/catalog")}
        aria-current={isCatalog ? "page" : undefined}
        className={[
          "relative inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 no-underline",
          isCatalog
            ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
            : "text-[var(--color-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-text)]",
        ].join(" ")}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />
        <MaintGlossaryTip glossaryKey="page_catalog">Catalog</MaintGlossaryTip>
      </button>

      <button
        type="button"
        onClick={() => navigate("/maintenance")}
        aria-current={isCampaign ? "page" : undefined}
        className={[
          "relative inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 no-underline",
          isCampaign
            ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
            : "text-[var(--color-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-text)]",
        ].join(" ")}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />
        <MaintGlossaryTip glossaryKey="page_campaign">Campaign</MaintGlossaryTip>
        {hasCriticalCampaign ? (
          <span
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--color-critical)]"
            aria-label="Discovery failed"
          />
        ) : null}
      </button>
    </nav>
  );
}
