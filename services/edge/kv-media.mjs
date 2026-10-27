// Free-tier beta storage adapter. KV is intentionally bounded and eventually consistent.
// Unlike public CDN objects, every read flows through Niches authentication or
// a time-limited, unguessable provider grant. R2 remains preferred when available.
const MAX_VALUE = 25 * 1024 * 1024;
const prefix = "niches-media:";

function requestedRange(input, size) {
  const range = input?.range;
  if (!range) return null;
  let start, end;
  if (typeof range.get === "function" || typeof range === "string") {
    const value = typeof range === "string" ? range : range.get("range");
    if (!value) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!match || (!match[1] && !match[2])) throw new RangeError("Invalid byte range");
    if (!match[1]) {
      const last = Number(match[2]);
      if (!Number.isSafeInteger(last) || !last) throw new RangeError("Invalid byte range");
      start = Math.max(0, size - last);
      end = size;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) + 1 : size;
    }
  } else if (Number.isSafeInteger(range.suffix)) {
    start = Math.max(0, size - range.suffix);
    end = size;
  } else {
    start = range.offset ?? 0;
    end = range.length === undefined ? size : start + range.length;
  }
  if (![start, end].every(Number.isSafeInteger) || start < 0 || start >= size ||
      end <= start || end > size) throw new RangeError("Invalid byte range");
  return { offset: start, length: end - start };
}

export function kvMediaBucket(kv) {
  if (!kv?.put || !kv?.getWithMetadata || !kv?.delete)
    throw new TypeError("Missing Workers KV media binding");
  return {
    async put(key, data, options = {}) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      if (!bytes.byteLength || bytes.byteLength > MAX_VALUE)
        throw new RangeError("Workers KV supports media from 1 byte through 25 MiB");
      const value = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await kv.put(prefix + key, value, {
        metadata: { contentType: options.httpMetadata?.contentType || "application/octet-stream" },
      });
    },
    async get(key, options = {}) {
      const item = await kv.getWithMetadata(prefix + key, "arrayBuffer");
      if (!item?.value) return null;
      const bytes = new Uint8Array(item.value);
      const range = requestedRange(options, bytes.byteLength);
      const chosen = range ? bytes.subarray(range.offset, range.offset + range.length) : bytes;
      return {
        size: bytes.byteLength,
        range,
        httpMetadata: { contentType: item.metadata?.contentType || "application/octet-stream" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(chosen);
            controller.close();
          },
        }),
        arrayBuffer: async () => chosen.slice().buffer,
      };
    },
    async delete(key) { await kv.delete(prefix + key); },
  };
}

export function withMedia(env) {
  if (env.MEDIA || !env.MEDIA_KV) return env;
  return { ...env, MEDIA: kvMediaBucket(env.MEDIA_KV), MEDIA_BACKEND: "kv" };
}
