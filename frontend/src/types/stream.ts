export interface PlaybackUrls {
  whep_url: string;
  hls_url: string;
  rtsp_url: string;
}

export interface StreamSummary {
  stream_id: string;
  status: string;
  pid: number | null;
  restart_count: number;
  source_url: string;
  playback_urls?: PlaybackUrls;
}
