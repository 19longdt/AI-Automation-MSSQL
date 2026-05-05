export interface QueryConfig {
  id: string;
  name?: string;
  sql?: string;
  enabled?: boolean;
}

export interface MonitorTopic {
  topic_id: string;
  name: string;
  description?: string;
  queries?: QueryConfig[];
}
