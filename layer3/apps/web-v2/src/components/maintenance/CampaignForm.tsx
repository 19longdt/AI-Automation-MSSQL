import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Clock3, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MaintGlossaryTip } from "@/components/maintenance/MaintGlossaryTip";
import { THRESHOLD_DEFAULTS } from "@/lib/maintenance-defaults";
import { cn } from "@/lib/utils";
import {
  useCatalogDatabases,
  useCatalogSchemas,
  useCatalogTables,
  useMaintenanceSummary,
} from "@/hooks/useMaintenance";
import type {
  CampaignCreateBody,
  CampaignScopeDatabase,
  CampaignThresholds,
  CampaignUpdateBody,
  ExecutionType,
  MaintenanceCampaign,
} from "@/types";

type CampaignFormMode = "create" | "edit" | "extend";

const THRESHOLD_FIELD_DEFAULTS: Record<string, number | null> = {
  "index.reorganize_pct": THRESHOLD_DEFAULTS.index.reorganize_pct,
  "index.rebuild_pct": THRESHOLD_DEFAULTS.index.rebuild_pct,
  "index.min_page_count": THRESHOLD_DEFAULTS.index.min_page_count,
  "index.max_page_count": THRESHOLD_DEFAULTS.index.max_page_count,
  "statistic.modification_threshold": THRESHOLD_DEFAULTS.statistic.modification_threshold,
  "statistic.stats_min_sample_pct": THRESHOLD_DEFAULTS.statistic.stats_min_sample_pct,
  "heap.forwarded_threshold": THRESHOLD_DEFAULTS.heap.forwarded_threshold,
};

// Threshold nhóm theo execution type. key dạng "group.field" trong state phẳng.
const THRESHOLD_GROUPS: Array<{
  type: ExecutionType;
  title: string;
  fields: Array<{ key: string; field: string; label: string; placeholder: string; glossaryKey?: string }>;
}> = [
  {
    type: "index",
    title: "Index",
    fields: [
      { key: "index.reorganize_pct", field: "reorganize_pct", label: "Reorganize ≥ (%)", placeholder: `${THRESHOLD_DEFAULTS.index.reorganize_pct} (mặc định)`, glossaryKey: "threshold_reorganize" },
      { key: "index.rebuild_pct", field: "rebuild_pct", label: "Rebuild ≥ (%)", placeholder: `${THRESHOLD_DEFAULTS.index.rebuild_pct} (mặc định)`, glossaryKey: "threshold_rebuild" },
      { key: "index.min_page_count", field: "min_page_count", label: "Min pages", placeholder: `${THRESHOLD_DEFAULTS.index.min_page_count} (mặc định)`, glossaryKey: "threshold_min_pages" },
      { key: "index.max_page_count", field: "max_page_count", label: "Max pages", placeholder: "không giới hạn", glossaryKey: "threshold_max_pages" },
    ],
  },
  {
    type: "statistic",
    title: "Statistics",
    fields: [
      { key: "statistic.modification_threshold", field: "modification_threshold", label: "Modification ≥", placeholder: `${THRESHOLD_DEFAULTS.statistic.modification_threshold} (mặc định)`, glossaryKey: "threshold_modification" },
      { key: "statistic.stats_min_sample_pct", field: "stats_min_sample_pct", label: "Min Sample Rate (%)", placeholder: `${THRESHOLD_DEFAULTS.statistic.stats_min_sample_pct} (mặc định)` },
    ],
  },
  {
    type: "heap",
    title: "Heap",
    fields: [
      { key: "heap.forwarded_threshold", field: "forwarded_threshold", label: "Forwarded records ≥", placeholder: `${THRESHOLD_DEFAULTS.heap.forwarded_threshold} (mặc định)`, glossaryKey: "threshold_forwarded" },
    ],
  },
];

// Build CampaignThresholds (grouped) — chỉ gồm execution type đang được chọn.
function getDefaultForThresholdKey(key: string): number | null {
  return THRESHOLD_FIELD_DEFAULTS[key] ?? null;
}

