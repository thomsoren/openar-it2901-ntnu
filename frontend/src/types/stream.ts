export interface StreamSummary {
  stream_id: string;
  status: string;
  pid: number | null;
  restart_count: number;
  source_url: string;
}
