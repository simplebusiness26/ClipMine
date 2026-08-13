import type {
  CandidateUpdate,
  Project,
  PublicConfig,
  UploadOptions,
} from "./types";

const API_ORIGIN = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string };
    return payload.detail || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function mediaUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return `${API_ORIGIN}${path}`;
}

export const api = {
  config: () => request<PublicConfig>("/api/config"),
  projects: () => request<Project[]>("/api/projects"),
  project: (id: string) => request<Project>(`/api/projects/${id}`),
  retry: (id: string) => request<Project>(`/api/projects/${id}/retry`, { method: "POST" }),
  updateCandidate: (projectId: string, candidateId: string, update: CandidateUpdate) =>
    request<Project>(`/api/projects/${projectId}/candidates/${candidateId}`, {
      method: "PATCH",
      body: JSON.stringify(update),
    }),
  renderCandidate: (projectId: string, candidateId: string) =>
    request<Project>(`/api/projects/${projectId}/candidates/${candidateId}/render`, {
      method: "POST",
    }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
};

export function uploadProject(
  options: UploadOptions,
  onProgress: (percentage: number) => void,
): Promise<Project> {
  const body = new FormData();
  body.append("file", options.file);
  body.append("title", options.title);
  body.append("desired_clips", String(options.desiredClips));
  body.append("min_clip_seconds", String(options.minSeconds));
  body.append("max_clip_seconds", String(options.maxSeconds));
  body.append("language", options.language);
  body.append("rights_confirmed", String(options.rightsConfirmed));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_ORIGIN}/api/projects`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as Project);
        return;
      }
      const detail = (xhr.response as { detail?: string } | null)?.detail;
      reject(new Error(detail || `Upload failed (${xhr.status})`));
    };
    xhr.send(body);
  });
}