function buildDefaultThresholdInputs(): Record<string, string> {
  return {
    "index.reorganize_pct": String(THRESHOLD_DEFAULTS.index.reorganize_pct),
    "index.rebuild_pct": String(THRESHOLD_DEFAULTS.index.rebuild_pct),
    "index.min_page_count": String(THRESHOLD_DEFAULTS.index.min_page_count),
    "index.max_page_count": "",
    "statistic.modification_threshold": String(THRESHOLD_DEFAULTS.statistic.modification_threshold),
    "statistic.stats_min_sample_pct": String(THRESHOLD_DEFAULTS.statistic.stats_min_sample_pct),
    "heap.forwarded_threshold": String(THRESHOLD_DEFAULTS.heap.forwarded_threshold),
  };
}

function mapThresholdInputs(thresholds: CampaignThresholds | null | undefined): Record<string, string> {
  const out = buildDefaultThresholdInputs();
  const src = (thresholds ?? null) as Record<string, Record<string, unknown>> | null;
  for (const group of THRESHOLD_GROUPS) {
    for (const { key, field } of group.fields) {
      const value = src?.[group.type]?.[field];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        out[key] = String(value);
      } else if (getDefaultForThresholdKey(key) == null) {
        out[key] = "";
      }
    }
  }
  return out;
}

