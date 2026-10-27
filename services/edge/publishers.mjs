import { fail } from "./security.mjs";
import { providerJSON, graph } from "./social-oauth.mjs";
export function resolveOptions(post, account, settings = {}) {
  const overrides = JSON.parse(post.overrides_json || "{}");
  const output = { title: post.title, caption: post.caption };
  for (const layer of [
    overrides[account.platform],
    overrides[account.id],
    settings[account.id],
  ])
    for (const [k, v] of Object.entries(layer || {}))
      if (!(["title", "caption"].includes(k) && v === "")) output[k] = v;
  return output;
}
export function validatePost(account, media, post, options, creator) {
  const p = account.platform,
    title = options.title || post.title,
    caption = options.caption || post.caption;
  if (typeof title !== "string" || typeof caption !== "string")
    fail(400, "Titles and captions must be text.");
  if (
    options.cover_ms !== undefined &&
    (!Number.isSafeInteger(options.cover_ms) ||
      options.cover_ms < 0 ||
      (media.duration_seconds &&
        options.cover_ms >= media.duration_seconds * 1000))
  )
    fail(400, "Choose a cover frame inside the video.");
  if (!media) fail(400, "Choose uploaded media first.");
  if (p === "youtube") {
    if (!media.mime.startsWith("video/")) fail(400, "YouTube requires video.");
    if (!title || title.length > 100 || caption.length > 5000)
      fail(
        400,
        "YouTube needs a title up to 100 characters and description up to 5,000.",
      );
    if (
      !["private", "unlisted", "public"].includes(options.privacy) ||
      typeof options.made_for_kids !== "boolean"
    )
      fail(400, "Choose YouTube visibility and the audience setting.");
  }
  if (p === "instagram") {
    if (caption.length > 2200)
      fail(400, "Instagram captions must be at most 2,200 characters.");
    if (!["video/mp4", "video/quicktime", "image/jpeg"].includes(media.mime))
      fail(400, "Instagram requires an MP4/MOV Reel or JPEG image.");
  }
  if (p === "facebook" && caption.length > 60000)
    fail(400, "Facebook caption is too long.");
  if (p === "tiktok") {
    if (!media.mime.startsWith("video/"))
      fail(
        400,
        "TikTok direct posting currently supports videos in Niches. Export images for manual posting.",
      );
    if (caption.length > 2200)
      fail(400, "TikTok captions must be at most 2,200 characters.");
    if (!creator?.privacy_level_options?.includes(options.privacy))
      fail(400, "Choose a currently available TikTok visibility setting.");
    if (
      !media.duration_seconds ||
      media.duration_seconds > creator.max_video_post_duration_sec
    )
      fail(
        400,
        "This video is missing its duration or exceeds this TikTok account’s duration limit.",
      );
    if (options.tiktok_consent !== true)
      fail(400, "Accept TikTok’s Music Usage Confirmation before publishing.");
    if (
      options.commercial_content &&
      !(options.brand_organic || options.brand_content)
    )
      fail(400, "Choose the commercial-content disclosure that applies.");
    if (options.brand_content && options.privacy === "SELF_ONLY")
      fail(400, "Branded TikTok content cannot be posted as private.");
  }
  return { title, caption };
}
export function uploadLocation(value, provider) {
  const url = new URL(value);
  const hosts =
    provider === "youtube"
      ? ["www.googleapis.com", "youtube.googleapis.com"]
      : ["rupload.facebook.com"];
  if (
    url.protocol !== "https:" ||
    !hosts.includes(url.hostname) ||
    url.username ||
    url.password
  )
    fail(502, "Provider returned an unexpected upload destination.");
  return url.href;
}
async function checkedFetch(url, init, fetcher) {
  const response = await fetcher(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.status !== 308
  )
    fail(502, "Provider redirect refused.");
  return response;
}
// One resumable stage per call; caller persists every state transition before another write.
export async function advancePublisher({
  env,
  account,
  token,
  media,
  post,
  options,
  state,
  mediaURL,
  object,
  creator,
  fetcher = fetch,
}) {
  const p = account.platform,
    headers = { Authorization: "Bearer " + token },
    meta = {
      title: options.title || post.title,
      caption: options.caption || post.caption,
    };
  if (p === "youtube") {
    if (!state.phase) {
      const response = await checkedFetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "X-Upload-Content-Length": String(media.size),
            "X-Upload-Content-Type": media.mime,
          },
          body: JSON.stringify({
            snippet: { title: meta.title, description: meta.caption },
            status: {
              privacyStatus: options.privacy,
              selfDeclaredMadeForKids: options.made_for_kids,
              containsSyntheticMedia: !!options.aigc,
            },
          }),
        },
        fetcher,
      );
      if (!response.ok)
        throw Object.assign(new Error("YouTube refused the upload session."), {
          providerStatus: response.status,
        });
      return {
        state: {
          phase: "upload",
          session: uploadLocation(response.headers.get("location"), "youtube"),
        },
        status: "processing",
      };
    }
    if (state.phase === "upload") {
      const probe = await checkedFetch(
        uploadLocation(state.session, "youtube"),
        {
          method: "PUT",
          headers: {
            ...headers,
            "Content-Length": "0",
            "Content-Range": `bytes */${media.size}`,
          },
        },
        fetcher,
      );
      if (probe.ok) {
        const result = await probe.json();
        if (!result.id) fail(502, "YouTube omitted the video identifier.");
        return {
          state: { phase: "poll", video_id: result.id },
          providerId: result.id,
          status: "processing",
        };
      }
      if (probe.status !== 308)
        throw Object.assign(
          new Error(
            "YouTube upload cannot be resumed. Check the channel before retrying.",
          ),
          { providerStatus: probe.status, uncertain: true },
        );
      const offset =
        Number(probe.headers.get("range")?.match(/-(\d+)$/)?.[1] ?? -1) + 1;
      if (offset < 0 || offset >= media.size)
        fail(502, "Invalid YouTube upload offset.");
      const length = Math.min(4 * 1024 * 1024, media.size - offset),
        bytes = await object({ offset, length });
      const response = await checkedFetch(
        uploadLocation(state.session, "youtube"),
        {
          method: "PUT",
          headers: {
            ...headers,
            "Content-Type": media.mime,
            "Content-Length": String(length),
            "Content-Range": `bytes ${offset}-${offset + length - 1}/${media.size}`,
          },
          body: bytes,
        },
        fetcher,
      );
      if (response.status === 308) return { state, status: "processing" };
      if (!response.ok)
        throw Object.assign(
          new Error("YouTube did not confirm the video upload."),
          { providerStatus: response.status, uncertain: true },
        );
      const result = await response.json();
      if (!result.id) fail(502, "YouTube omitted the video identifier.");
      return {
        state: { phase: "poll", video_id: result.id },
        providerId: result.id,
        status: "processing",
      };
    }
    const result = await providerJSON(
      `https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(state.video_id)}`,
      { headers },
      fetcher,
    );
    const video = result.items?.[0];
    if (!video) fail(502, "YouTube has not returned this video.");
    if (
      ["failed", "rejected", "deleted"].includes(video.status?.uploadStatus) ||
      video.processingDetails?.processingStatus === "failed"
    )
      return {
        state,
        status: "failed",
        error: "YouTube processing failed or rejected the video.",
      };
    const done = video.status?.uploadStatus === "processed";
    return {
      state: { ...state, privacy: video.status?.privacyStatus },
      providerId: state.video_id,
      status: done ? "published" : "processing",
    };
  }
  if (p === "instagram") {
    if (!state.phase) {
      const values = media.mime.startsWith("video/")
        ? {
            media_type: "REELS",
            video_url: mediaURL,
            caption: meta.caption,
            ...(options.cover_url ? {} : {}),
          }
        : { image_url: mediaURL, caption: meta.caption };
      if (options.cover_ms !== undefined && media.mime.startsWith("video/"))
        values.thumb_offset = options.cover_ms;
      const result = await providerJSON(
        `${graph(env)}/${account.provider_id}/media`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
        fetcher,
      );
      if (!result.id) fail(502, "Instagram omitted the media container.");
      return {
        state: { phase: "container", container_id: result.id },
        status: "processing",
      };
    }
    if (state.phase === "container" || state.phase === "confirm") {
      const result = await providerJSON(
        `${graph(env)}/${state.container_id}?fields=status_code`,
        { headers },
        fetcher,
      );
      if (result.status_code === "PUBLISHED")
        return { state, status: "published" };
      if (["ERROR", "EXPIRED"].includes(result.status_code))
        return {
          state,
          status: "failed",
          error: "Instagram could not process this media.",
        };
      return {
        state:
          result.status_code === "FINISHED" && state.phase === "container"
            ? { ...state, phase: "finish" }
            : state,
        status: "processing",
      };
    }
    if (state.phase === "finish") {
      const result = await providerJSON(
        `${graph(env)}/${account.provider_id}/media_publish`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ creation_id: state.container_id }),
        },
        fetcher,
      );
      if (!result.id) fail(502, "Instagram did not confirm publication.");
      return {
        state: { ...state, phase: "done", media_id: result.id },
        providerId: result.id,
        status: "published",
      };
    }
  }
  if (p === "facebook") {
    if (!media.mime.startsWith("video/")) {
      const result = await providerJSON(
        `${graph(env)}/${account.provider_id}/photos`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            url: mediaURL,
            caption: meta.caption,
            published: true,
          }),
        },
        fetcher,
      );
      if (!result.id) fail(502, "Facebook did not confirm publication.");
      return {
        state: { phase: "done" },
        providerId: result.post_id || result.id,
        status: "published",
      };
    }
    if (!state.phase) {
      const result = await providerJSON(
        `${graph(env)}/${account.provider_id}/video_reels`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ upload_phase: "start" }),
        },
        fetcher,
      );
      if (!result.video_id || !result.upload_url)
        fail(502, "Facebook omitted the Reel upload session.");
      return {
        state: {
          phase: "upload",
          video_id: result.video_id,
          upload_url: uploadLocation(result.upload_url, "facebook"),
        },
        providerId: result.video_id,
        status: "processing",
      };
    }
    if (state.phase === "upload") {
      await providerJSON(
        uploadLocation(state.upload_url, "facebook"),
        {
          method: "POST",
          headers: { Authorization: "OAuth " + token, file_url: mediaURL },
        },
        fetcher,
      );
      return {
        state: { phase: "finish", video_id: state.video_id },
        status: "processing",
      };
    }
    if (state.phase === "finish") {
      const result = await providerJSON(
        `${graph(env)}/${account.provider_id}/video_reels`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            upload_phase: "finish",
            video_id: state.video_id,
            video_state: "PUBLISHED",
            description: meta.caption,
            title: meta.title,
          }),
        },
        fetcher,
      );
      if (result.success !== true)
        fail(502, "Facebook did not accept Reel publication.");
      return {
        state: { phase: "poll", video_id: state.video_id },
        status: "processing",
      };
    }
    const result = await providerJSON(
      `${graph(env)}/${state.video_id}?fields=status`,
      { headers },
      fetcher,
    );
    const status = result.status;
    if (
      status?.publishing_phase?.status === "error" ||
      status?.processing_phase?.status === "error"
    )
      return {
        state,
        status: "failed",
        error: "Facebook Reel processing or publishing failed.",
      };
    return {
      state,
      status:
        status?.publishing_phase?.status === "complete"
          ? "published"
          : "processing",
    };
  }
  if (p === "tiktok") {
    if (!state.phase) {
      validatePost(account, media, post, options, creator);
      const result = await providerJSON(
        "https://open.tiktokapis.com/v2/post/publish/video/init/",
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            post_info: {
              title: meta.caption,
              privacy_level: options.privacy,
              disable_comment:
                !options.allow_comments || creator.comment_disabled,
              disable_duet: !options.allow_duet || creator.duet_disabled,
              disable_stitch: !options.allow_stitch || creator.stitch_disabled,
              brand_organic_toggle: !!options.brand_organic,
              brand_content_toggle: !!options.brand_content,
              is_aigc: !!options.aigc,
              ...(options.cover_ms !== undefined
                ? { video_cover_timestamp_ms: options.cover_ms }
                : {}),
            },
            source_info: { source: "PULL_FROM_URL", video_url: mediaURL },
          }),
        },
        fetcher,
      );
      if (!result.data?.publish_id)
        fail(502, "TikTok did not return a publishing identifier.");
      return {
        state: { phase: "poll", publish_id: result.data.publish_id },
        providerId: result.data.publish_id,
        status: "processing",
      };
    }
    const result = await providerJSON(
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ publish_id: state.publish_id }),
      },
      fetcher,
    );
    if (result.data?.status === "FAILED")
      return {
        state,
        status: "failed",
        error: "TikTok rejected or could not process this post.",
      };
    return {
      state,
      status:
        result.data?.status === "PUBLISH_COMPLETE" ? "published" : "processing",
    };
  }
  fail(400, "Unsupported publishing platform.");
}
