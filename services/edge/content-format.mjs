import { fail } from "./security.mjs";

// Format is explicit for new content; "auto" preserves all legacy drafts and jobs.
export const POST_KINDS = Object.freeze(["auto", "reel", "image", "carousel", "story"]);

export function mediaIdsFor(post) {
  if (post.post_kind !== "carousel") return post.media_id ? [post.media_id] : [];
  let ids;
  try { ids = JSON.parse(post.media_ids_json || "[]"); } catch { fail(400, "Invalid carousel media list."); }
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 10 ||
      ids.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9-]+$/.test(id)) ||
      new Set(ids).size !== ids.length || ids[0] !== post.media_id)
    fail(400, "A carousel needs 2–10 distinct, ordered files.");
  return ids;
}

export function validateMediaKind(kind, assets, platform) {
  if (!POST_KINDS.includes(kind)) fail(400, "Unknown content format.");
  if (!assets?.length) fail(400, "Upload media before publishing.");
  if (kind === "carousel") {
    if (platform !== "instagram")
      fail(400, "Carousel direct publishing is currently available only for Instagram. Choose an Instagram account.");
    if (assets.length < 2 || assets.length > 10)
      fail(400, "A carousel needs 2–10 slides.");
    if (assets.some((m) => !["image/jpeg", "video/mp4", "video/quicktime"].includes(m.mime)))
      fail(400, "Instagram carousel slides must be JPEG or MP4/MOV.");
    return;
  }
  if (assets.length !== 1) fail(400, "This content format requires one file.");
  const mime = assets[0].mime;
  if (kind === "reel" && !["video/mp4", "video/quicktime"].includes(mime))
    fail(400, "Choose an MP4/MOV video for a Reel.");
  if (kind === "image" && !mime.startsWith("image/"))
    fail(400, "Choose an image for a photo post.");
  if (kind === "story") {
    if (platform !== "instagram")
      fail(400, "Story direct publishing is currently available only for Instagram.");
    if (!["image/jpeg", "video/mp4", "video/quicktime"].includes(mime))
      fail(400, "Instagram Stories require JPEG or MP4/MOV media.");
  }
  if (platform === "instagram" && mime.startsWith("image/") && mime !== "image/jpeg")
    fail(400, "Instagram's publishing API requires JPEG images. Export PNG/WebP as JPEG.");
}
