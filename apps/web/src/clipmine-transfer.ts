export const CLIPMINE_MAX_BYTES = 25 * 1024 * 1024;
export interface ClipMineTransfer { name: string; title: string; bytes: ArrayBuffer }
export function colabOrigin(origin: string): boolean {
  return origin === "https://colab.research.google.com" ||
    /^https:\/\/[a-z0-9-]+-colab\.googleusercontent\.com$/.test(origin);
}
export function receiveClipMineExport(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  opener: MessageEventSource | null,
): ClipMineTransfer | null {
  if (!opener || event.source !== opener || !colabOrigin(event.origin)) return null;
  const data = event.data;
  if (!data || data.type !== "clipmine-export-v1" ||
      !(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength < 12 ||
      data.bytes.byteLength > CLIPMINE_MAX_BYTES || typeof data.name !== "string" ||
      !data.name.toLowerCase().endsWith(".mp4")) return null;
  // Require an MP4 ftyp box. Server-side media validation remains authoritative.
  if (new TextDecoder().decode(new Uint8Array(data.bytes, 4, 4)) !== "ftyp") return null;
  return {
    name: data.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120),
    title: typeof data.title === "string" ? data.title.slice(0, 120) : "ClipMine export",
    bytes: data.bytes,
  };
}