function buildThresholds(inputs: Record<string, string>, selectedTypes: ExecutionType[]): CampaignThresholds | null {
  const out: CampaignThresholds = {};
  for (const group of THRESHOLD_GROUPS) {
    if (!selectedTypes.includes(group.type)) continue;
    const groupOut: Record<string, number> = {};
    for (const { key, field } of group.fields) {
      const raw = (inputs[key] ?? "").trim();
      const fallback = getDefaultForThresholdKey(key);
      const resolved = raw !== "" ? raw : fallback != null ? String(fallback) : "";
      if (resolved === "") continue;
      const num = Number(resolved);
      if (Number.isFinite(num) && num >= 0) groupOut[field] = num;
    }
    if (Object.keys(groupOut).length > 0) {
      (out as Record<string, unknown>)[group.type] = groupOut;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

interface CampaignFormProps {
  open: boolean;
  mode: CampaignFormMode;
  clusterId: string;
  campaign?: MaintenanceCampaign | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CampaignCreateBody | CampaignUpdateBody) => Promise<void>;
}

interface FormState {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  scanTimes: string[];
  database: string;
  schema: string;
  tableMode: "all" | "specific";
  selectedTables: string[];
  executionTypes: ExecutionType[];
  thresholds: Record<string, string>;
  useDefaultWindow: boolean;
  overrideStart: string;
  overrideEnd: string;
  overrideBudgetMinutes: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  startDate: "",
  endDate: "",
  scanTimes: ["20:00"],
  database: "",
  schema: "",
  tableMode: "all",
  selectedTables: [],
  executionTypes: ["index", "statistic", "heap"],
  thresholds: buildDefaultThresholdInputs(),
  useDefaultWindow: true,
  overrideStart: "08:00",
  overrideEnd: "12:00",
  overrideBudgetMinutes: "120",
};

const fieldClassName =
  "w-full rounded-xl border border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface)_90%,transparent)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-muted)] focus:border-[color:color-mix(in_srgb,var(--color-primary)_55%,var(--color-border)_45%)]";

const scopeSelectTriggerClassName =
  "h-10 w-full rounded-xl border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface)_90%,transparent)] px-3 text-left text-[14px] text-[var(--color-text)] hover:bg-[var(--color-surface)] focus:ring-[var(--color-primary)]";

const scopeSelectContentClassName =
  "rounded-xl border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl";

function toggleSelectedTable(current: string[], tableName: string): string[] {
  return current.includes(tableName)
    ? current.filter((item) => item !== tableName)
    : [...current, tableName];
}

function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function titleForMode(mode: CampaignFormMode): string {
  switch (mode) {
    case "create":
      return "Create Campaign";
    case "edit":
      return "Edit Campaign";
    default:
      return "Extend Campaign";
  }
}

function toggleExecutionType(current: ExecutionType[], value: ExecutionType): ExecutionType[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

export function CampaignForm({
  open,
  mode,
  clusterId,
  campaign,
  pending = false,
  onOpenChange,
  onSubmit,
}: CampaignFormProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const { data: summary } = useMaintenanceSummary();
  const { data: databases } = useCatalogDatabases();
  const { data: schemas } = useCatalogSchemas(form.database);
  const { data: tables } = useCatalogTables(form.database, form.schema);

  const catalogReady = Boolean(
    summary?.catalog?.has_config &&
    !summary.catalog.is_stale &&
    (summary.catalog.table_count ?? 0) > 0,
  );

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      setError("");
      return;
    }

    if (!campaign) {
      setForm((prev) => ({
        ...EMPTY_FORM,
        database: databases?.[0] ?? prev.database,
      }));
      setError("");
      return;
    }

    setForm({
      name: campaign.name ?? "",
      description: campaign.description ?? "",
      startDate: toDateInput(campaign.start_date),
      endDate: toDateInput(campaign.end_date),
      scanTimes: campaign.scan_times?.length ? [...campaign.scan_times] : ["20:00"],
      database: campaign.scope?.[0]?.database_name ?? databases?.[0] ?? "",
      schema: campaign.scope?.[0]?.schemas?.[0]?.schema_name ?? "",
      tableMode: (campaign.scope?.[0]?.schemas?.[0]?.table_names?.length ?? 0) > 0 ? "specific" : "all",
      selectedTables: campaign.scope?.[0]?.schemas?.[0]?.table_names ?? [],
      executionTypes: campaign.execution_types?.length ? [...campaign.execution_types] : ["index", "statistic", "heap"],
      thresholds: mapThresholdInputs(campaign.thresholds),
      useDefaultWindow: campaign.window_override == null,
      overrideStart: campaign.window_override?.start ?? "08:00",
      overrideEnd: campaign.window_override?.end ?? "12:00",
      overrideBudgetMinutes: String(campaign.window_override?.time_budget_minutes ?? 120),
    });
    setError("");
  }, [campaign, open, databases]);

  useEffect(() => {
    if (!form.database && databases?.length) {
      setForm((prev) => ({ ...prev, database: databases[0] }));
    }
  }, [databases, form.database]);

  useEffect(() => {
    if (!form.schema && schemas?.length) {
      setForm((prev) => ({ ...prev, schema: schemas[0] }));
    }
  }, [form.schema, schemas]);

  const availableStats = useMemo(() => {
    return {
      tableCount: tables?.length ?? 0,
      capturedAt: tables?.[0]?.captured_at ?? null,
    };
  }, [tables]);

  async function handleSubmit() {
    setError("");
    if (!clusterId) {
      setError("Chọn cluster trước khi chỉnh sửa campaign.");
      return;
    }
    if ((mode === "create" || mode === "edit") && !catalogReady) {
      setError("Catalog chưa sẵn sàng cho cluster này.");
      return;
    }
    if ((mode === "create" || mode === "edit") && (!form.database || !form.schema)) {
      setError("Database và schema là bắt buộc.");
      return;
    }
    if (form.executionTypes.length === 0) {
      setError("Chọn ít nhất một execution type.");
      return;
    }

    if ((mode === "create" || mode === "edit") && form.tableMode === "specific" && form.selectedTables.length === 0) {
      setError("Chọn ít nhất 1 bảng, hoặc dùng 'All tables'.");
      return;
    }
    const scope: CampaignScopeDatabase[] | null =
      mode === "extend"
        ? undefined as never
        : [
            {
              database_name: form.database,
              schemas: [{
                schema_name: form.schema,
                table_names: form.tableMode === "specific" ? form.selectedTables : [],
              }],
            },
          ];
    const windowOverride = form.useDefaultWindow
      ? null
      : {
          start: form.overrideStart,
          end: form.overrideEnd,
          time_budget_minutes: Number(form.overrideBudgetMinutes || "0"),
        };

    try {
      if (mode === "create") {
        if (!form.name.trim() || !form.startDate || !form.endDate) {
          setError("Tên, ngày bắt đầu và ngày kết thúc là bắt buộc.");
          return;
        }
        if (form.endDate <= form.startDate) {
          setError("Ngày kết thúc phải lớn hơn ngày bắt đầu.");
          return;
        }
        await onSubmit({
          cluster_id: clusterId,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          start_date: form.startDate,
          end_date: form.endDate,
          scan_times: form.scanTimes,
          scope,
          thresholds: buildThresholds(form.thresholds, form.executionTypes),
          window_override: windowOverride,
          execution_types: form.executionTypes,
        });
        return;
      }

      if (mode === "extend") {
        if (!form.endDate) {
          setError("Ngày kết thúc là bắt buộc.");
          return;
        }
        await onSubmit({
          end_date: form.endDate,
          window_override: windowOverride,
        });
        return;
      }

      if (!form.name.trim()) {
        setError("Tên campaign là bắt buộc.");
        return;
      }
      await onSubmit({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        end_date: form.endDate || undefined,
        scan_times: form.scanTimes,
        scope,
        thresholds: buildThresholds(form.thresholds, form.executionTypes),
        window_override: windowOverride,
        execution_types: form.executionTypes,
      });
    } catch {
      // keep dialog open
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,760px)]">
        <DialogHeader className="px-4 py-3">
          <DialogTitle>{titleForMode(mode)}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3 p-4">
          {!catalogReady && mode !== "extend" ? (
            <div className="rounded-xl border border-[var(--color-warning)]/30 bg-[var(--color-warning-soft)] px-3 py-2 text-[13px] text-[var(--color-warning)]">
              Catalog chưa sẵn sàng cho cluster này. Cấu hình scope trong tab Catalog và chờ snapshot trước khi tạo campaign.
            </div>
          ) : null}

          <div className="rounded-xl border border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface-2)_82%,transparent)] px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Cluster</div>
            <div className="mt-1 text-[14px] font-semibold text-[var(--color-text)]">{clusterId || "-"}</div>
          </div>

          {mode !== "extend" ? (
            <>
              <div className="space-y-1">
                <label className="text-[12px] font-medium text-[var(--color-muted)]" htmlFor="campaign-name">
                  Campaign Name
                </label>
                <input
                  id="campaign-name"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  className={fieldClassName}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[12px] font-medium text-[var(--color-muted)]" htmlFor="campaign-description">
                  Description
                </label>
                <textarea
                  id="campaign-description"
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  rows={2}
                  className={fieldClassName}
                />
              </div>

              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <div className="mb-2">
                  <div className="text-[12px] font-semibold text-[var(--color-text)]">Execution Scope</div>
                  <div className="text-[12px] text-[var(--color-muted)]">
                    {availableStats.capturedAt ? `Snapshot lúc ${availableStats.capturedAt.slice(0, 16).replace("T", " ")}` : "Chưa có snapshot catalog"}
                  </div>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Select
                    value={form.database || undefined}
                    onValueChange={(value) =>
                      setForm((prev) => ({ ...prev, database: value, schema: "", selectedTables: [] }))
                    }
                  >
                    <SelectTrigger className={scopeSelectTriggerClassName} aria-label="Select database">
                      <SelectValue placeholder="Select database" />
                    </SelectTrigger>
                    <SelectContent className={scopeSelectContentClassName}>
                      {(databases ?? []).map((item) => (
                        <SelectItem key={item} value={item} className="rounded-lg text-[13px]">
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={form.schema || undefined}
                    onValueChange={(value) =>
                      setForm((prev) => ({ ...prev, schema: value, selectedTables: [] }))
                    }
                  >
                    <SelectTrigger className={scopeSelectTriggerClassName} aria-label="Select schema">
                      <SelectValue placeholder="Select schema" />
                    </SelectTrigger>
                    <SelectContent className={scopeSelectContentClassName}>
                      {(schemas ?? []).map((item) => (
                        <SelectItem key={item} value={item} className="rounded-lg text-[13px]">
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="mt-3 inline-flex rounded-lg bg-[var(--color-surface-2)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, tableMode: "all" }))}
                    className={cn(
                      "inline-flex min-w-[144px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150",
                      form.tableMode === "all"
                        ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm ring-1 ring-inset ring-[color:color-mix(in_srgb,var(--color-primary)_26%,transparent)]"
                        : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
                    )}
                    aria-pressed={form.tableMode === "all"}
                  >
                    <span>All tables</span>
                    <span className="rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] font-semibold tabular text-[var(--color-text)]">
                      {availableStats.tableCount}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, tableMode: "specific" }))}
                    className={cn(
                      "inline-flex min-w-[144px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150",
                      form.tableMode === "specific"
                        ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm ring-1 ring-inset ring-[color:color-mix(in_srgb,var(--color-primary)_26%,transparent)]"
                        : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
                    )}
                    aria-pressed={form.tableMode === "specific"}
                  >
                    <span>Specific tables</span>
                    {form.selectedTables.length > 0 ? (
                      <span className="rounded-full bg-[var(--color-primary-soft)] px-1.5 py-0.5 text-[11px] font-semibold tabular text-[var(--color-primary)]">
                        {form.selectedTables.length}
                      </span>
                    ) : null}
                  </button>
                </div>

                {form.tableMode === "specific" ? (
                  (tables ?? []).length === 0 ? (
                    <p className="mt-2 text-[12px] text-[var(--color-muted)]">No tables captured in this schema yet.</p>
                  ) : (
                    <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                      {(tables ?? []).map((t) => (
                        <button
                          key={t.table_name}
                          type="button"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              selectedTables: toggleSelectedTable(prev.selectedTables, t.table_name),
                            }))
                          }
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] transition-colors duration-150",
                            form.selectedTables.includes(t.table_name)
                              ? "border-[color:color-mix(in_srgb,var(--color-primary)_34%,var(--color-border)_66%)] bg-[var(--color-primary-soft)] text-[var(--color-text)]"
                              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-row-hover)]",
                          )}
                          aria-pressed={form.selectedTables.includes(t.table_name)}
                        >
                          <span
                            className={cn(
                              "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-150",
                              form.selectedTables.includes(t.table_name)
                                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                                : "border-[var(--color-border)] bg-transparent text-transparent",
                            )}
                            aria-hidden="true"
                          >
                            <Check className="h-3 w-3" />
                          </span>
                          <span className="truncate font-medium">{t.table_name}</span>
                        </button>
                      ))}
                      </div>
                    </div>
                  )
                ) : (
                  <div className="mt-2 text-[12px] text-[var(--color-muted)]">{availableStats.tableCount} tables available in current schema</div>
                )}
                {form.tableMode === "specific" && form.selectedTables.length > 0 ? (
                  <div className="mt-1.5 text-[11px] text-[var(--color-muted)]">{form.selectedTables.length} bảng được chọn</div>
                ) : null}
              </div>

              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <div className="text-[12px] font-semibold text-[var(--color-text)]">Execution Types</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {([
                    ["index", "Index", "exec_type_index"],
                    ["statistic", "Statistics", "exec_type_statistics"],
                    ["heap", "Heap Rebuild", "exec_type_heap"],
                  ] as Array<[ExecutionType, string, string]>).map(([value, label, gKey]) => {
                    const checked = form.executionTypes.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, executionTypes: toggleExecutionType(prev.executionTypes, value) }))}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] transition-colors duration-150",
                          checked
                            ? "border-[color:color-mix(in_srgb,var(--color-primary)_34%,var(--color-border)_66%)] bg-[var(--color-primary-soft)] text-[var(--color-text)]"
                            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-row-hover)]",
                        )}
                        aria-pressed={checked}
                      >
                        <span
                          className={cn(
                            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-150",
                            checked
                              ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                              : "border-[var(--color-border)] bg-transparent text-transparent",
                          )}
                          aria-hidden="true"
                        >
                          <Check className="h-3 w-3" />
                        </span>
                        <MaintGlossaryTip glossaryKey={gKey}>{label}</MaintGlossaryTip>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <div className="text-[12px] font-semibold text-[var(--color-text)]">Thresholds</div>
                <div className="text-[12px] text-[var(--color-muted)]">Theo execution type đã chọn. Để trống = dùng ngưỡng mặc định của cluster.</div>
                <div className="mt-2 space-y-3">
                  {THRESHOLD_GROUPS.filter((g) => form.executionTypes.includes(g.type)).map((group) => (
                    <div key={group.type} className="rounded-lg border border-[var(--color-border)]/70 bg-[color:color-mix(in_srgb,var(--color-surface-2)_55%,transparent)] p-2.5">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{group.title}</div>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {group.fields.map((field) => (
                          <div key={field.key} className="space-y-1">
                            <label className="block text-[11px] font-medium text-[var(--color-muted)]">
                              {field.glossaryKey ? (
                                <MaintGlossaryTip glossaryKey={field.glossaryKey}>{field.label}</MaintGlossaryTip>
                              ) : field.label}
                            </label>
                            <input
                              type="number"
                              min={0}
                              inputMode="decimal"
                              value={form.thresholds[field.key] ?? ""}
                              onChange={(e) =>
                                setForm((prev) => ({ ...prev, thresholds: { ...prev.thresholds, [field.key]: e.target.value } }))
                              }
                              placeholder={field.placeholder}
                              className={fieldClassName}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {form.executionTypes.length === 0 ? (
                    <p className="text-[12px] text-[var(--color-muted)]">Chọn execution type ở trên để cấu hình ngưỡng.</p>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          <div className="grid gap-2.5 sm:grid-cols-2">
            {mode === "create" ? (
              <div className="space-y-1">
                <label className="text-[12px] font-medium text-[var(--color-muted)]" htmlFor="campaign-start-date">
                  Start Date
                </label>
                <div className="relative">
                  <input
                    id="campaign-start-date"
                    type="date"
                    value={form.startDate}
                    onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
                    className={fieldClassName}
                  />
                  <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-[12px] font-medium text-[var(--color-muted)]" htmlFor="campaign-start-date-readonly">
                  Start Date
                </label>
                <input id="campaign-start-date-readonly" value={form.startDate} disabled className={`${fieldClassName} bg-[var(--color-surface-2)]`} />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[12px] font-medium text-[var(--color-muted)]" htmlFor="campaign-end-date">
                End Date
              </label>
              <div className="relative">
                <input
                  id="campaign-end-date"
                  type="date"
                  value={form.endDate}
                  onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
                  className={fieldClassName}
                />
                <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
              </div>
            </div>
          </div>

          {mode !== "extend" ? (
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-[var(--color-muted)]">
                <MaintGlossaryTip glossaryKey="scan_times">Discovery Time Slots</MaintGlossaryTip>
              </label>
              <div className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface)_88%,transparent)] p-2">
                {form.scanTimes.map((time, idx) => (
                  <div key={`${idx}-${time}`} className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="time"
                        value={time}
                        onChange={(event) => {
                          const next = [...form.scanTimes];
                          next[idx] = event.target.value;
                          setForm((prev) => ({ ...prev, scanTimes: next }));
                        }}
                        className={fieldClassName}
                      />
                      <Clock3 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
                    </div>
                    {form.scanTimes.length > 1 ? (
                      <Button type="button" variant="ghost" size="icon" onClick={() => setForm((prev) => ({ ...prev, scanTimes: prev.scanTimes.filter((_, i) => i !== idx) }))} className="h-9 w-9 shrink-0 text-[var(--color-muted)] hover:text-[var(--color-critical)]">
                        <X className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                ))}
                {form.scanTimes.length < 10 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setForm((prev) => ({ ...prev, scanTimes: [...prev.scanTimes, "20:00"] }))} className="h-8 justify-start px-2 text-[12px] text-[var(--color-primary)]">
                    <Plus className="h-3.5 w-3.5" />
                    Add time slot
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-[var(--color-border)] p-3">
            <div className="text-[12px] font-semibold text-[var(--color-text)]">
              <MaintGlossaryTip glossaryKey="maintenance_window">Window</MaintGlossaryTip>
            </div>
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={form.useDefaultWindow}
                  onChange={() => setForm((prev) => ({ ...prev, useDefaultWindow: true }))}
                />
                Use cluster default window
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={!form.useDefaultWindow}
                  onChange={() => setForm((prev) => ({ ...prev, useDefaultWindow: false }))}
                />
                <MaintGlossaryTip glossaryKey="window_override">Override window</MaintGlossaryTip>
              </label>
            </div>
            {!form.useDefaultWindow ? (
              <div className="mt-3 space-y-2">
                {summary?.window?.slot ? (
                  <p className="text-[11px] text-[var(--color-muted)]">
                    Cluster default: {summary.window.slot.start}-{summary.window.slot.end},{" "}
                    {summary.window.slot.time_budget_minutes} min
                  </p>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-[var(--color-muted)]">Start</label>
                    <input type="time" className={fieldClassName} value={form.overrideStart} onChange={(e) => setForm((prev) => ({ ...prev, overrideStart: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-[var(--color-muted)]">End</label>
                    <input type="time" className={fieldClassName} value={form.overrideEnd} onChange={(e) => setForm((prev) => ({ ...prev, overrideEnd: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-[var(--color-muted)]">Budget (min)</label>
                    <input type="number" min={30} max={1440} className={fieldClassName} value={form.overrideBudgetMinutes} onChange={(e) => setForm((prev) => ({ ...prev, overrideBudgetMinutes: e.target.value }))} />
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {error ? <p className="text-[12px] text-[var(--color-critical)]">{error}</p> : null}
        </DialogBody>
        <DialogFooter className="px-4 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} loading={pending}>
            {mode === "create" ? "Create" : mode === "extend" ? "Extend" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
