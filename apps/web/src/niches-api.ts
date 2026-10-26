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
}
export interface Provider {
  id: string;
  name: string;
  status: string;
  reason: string;
}
export interface Post {
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
export async function uploadMedia(niche: string, file: File) {
  const response = await fetch(`/api/niches/${niche}/media`, {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "X-Filename": file.name.replace(/[^\x20-\x7E]/g, "_"),
    },
    body: file,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail);
  return data as { id: string };
}
