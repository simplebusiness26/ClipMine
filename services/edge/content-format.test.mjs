import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaIdsFor, validateCarouselIds, validateCarouselSlides } from "./content-format.mjs";

test("carousel preserves its slide order after source cleanup; ordinary posts use their existing media ID", () => {
  assert.deepEqual(mediaIdsFor({ media_id: "existing" }), ["existing"]);
  const carousel = { post_kind: "carousel", media_id: null, media_ids_json: '["b","a"]' };
  assert.deepEqual(mediaIdsFor(carousel), ["b", "a"]);
});

test("carousel accepts 2–10 distinct JPEG or video slides", () => {
  assert.doesNotThrow(() => validateCarouselIds(["b", "a"]));
  for (const ids of [["a"], ["a", "a"], [null, "b"], Array.from({ length: 11 }, (_, i) => String(i))])
    assert.throws(() => validateCarouselIds(ids), /carousel/i);
  assert.doesNotThrow(() => validateCarouselSlides([{ mime: "image/jpeg" }, { mime: "video/mp4" }]));
  assert.throws(() => validateCarouselSlides([{ mime: "image/png" }]), /JPEG/);
});
