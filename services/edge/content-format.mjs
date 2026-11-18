import { fail } from "./security.mjs";

export const POST_KINDS = Object.freeze(["auto", "carousel"]);
const CAROUSEL_MIMES = ["image/jpeg", "video/mp4", "video/quicktime"];

export function mediaIdsFor(post) {
  if (post.post_kind !== "carousel") return post.media_id ? [post.media_id] : [];
  return JSON.parse(post.media_ids_json);
}

export function validateCarouselIds(ids) {
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 10 ||
      ids.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9-]+$/.test(id)) ||
      new Set(ids).size !== ids.length)
    fail(400, "A carousel needs 2–10 distinct, ordered slides.");
}

export function validateCarouselSlides(assets) {
  if (assets.some((asset) => !CAROUSEL_MIMES.includes(asset.mime)))
    fail(400, "Instagram carousel slides must be JPEG, MP4 or MOV.");
}
