import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BarChart3, Database, Loader2 } from "lucide-react";
import { CatalogChartsPanel } from "@/components/maintenance/CatalogCharts";
import { CatalogTableDetailDialog } from "@/components/maintenance/CatalogTableDetailDialog";
import { ScopeEditor } from "@/components/maintenance/ScopeEditor";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCatalogConfig,
  useCatalogDatabases,
  useCatalogSchemas,
  useCatalogTables,
  useCreateMaintenanceCommand,
} from "@/hooks/useMaintenance";
import { formatDetectedAt, formatNumber } from "@/lib/format";
import { useDashboardStore } from "@/store/dashboard.store";
import type { CatalogTableSummary } from "@/types";

const STALE_MS = 24 * 60 * 60 * 1000;
const TIME_RANGE_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
] as const;

function groupTablesBySchema(tables: CatalogTableSummary[]): Array<{ schemaName: string; tables: CatalogTableSummary[] }> {
  const grouped = new Map<string, CatalogTableSummary[]>();
  for (const table of tables) {
    const key = table.schema_name || "unknown";
    const items = grouped.get(key);
    if (items) items.push(table);
    else grouped.set(key, [table]);
  }
  return Array.from(grouped.entries()).map(([schemaName, items]) => ({ schemaName, tables: items }));
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="min-w-0 space-y-1">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

export function CatalogView() {
  const { selectedClusterId } = useDashboardStore();
  const { data: databases, isLoading: databasesLoading, error: databasesError } = useCatalogDatabases();
  const { data: config } = useCatalogConfig();
  const commandMutation = useCreateMaintenanceCommand();
  const [database, setDatabase] = useState("");
  const [selectedSchema, setSelectedSchema] = useState("");
  const [selectedTable, setSelectedTable] = useState("");
  const [statsDialogTable, setStatsDialogTable] = useState<{ schema: string; table: string } | null>(null);
  const [days, setDays] = useState<number>(30);

  const { data: schemas, isLoading: schemasLoading, error: schemasError } = useCatalogSchemas(database);
  const { data: tables, isLoading: tablesLoading, error: tablesError } = useCatalogTables(database, selectedSchema);

  useEffect(() => {
    if (!database && databases?.length) setDatabase(databases[0]);
  }, [database, databases]);

  useEffect(() => {
    if (database && databases && !databases.includes(database)) {
      setDatabase(databases[0] ?? "");
    }
  }, [database, databases]);

  const configuredSchemasForDb = useMemo(() => {
    if (!config || !database) return null;
    const dbConfig = config.databases?.find((d) => d.database_name === database);
    return dbConfig?.schemas.map((s) => s.schema_name) ?? null;
  }, [config, database]);

  useEffect(() => {
    if (!database) {
      if (selectedSchema) setSelectedSchema("");
      return;
    }
    if (!schemas?.length) {
      if (selectedSchema) setSelectedSchema("");
      return;
    }
    if (!selectedSchema || !schemas.includes(selectedSchema)) {
      const preferred = configuredSchemasForDb?.find((s) => schemas.includes(s)) ?? schemas[0];
      setSelectedSchema(preferred);
    }
  }, [database, schemas, selectedSchema, configuredSchemasForDb]);

  useEffect(() => {
    const tableNames = (tables ?? []).map((item) => item.table_name);
    if (!tableNames.length) {
      if (selectedTable) setSelectedTable("");
      return;
    }
    if (!selectedTable || !tableNames.includes(selectedTable)) {
      setSelectedTable(tableNames[0]);
    }
  }, [selectedTable, tables]);

  const selectedTableSummary = useMemo(
    () => (tables ?? []).find((item) => item.table_name === selectedTable) ?? null,
    [selectedTable, tables],
  );
  const canRunFiltered = Boolean(database && selectedSchema && selectedTable);
  const groupedTables = useMemo(() => groupTablesBySchema(tables ?? []), [tables]);
  const capturedAt = selectedTableSummary?.captured_at ?? tables?.[0]?.captured_at ?? null;
  const isStale = capturedAt ? Date.now() - new Date(capturedAt).getTime() > STALE_MS : false;
  const catalogEnabled = config?.enabled !== false;
  const hasCatalogConfig = Boolean(config);

  if (!selectedClusterId) {
    return <EmptyState title="No cluster selected" description="Choose a cluster before viewing catalog data." />;
  }

  return (
    <div className="space-y-3">
      <ScopeEditor clusterId={selectedClusterId} config={config} />

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        <div className="border-b border-[var(--color-border)] px-3 py-2.5">
          <div className="flex flex-col gap-2.5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Catalog</p>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[16px] font-semibold text-[var(--color-text)]">Catalog Tables</h3>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                    catalogEnabled
                      ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                      : "bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
                  }`}
                >
                  {catalogEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>

            <div className="grid w-full gap-2.5 md:grid-cols-2 xl:w-auto xl:grid-cols-[190px_170px_220px_130px_auto]">
              <FilterField label="Database">
                {databasesLoading ? (
                  <Skeleton className="h-9 w-full rounded-md" />
                ) : (
                  <Select value={database || undefined} onValueChange={setDatabase} disabled={!databases?.length}>
                    <SelectTrigger className="h-9 rounded-md border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-left text-[12px]">
                      <SelectValue placeholder="Select database" />
                    </SelectTrigger>
                    <SelectContent>
                      {(databases ?? []).map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FilterField>

              <FilterField label="Schema">
                {schemasLoading ? (
                  <Skeleton className="h-9 w-full rounded-md" />
                ) : (
                  <Select value={selectedSchema || undefined} onValueChange={setSelectedSchema} disabled={!schemas?.length}>
                    <SelectTrigger className="h-9 rounded-md border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-left text-[12px]">
                      <SelectValue placeholder={database ? "Select schema" : "Select database first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(schemas ?? []).map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FilterField>

              <FilterField label="Table">
                {tablesLoading ? (
                  <Skeleton className="h-9 w-full rounded-md" />
                ) : (
                  <Select value={selectedTable || undefined} onValueChange={setSelectedTable} disabled={!tables?.length}>
                    <SelectTrigger className="h-9 rounded-md border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-left text-[12px]">
                      <SelectValue placeholder={selectedSchema ? "Select table" : "Select schema first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(tables ?? []).map((item) => (
                        <SelectItem key={`${item.schema_name}.${item.table_name}`} value={item.table_name}>
                          {item.table_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FilterField>

              <FilterField label="Time Range">
                <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
                  <SelectTrigger className="h-9 rounded-md border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-left text-[12px]">
                    <SelectValue placeholder="Range" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_RANGE_OPTIONS.map((item) => (
                      <SelectItem key={item.value} value={String(item.value)}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>

              <div className="flex items-end">
                <div className="grid w-full grid-cols-1 gap-2 xl:w-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-md border-[var(--color-border-2)] bg-[var(--color-primary-soft)]/12 px-3.5 text-[12px] text-[var(--color-primary)] hover:border-[var(--color-border-2)] hover:bg-[var(--color-primary-soft)]/18 hover:text-[var(--color-primary)]"
                    disabled={commandMutation.isPending || !canRunFiltered}
                    onClick={() =>
                      commandMutation.mutate({
                        cluster_id: selectedClusterId,
                        type: "run_catalog",
                        catalog_scope: [
                          {
                            database_name: database,
                            schemas: [
                              {
                                schema_name: selectedSchema,
                                table_names: selectedTable ? [selectedTable] : [],
                              },
                            ],
                          },
                        ],
                      })
                    }
                    title={
                      canRunFiltered
                        ? `Queue catalog for ${database}.${selectedSchema}.${selectedTable}`
                        : "Choose database, schema, and table first"
                    }
                  >
                    {commandMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Database className="h-3.5 w-3.5" />
                    )}
                    Run filtered
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
            <span>
              {hasCatalogConfig
                ? catalogEnabled
                  ? "Catalog capture is enabled for this cluster"
                  : "Catalog capture is disabled for this cluster"
                : "No catalog config yet"}
            </span>
            <span>|</span>
            <span>{capturedAt ? formatDetectedAt(capturedAt) : "No snapshot yet"}</span>
            <span>|</span>
            <span>{formatNumber(tables?.length ?? 0)} tables in view</span>
            {selectedTableSummary ? (
              <>
                <span>|</span>
                <span>Selected {selectedSchema}.{selectedTable}</span>
              </>
            ) : null}
            {isStale ? (
              <span className="inline-flex items-center rounded-full bg-[var(--color-warning-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-warning)]">
                Stale &gt;24h
              </span>
            ) : null}
          </div>
        </div>

        <div className="p-3">
          {databasesError || schemasError || tablesError ? (
            <ErrorState
              message="Failed to load catalog filters"
              description={
                databasesError instanceof Error ? databasesError.message
                : schemasError instanceof Error ? schemasError.message
                : tablesError instanceof Error ? tablesError.message
                : "Unknown error"
              }
            />
          ) : selectedSchema && selectedTable ? (
            <CatalogChartsPanel database={database} schema={selectedSchema} table={selectedTable} days={days} />
          ) : (
            <EmptyState
              title="Pick a table to inspect"
              description="Choose database, schema, and table from the filter bar or click a table row below."
            />
          )}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        <div className="border-b border-[var(--color-border)] px-3 py-2.5">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Browse</p>
              <h3 className="text-[16px] font-semibold text-[var(--color-text)]">Latest Snapshot Tables</h3>
            </div>
            <p className="text-[11px] text-[var(--color-muted)]">Click a row to sync the filter bar and update the charts above.</p>
          </div>
        </div>

        <div className="p-3">
          {tablesLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : databasesError || schemasError || tablesError ? (
            <ErrorState
              message="Failed to load catalog tables"
              description={
                databasesError instanceof Error ? databasesError.message
                : schemasError instanceof Error ? schemasError.message
                : tablesError instanceof Error ? tablesError.message
                : "Unknown error"
              }
            />
          ) : !database ? (
            <EmptyState title="No database selected" description="Choose a database to inspect captured tables." />
          ) : !selectedSchema ? (
            <EmptyState title="No schema selected" description="Choose a schema to browse captured tables." />
          ) : !groupedTables.length ? (
            <EmptyState title="No catalog data" description="The latest snapshot does not contain tables for this schema." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
              <div className="overflow-x-auto">
                <table className="min-w-full w-max border-collapse text-[12px] leading-tight">
                  <thead className="sticky top-0 z-10 bg-[var(--color-surface-2)]">
                    <tr className="text-left">
                      <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">Table</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">Rows</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">Frag</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">Stale</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">Heap</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedTables.flatMap((group) => {
                      const schemaRows = group.tables.map((item) => {
                        const highFrag = item.max_fragmentation_pct != null && item.max_fragmentation_pct >= 30;
                        const isActive = item.table_name === selectedTable && group.schemaName === selectedSchema;
                        return (
                          <tr
                            key={`${group.schemaName}.${item.table_name}`}
                            className={`cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-row-hover)] ${
                              isActive ? "bg-[var(--color-primary-soft)]/45" : ""
                            }`}
                            onClick={() => {
                              setSelectedSchema(group.schemaName);
                              setSelectedTable(item.table_name);
                            }}
                          >
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]"}`} aria-hidden="true" />
                                <span className={`font-medium ${isActive ? "text-[var(--color-primary)]" : "text-[var(--color-text)]"}`}>
                                  {item.table_name}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-text)]">{formatNumber(item.row_count)}</td>
                            <td className={`px-3 py-2.5 text-right tabular-nums ${highFrag ? "font-semibold text-[var(--color-critical)]" : "text-[var(--color-text-2)]"}`}>
                              {item.max_fragmentation_pct != null ? `${item.max_fragmentation_pct.toFixed(1)}%` : "-"}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-text-2)]">{formatNumber(item.stale_stats_count)}</td>
                            <td className="px-3 py-2.5">
                              {item.has_heap_issue ? (
                                <span className="inline-flex items-center rounded-full bg-[var(--color-warning-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
                                  Warning
                                </span>
                              ) : (
                                <span className="text-[var(--color-muted)]">-</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 rounded-md px-2.5 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setStatsDialogTable({ schema: group.schemaName, table: item.table_name });
                                }}
                              >
                                <BarChart3 className="h-3.5 w-3.5" />
                                Stats
                              </Button>
                            </td>
                          </tr>
                        );
                      });

                      return [
                        <tr key={`schema-${group.schemaName}`} className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                          <td colSpan={6} className="px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-muted)]" aria-hidden="true" />
                                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text)]">
                                  {group.schemaName}
                                </span>
                              </div>
                              <span className="text-[10px] font-medium text-[var(--color-muted)]">
                                {formatNumber(group.tables.length)} tables
                              </span>
                            </div>
                          </td>
                        </tr>,
                        ...schemaRows,
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>

      {statsDialogTable ? (
        <CatalogTableDetailDialog
          database={database}
          schema={statsDialogTable.schema}
          table={statsDialogTable.table}
          initialTab="statistics"
          onClose={() => setStatsDialogTable(null)}
        />
      ) : null}
    </div>
  );
}
