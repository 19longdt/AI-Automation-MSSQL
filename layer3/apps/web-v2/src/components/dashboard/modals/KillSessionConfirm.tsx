import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { truncate } from "@/lib/format";

interface Props {
  sessionId: number;
  node: string;
  clusterId?: string;
  sourceLabel: string;
  sqlText?: string;
  onClose: () => void;
}

export function KillSessionConfirm({ sessionId, node, clusterId, sourceLabel, sqlText, onClose }: Props) {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => apiPost("/api/actions/kill-session", { session_id: sessionId, node, cluster_id: clusterId }),
    onSuccess: () => {
      toast.success(`Session #${sessionId} killed successfully`);
      void qc.invalidateQueries({ queryKey: qk.findings({}) });
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Kill session failed", { description: msg });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Kill Session</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-3">
            <div className="flex items-baseline gap-3">
              <span className="text-[13px] text-[var(--color-muted)]">Session</span>
              <span className="text-[20px] font-bold font-code text-[var(--color-critical)]">#{sessionId}</span>
              <span className="text-[12px] text-[var(--color-muted)]">via {sourceLabel} on {node || "auto"}</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--color-critical-soft)] border border-[color:color-mix(in_srgb,var(--color-critical)_20%,transparent)]">
              <p className="text-[12px] font-medium text-[var(--color-critical)]">
                This will execute <code className="font-code font-bold">KILL {sessionId}</code> on the target node.
                This action cannot be undone.
              </p>
            </div>
            {sqlText && (
              <div>
                <p className="text-[11px] text-[var(--color-muted)] mb-1 font-semibold uppercase tracking-wide">SQL Text</p>
                <pre className="p-2 rounded-md bg-[var(--color-code-bg)] text-[var(--color-code-text)] text-[11px] font-code overflow-x-auto whitespace-pre-wrap">
                  {truncate(sqlText, 600)}
                </pre>
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="danger"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
            aria-label={`Confirm kill session #${sessionId}`}
          >
            KILL Session #{sessionId}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
