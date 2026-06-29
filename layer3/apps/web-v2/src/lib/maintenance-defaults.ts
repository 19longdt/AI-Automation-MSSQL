export const THRESHOLD_DEFAULTS = {
  index: {
    reorganize_pct: 10,
    rebuild_pct: 30,
    min_page_count: 1000,
    max_page_count: null as number | null,
  },
  statistic: {
    modification_threshold: 20000,
    stats_min_sample_pct: 5,
  },
  heap: {
    forwarded_threshold: 1000,
  },
} as const;
