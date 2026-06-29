import type { ReactNode } from "react";
import { ArrowRight, BarChart2, CheckCircle2, Database, ListOrdered } from "lucide-react";
import { MaintGlossaryTip } from "@/components/maintenance/MaintGlossaryTip";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDetectedAt, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MaintenanceCampaignSummary } from "@/types";

function StageCard({
  icon,
  eyebrow,
  title,
  line1,
  line2,
  tone,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: ReactNode;
  line1: string;
  line2: string;
  tone?: string;
}) {
  return (
    <div
      className="rounded-lg border bg-[var(--color-surface)] p-3 shadow-sm"
      style={tone ? { borderColor: `color-mix(in srgb, ${tone} 42%, var(--color-border))` } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">{eyebrow}</div>
          <div
            className="mt-1 text-[13px] font-semibold"
            style={tone ? { color: tone } : { color: "var(--color-text)" }}
          >
            {title}
          </div>
        </div>
        <span
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={
            tone
              ? { color: tone, background: `color-mix(in srgb, ${tone} 12%, transparent)` }
              : { color: "var(--color-muted)", background: "var(--color-surface-2)" }
          }
        >
          {icon}
        </span>
      </div>
      <div className="mt-2.5 space-y-0.5">
        <p className="text-[13px] font-medium text-[var(--color-text)]">{line1}</p>
        <p className="text-[12px] leading-5 text-[var(--color-muted)]">{line2}</p>
      </div>
    </div>
  );
}

function formatBatchStatus(status: string | null): string {
  if (!status) return "—";
  const map: Record<string, string> = {
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    expired: "Expired",
  };
  return map[status.toLowerCase()] ?? status;
}

interface Props {
  data?: MaintenanceCampaignSummary | null;
  isLoading?: boolean;
}

export function PipelineStages({ data, isLoading = false }: Props) {
  if (isLoading) {
    return (
      <div className="grid gap-2 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <Skeleton className="h-3 w-20 rounded-full" />
            <Skeleton className="mt-3 h-5 w-32 rounded-full" />
            <Skeleton className="mt-6 h-4 w-40 rounded-full" />
            <Skeleton className="mt-2 h-4 w-28 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-6 text-center">
        <p className="text-[14px] font-semibold text-[var(--color-text)]">No pipeline data</p>
        <p className="mt-1 text-[12px] text-[var(--color-muted)]">
          Select a campaign to see approval, queue, and execution status.
        </p>
      </div>
    );
  }

  const status = (data.status ?? "").toLowerCase();

  // ── Catalog ────────────────────────────────────────────────────────────────
  const catalogLine1 = data.catalog.last_run_at
    ? `Snapshot: ${formatDetectedAt(data.catalog.last_run_at)}`
    : status === "discovering"
      ? "Building from catalog snapshot…"
      : "No snapshot linked";
  const catalogLine2 = data.catalog.has_snapshot
    ? `${formatNumber(data.catalog.table_count)} table(s) · ${formatNumber(data.catalog.schema_count)} schema(s)`
    : data.discovery_error
      ? data.discovery_error
      : "Capture catalog first, then run discovery";

  // ── Approval ───────────────────────────────────────────────────────────────
  const approvalLine1 =
    data.approval.awaiting_count > 0
      ? `${formatNumber(data.approval.awaiting_count)} item(s) awaiting approval`
      : data.approval.status
        ? `${formatBatchStatus(data.approval.status)} — ${formatNumber(data.approval.item_count ?? 0)} item(s)`
        : "No batch sent yet";
  const approvalLine2 =
    data.approval.awaiting_count > 0
      ? "Check Telegram for the approval request"
      : data.approval.decided_at
        ? `Decided ${formatDetectedAt(data.approval.decided_at)}`
        : "Awaiting first discovery run";
  const approvalTone =
    data.approval.awaiting_count > 0 ? "var(--color-warning)" : undefined;

  // ── Queue ──────────────────────────────────────────────────────────────────
  const totalQueue =
    data.queue.approved + data.queue.running + data.queue.paused + data.queue.awaiting_approval;
  const queueLine1 =
    data.queue.running > 0
      ? `${data.queue.running} running — ${data.queue.approved} approved`
      : data.queue.approved > 0
        ? `${data.queue.approved} approved, waiting for window`
        : data.queue.paused > 0
          ? `${data.queue.paused} paused (resumable)`
          : totalQueue === 0
            ? "Queue is empty"
            : `${data.queue.awaiting_approval} awaiting approval`;
  const queueLine2 =
    data.queue.paused > 0
      ? "Will resume in the next maintenance window"
      : data.queue.awaiting_approval > 0
        ? `${data.queue.awaiting_approval} item(s) still need approval`
        : data.queue.approved > 0
          ? "Execute tick will claim items when window opens"
          : "No active items in queue";
  const queueTone = data.queue.running > 0 ? "var(--color-primary)" : undefined;

  // ── Results ────────────────────────────────────────────────────────────────
  const totalTerminal = data.results.done + data.results.failed + data.results.skipped;
  const resultsLine1 =
    totalTerminal === 0
      ? "No items executed yet"
      : `${formatNumber(data.results.done)} done · ${formatNumber(data.results.failed)} failed · ${formatNumber(data.results.skipped)} skipped`;
  const resultsLine2 =
    totalTerminal === 0
      ? "Results will appear here after execution"
      : `${formatNumber(data.results.remaining)} remaining — ${data.results.progress_pct}% complete`;
  const resultsTone =
    totalTerminal === 0
      ? undefined
      : data.results.failed > 0
        ? "var(--color-critical)"
        : "var(--color-success)";

  const stages = [
    {
      key: "catalog",
      eyebrow: "Step 1",
      title: <MaintGlossaryTip glossaryKey="stage_catalog">Catalog</MaintGlossaryTip>,
      icon: <Database className="h-4 w-4" />,
      line1: catalogLine1,
      line2: catalogLine2,
      tone: undefined,
    },
    {
      key: "approval",
      eyebrow: "Step 2",
      title: <MaintGlossaryTip glossaryKey="stage_approval">Approval</MaintGlossaryTip>,
      icon: <CheckCircle2 className="h-4 w-4" />,
      line1: approvalLine1,
      line2: approvalLine2,
      tone: approvalTone,
    },
    {
      key: "queue",
      eyebrow: "Step 3",
      title: <MaintGlossaryTip glossaryKey="stage_queue">Queue</MaintGlossaryTip>,
      icon: <ListOrdered className="h-4 w-4" />,
      line1: queueLine1,
      line2: queueLine2,
      tone: queueTone,
    },
    {
      key: "results",
      eyebrow: "Step 4",
      title: <MaintGlossaryTip glossaryKey="stage_results">Results</MaintGlossaryTip>,
      icon: <BarChart2 className="h-4 w-4" />,
      line1: resultsLine1,
      line2: resultsLine2,
      tone: resultsTone,
    },
  ];

  return (
    <div className="grid gap-2 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] xl:items-stretch">
      {stages.map((stage, index) => (
        <div key={stage.key} className={cn("contents")}>
          <StageCard {...stage} />
          {index < stages.length - 1 ? (
            <div className="hidden items-center justify-center text-[var(--color-subtle)] xl:flex" aria-hidden="true">
              <ArrowRight className="h-4 w-4" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
