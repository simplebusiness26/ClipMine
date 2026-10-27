import { test } from "node:test";
import assert from "node:assert/strict";
import { kvMediaBucket, withMedia } from "./kv-media.mjs";

function fakeKV() {
  const rows = new Map();
  return {
    rows,
    async put(key, value, options) {
      rows.set(key, { value: value.slice(0), metadata: options?.metadata });
    },
    async getWithMetadata(key) {
      const row = rows.get(key);
      return row
        ? { value: row.value.slice(0), metadata: row.metadata }
        : { value: null, metadata: null };
    },
    async delete(key) { rows.delete(key); },
  };
}
test("Workers KV fallback is private by key, binary safe and supports video byte ranges", async () => {
  const kv = fakeKV(), bucket = kvMediaBucket(kv);
  const data = Uint8Array.from([0, 1, 2, 127, 255, 9, 6]);
  await bucket.put("alice/niche/media", data, { httpMetadata: { contentType: "video/mp4" } });
  assert.deepEqual([...kv.rows.keys()], ["niches-media:alice/niche/media"]);
  assert.equal(await bucket.get("bob/niche/media"), null);
  const full = await bucket.get("alice/niche/media");
  assert.equal(full.size, data.length);
  assert.equal(full.httpMetadata.contentType, "video/mp4");
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), data);
  const part = await bucket.get("alice/niche/media", { range: new Headers({ range: "bytes=2-4" }) });
  assert.deepEqual(new Uint8Array(await part.arrayBuffer()), Uint8Array.from([2, 127, 255]));
  assert.deepEqual(part.range, { offset: 2, length: 3 });
  assert.deepEqual(new Uint8Array(await (await bucket.get("alice/niche/media", { range: { offset: 3, length: 2 } })).arrayBuffer()), Uint8Array.from([127, 255]));
  assert.deepEqual(new Uint8Array(await (await bucket.get("alice/niche/media", { range: new Headers({ range: "bytes=-2" }) })).arrayBuffer()), Uint8Array.from([9, 6]));
  await assert.rejects(bucket.get("alice/niche/media", { range: new Headers({ range: "bytes=999-" }) }), RangeError);
  await bucket.delete("alice/niche/media");
  assert.equal(await bucket.get("alice/niche/media"), null);
});
test("storage fallback does not replace the R2 binding, and fails closed on oversized values", async () => {
  const kv = fakeKV();
  assert.equal(withMedia({}).MEDIA, undefined);
  const adapted = withMedia({ MEDIA_KV: kv });
  assert.equal(adapted.MEDIA_BACKEND, "kv");
  await assert.rejects(adapted.MEDIA.put("key", new Uint8Array(25 * 1024 * 1024 + 1)), RangeError);
  assert.equal(kv.rows.size, 0);
  const r2 = { get: async () => null };
  assert.equal(withMedia({ MEDIA: r2, MEDIA_KV: kv }).MEDIA, r2);
});
