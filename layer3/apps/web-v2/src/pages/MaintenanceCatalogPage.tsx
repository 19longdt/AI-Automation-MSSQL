import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MaintenanceSubNav } from "@/components/maintenance/MaintenanceSubNav";
import { CatalogView } from "@/components/maintenance/CatalogView";
import { PageShell } from "@/components/layout/PageShell";
import { useDashboardStore } from "@/store/dashboard.store";

export function MaintenanceCatalogPage() {
  const { selectedClusterId } = useDashboardStore();
  const queryClient = useQueryClient();

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["maintenance-catalog-databases"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-catalog-schemas"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-catalog-snapshots"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-catalog-tables"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-catalog-table"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-catalog-config"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
  }, [queryClient, selectedClusterId]);

  return (
    <PageShell className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <MaintenanceSubNav />

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 shadow-sm">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Maintenance Catalog</div>
        <h1 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] leading-tight text-[var(--color-text)]">
          Catalog Scope and Snapshots
        </h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--color-muted)]">
          Configure the catalog scope for the active cluster, trigger snapshots, and inspect captured table metadata.
        </p>
      </section>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full flex-col gap-2 pb-1">
          <CatalogView />
        </div>
      </div>
    </PageShell>
  );
}
