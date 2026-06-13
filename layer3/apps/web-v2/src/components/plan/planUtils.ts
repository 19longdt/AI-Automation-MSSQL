import type { OperatorSummary, WaitStatSummary } from "@layer3/core";

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "\u2014";
  if (Math.abs(ms) >= 1_000) return `${num(ms / 1_000, 1)} s`;
  return `${num(ms, 0)} ms`;
}

export function fmtReads(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "\u2014";
  if (Math.abs(value) >= 1_000_000) return `${num(value / 1_000_000, 1)}M`;
  if (Math.abs(value) >= 1_000) return `${num(value / 1_000, 1)}K`;
  return num(value, 0);
}

export function fmtKbOrMb(kb: number | null | undefined): string {
  if (kb == null || Number.isNaN(kb)) return "\u2014";
  if (Math.abs(kb) >= 1_024) return `${num(kb / 1_024, 1)} MB`;
  return `${num(kb, 0)} KB`;
}

export function kbToMb(kb: number | null | undefined): string {
  if (kb == null || Number.isNaN(kb)) return "\u2014";
  return num(kb / 1_024, 1);
}

export function num(value: number, digits = 0): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function nullableNum(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "\u2014";
  return num(value, digits);
}

export function waitCls(type: string | null | undefined): string {
  const upper = (type ?? "").toUpperCase();
  if (upper.startsWith("LCK") || upper.includes("PAGEIOLATCH")) return "text-[var(--color-critical)]";
  if (upper.includes("CX") || upper.includes("RESOURCE_SEMAPHORE")) return "text-[var(--color-warning)]";
  if (upper.includes("ASYNC") || upper.includes("WRITELOG")) return "text-[var(--color-info)]";
  return "text-[var(--color-text)]";
}

export function elapsedCls(ms: number | null | undefined): string {
  if (ms == null) return "text-[var(--color-text)]";
  if (ms >= 10_000) return "text-[var(--color-critical)]";
  if (ms >= 1_000) return "text-[var(--color-warning)]";
  return "text-[var(--color-success)]";
}

export function cpuCls(ms: number | null | undefined): string {
  return elapsedCls(ms);
}

export function memCls(usedKb: number | null | undefined, grantedKb: number | null | undefined): string {
  if (usedKb == null || grantedKb == null || grantedKb <= 0) return "text-[var(--color-text)]";
  const pct = (usedKb / grantedKb) * 100;
  if (pct >= 90) return "text-[var(--color-critical)]";
  if (pct >= 50) return "text-[var(--color-warning)]";
  return "text-[var(--color-success)]";
}

export function opTagClass(tag: string | null | undefined): string {
  const upper = (tag ?? "").toUpperCase();
  if (upper.includes("SEEK")) return "bg-[var(--color-success)]";
  if (upper.includes("SCAN")) return "bg-[var(--color-warning)]";
  if (upper.includes("SORT") || upper.includes("SPILL")) return "bg-[var(--color-critical)]";
  if (upper.includes("JOIN") || upper.includes("HASH")) return "bg-[var(--color-info)]";
  if (upper.includes("LOOKUP")) return "bg-[color:color-mix(in_srgb,var(--color-warning)_70%,var(--color-critical))]";
  if (upper.includes("PARALLEL")) return "bg-[color:color-mix(in_srgb,var(--color-info)_60%,var(--color-surface-2))]";
  return "bg-[var(--color-text)]";
}

export function opGlossaryKey(physicalOp: string | null | undefined, logicalOp: string | null | undefined): string {
  const op = (physicalOp ?? "").toLowerCase();
  const lop = (logicalOp ?? "").toLowerCase();
  if (op === "sort" || op === "distinct sort") return "op_sort";
  if (op === "filter") return "op_filter";
  if (op === "top") return "op_top";
  if (op === "compute scalar") return "op_compute_scalar";
  if (op === "stream aggregate") return "op_stream_aggregate";
  if (op === "hash match") return "op_hash_match";
  if (op === "nested loops") return "op_nested_loops";
  if (op === "merge join") return "op_merge_join";
  if (op === "index seek" || op === "clustered index seek") return "op_index_seek";
  if (op === "index scan") return "op_index_scan";
  if (op === "clustered index scan") return "op_clustered_index_scan";
  if (op === "table scan") return "op_table_scan";
  if (op === "key lookup") return "op_key_lookup";
  if (op === "rid lookup") return "op_rid_lookup";
  if (op === "parallelism") return "op_parallelism";
  if (op === "bitmap") return "op_bitmap";
  if (op === "window spool") return "op_window_spool";
  if (op === "lazy spool" || op === "eager spool" || op === "table spool" || op === "index spool") return "op_spool";
  if (op === "concatenation") return "op_concatenation";
  if (op === "assert") return "op_assert";
  if (op === "remote query" || op === "remote scan") return "op_remote";
  if (lop.includes("hash")) return "op_hash_match";
  return "";
}

export function warnCat(type: string | null | undefined): string {
  const raw = (type ?? "").toLowerCase();
  if (raw.includes("spill")) return "spill";
  if (raw.includes("parallel") || raw.includes("serial")) return "parallel";
  if (raw.includes("index") || raw.includes("lookup") || raw.includes("sargable")) return "index";
  if (raw.includes("stat") || raw.includes("row_estimate") || raw.includes("row_under") || raw.includes("row_over")) return "stats";
  return "perf";
}

export function warnLabel(type: string | null | undefined): string {
  const raw = (type ?? "").replace(/_/g, " ").trim();
  return raw ? raw.toUpperCase() : "PLAN WARNING";
}

export function opDisplayName(op: OperatorSummary): string {
  const objectName = [op.table_name, op.index_name].filter((item): item is string => Boolean(item)).join(" / ");
  return objectName ? `${op.physical_op}: ${objectName}` : op.physical_op;
}

export function formatQueryText(source: string | null | undefined): string {
  const text = (source ?? "").trim();
  if (!text) return "(no text)";
  return text
    .replace(/\s+/g, " ")
    .replace(/\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|OPTION|JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|OUTER APPLY|CROSS APPLY)\b/gi, "\n$1")
    .replace(/\b(AND|OR)\b/gi, "\n  $1")
    .trim();
}

export function topWait(waits: WaitStatSummary[]): WaitStatSummary | null {
  if (!waits.length) return null;
  return waits.reduce<WaitStatSummary>((current, item) => (item.ms > current.ms ? item : current), waits[0]);
}

export function totalWaitMs(waits: WaitStatSummary[]): number {
  return waits.reduce((sum, item) => sum + item.ms, 0);
}
