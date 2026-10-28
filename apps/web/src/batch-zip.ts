/**
 * Private, browser-only importer for a small ZIP of creator-owned media.
 * ZIP content is treated as untrusted. Nothing is sent to a server until
 * the user explicitly selects "Import ZIP as drafts".
 */
export type BatchAsset = { file: File; title: string; caption: string };
type ArchiveEntry = {
  path: string;
  base: string;
  offset: number;
  compressed: number;
  size: number;
  method: number;
};
const MB = 1024 * 1024;
const MAX_ARCHIVE = 160 * MB;
const MAX_TOTAL = 120 * MB;
const MAX_MEDIA = 25 * MB;
const MAX_META = 1024 * 1024;
const MAX_FILES = 20;
const MIME: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const extension = (name: string) => name.split(".").pop()?.toLowerCase() || "";
const stem = (name: string) => name.replace(/\.[^.]+$/, "").toLowerCase();
const safeText = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const read32 = (view: DataView, i: number) => view.getUint32(i, true);
const read16 = (view: DataView, i: number) => view.getUint16(i, true);

function indexArchive(bytes: Uint8Array): ArchiveEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory sits in the final 65,557 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (read32(view, i) === 0x06054b50 && i + 22 + read16(view, i + 20) === bytes.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("This is not a supported ZIP archive.");
  if (read16(view, end + 4) || read16(view, end + 6))
    throw new Error("Multi-disk ZIP archives are not supported.");
  const count = read16(view, end + 10);
  const start = read32(view, end + 16);
  const centralSize = read32(view, end + 12);
  if (count > 200 || count === 0xffff || start === 0xffffffff ||
      centralSize === 0xffffffff || start + centralSize > end)
    throw new Error("ZIP has too many entries or uses an unsupported format.");
  const entries: ArchiveEntry[] = [];
  let cursor = start;
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || read32(view, cursor) !== 0x02014b50)
      throw new Error("ZIP directory is damaged.");
    const flags = read16(view, cursor + 8), method = read16(view, cursor + 10);
    const compressed = read32(view, cursor + 20), size = read32(view, cursor + 24);
    const nameLen = read16(view, cursor + 28), extra = read16(view, cursor + 30);
    const comment = read16(view, cursor + 32), offset = read32(view, cursor + 42);
    const next = cursor + 46 + nameLen + extra + comment;
    if (next > end || compressed === 0xffffffff || size === 0xffffffff ||
        offset === 0xffffffff || (flags & 1) || ![0, 8].includes(method))
      throw new Error("ZIP contains encrypted or unsupported entries.");
    const path = textDecoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLen))
      .replaceAll("\\", "/");
    cursor = next;
    if (path.endsWith("/")) continue;
    if (!path || path.startsWith("/") || path.split("/").some(x => !x || x === ".." || x === "."))
      throw new Error("Unsafe file path inside ZIP.");
    const base = path.split("/").pop()!;
    const key = base.toLowerCase();
    if (used.has(key))
      throw new Error("ZIP contains duplicate filenames: " + base);
    used.add(key);
    const limit = MIME[extension(base)] ? MAX_MEDIA : MAX_META;
    if (size > limit)
      throw new Error(base + " exceeds the import size limit.");
    if (offset + 30 > bytes.length || read32(view, offset) !== 0x04034b50)
      throw new Error("ZIP contains a broken file header.");
    const dataOffset = offset + 30 + read16(view, offset + 26) + read16(view, offset + 28);
    if (dataOffset + compressed > start || (method === 0 && compressed !== size))
      throw new Error("ZIP has inconsistent entry lengths.");
    entries.push({ path, base, offset: dataOffset, compressed, size, method });
  }
  if (cursor !== start + centralSize) throw new Error("ZIP directory length is invalid.");
  return entries;
}
async function extract(bytes: Uint8Array, entry: ArchiveEntry): Promise<Uint8Array> {
  const chunk = bytes.slice(entry.offset, entry.offset + entry.compressed);
  if (entry.method === 0) return chunk;
  const stream = new Blob([chunk]).stream()
    .pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > entry.size) {
        await reader.cancel();
        throw new Error("ZIP entry expanded beyond its declared size.");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length !== entry.size) throw new Error("ZIP entry size is inconsistent.");
  const out = new Uint8Array(length);
  let pos = 0;
  for (const part of parts) { out.set(part, pos); pos += part.length; }
  return out;
}
function rowsFromJSON(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(x => x && typeof x === "object" && !Array.isArray(x));
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.posts)) return rowsFromJSON(object.posts);
  if (Array.isArray(object.videos)) return rowsFromJSON(object.videos);
  if (Array.isArray(object.items)) return rowsFromJSON(object.items);
  return Object.entries(object).filter(([,v]) => v && typeof v === "object" && !Array.isArray(v))
    .map(([file, fields]) => ({ file, ...(fields as Record<string, unknown>) }));
}
function parseCSV(source: string): Record<string, unknown>[] {
  // RFC-style quoting, including commas and linebreaks within quoted fields.
  const rows: string[][] = [];
  let cells: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { cells.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      cells.push(cell); cell = "";
      if (cells.some(x => x.trim())) rows.push(cells);
      cells = [];
    } else cell += ch;
  }
  if (quoted) throw new Error("Unclosed quote in ZIP metadata CSV.");
  cells.push(cell);
  if (cells.some(x => x.trim())) rows.push(cells);
  const [headers, ...data] = rows;
  return headers ? data.map(row => Object.fromEntries(headers.map((h,i) => [h.trim().toLowerCase(), row[i] || ""]))) : [];
}
/** Accepts metadata.json, manifest.json, captions.csv or matching video-name.txt files. */
export async function parseBatchArchive(file: File): Promise<BatchAsset[]> {
  if (file.size > MAX_ARCHIVE) throw new Error("ZIP must be smaller than 160 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = indexArchive(bytes);
  const media = entries.filter(x => !!MIME[extension(x.base)]);
  if (!media.length) throw new Error("ZIP has no supported videos or images.");
  if (media.length > MAX_FILES) throw new Error("Import up to 20 media files per ZIP.");
  if (media.reduce((v,x) => v + x.size, 0) > MAX_TOTAL)
    throw new Error("ZIP media exceeds the 120 MB batch limit. Split it into smaller packs.");
  const metadata = entries.find(e =>
    ["metadata.json", "manifest.json", "captions.json", "metadata.csv", "captions.csv"].includes(e.base.toLowerCase()));
  let rows: Record<string, unknown>[] = [];
  if (metadata) {
    const data = textDecoder.decode(await extract(bytes, metadata));
    try {
      rows = extension(metadata.base) === "csv" ? parseCSV(data) : rowsFromJSON(JSON.parse(data));
    } catch {
      throw new Error("The ZIP metadata file is not valid JSON or CSV.");
    }
  }
  const byName = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const name = safeText(row.file ?? row.filename ?? row.video ?? row.media ?? row.name, 256);
    if (name) byName.set(name.split(/[\\/]/).pop()!.toLowerCase(), row);
  }
  const result: BatchAsset[] = [];
  for (const entry of media) {
    const row = byName.get(entry.base.toLowerCase()) || byName.get(stem(entry.base)) || {};
    const sidecar = entries.find(e => e.base.toLowerCase() === stem(entry.base) + ".txt");
    let caption = safeText(row.caption ?? row.description ?? row.text ?? row.post, 10000);
    if (!caption && sidecar) caption = textDecoder.decode(await extract(bytes, sidecar)).trim().slice(0, 10000);
    const tags = Array.isArray(row.hashtags)
      ? row.hashtags.map(x => safeText(x, 80)).filter(Boolean).join(" ")
      : safeText(row.hashtags ?? row.tags, 2000);
    const withTags = [caption, tags].filter(Boolean).join("\n\n").slice(0,10000);
    const payload = await extract(bytes, entry);
    result.push({
      file: new File([payload], entry.base, { type: MIME[extension(entry.base)] }),
      title: safeText(row.title ?? row.headline, 120) || entry.base.replace(/\.[^.]+$/, ""),
      caption: withTags,
    });
  }
  return result;
}
