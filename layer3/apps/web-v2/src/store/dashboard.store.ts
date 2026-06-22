import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TimeRangeState } from "@/lib/time-range";
import type { AutoRefreshConfig, FindingFilters } from "@/types";

const DEFAULT_TIME_RANGE: TimeRangeState = { mode: "preset", presetId: "last_1_hour" };
const DEFAULT_AUTO_REFRESH: AutoRefreshConfig = { enabled: false, intervalMs: 60_000 };

interface DashboardState {
  selectedClusterId: string | null;
  setSelectedClusterId: (id: string | null) => void;

  activeTopicId: string;
  setActiveTopicId: (id: string) => void;

  timeRange: TimeRangeState;
  setTimeRange: (range: TimeRangeState) => void;

  filters: FindingFilters;
  setFilters: (filters: FindingFilters) => void;
  comparePastEnabled: boolean;
  setComparePastEnabled: (enabled: boolean) => void;

  page: number;
  setPage: (p: number) => void;

  autoRefresh: AutoRefreshConfig;
  setAutoRefresh: (cfg: AutoRefreshConfig) => void;
  timeAnchorMs: number;
  refreshNow: () => void;

  theme: "light" | "dark";
  toggleTheme: () => void;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      selectedClusterId: null,
      setSelectedClusterId: (selectedClusterId) =>
        set((state) => ({
          selectedClusterId,
          page: 0,
          // replica options are cluster-specific — reset to avoid stale client-side filter
          filters: { ...state.filters, replica: undefined },
        })),

      activeTopicId: "",
      setActiveTopicId: (id) =>
        set((state) => {
          if (state.activeTopicId === id) {
            return { activeTopicId: id, page: 0 };
          }

          return {
            activeTopicId: id,
            filters: {},
            page: 0,
          };
        }),

      timeRange: DEFAULT_TIME_RANGE,
      setTimeRange: (timeRange) => set({ timeRange, page: 0 }),

      filters: {},
      setFilters: (filters) => set({ filters, page: 0 }),
      comparePastEnabled: false,
      setComparePastEnabled: (comparePastEnabled) => set({ comparePastEnabled }),

      page: 0,
      setPage: (page) => set({ page }),

      autoRefresh: DEFAULT_AUTO_REFRESH,
      setAutoRefresh: (autoRefresh) => set({ autoRefresh }),
      timeAnchorMs: Date.now(),
      refreshNow: () => set({ timeAnchorMs: Date.now() }),

      theme: (document.documentElement.getAttribute("data-theme") as "light" | "dark") ?? "light",
      toggleTheme: () => {
        const next = get().theme === "light" ? "dark" : "light";
        set({ theme: next });
        document.documentElement.setAttribute("data-theme", next);
        try { localStorage.setItem("theme", next); } catch (_) {}
      },
    }),
    {
      name: "dashboard-v3",
      partialize: (s) => ({
        activeTopicId: s.activeTopicId,
        selectedClusterId: s.selectedClusterId,
        timeRange: s.timeRange,
        comparePastEnabled: s.comparePastEnabled,
        autoRefresh: s.autoRefresh,
        theme: s.theme,
      }),
    },
  ),
);
