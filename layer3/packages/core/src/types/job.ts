export type JobStatus = "pending" | "running" | "completed" | "failed" | "timeout";

export interface JobExecution {
  job_name: string;
  status: JobStatus;
  started_at: string;
  completed_at?: string;
  total_duration_ms?: number;
  findings_created?: number;
}
