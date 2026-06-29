import { useEffect, useMemo, useState } from "react";
import { BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTopicOverrides, useUpdateTopicOverrides } from "@/hooks/useTopicOverrides";
import { useTopics } from "@/hooks/useTopics";
import { cn } from "@/lib/utils";
import type { ClusterResponse, TopicOverridesMap } from "@/types";

interface AlertConfigDialogProps {
  cluster: ClusterResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function isNotifyEnabled(overrides: TopicOverridesMap, topicId: string): boolean {
  return overrides[topicId]?.notify_enabled ?? true;
}

export function AlertConfigDialog({ cluster, open, onOpenChange }: AlertConfigDialogProps) {
  const clusterId = cluster?.cluster_id ?? "";
  const { data: topics, isLoading: topicsLoading, error: topicsError } = useTopics();
  const {
    data: overrides,
    isLoading: overridesLoading,
    error: overridesError,
  } = useTopicOverrides(clusterId, open && Boolean(clusterId));
  const updateMutation = useUpdateTopicOverrides(clusterId);
  const [draft, setDraft] = useState<TopicOverridesMap>({});

  useEffect(() => {
    if (!open) {
      setDraft({});
      return;
    }
    setDraft(overrides ?? {});
  }, [open, overrides]);

  const sortedTopics = useMemo(
    () => [...(topics ?? [])].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [topics]
  );
  const isLoading = topicsLoading || overridesLoading;
  const errorMessage = topicsError instanceof Error
    ? topicsError.message
    : overridesError instanceof Error
      ? overridesError.message
      : "";

  function toggleTopic(topicId: string) {
    setDraft((current) => {
      const enabled = isNotifyEnabled(current, topicId);
      if (enabled) {
        return { ...current, [topicId]: { notify_enabled: false } };
      }

      const next = { ...current };
      delete next[topicId];
      return next;
    });
  }

  async function handleSave() {
    if (!clusterId) return;
    await updateMutation.mutateAsync(draft);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,860px)]">
        <DialogHeader className="px-4 py-3">
          <div>
            <DialogTitle>Alert Notifications</DialogTitle>
            <p className="mt-1 text-[12px] text-[var(--color-muted)]">
              {cluster ? `${cluster.name} (${cluster.environment.toUpperCase()})` : "Select a cluster"}
            </p>
          </div>
        </DialogHeader>
        <DialogBody className="space-y-3 p-4">
          <div className="rounded-xl border border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-surface)_84%,transparent)] px-3 py-2 text-[12px] text-[var(--color-text-2)]">
            Tắt notify vẫn lưu findings đầy đủ, chỉ không gửi Telegram/Teams alert.
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-[13px] text-[var(--color-muted)]">Loading alert config...</div>
          ) : errorMessage ? (
            <div className="rounded-xl border border-[var(--color-critical-soft)] bg-[var(--color-critical-soft)] px-3 py-3 text-[13px] text-[var(--color-critical)]">
              {errorMessage}
            </div>
          ) : !sortedTopics.length ? (
            <div className="py-10 text-center text-[13px] text-[var(--color-muted)]">No topics available.</div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
              <table className="w-full table-fixed text-left text-[13px]">
                <colgroup>
                  <col className="w-[55%]" />
                  <col className="w-[15%]" />
                  <col className="w-[30%]" />
                </colgroup>
                <thead className="bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                  <tr>
                    <th className="px-4 py-3">Topic</th>
                    <th className="px-4 py-3">Notify</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTopics.map((topic) => {
                    const enabled = isNotifyEnabled(draft, topic.topic_id);
                    return (
                      <tr key={topic.topic_id} className="border-t border-[var(--color-border)]">
                        <td className="px-4 py-3">
                          <div className="font-medium text-[var(--color-text)]">{topic.name}</div>
                          <div className="text-[12px] text-[var(--color-muted)]">{topic.topic_id}</div>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={enabled}
                            onClick={() => toggleTopic(topic.topic_id)}
                            className={cn(
                              "inline-flex h-7 w-14 items-center rounded-full border px-1 transition-colors",
                              enabled
                                ? "border-[var(--color-success)] bg-[var(--color-success-soft)]"
                                : "border-[var(--color-border-2)] bg-[var(--color-surface-3)]"
                            )}
                          >
                            <span
                              className={cn(
                                "inline-flex h-5 w-5 items-center justify-center rounded-full transition-transform",
                                enabled
                                  ? "translate-x-7 bg-[var(--color-success)] text-white"
                                  : "translate-x-0 bg-[var(--color-text-2)] text-[var(--color-surface)]"
                              )}
                            >
                              {enabled ? <BellRing className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              enabled
                                ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                                : "bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
                            )}
                          >
                            {enabled ? "Enabled" : "Disabled"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DialogBody>
        <DialogFooter className="px-4 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            loading={updateMutation.isPending}
            disabled={isLoading || Boolean(errorMessage) || !clusterId}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
