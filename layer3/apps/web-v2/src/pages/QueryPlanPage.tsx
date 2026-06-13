import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, Zap, FileSearch, Code2 } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { QpDiagram } from "@/components/plan/QpDiagram";
import { PlanAnalysisPanel } from "@/components/plan/PlanAnalysisPanel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/ErrorState";
import { apiPost } from "@/lib/api-client";
import type { PlanAnalysisResult } from "@layer3/core";

export function QueryPlanPage() {
  const [xml, setXml]           = useState("");
  const [diagramError, setDiagramError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("diagram");
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const analysisMutation = useMutation({
    mutationFn: (planXml: string) =>
      apiPost<PlanAnalysisResult>("/api/plan/analyze", { plan_xml: planXml }),
    onSuccess: () => setActiveTab("analysis"),
    onError: (err) => {
      toast.error("Plan analysis failed", {
        description: err instanceof Error ? err.message : "Check that Layer 2 is running",
      });
    },
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? "");
      setXml(text);
      setDiagramError(null);
      setActiveTab("diagram");
    };
    reader.onerror = () => toast.error("Cannot read file");
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  }

  function handleXmlChange(value: string) {
    setXml(value);
    setDiagramError(null);
    // Auto-switch to diagram tab when XML is pasted
    if (value.trim()) setActiveTab("diagram");
  }

  function handleClear() {
    setXml("");
    setDiagramError(null);
    analysisMutation.reset();
    setActiveTab("diagram");
    if (textareaRef.current) textareaRef.current.value = "";
  }

  const hasXml = !!xml.trim();

  return (
    <PageShell className="flex flex-col gap-3 h-[calc(100vh-56px)]">
      {/* ── Input toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="w-3.5 h-3.5" /> Upload .sqlplan
        </Button>
        <input ref={fileRef} type="file" accept=".xml,.sqlplan" className="hidden" onChange={handleFile} />

        <Button
          variant="primary" size="sm"
          disabled={!hasXml || analysisMutation.isPending}
          loading={analysisMutation.isPending}
          onClick={() => analysisMutation.mutate(xml)}
        >
          <Zap className="w-3.5 h-3.5" />
          {analysisMutation.isPending ? "Analyzing…" : "AI Analysis"}
        </Button>

        {hasXml && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            Clear
          </Button>
        )}

        {hasXml && (
          <span className="text-[11px] text-[var(--color-muted)] font-code ml-auto">
            {xml.length.toLocaleString()} chars
          </span>
        )}
      </div>

      {/* ── XML Paste area ── */}
      <div
        className="rounded-lg border border-[var(--color-border-2)] bg-[var(--color-surface-2)] shrink-0"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => { handleXmlChange(String(ev.target?.result ?? "")); };
          reader.readAsText(file, "UTF-8");
        }}
      >
        <textarea
          ref={textareaRef}
          value={xml}
          onChange={(e) => handleXmlChange(e.target.value)}
          placeholder="Paste ShowPlan XML here, or drop a .sqlplan file…"
          className="w-full h-28 resize-none p-3 bg-transparent font-code text-[11px] text-[var(--color-text)] placeholder-[var(--color-subtle)] focus:outline-none"
          aria-label="Execution plan XML input"
          spellCheck={false}
        />
      </div>

      {/* ── Main content area — Tabs ── */}
      <div className="flex-1 min-h-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
          <TabsList className="px-4 shrink-0 border-b border-[var(--color-border)]">
            <TabsTrigger value="diagram">
              Diagram
            </TabsTrigger>
            <TabsTrigger value="analysis" disabled={!analysisMutation.data && !analysisMutation.isPending}>
              <Zap className="w-3 h-3" /> AI Analysis
              {analysisMutation.data && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
              )}
            </TabsTrigger>
            <TabsTrigger value="xml" disabled={!hasXml}>
              <Code2 className="w-3 h-3" /> XML
            </TabsTrigger>
          </TabsList>

          {/* ── Diagram tab — QP.showPlan ── */}
          <TabsContent value="diagram" className="flex-1 overflow-y-auto p-4 mt-0">
            {!hasXml ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-8">
                <FileSearch className="w-12 h-12 text-[var(--color-muted)] opacity-40" />
                <p className="text-[14px] font-medium text-[var(--color-muted)]">
                  Paste or upload a SQL execution plan to visualize
                </p>
                <p className="text-[12px] text-[var(--color-subtle)]">
                  In SSMS: Right-click → Include Actual Execution Plan → save as .sqlplan
                </p>
              </div>
            ) : diagramError ? (
              <ErrorState
                message="Cannot render diagram"
                description={diagramError}
                onRetry={() => setDiagramError(null)}
              />
            ) : (
              <QpDiagram xml={xml} onError={setDiagramError} />
            )}
          </TabsContent>

          {/* ── AI Analysis tab ── */}
          <TabsContent value="analysis" className="flex-1 overflow-auto p-4 mt-0">
            {analysisMutation.isPending && (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
              </div>
            )}
            {analysisMutation.isError && !analysisMutation.isPending && (
              <ErrorState
                message="Analysis failed"
                description={analysisMutation.error instanceof Error ? analysisMutation.error.message : "Unknown error"}
                onRetry={() => analysisMutation.mutate(xml)}
              />
            )}
            {analysisMutation.data && !analysisMutation.isPending && (
              <PlanAnalysisPanel result={analysisMutation.data} />
            )}
            {!analysisMutation.data && !analysisMutation.isPending && !analysisMutation.isError && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
                <Zap className="w-10 h-10 text-[var(--color-muted)] opacity-40" />
                <p className="text-[13px] text-[var(--color-muted)]">
                  Click <strong>AI Analysis</strong> to send the plan to Layer 2 for analysis
                </p>
              </div>
            )}
          </TabsContent>

          {/* ── XML tab — raw formatted XML ── */}
          <TabsContent value="xml" className="flex-1 overflow-auto p-4 mt-0">
            {hasXml ? (
              <div className="relative">
                <Button
                  variant="secondary" size="sm"
                  className="absolute top-2 right-2 z-10"
                  onClick={() => navigator.clipboard.writeText(xml).then(() => toast.success("Copied to clipboard"))}
                >
                  Copy XML
                </Button>
                <pre className="p-3 rounded-lg bg-[var(--color-code-bg)] text-[var(--color-code-text)] text-[11px] font-code whitespace-pre-wrap">
                  {xml}
                </pre>
              </div>
            ) : (
              <p className="text-[var(--color-muted)]">No XML loaded.</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
