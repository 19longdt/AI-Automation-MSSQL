import { useEffect } from "react";
import { useClusters } from "@/hooks/useClusters";
import { useDashboardStore } from "@/store/dashboard.store";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import type { ClusterResponse } from "@/types";

const ENV_ORDER = ["production", "uat", "dev", "staging", "other"] as const;

function rolesSummary(cluster: ClusterResponse): string | null {
  if (!cluster.node_roles.length) return null;
  const primary = cluster.node_roles.filter((r) => r.role === "primary").length;
  const secondary = cluster.node_roles.filter((r) => r.role === "secondary").length;
  const parts: string[] = [];
  if (primary) parts.push(`${primary}P`);
  if (secondary) parts.push(`${secondary}S`);
  return parts.join(" / ") || null;
}

function envLabel(environment: ClusterResponse["environment"]) {
  switch (environment) {
    case "production":
      return "Production";
    case "uat":
      return "UAT";
    case "dev":
      return "Dev";
    case "staging":
      return "Staging";
    default:
      return "Other";
  }
}

export function ClusterSelector() {
  const { data } = useClusters();
  const { selectedClusterId, setSelectedClusterId } = useDashboardStore();
  const enabledClusters = (data ?? []).filter((cluster) => cluster.enabled);
  const selectedCluster = enabledClusters.find((cluster) => cluster.cluster_id === selectedClusterId) ?? null;

  useEffect(() => {
    if (!enabledClusters.length) return;
    // Auto-select first cluster if nothing selected or current selection is gone
    if (!selectedClusterId || !enabledClusters.some((c) => c.cluster_id === selectedClusterId)) {
      setSelectedClusterId(enabledClusters[0].cluster_id);
    }
  }, [enabledClusters, selectedClusterId, setSelectedClusterId]);

  if (!enabledClusters.length) return null;

  return (
    <Select
      value={selectedCluster?.cluster_id ?? ""}
      onValueChange={(value) => setSelectedClusterId(value || null)}
    >
      <SelectTrigger className="w-[230px]" aria-label="Select cluster">
        {selectedCluster ? (
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: selectedCluster.color }}
              aria-hidden="true"
            />
            <span className="truncate">{selectedCluster.name}</span>
            <span className="truncate text-[11px] text-[var(--color-muted)]">
              {envLabel(selectedCluster.environment)}
            </span>
          </span>
        ) : null}
      </SelectTrigger>
      <SelectContent>
        {ENV_ORDER.map((environment) => {
          const items = enabledClusters.filter((cluster) => cluster.environment === environment);
          if (!items.length) return null;
          return (
            <SelectGroup key={environment}>
              <SelectLabel>{envLabel(environment)}</SelectLabel>
              {items.map((cluster) => {
                const roles = rolesSummary(cluster);
                return (
                  <SelectItem key={cluster.cluster_id} value={cluster.cluster_id}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: cluster.color }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{cluster.name}</span>
                      {roles ? (
                        <span className="shrink-0 text-[10px] text-[var(--color-muted)]">{roles}</span>
                      ) : null}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}
