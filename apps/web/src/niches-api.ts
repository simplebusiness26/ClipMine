export interface Niche {
  id: string;
  name: string;
  description: string;
  colour: string;
  initials: string;
  brand_json: string;
  media_count?: number;
  draft_count?: number;
  scheduled_count?: number;
  account_count?: number;
  connected_count?: number;
  accounts_json?: string;
}
export interface Media {
  id: string;
  filename: string;
  mime: string;
  size: number;
  created_at: string;
}
export interface SocialAccount {
  id: string;
  platform: string;
  display_name: string;
  status: string;
  provider_id?: string;
  connection_kind?: string;
}
export interface Provider {
  oauth_ready?: boolean;
  publishing_enabled?: boolean;
  callback?: string | null;
  id: string;
  name: string;
  status: string;
  reason: string;
}
export interface Post {
  publish_mode?: string;
  id: string;
  media_id: string | null;
  title: string;
  caption: string;
  destinations: string[];
  overrides: Record<string, { caption?: string; title?: string }>;
  status: string;
  scheduled_at: string | null;
  updated_at: string;
}
export interface Activity {
  action: string;
  resource_id: string | null;
  created_at: string;
}
export interface Idea {
  id: string;
  text: string;
  status: string;
}
export interface Revenue {
  id: string;
  amount_pence: number;
  category: string;
  note: string;
  earned_at: string;
}
export interface Notice {
  id: string;
  message: string;
  read_at: string | null;
  created_at: string;
}
export async function call<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.detail || `Request failed (${response.status})`);
  return payload as T;
}
export const mediaPath = (niche: string, media: string, download = false) =>
  `/api/niches/${niche}/media/${media}${download ? "?download=1" : ""}`;
async function fileMetadata(file: File): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file),
      element = file.type.startsWith("video/")
        ? document.createElement("video")
        : new Image();
    const finish = () => {
      const v = element as HTMLVideoElement;
      const i = element as HTMLImageElement;
      const result: Record<string, string> = {};
      if (v.videoWidth || i.naturalWidth)
        result["X-Media-Width"] = String(v.videoWidth || i.naturalWidth);
      if (v.videoHeight || i.naturalHeight)
        result["X-Media-Height"] = String(v.videoHeight || i.naturalHeight);
      if (Number.isFinite(v.duration) && v.duration > 0)
        result["X-Duration-Seconds"] = String(v.duration);
      URL.revokeObjectURL(url);
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(finish, 8000);
    element.onerror = finish;
    if (element instanceof HTMLVideoElement) {
      element.onloadedmetadata = finish;
      element.preload = "metadata";
    } else element.onload = finish;
    element.src = url;
  });
}
export async function uploadMedia(
  niche: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ id: string }> {
  const metadata = await fileMetadata(file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/niches/${niche}/media`);
    xhr.responseType = "json";
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream",
    );
    xhr.setRequestHeader("X-Filename", file.name.replace(/[^\x20-\x7E]/g, "_"));
    for (const [k, v] of Object.entries(metadata)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () =>
      reject(
        new Error("Upload interrupted. Check your connection and try again."),
      );
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else
        reject(
          new Error(xhr.response?.detail || `Upload failed (${xhr.status})`),
        );
    };
    xhr.send(file);
  });
}
