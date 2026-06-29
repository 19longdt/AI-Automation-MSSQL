import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MaintGlossaryTip } from "@/components/maintenance/MaintGlossaryTip";
import { useUpsertWindowConfig, useWindowConfig } from "@/hooks/useMaintenance";
import type { MaintenanceWindowConfig, MaintenanceWindowSlotConfig } from "@/types";

const fieldClassName =
  "h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12px] text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-muted)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--color-primary)_25%,transparent)]";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusterId?: string;
}

interface SlotDraft {
  start: string;
  end: string;
  time_budget_minutes: string;
}

interface FormState {
  enabled: boolean;
  killSwitch: boolean;
  defaultSlot: SlotDraft;
  weekdayEnabled: boolean;
  weekdaySlot: SlotDraft;
  weekendEnabled: boolean;
  weekendSlot: SlotDraft;
  gates: {
    cpu_max_pct: string;
    active_requests_max: string;
    log_send_queue_max_kb: string;
    redo_queue_max_kb: string;
  };
}

const DEFAULT_SLOT: SlotDraft = { start: "02:30", end: "05:00", time_budget_minutes: "150" };
const DEFAULT_WEEKEND_SLOT: SlotDraft = { start: "00:00", end: "05:00", time_budget_minutes: "280" };
const DEFAULT_GATES = {
  cpu_max_pct: "60",
  active_requests_max: "50",
  log_send_queue_max_kb: "100000",
  redo_queue_max_kb: "200000",
} as const;

function slotDraftFromConfig(slot?: MaintenanceWindowSlotConfig | null, fallback: SlotDraft = DEFAULT_SLOT): SlotDraft {
  if (!slot) return { ...fallback };
  return {
    start: slot.start,
    end: slot.end,
    time_budget_minutes: String(slot.time_budget_minutes),
  };
}

function buildInitialState(config?: MaintenanceWindowConfig | null): FormState {
  const weekdaySlot = config?.day_overrides?.["0"] ?? null;
  const weekendSlot = config?.day_overrides?.["5"] ?? null;
  return {
    enabled: config?.enabled ?? true,
    killSwitch: config?.kill_switch ?? false,
    defaultSlot: slotDraftFromConfig(config?.default, DEFAULT_SLOT),
    weekdayEnabled: Boolean(weekdaySlot),
    weekdaySlot: slotDraftFromConfig(weekdaySlot, DEFAULT_SLOT),
    weekendEnabled: Boolean(weekendSlot),
    weekendSlot: slotDraftFromConfig(weekendSlot, DEFAULT_WEEKEND_SLOT),
    gates: {
      cpu_max_pct: config?.gates.cpu_max_pct != null ? String(config.gates.cpu_max_pct) : "",
      active_requests_max: config?.gates.active_requests_max != null ? String(config.gates.active_requests_max) : "",
      log_send_queue_max_kb: config?.gates.log_send_queue_max_kb != null ? String(config.gates.log_send_queue_max_kb) : "",
      redo_queue_max_kb: config?.gates.redo_queue_max_kb != null ? String(config.gates.redo_queue_max_kb) : "",
    },
  };
}

function slotToPayload(slot: SlotDraft): MaintenanceWindowSlotConfig {
  return {
    start: slot.start,
    end: slot.end,
    time_budget_minutes: Number(slot.time_budget_minutes || "0"),
  };
}

function nullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function Toggle({
  checked,
  onChange,
  label,
  tone = "default",
  glossaryKey,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  tone?: "default" | "danger";
  glossaryKey?: string;
}) {
  const isDanger = tone === "danger";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-surface-2)]"
    >
      <span
        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
        style={{
          backgroundColor: checked
            ? isDanger ? "var(--color-critical)" : "var(--color-primary)"
            : "var(--color-surface-3)",
        }}
      >
        <span
          className="inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
          style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
        />
      </span>
      {glossaryKey ? (
        <MaintGlossaryTip glossaryKey={glossaryKey}>{label}</MaintGlossaryTip>
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
}

function SlotFields({
  label,
  value,
  onChange,
}: {
  label?: string;
  value: SlotDraft;
  onChange: (slot: SlotDraft) => void;
}) {
  return (
    <div className="space-y-2">
      {label ? <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">{label}</div> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <label className="text-[11px] text-[var(--color-muted)]">Start</label>
          <input
            type="time"
            className={fieldClassName}
            value={value.start}
            onChange={(event) => onChange({ ...value, start: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-[var(--color-muted)]">End</label>
          <input
            type="time"
            className={fieldClassName}
            value={value.end}
            onChange={(event) => onChange({ ...value, end: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-[var(--color-muted)]">Budget (min)</label>
          <input
            type="number"
            min={30}
            max={1440}
            className={fieldClassName}
            value={value.time_budget_minutes}
            onChange={(event) => onChange({ ...value, time_budget_minutes: event.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

export function WindowConfigDialog({ open, onOpenChange, clusterId }: Props) {
  const [form, setForm] = useState<FormState>(() => buildInitialState(null));
  const [showOverrides, setShowOverrides] = useState(false);
  const [error, setError] = useState("");
  const { data, isLoading } = useWindowConfig(clusterId);
  const saveMutation = useUpsertWindowConfig();

  useEffect(() => {
    if (!open) {
      setError("");
      return;
    }
    setForm(buildInitialState(data));
  }, [open, data]);

  const placeholders = useMemo(() => DEFAULT_GATES, []);

  async function handleSubmit() {
    setError("");
    if (!clusterId) {
      setError("Vui lòng chọn cluster trước.");
      return;
    }

    const defaultBudget = Number(form.defaultSlot.time_budget_minutes || "0");
    if (!form.defaultSlot.start || !form.defaultSlot.end || defaultBudget < 30 || defaultBudget > 1440) {
      setError("Window mặc định cần có giờ bắt đầu, kết thúc và ngân sách hợp lệ (30–1440 phút).");
      return;
    }

    const weekdayBudget = Number(form.weekdaySlot.time_budget_minutes || "0");
    if (form.weekdayEnabled && (!form.weekdaySlot.start || !form.weekdaySlot.end || weekdayBudget < 30 || weekdayBudget > 1440)) {
      setError("Cấu hình Weekday cần có giờ bắt đầu, kết thúc và ngân sách hợp lệ (30–1440 phút).");
      return;
    }

    const weekendBudget = Number(form.weekendSlot.time_budget_minutes || "0");
    if (form.weekendEnabled && (!form.weekendSlot.start || !form.weekendSlot.end || weekendBudget < 30 || weekendBudget > 1440)) {
      setError("Cấu hình Weekend cần có giờ bắt đầu, kết thúc và ngân sách hợp lệ (30–1440 phút).");
      return;
    }

    const dayOverrides: Record<string, MaintenanceWindowSlotConfig | null> = {};
    for (const day of ["0", "1", "2", "3", "4"]) {
      dayOverrides[day] = form.weekdayEnabled ? slotToPayload(form.weekdaySlot) : null;
    }
    for (const day of ["5", "6"]) {
      dayOverrides[day] = form.weekendEnabled ? slotToPayload(form.weekendSlot) : null;
    }

    try {
      await saveMutation.mutateAsync({
        cluster_id: clusterId,
        enabled: form.enabled,
        kill_switch: form.killSwitch,
        default: slotToPayload(form.defaultSlot),
        day_overrides: dayOverrides,
        gates: {
          cpu_max_pct: nullableNumber(form.gates.cpu_max_pct),
          active_requests_max: nullableNumber(form.gates.active_requests_max),
          log_send_queue_max_kb: nullableNumber(form.gates.log_send_queue_max_kb),
          redo_queue_max_kb: nullableNumber(form.gates.redo_queue_max_kb),
        },
      });
      onOpenChange(false);
    } catch {
      // toast handled in hook
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,780px)]">
        <DialogHeader className="px-4 py-3">
          <div className="space-y-0.5">
            <DialogTitle>Configure Maintenance Window</DialogTitle>
            <p className="text-[12px] text-[var(--color-muted)]">
              Cấu hình khung giờ bảo trì, ghi đè theo ngày trong tuần/cuối tuần, và ngưỡng gate an toàn cho cluster.
            </p>
          </div>
        </DialogHeader>

        <DialogBody className="space-y-3 p-4">
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="mb-2 text-[12px] font-semibold text-[var(--color-text)]">
              <MaintGlossaryTip glossaryKey="maintenance_window">Default window slot</MaintGlossaryTip>
            </div>
            <SlotFields value={form.defaultSlot} onChange={(slot) => setForm((prev) => ({ ...prev, defaultSlot: slot }))} />
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left"
              onClick={() => setShowOverrides((prev) => !prev)}
            >
              <div>
                <div className="text-[12px] font-semibold text-[var(--color-text)]">
                  <MaintGlossaryTip glossaryKey="day_overrides">Day overrides</MaintGlossaryTip>
                </div>
                <div className="text-[12px] text-[var(--color-muted)]">Áp dụng khung giờ riêng cho ngày trong tuần hoặc cuối tuần.</div>
              </div>
              <ChevronDown className={`h-4 w-4 text-[var(--color-muted)] transition-transform ${showOverrides ? "rotate-180" : ""}`} />
            </button>

            {showOverrides ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[12px] font-medium text-[var(--color-text)]">Weekday override</div>
                      <div className="text-[11px] text-[var(--color-muted)]">Thứ 2 – Thứ 6</div>
                    </div>
                    <Toggle checked={form.weekdayEnabled} onChange={(next) => setForm((prev) => ({ ...prev, weekdayEnabled: next }))} label={form.weekdayEnabled ? "Đã bật" : "Đã tắt"} />
                  </div>
                  {form.weekdayEnabled ? (
                    <SlotFields value={form.weekdaySlot} onChange={(slot) => setForm((prev) => ({ ...prev, weekdaySlot: slot }))} />
                  ) : null}
                </div>

                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[12px] font-medium text-[var(--color-text)]">Weekend override</div>
                      <div className="text-[11px] text-[var(--color-muted)]">Thứ 7 – Chủ nhật</div>
                    </div>
                    <Toggle checked={form.weekendEnabled} onChange={(next) => setForm((prev) => ({ ...prev, weekendEnabled: next }))} label={form.weekendEnabled ? "Đã bật" : "Đã tắt"} />
                  </div>
                  {form.weekendEnabled ? (
                    <SlotFields value={form.weekendSlot} onChange={(slot) => setForm((prev) => ({ ...prev, weekendSlot: slot }))} />
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="mb-2 text-[12px] font-semibold text-[var(--color-text)]">Safety gates</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] text-[var(--color-muted)]">
                  <MaintGlossaryTip glossaryKey="gate_cpu">CPU max %</MaintGlossaryTip>
                </label>
                <input
                  type="number"
                  min={0}
                  className={fieldClassName}
                  placeholder={placeholders.cpu_max_pct}
                  value={form.gates.cpu_max_pct}
                  onChange={(event) => setForm((prev) => ({ ...prev, gates: { ...prev.gates, cpu_max_pct: event.target.value } }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-[var(--color-muted)]">
                  <MaintGlossaryTip glossaryKey="gate_requests">Active requests max</MaintGlossaryTip>
                </label>
                <input
                  type="number"
                  min={0}
                  className={fieldClassName}
                  placeholder={placeholders.active_requests_max}
                  value={form.gates.active_requests_max}
                  onChange={(event) => setForm((prev) => ({ ...prev, gates: { ...prev.gates, active_requests_max: event.target.value } }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-[var(--color-muted)]">
                  <MaintGlossaryTip glossaryKey="gate_ag_send">AG send queue max (KB)</MaintGlossaryTip>
                </label>
                <input
                  type="number"
                  min={0}
                  className={fieldClassName}
                  placeholder={placeholders.log_send_queue_max_kb}
                  value={form.gates.log_send_queue_max_kb}
                  onChange={(event) => setForm((prev) => ({ ...prev, gates: { ...prev.gates, log_send_queue_max_kb: event.target.value } }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-[var(--color-muted)]">
                  <MaintGlossaryTip glossaryKey="gate_ag_redo">AG redo queue max (KB)</MaintGlossaryTip>
                </label>
                <input
                  type="number"
                  min={0}
                  className={fieldClassName}
                  placeholder={placeholders.redo_queue_max_kb}
                  value={form.gates.redo_queue_max_kb}
                  onChange={(event) => setForm((prev) => ({ ...prev, gates: { ...prev.gates, redo_queue_max_kb: event.target.value } }))}
                />
              </div>
            </div>
            <div className="mt-2 text-[11px] text-[var(--color-muted)]">Để trống để dùng giá trị mặc định của runner.</div>
          </section>

          {error ? <p className="text-[12px] text-[var(--color-critical)]">{error}</p> : null}
          {isLoading ? <p className="text-[12px] text-[var(--color-muted)]">Đang tải cấu hình window…</p> : null}
        </DialogBody>

        <DialogFooter className="px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleSubmit()} loading={saveMutation.isPending}>
            Save window
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
