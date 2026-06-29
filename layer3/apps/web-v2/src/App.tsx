import { Suspense, lazy, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { Topbar } from "@/components/layout/Topbar";
import { Skeleton } from "@/components/ui/skeleton";

const DashboardPage  = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const InsightsPage   = lazy(() => import("@/pages/InsightsPage").then((m) => ({ default: m.InsightsPage })));
const QueryPlanPage  = lazy(() => import("@/pages/QueryPlanPage").then((m) => ({ default: m.QueryPlanPage })));
const MaintenanceCampaignPage = lazy(() => import("@/pages/MaintenanceCampaignPage").then((m) => ({ default: m.MaintenanceCampaignPage })));
const MaintenanceCatalogPage = lazy(() => import("@/pages/MaintenanceCatalogPage").then((m) => ({ default: m.MaintenanceCatalogPage })));
const SettingsPage   = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

function PageFallback() {
  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-3 space-y-3">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
    </div>
  );
}

function resolveRoute(): "dashboard" | "insights" | "query-plan" | "maintenance-campaign" | "maintenance-catalog" | "settings" {
  const p = window.location.pathname;
  if (p.startsWith("/insights"))  return "insights";
  if (p.startsWith("/maintenance/catalog")) return "maintenance-catalog";
  if (p.startsWith("/maintenance")) return "maintenance-campaign";
  if (p.startsWith("/settings")) return "settings";
  if (p.startsWith("/query-plan") || p.startsWith("/extract-query-plan")) return "query-plan";
  return "dashboard";
}

export default function App() {
  const [route, setRoute] = useState(resolveRoute);

  useEffect(() => {
    const handleRouteChange = () => setRoute(resolveRoute());
    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("pushstate", handleRouteChange);
    return () => {
      window.removeEventListener("popstate", handleRouteChange);
      window.removeEventListener("pushstate", handleRouteChange);
    };
  }, []);

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-[var(--color-bg)]">
      <Topbar />
      <main className="flex-1 overflow-hidden" id="main-content">
        <Suspense fallback={<PageFallback />}>
          {route === "dashboard"  && <DashboardPage />}
          {route === "insights"   && <InsightsPage />}
          {route === "query-plan" && <QueryPlanPage />}
          {route === "maintenance-campaign" && <MaintenanceCampaignPage />}
          {route === "maintenance-catalog" && <MaintenanceCatalogPage />}
          {route === "settings"   && <SettingsPage />}
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
