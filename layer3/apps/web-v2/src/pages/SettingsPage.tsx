import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useClusters } from "@/hooks/useClusters";
import { apiDelete, apiPost, apiPut } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ClusterNodeRole, ClusterResponse } from "@/types";

function NodeRoleBadge({ role }: { role: ClusterNodeRole["role"] }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        role === "primary"
          ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
          : "bg-[var(--color-surface-3)] text-[var(--color-muted)]",
      )}
    >
      {role}
    </span>
  );
}

interface ClusterFormState {
  cluster_id: string;
  name: string;
  environment: ClusterResponse["environment"];
  nodes: string;
  port: string;
  database: string;
  username: string;
  password: string;
  connect_timeout_sec: string;
  enabled: boolean;
  color: string;
}

const ENV_ORDER = ["production", "uat", "dev", "staging", "other"] as const;

const EMPTY_FORM: ClusterFormState = {
  cluster_id: "",
  name: "",
  environment: "other",
  nodes: "",
  port: "1433",
  database: "",
  username: "",
  password: "",
  connect_timeout_sec: "30",
  enabled: true,
  color: "#6b7280",
};

function envLabel(environment: ClusterResponse["environment"]) {
  switch (environment) {
    case "production":
      return "Production";
    case "uat":
      return "UAT";
    case "dev":
      return "Dev";
    case "staging":
      return "Staging";
    default:
      return "Other";
  }
}

function envBadgeClass(environment: ClusterResponse["environment"]) {
  switch (environment) {
    case "production":
      return "bg-[var(--color-critical-soft)] text-[var(--color-critical)]";
    case "uat":
      return "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
    case "dev":
      return "bg-[var(--color-success-soft)] text-[var(--color-success)]";
    case "staging":
      return "bg-[var(--color-info-soft)] text-[var(--color-info)]";
    default:
      return "bg-[var(--color-surface-3)] text-[var(--color-text-2)]";
  }
}

function toCreatePayload(form: ClusterFormState) {
  return {
    cluster_id: form.cluster_id.trim(),
    name: form.name.trim(),
    environment: form.environment,
    nodes: form.nodes.split(",").map((item) => item.trim()).filter(Boolean),
    port: Number(form.port || "1433"),
    database: form.database.trim(),
    username: form.username.trim(),
    password: form.password,
    connect_timeout_sec: Number(form.connect_timeout_sec || "30"),
    enabled: form.enabled,
    color: form.color.trim() || "#6b7280",
  };
}

function toUpdatePayload(form: ClusterFormState) {
  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    environment: form.environment,
    nodes: form.nodes.split(",").map((item) => item.trim()).filter(Boolean),
    port: Number(form.port || "1433"),
    database: form.database.trim(),
    username: form.username.trim(),
    connect_timeout_sec: Number(form.connect_timeout_sec || "30"),
    enabled: form.enabled,
    color: form.color.trim() || "#6b7280",
  };
  if (form.password.trim()) payload.password = form.password;
  return payload;
}

