import { Suspense, lazy } from "react";
import { Toaster } from "sonner";
import { Topbar } from "@/components/layout/Topbar";
import { Skeleton } from "@/components/ui/skeleton";

const DashboardPage  = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const InsightsPage   = lazy(() => import("@/pages/InsightsPage").then((m) => ({ default: m.InsightsPage })));
const QueryPlanPage  = lazy(() => import("@/pages/QueryPlanPage").then((m) => ({ default: m.QueryPlanPage })));

function PageFallback() {
  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-3 space-y-3">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
    </div>
  );
}

function resolveRoute(): "dashboard" | "insights" | "query-plan" {
  const p = window.location.pathname;
  if (p.startsWith("/insights"))  return "insights";
  if (p.startsWith("/query-plan") || p.startsWith("/extract-query-plan")) return "query-plan";
  return "dashboard";
}

export default function App() {
  const route = resolveRoute();

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-[var(--color-bg)]">
      <Topbar />
      <main className="flex-1 overflow-hidden" id="main-content">
        <Suspense fallback={<PageFallback />}>
          {route === "dashboard"  && <DashboardPage />}
          {route === "insights"   && <InsightsPage />}
          {route === "query-plan" && <QueryPlanPage />}
        </Suspense>
      </main>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border-2)",
            color: "var(--color-text)",
          },
        }}
      />
    </div>
  );
}
