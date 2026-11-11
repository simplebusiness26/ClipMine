import { test } from "node:test";
import assert from "node:assert/strict";
import { POST_KINDS, mediaIdsFor, validateMediaKind } from "./content-format.mjs";

test("new formats include the legacy-safe automatic type", () => {
  assert.deepEqual(POST_KINDS, ["auto", "reel", "image", "carousel", "story"]);
  assert.deepEqual(mediaIdsFor({ post_kind: "auto", media_id: "existing" }), ["existing"]);
});
test("carousel preserves ordered media and rejects invalid or duplicate slides", () => {
  assert.deepEqual(mediaIdsFor({ post_kind:"carousel", media_id:"a", media_ids_json:'["a","b"]' }), ["a","b"]);
  for (const media_ids_json of ['["a","a"]','["b","a"]','["a"]','not json'])
    assert.throws(() => mediaIdsFor({ post_kind:"carousel", media_id:"a", media_ids_json }), /carousel/i);
});
test("Instagram JPEG photos and mixed carousels are valid", () => {
  assert.doesNotThrow(() => validateMediaKind("image", [{mime:"image/jpeg"}], "instagram"));
  assert.doesNotThrow(() => validateMediaKind("carousel", [{mime:"image/jpeg"}, {mime:"video/mp4"}], "instagram"));
  assert.doesNotThrow(() => validateMediaKind("story", [{mime:"video/mp4"}], "instagram"));
});
test("Instagram format and platform mismatches fail before enqueue", () => {
  assert.throws(() => validateMediaKind("image", [{mime:"image/png"}], "instagram"), /JPEG/);
  assert.throws(() => validateMediaKind("reel", [{mime:"image/jpeg"}], "instagram"), /Reel/);
  assert.throws(() => validateMediaKind("story", [{mime:"image/jpeg"}], "facebook"), /Instagram/);
  assert.throws(() => validateMediaKind("carousel", [{mime:"image/jpeg"},{mime:"image/jpeg"}], "facebook"), /Instagram/);
  assert.throws(() => validateMediaKind("carousel", [{mime:"image/png"},{mime:"image/jpeg"}], "instagram"), /JPEG/);
});
