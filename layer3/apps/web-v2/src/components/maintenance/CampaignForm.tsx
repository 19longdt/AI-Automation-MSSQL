import { useEffect, useState } from "react";
import { CalendarDays, Clock3, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CampaignCreateBody, CampaignUpdateBody, MaintenanceCampaign } from "@/types";

type CampaignFormMode = "create" | "edit" | "extend";

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
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  startDate: "",
  endDate: "",
  scanTimes: ["20:00"],
};

const fieldClassName =
  "w-full rounded-xl border border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface)_90%,transparent)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-muted)] focus:border-[color:color-mix(in_srgb,var(--color-primary)_55%,var(--color-border)_45%)]";

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
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      setError("");
      return;
    }

    if (!campaign) {
      setForm(EMPTY_FORM);
      setError("");
      return;
    }

    setForm({
      name: campaign.name ?? "",
      description: campaign.description ?? "",
      startDate: toDateInput(campaign.start_date),
      endDate: toDateInput(campaign.end_date),
      scanTimes: campaign.scan_times?.length ? [...campaign.scan_times] : ["20:00"],
    });
    setError("");
  }, [campaign, open]);

  async function handleSubmit() {
    setError("");
    if (!clusterId) {
      setError("Select a cluster before editing campaigns.");
      return;
    }
    try {
      if (mode === "create") {
        if (!form.name.trim() || !form.startDate || !form.endDate) {
          setError("Name, start date, and end date are required.");
          return;
        }
        if (form.endDate <= form.startDate) {
          setError("End date must be greater than start date.");
          return;
        }
        await onSubmit({
          cluster_id: clusterId,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          start_date: form.startDate,
          end_date: form.endDate,
          scan_times: form.scanTimes,
        });
        return;
      }

      if (mode === "extend") {
        if (!form.endDate) {
          setError("End date is required.");
          return;
        }
        if (form.startDate && form.endDate <= form.startDate) {
          setError("End date must be greater than start date.");
          return;
        }
        await onSubmit({ end_date: form.endDate });
        return;
      }

      if (!form.name.trim()) {
        setError("Name is required.");
        return;
      }
      if (form.startDate && form.endDate && form.endDate <= form.startDate) {
        setError("End date must be greater than start date.");
        return;
      }
      await onSubmit({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        end_date: form.endDate || undefined,
        scan_times: form.scanTimes,
      });
    } catch {
      // Mutation hooks already surface a toast; keep the dialog open for correction.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,540px)]">
        <DialogHeader className="px-4 py-3">
          <DialogTitle>{titleForMode(mode)}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-2.5 p-4">
          <div className="rounded-xl border border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface-2)_82%,transparent)] px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">Cluster</div>
            <div className="mt-1 text-[14px] font-semibold text-[var(--color-text)]">{clusterId || "-"}</div>
          </div>

          {mode !== "extend" ? (
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
          ) : null}

          {mode !== "extend" ? (
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
                <input
                  id="campaign-start-date-readonly"
                  value={form.startDate}
                  disabled
                  className={`${fieldClassName} bg-[var(--color-surface-2)]`}
                />
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
                Discovery Time Slots
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            scanTimes: prev.scanTimes.filter((_, i) => i !== idx),
                          }))
                        }
                        className="h-9 w-9 shrink-0 text-[var(--color-muted)] hover:text-[var(--color-critical)]"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                ))}
                {form.scanTimes.length < 10 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setForm((prev) => ({ ...prev, scanTimes: [...prev.scanTimes, "20:00"] }))
                    }
                    className="h-8 justify-start px-2 text-[12px] text-[var(--color-primary)]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add time slot
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

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
