import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import type { MonitorTopic, TopicThresholdConfig } from "@/types";

export function useTopics() {
  return useQuery({
    queryKey: qk.topics(),
    queryFn: () => apiGet<MonitorTopic[]>("/api/topics"),
    staleTime: 5 * 60_000,
    retry: 2,
  });
}

export function useTopicById(topicId: string): MonitorTopic | null {
  const { data } = useTopics();
  return data?.find((topic) => topic.topic_id === topicId) ?? null;
}

export function useTopicMetricThreshold(
  topicId: string,
  metricKey: string,
  fallback?: TopicThresholdConfig,
): TopicThresholdConfig {
  const topic = useTopicById(topicId);
  return topic?.thresholds?.[metricKey] ?? fallback ?? {};
}
