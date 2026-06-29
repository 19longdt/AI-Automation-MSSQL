import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Database, Edit2, Plus, RotateCcw, Save, Table2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useCatalogLiveTables, useSaveCatalogConfig } from "@/hooks/useMaintenance";
import { ApiError } from "@/lib/api-client";
import type { CatalogConfig } from "@/types";

interface ScopeEntry {
  name: string;
  database: string;
  schema: string;
  tableNames: string[];
}

interface ScopeEditorProps {
  clusterId: string;
  config: CatalogConfig | null | undefined;
}

function configToEntries(config: CatalogConfig): ScopeEntry[] {
  return config.databases.flatMap((db) =>
    db.schemas.map((schema) => ({
      name: schema.name ?? "",
      database: db.database_name,
      schema: schema.schema_name,
      tableNames: schema.table_names ?? [],
    })),
  );
}

function entriesToConfig(clusterId: string, entries: ScopeEntry[], enabled: boolean): CatalogConfig {
  const dbMap = new Map<string, { name?: string; schema_name: string; table_names: string[] }[]>();
  for (const entry of entries) {
    if (!dbMap.has(entry.database)) dbMap.set(entry.database, []);
    dbMap.get(entry.database)!.push({
      ...(entry.name ? { name: entry.name } : {}),
      schema_name: entry.schema,
      table_names: entry.tableNames,
    });
  }
  return {
    cluster_id: clusterId,
    enabled,
    databases: Array.from(dbMap.entries()).map(([database_name, schemas]) => ({
      database_name,
      schemas,
    })),
  };
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const fieldCls =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-muted)] focus:border-[color:color-mix(in_srgb,var(--color-primary)_55%,var(--color-border)_45%)]";
const checkboxCls =
  "h-4 w-4 shrink-0 cursor-pointer rounded-[4px] border border-[var(--color-border-2)] bg-[var(--color-surface)] accent-[var(--color-primary)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--color-primary)_35%,transparent)]";

// ── Modal ────────────────────────────────────────────────────────────────────