function ClusterTableSection({
  environment,
  items,
  onEdit,
  onAskDelete,
  deletingId,
  refreshingId,
  onRefreshRoles,
}: {
  environment: ClusterResponse["environment"];
  items: ClusterResponse[];
  onEdit: (cluster: ClusterResponse) => void;
  onAskDelete: (cluster: ClusterResponse) => void;
  deletingId: string | null;
  refreshingId: string | null;
  onRefreshRoles: (cluster: ClusterResponse) => void;
}) {
  if (!items.length) return null;

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-[14px] font-semibold text-[var(--color-text)]">{envLabel(environment)}</h2>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", envBadgeClass(environment))}>
            {items.length} cluster{items.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-[13px]">
          <thead className="bg-[var(--color-surface-2)] text-[var(--color-muted)]">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Nodes</th>
              <th className="px-4 py-3">Database</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((cluster) => (
              <tr key={cluster.cluster_id} className="border-t border-[var(--color-border)]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: cluster.color }}
                      aria-hidden="true"
                    />
                    <div>
                      <div className="font-medium text-[var(--color-text)]">{cluster.name}</div>
                      <div className="text-[12px] text-[var(--color-muted)]">{cluster.cluster_id}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    {cluster.nodes.map((node) => {
                      const roleEntry = cluster.node_roles.find((r) => r.host === node);
                      return (
                        <div key={node} className="flex items-center gap-1.5 text-[var(--color-text-2)]">
                          <span className="font-mono text-[12px]">{node}</span>
                          {roleEntry ? (
                            <NodeRoleBadge role={roleEntry.role} />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </td>
                <td className="px-4 py-3 text-[var(--color-text-2)]">{cluster.database}</td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      cluster.enabled
                        ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                        : "bg-[var(--color-surface-3)] text-[var(--color-muted)]"
                    )}
                  >
                    {cluster.enabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => onEdit(cluster)}>Edit</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={refreshingId === cluster.cluster_id}
                      onClick={() => onRefreshRoles(cluster)}
                      title="Force re-detect Primary/Secondary roles now"
                    >
                      Refresh Roles
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={deletingId === cluster.cluster_id}
                      onClick={() => onAskDelete(cluster)}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: clusters, isLoading, error } = useClusters();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ClusterResponse | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClusterResponse | null>(null);
  const [form, setForm] = useState<ClusterFormState>(EMPTY_FORM);
  const [testResult, setTestResult] = useState<string>("");

  useEffect(() => {
    if (!isEditorOpen) {
      setForm(EMPTY_FORM);
      setEditing(null);
      setTestResult("");
    }
  }, [isEditorOpen]);

  const groupedClusters = useMemo(() => {
    const source = clusters ?? [];
    return ENV_ORDER.map((environment) => ({
      environment,
      items: source.filter((cluster) => cluster.environment === environment),
    })).filter((group) => group.items.length > 0);
  }, [clusters]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["clusters"] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof toCreatePayload>) => apiPost<ClusterResponse>("/api/clusters", payload),
    onSuccess: async () => {
      toast.success("Cluster created");
      await invalidate();
      setIsEditorOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Create failed"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReturnType<typeof toUpdatePayload> }) =>
      apiPut<ClusterResponse>(`/api/clusters/${encodeURIComponent(id)}`, payload),
    onSuccess: async () => {
      toast.success("Cluster updated");
      await invalidate();
      setIsEditorOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Update failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: boolean }>(`/api/clusters/${encodeURIComponent(id)}`),
    onSuccess: async () => {
      toast.success("Cluster deleted");
      await invalidate();
      setPendingDelete(null);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Delete failed"),
  });

  const refreshRolesMutation = useMutation({
    mutationFn: (id: string) => apiPost<ClusterResponse>(`/api/clusters/${encodeURIComponent(id)}/refresh-roles`, {}),
    onSuccess: async () => {
      toast.success("Node roles refreshed");
      await invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Refresh roles failed"),
  });

  const testMutation = useMutation({
    mutationFn: (payload: { kind: "existing"; id: string } | { kind: "new"; payload: Record<string, unknown> }) => {
      if (payload.kind === "existing") {
        return apiPost<{ ok: boolean; latency_ms?: number; error?: string }>(
          `/api/clusters/${encodeURIComponent(payload.id)}/test`,
          {}
        );
      }
      return apiPost<{ ok: boolean; latency_ms?: number; error?: string }>("/api/clusters/test", payload.payload);
    },
    onSuccess: (data) =>
      setTestResult(data.ok ? `Connected in ${Math.round(data.latency_ms || 0)} ms` : `Failed: ${data.error || "Unknown error"}`),
    onError: (err) => setTestResult(err instanceof Error ? err.message : "Connection test failed"),
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setIsEditorOpen(true);
  }

  function openEdit(cluster: ClusterResponse) {
    setEditing(cluster);
    setForm({
      cluster_id: cluster.cluster_id,
      name: cluster.name,
      environment: cluster.environment,
      nodes: cluster.nodes.join(", "),
      port: String(cluster.port),
      database: cluster.database,
      username: cluster.username,
      password: "",
      connect_timeout_sec: String(cluster.connect_timeout_sec ?? 30),
      enabled: cluster.enabled,
      color: cluster.color,
    });
    setIsEditorOpen(true);
  }

  function submit() {
    if (editing) {
      updateMutation.mutate({ id: editing.cluster_id, payload: toUpdatePayload(form) });
      return;
    }
    createMutation.mutate(toCreatePayload(form));
  }

  function testConnection() {
    setTestResult("");
    if (editing) {
      testMutation.mutate({ kind: "existing", id: editing.cluster_id });
      return;
    }
    testMutation.mutate({ kind: "new", payload: toCreatePayload(form) });
  }

  return (
    <PageShell className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--color-text)]">Cluster Settings</h1>
          <p className="text-[13px] text-[var(--color-muted)]">Manage monitor datasources owned by Layer 1.</p>
        </div>
        <Button variant="primary" onClick={openCreate}>Add Cluster</Button>
      </div>

      {isLoading ? (
        <div className="text-[13px] text-[var(--color-muted)]">Loading clusters...</div>
      ) : error ? (
        <div className="text-[13px] text-[var(--color-critical)]">
          {error instanceof Error ? error.message : "Failed to load clusters"}
        </div>
      ) : !groupedClusters.length ? (
        <div className="rounded-xl border border-dashed border-[var(--color-border-2)] bg-[var(--color-surface)] px-5 py-10 text-center">
          <div className="text-[15px] font-semibold text-[var(--color-text)]">No clusters configured</div>
          <div className="mt-1 text-[13px] text-[var(--color-muted)]">
            Add the first datasource to enable multi-cluster monitoring.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groupedClusters.map((group) => (
            <ClusterTableSection
              key={group.environment}
              environment={group.environment}
              items={group.items}
              onEdit={openEdit}
              onAskDelete={setPendingDelete}
              deletingId={deleteMutation.isPending ? pendingDelete?.cluster_id ?? null : null}
              refreshingId={refreshRolesMutation.isPending ? (refreshRolesMutation.variables ?? null) : null}
              onRefreshRoles={(cluster) => refreshRolesMutation.mutate(cluster.cluster_id)}
            />
          ))}
        </div>
      )}

      <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Cluster" : "Add Cluster"}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-[12px] text-[var(--color-muted)]">Cluster ID</span>
                <input
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                  value={form.cluster_id}
                  disabled={!!editing}
                  onChange={(e) => setForm({ ...form, cluster_id: e.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[12px] text-[var(--color-muted)]">Name</span>
                <input
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[12px] text-[var(--color-muted)]">Environment</span>
                <select
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                  value={form.environment}
                  onChange={(e) => setForm({ ...form, environment: e.target.value as ClusterResponse["environment"] })}
                >
                  <option value="production">production</option>
                  <option value="uat">uat</option>
                  <option value="dev">dev</option>
                  <option value="staging">staging</option>
                  <option value="other">other</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[12px] text-[var(--color-muted)]">Port</span>
                <input
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[12px] text-[var(--color-muted)]">Connect Timeout (sec)</span>
                <input
                  type="number"
                  min={5}
                  max={120}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                  value={form.connect_timeout_sec}
                  onChange={(e) => setForm({ ...form, connect_timeout_sec: e.target.value })}
                />
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-[12px] text-[var(--color-muted)]">Nodes</span>
                <input
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                  value={form.nodes}
                  onChange={(e) => setForm({ ...form, nodes: e.target.value })}
                  placeholder="10.0.0.1, 10.0.0.2"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[12px] text-[var(--color-muted)]">Database</span>
                <input
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                  value={form.database}
                  onChange={(e) => setForm({ ...form, database: e.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[12px] text-[var(--color-muted)]">Username</span>
                <input
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[12px] text-[var(--color-muted)]">Password</span>
                <input
                  type="password"
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editing ? "Leave blank to keep current password" : ""}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[12px] text-[var(--color-muted)]">Color</span>
                <div className="flex items-center gap-2">
                  <span
                    className="h-4 w-4 rounded-full border border-[var(--color-border-2)]"
                    style={{ backgroundColor: form.color }}
                    aria-hidden="true"
                  />
                  <input
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                  />
                </div>
              </label>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled
            </label>
            {testResult ? (
              <div className="rounded-md bg-[var(--color-surface-2)] px-3 py-2 text-[12px] text-[var(--color-muted)]">
                {testResult}
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" loading={testMutation.isPending} onClick={testConnection}>Test Connection</Button>
            <Button variant="secondary" onClick={() => setIsEditorOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={createMutation.isPending || updateMutation.isPending} onClick={submit}>
              {editing ? "Save Changes" : "Create Cluster"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="w-[min(90vw,480px)]">
          <DialogHeader>
            <DialogTitle>Delete Cluster</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <p className="text-[13px] text-[var(--color-text-2)]">
              Delete <span className="font-semibold text-[var(--color-text)]">{pendingDelete?.name}</span> from datasource settings.
            </p>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 text-[12px] text-[var(--color-muted)]">
              Cluster ID: <span className="font-code text-[var(--color-text)]">{pendingDelete?.cluster_id}</span>
            </div>
            <p className="text-[12px] text-[var(--color-critical)]">
              This removes the cluster configuration from Layer 1 management. Existing findings already stored in MongoDB are not deleted.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.cluster_id)}
            >
              Delete Cluster
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
