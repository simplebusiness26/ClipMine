export type ProjectStatus =
  | "uploading"
  | "uploaded"
  | "processing"
  | "ready"
  | "failed"
  | "deleting";

export type RenderStatus = "idle" | "queued" | "rendering" | "ready" | "failed";

export interface TranscriptSegment {
  start_seconds: number;
  end_seconds: number;
  text: string;
  confidence?: number | null;
}

export interface ClipCandidate {
  id: string;
  start_seconds: number;
  end_seconds: number;
  title: string;
  score: number;
  confidence: "high" | "medium" | "experimental";
  reasons: string[];
  caption_text: string;
  render_status: RenderStatus;
  export_url?: string | null;
  render_error?: string | null;
}

export interface Project {
  id: string;
  title: string;
  source_filename: string;
  source_url: string;
  status: ProjectStatus;
  stage: string;
  progress: number;
  desired_clips: number;
  min_clip_seconds: number;
  max_clip_seconds: number;
  language: string;
  rights_confirmed: boolean;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  analysis_mode?: string | null;
  transcript_segments: TranscriptSegment[];
  candidates: ClipCandidate[];
  error_code?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicConfig {
  persistence: "json" | "postgres";
  database_connected: boolean;
  max_upload_mb: number;
  max_source_minutes: number;
  transcription_provider: string;
  render_size: [number, number];
  authentication: string;
}

export interface CandidateUpdate {
  title?: string;
  start_seconds?: number;
  end_seconds?: number;
  caption_text?: string;
}

export interface UploadOptions {
  file: File;
  title: string;
  desiredClips: number;
  minSeconds: number;
  maxSeconds: number;
  language: string;
  rightsConfirmed: boolean;
}