function ScopeEntryModal({
  initial,
  existingEntries,
  editIndex,
  onSave,
  onClose,
}: {
  initial?: ScopeEntry;
  existingEntries: ScopeEntry[];
  editIndex: number | null;
  onSave: (entry: ScopeEntry) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [database, setDatabase] = useState(initial?.database ?? "");
  const [schema, setSchema] = useState(initial?.schema ?? "");
  const [tableMode, setTableMode] = useState<"all" | "specific">(
    (initial?.tableNames.length ?? 0) > 0 ? "specific" : "all",
  );
  const [selectedTables, setSelectedTables] = useState<string[]>(initial?.tableNames ?? []);
  const [errors, setErrors] = useState<{ database?: string; schema?: string }>({});
  const [search, setSearch] = useState("");

  const db = database.trim();
  const sc = schema.trim();

  const debouncedDb = useDebounce(db, 3000);
  const debouncedSc = useDebounce(sc, 3000);

  const loadTables = tableMode === "specific" && Boolean(debouncedDb) && Boolean(debouncedSc);
  const isDebouncing = tableMode === "specific" && Boolean(db) && Boolean(sc) && (db !== debouncedDb || sc !== debouncedSc);

  const { data: liveData, isLoading: tablesLoading, error: tablesError, refetch } = useCatalogLiveTables(
    loadTables ? debouncedDb : "",
    loadTables ? debouncedSc : "",
  );
  const availableTables = liveData?.tables ?? [];

  useEffect(() => { setSearch(""); }, [debouncedDb, debouncedSc]);

  const filteredTables = useMemo(
    () =>
      search.trim()
        ? availableTables.filter((t) => t.toLowerCase().includes(search.trim().toLowerCase()))
        : availableTables,
    [availableTables, search],
  );

  const tableErrorMessage = useMemo(() => {
    if (!(tablesError instanceof ApiError)) return "Failed to load tables from SQL Server.";
    const payload = tablesError.payload;
    if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") {
      return payload.message;
    }
    return "Failed to load tables from SQL Server.";
  }, [tablesError]);

  function toggleTable(table: string) {
    setSelectedTables((prev) =>
      prev.includes(table) ? prev.filter((t) => t !== table) : [...prev, table],
    );
  }

  function handleSubmit() {
    const errs: typeof errors = {};
    if (!db) errs.database = "Required";
    if (!sc) errs.schema = "Required";

    const myTables = tableMode === "specific" ? selectedTables : [];
    if (!errs.database && !errs.schema) {
      // Key = (db, schema, table). Cùng (db,schema) nhưng bảng RỜI NHAU → cho phép.
      // Chặn: cùng all-tables, hoặc table set giao nhau.
      const myLower = new Set(myTables.map((t) => t.toLowerCase()));
      const conflict = existingEntries.some((e, i) => {
        if (i === editIndex) return false;
        if (e.database.trim().toLowerCase() !== db.toLowerCase()) return false;
        if (e.schema.trim().toLowerCase() !== sc.toLowerCase()) return false;
        const otherAll = e.tableNames.length === 0;
        const myAll = myTables.length === 0;
        if (otherAll || myAll) return true; // all-tables phủ lên mọi entry cùng schema
        return e.tableNames.some((t) => myLower.has(t.toLowerCase())); // bảng giao nhau
      });
      if (conflict) errs.schema = `(${db}, ${sc}) trùng/giao bảng với scope entry khác`;
    }
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    onSave({ name: name.trim() || `${db}.${sc}`, database: db, schema: sc, tableNames: myTables });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(92vw,480px)]">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Scope Entry" : "Add Catalog Scope"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {/* Scope name */}
          <div className="space-y-1">
            <label className="text-[12px] font-medium text-[var(--color-muted)]">Scope name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Core Tables, Analytics, Archive"
              className={fieldCls}
            />
            <p className="text-[11px] text-[var(--color-muted)]">Auto-fills from database.schema if left blank.</p>
          </div>

          {/* DB + Schema */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-[var(--color-muted)]">Database</label>
              <input
                value={database}
                onChange={(e) => { setDatabase(e.target.value); setErrors((p) => ({ ...p, database: undefined })); }}
                placeholder="e.g. MyDatabase"
                className={fieldCls}
              />
              {errors.database && <p className="text-[12px] text-[var(--color-critical)]">{errors.database}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-[var(--color-muted)]">Schema</label>
              <input
                value={schema}
                onChange={(e) => { setSchema(e.target.value); setErrors((p) => ({ ...p, schema: undefined })); }}
                placeholder="e.g. dbo"
                className={fieldCls}
              />
              {errors.schema && <p className="text-[12px] text-[var(--color-critical)]">{errors.schema}</p>}
            </div>
          </div>

          {/* Table selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[12px] font-medium text-[var(--color-muted)]">Tables to capture</label>
              {tableMode === "specific" && Boolean(debouncedDb) && Boolean(debouncedSc) && (
                <button
                  type="button"
                  onClick={() => void refetch()}
                  disabled={tablesLoading}
                  className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-primary)]"
                  title="Reload tables from SQL Server"
                >
                  <RotateCcw className={`h-3 w-3 ${tablesLoading ? "animate-spin" : ""}`} />
                  Reload
                </button>
              )}
            </div>
            <div className="flex gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--color-text)]">
                <input
                  type="radio"
                  checked={tableMode === "all"}
                  onChange={() => setTableMode("all")}
                  className="accent-[var(--color-primary)]"
                />
                All tables
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--color-text)]">
                <input
                  type="radio"
                  checked={tableMode === "specific"}
                  onChange={() => setTableMode("specific")}
                  className="accent-[var(--color-primary)]"
                />
                Specific tables
              </label>
            </div>

            {tableMode === "specific" && (
              <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
                {!db || !sc ? (
                  <p className="px-3 py-4 text-[12px] text-[var(--color-muted)]">
                    Enter database and schema above to load available tables.
                  </p>
                ) : isDebouncing ? (
                  <p className="px-3 py-4 text-[12px] text-[var(--color-muted)]">
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-primary)]" />
                    Loading tables in a moment…
                  </p>
                ) : tablesLoading ? (
                  <div className="space-y-2 px-3 py-3">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-5 w-4/5" />
                    <Skeleton className="h-5 w-3/4" />
                  </div>
                ) : tablesError ? (
                  <p className="px-3 py-4 text-[12px] text-[var(--color-critical)]">
                    {tableErrorMessage}
                  </p>
                ) : availableTables.length === 0 ? (
                  <p className="px-3 py-4 text-[12px] text-[var(--color-muted)]">
                    No tables found in <span className="font-medium">{db}.{sc}</span>. Check database/schema names or use "All tables".
                  </p>
                ) : (
                  <>
                  <div className="border-b border-[var(--color-border)] px-3 py-2">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Filter tables…"
                      className="w-full bg-transparent text-[12px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto divide-y divide-[var(--color-border)]">
                    {filteredTables.length === 0 ? (
                      <p className="px-3 py-3 text-[12px] text-[var(--color-muted)]">
                        No tables match "<span className="font-medium">{search}</span>".
                      </p>
                    ) : filteredTables.map((table) => (
                      <label
                        key={table}
                        className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-[13px] text-[var(--color-text)] hover:bg-[var(--color-row-hover)] transition-colors duration-100"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTables.includes(table)}
                          onChange={() => toggleTable(table)}
                          className="h-3.5 w-3.5 shrink-0 accent-[var(--color-primary)]"
                        />
                        {table}
                      </label>
                    ))}
                  </div>
                  </>
                )}
                {tableMode === "specific" && selectedTables.length > 0 && (
                  <div className="border-t border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-muted)]">
                    {selectedTables.length} selected
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit}>
            {initial ? "Save changes" : "Add scope"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function ScopeEditor({ clusterId, config }: ScopeEditorProps) {
  const saveMutation = useSaveCatalogConfig();
  const [entries, setEntries] = useState<ScopeEntry[]>([]);
  const [serverEntries, setServerEntries] = useState<ScopeEntry[]>([]);
  const [enabled, setEnabled] = useState(config?.enabled !== false);
  const [serverEnabled, setServerEnabled] = useState(config?.enabled !== false);
  const [modalKey, setModalKey] = useState(0);
  const [editIndex, setEditIndex] = useState<number | null>(null);

  useEffect(() => {
    const initial = configToEntries(config ?? { cluster_id: clusterId, databases: [] });
    setEntries(initial);
    setServerEntries(initial);
    setEnabled(config?.enabled !== false);
    setServerEnabled(config?.enabled !== false);
    setEditIndex(null);
  }, [clusterId, config]);

  const isDirty = useMemo(
    () => JSON.stringify(entries) !== JSON.stringify(serverEntries) || enabled !== serverEnabled,
    [entries, serverEntries, enabled, serverEnabled],
  );

  const entriesByDb = useMemo(() => {
    const map = new Map<string, { entry: ScopeEntry; index: number }[]>();
    entries.forEach((entry, index) => {
      const key = entry.database || "(no database)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ entry, index });
    });
    return Array.from(map.entries());
  }, [entries]);

  const [collapsed, setCollapsed] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const dbCount = entriesByDb.length;
  const scopeCount = entries.length;

  function openAdd() {
    setEditIndex(null);
    setModalKey((k) => k + 1);
    setModalOpen(true);
  }

  function openEdit(index: number) {
    setEditIndex(index);
    setModalKey((k) => k + 1);
    setModalOpen(true);
  }

  function handleSaveEntry(entry: ScopeEntry) {
    setEntries((prev) => {
      if (editIndex !== null) {
        const next = [...prev];
        next[editIndex] = entry;
        return next;
      }
      return [...prev, entry];
    });
    setModalOpen(false);
    setEditIndex(null);
  }

  function handleDelete(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  function handleDiscard() {
    setEntries([...serverEntries]);
    setEnabled(serverEnabled);
    setModalOpen(false);
    setEditIndex(null);
  }

  async function handleSave() {
    await saveMutation.mutateAsync(entriesToConfig(clusterId, entries, enabled));
  }

  return (
    <>
      <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        {/* Header — always visible, acts as toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-100 hover:bg-[var(--color-row-hover)]"
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="shrink-0 text-[14px] font-semibold text-[var(--color-text)]">Configure Scope</h3>
            {entries.length === 0 ? (
              <span className="text-[12px] text-[var(--color-muted)]">No scope configured</span>
            ) : (
              <span className="text-[12px] text-[var(--color-muted)]">
                {dbCount} {dbCount === 1 ? "database" : "databases"} · {scopeCount} {scopeCount === 1 ? "scope" : "scopes"}
              </span>
            )}
            {isDirty && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
                Unsaved
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label
              className="flex cursor-pointer items-center gap-2 text-[13px]"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className={checkboxCls}
              />
              <span className={enabled ? "text-[var(--color-text)]" : "text-[var(--color-muted)]"}>
                {enabled ? "Capture enabled" : "Capture disabled"}
              </span>
            </label>
            <Button
              variant="primary"
              size="sm"
              onClick={(e) => { e.stopPropagation(); openAdd(); }}
              disabled={!clusterId}
            >
              <Plus className="h-3.5 w-3.5" />
              Add scope
            </Button>
            <ChevronDown
              className={`h-4 w-4 text-[var(--color-muted)] transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
            />
          </div>
        </button>

        {/* Scope list — grouped by database */}
        {!collapsed && <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
          {entries.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-[var(--color-muted)]">
              No scope configured yet.{" "}
              <button
                type="button"
                onClick={openAdd}
                className="cursor-pointer font-medium text-[var(--color-primary)] underline-offset-2 hover:underline"
              >
                Add a database and schema
              </button>{" "}
              to prepare the next snapshot.
            </div>
          ) : (
            entriesByDb.map(([dbName, schemas]) => (
              <div key={dbName}>
                {/* Database header */}
                <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface-2)_70%,transparent)] px-4 py-2">
                  <Database className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" />
                  <span className="text-[12px] font-semibold text-[var(--color-text)]">{dbName}</span>
                  <span className="ml-1 text-[11px] text-[var(--color-muted)]">
                    {(() => {
                      const n = new Set(schemas.map(({ entry }) => entry.schema)).size;
                      return `${n} schema${n !== 1 ? "s" : ""}`;
                    })()}
                  </span>
                </div>

                {/* Schema entries */}
                <div className="divide-y divide-[var(--color-border)]">
                  {schemas.map(({ entry, index }) => {
                    const MAX_VISIBLE = 14;
                    const visible = entry.tableNames.slice(0, MAX_VISIBLE);
                    const overflow = entry.tableNames.length - MAX_VISIBLE;
                    return (
                      <div
                        key={`${entry.schema}.${index}`}
                        className="flex items-start justify-between gap-3 px-4 py-3 pl-8 transition-colors duration-100 hover:bg-[var(--color-row-hover)]"
                      >
                        <div className="min-w-0 flex-1">
                          {/* Schema name */}
                          <div className="flex items-center gap-1.5">
                            <Table2 className="h-3 w-3 shrink-0 text-[var(--color-muted)]" />
                            <span className="text-[13px] font-medium text-[var(--color-text)]">
                              {entry.schema}
                            </span>
                            {entry.name && entry.name !== `${entry.database}.${entry.schema}` && (
                              <span className="text-[11px] text-[var(--color-muted)]">· {entry.name}</span>
                            )}
                          </div>

                          {/* Table list */}
                          {entry.tableNames.length === 0 ? (
                            <p className="mt-1 text-[11px] text-[var(--color-muted)]">All tables</p>
                          ) : (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              {visible.map((t) => (
                                <span
                                  key={t}
                                  className="inline-flex items-center rounded-md border border-[color:color-mix(in_srgb,var(--color-primary)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--color-primary)_8%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-primary)]"
                                >
                                  {t}
                                </span>
                              ))}
                              {overflow > 0 && (
                                <span className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-muted)]">
                                  +{overflow} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1 pt-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(index)}
                            aria-label={`Edit ${entry.schema}`}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(index)}
                            aria-label={`Remove ${entry.schema}`}
                            className="text-[var(--color-muted)] hover:text-[var(--color-critical)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>}

        {/* Footer — only when expanded */}
        {!collapsed && <div className="flex flex-col gap-2 border-t border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface-2)_55%,transparent)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-[12px] font-medium">
            <span
              className={`h-2.5 w-2.5 rounded-full ${isDirty ? "bg-[var(--color-warning)]" : "bg-[var(--color-success)]"}`}
              aria-hidden="true"
            />
            <span className={isDirty ? "text-[var(--color-text)]" : "text-[var(--color-muted)]"}>
              {isDirty ? "Unsaved changes" : "Config in sync with server"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" disabled={!isDirty || saveMutation.isPending} onClick={handleDiscard}>
              <RotateCcw className="h-3.5 w-3.5" />
              Discard
            </Button>
            <Button
              variant="primary"
              loading={saveMutation.isPending}
              disabled={!isDirty}
              onClick={() => void handleSave()}
            >
              <Save className="h-3.5 w-3.5" />
              Save config
            </Button>
          </div>
        </div>}
      </section>

      {modalOpen && (
        <ScopeEntryModal
          key={modalKey}
          initial={editIndex !== null ? entries[editIndex] : undefined}
          existingEntries={entries}
          editIndex={editIndex}
          onSave={handleSaveEntry}
          onClose={() => { setModalOpen(false); setEditIndex(null); }}
        />
      )}
    </>
  );
}
