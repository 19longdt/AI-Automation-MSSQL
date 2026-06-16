import type { TopicThresholdConfig } from "@/types";

export type ThresholdSeverity = "normal" | "warning" | "critical";

export function getThresholdSeverity(value: number, threshold?: TopicThresholdConfig): ThresholdSeverity {
  const critical = threshold?.critical;
  const warning = threshold?.warning;

  if (critical != null && value >= critical) return "critical";
  if (warning != null && value >= warning) return "warning";
  return "normal";
}

export function thresholdTextClass(value: number, threshold?: TopicThresholdConfig, normalClass = "text-[var(--color-text)]"): string {
  const severity = getThresholdSeverity(value, threshold);
  if (severity === "critical") return "text-[var(--color-critical)] font-semibold";
  if (severity === "warning") return "text-[var(--color-warning)] font-semibold";
  return normalClass;
}
