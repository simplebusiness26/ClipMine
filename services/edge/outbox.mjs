import { id, now, hash, randomToken, fail, json } from "./security.mjs";
import { execute, one, all } from "./db.mjs";
import { seal, unseal } from "./token-vault.mjs";
import { providerInfo, accessToken, providerJSON } from "./social-oauth.mjs";
import {
  advancePublisher,
  validatePost,
  resolveOptions,
} from "./publishers.mjs";
export async function creatorInfo(env, account, fetcher = fetch) {
  const token = await accessToken(env, account, fetcher);
  const result = await providerJSON(
    "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
    },
    fetcher,
  );
  return result.data;
}
export async function queuePost(env, user, niche, post, data) {
  if (data.confirmed !== true)
    fail(400, "Review the saved post and confirm publishing.");
  if (!env.MEDIA) fail(503, "Cloud storage must be enabled before publishing.");
  if (!["draft", "cancelled"].includes(post.delivery_status))
    fail(409, "This post has already been approved.");
  const media = await one(
    env,
    "SELECT * FROM media WHERE id=? AND niche_id=?",
    post.media_id,
    niche.id,
  );
  if (!media) fail(400, "Upload media to this niche before publishing.");
  const ids = JSON.parse(post.destinations_json);
  if (!ids.length) fail(400, "Select at least one destination account.");
  const options = data.accounts || {};
  if (!options || typeof options !== "object" || Array.isArray(options))
    fail(400, "Invalid account publishing settings.");
  if (ids.length > 20)
    fail(400, "Choose up to 20 accounts for one publishing batch.");
  for (const accountId of ids) {
    const a = await one(
      env,
      "SELECT * FROM accounts WHERE id=? AND niche_id=? AND status='connected' AND connection_kind='oauth'",
      accountId,
      niche.id,
    );
    if (!a)
      fail(409, "Every selected account must be connected for publishing.");
    const provider = providerInfo(env).find((p) => p.id === a.platform);
    if (!provider?.publishing_enabled)
      fail(
        503,
        `${provider?.name || a.platform} publishing requires app credentials and an authorised publishing configuration.`,
      );
    if (a.platform === "tiktok" && env.TIKTOK_MEDIA_URL_VERIFIED !== "1")
      fail(
        503,
        "The TikTok media URL/domain must be verified in the developer portal.",
      );
    const selected = resolveOptions(post, a, options);
    validatePost(
      a,
      media,
      post,
      selected,
      a.platform === "tiktok" ? await creatorInfo(env, a) : null,
    );
  }
  const date = data.scheduled_at ? new Date(data.scheduled_at) : null;
  if (
    date &&
    (!Number.isFinite(date.getTime()) || date.getTime() < Date.now() + 60000)
  )
    fail(400, "Choose a schedule at least one minute in the future.");
  const approved = now(),
    due = date?.toISOString() || approved;
  // Claim and insert once in one transaction. UNIQUE(post,account) is the final duplicate guard.
  const statements = [
    env.DB.prepare(
      "UPDATE posts SET delivery_status=?,publish_mode='direct',options_json=?,approved_at=?,scheduled_at=?,updated_at=? WHERE id=? AND updated_at=? AND delivery_status IN ('draft','cancelled') AND NOT EXISTS(SELECT 1 FROM publications WHERE post_id=posts.id)",
    ).bind(
      date ? "scheduled" : "queued",
      JSON.stringify(options),
      approved,
      date?.toISOString() || null,
      approved,
      post.id,
      post.updated_at,
    ),
  ];
  for (const accountId of ids)
    statements.push(
      env.DB.prepare(
        "INSERT INTO publications(id,post_id,account_id,status,updated_at,next_attempt_at) SELECT ?,?,?,'pending',?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=? AND approved_at=?)",
      ).bind(id(), post.id, accountId, approved, due, post.id, approved),
    );
  statements.push(
    env.DB.prepare(
      "INSERT INTO audit_events SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=? AND approved_at=?)",
    ).bind(
      id(),
      user.id,
      niche.id,
      date ? "post.scheduled" : "post.approved",
      post.id,
      approved,
      post.id,
      approved,
    ),
  );
  try {
    const result = await env.DB.batch(statements);
    if (!result[0].meta.changes)
      fail(409, "This post has already been approved.");
  } catch (error) {
    if (error.status) throw error;
    fail(
      409,
      "This post has already been approved or its destinations are invalid.",
    );
  }
  return {
    status: date ? "scheduled" : "queued",
    message: date
      ? "Publication scheduled. Status will update for each account."
      : "Publication queued. Each account’s result will appear in publish history.",
  };
}
async function mediaGrant(env, media, pub) {
  const token = randomToken();
  await execute(
    env,
    "INSERT INTO media_grants VALUES (?,?,?,?)",
    await hash(token),
    media.id,
    pub.id,
    new Date(Date.now() + 7200000).toISOString(),
  );
  return `${env.APP_URL}/api/provider-media/${token}`;
}
export async function providerMedia(request, env, token) {
  if (
    !["GET", "HEAD"].includes(request.method) ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    fail(404, "Not found");
  const m = await one(
    env,
    "SELECT m.* FROM media_grants g JOIN media m ON m.id=g.media_id WHERE g.token_hash=? AND g.expires_at>?",
    await hash(token),
    now(),
  );
  if (!m || !env.MEDIA) fail(404, "Media link expired");
  const partial = request.headers.has("range"),
    object = await env.MEDIA.get(
      m.object_key,
      partial ? { range: request.headers } : {},
    );
  if (!object) fail(404, "Media unavailable");
  const headers = {
    "Content-Type": m.mime,
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    "Content-Length": String(object.range?.length ?? object.size),
  };
  if (partial && object.range)
    headers["Content-Range"] =
      `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`;
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: partial && object.range ? 206 : 200,
    headers,
  });
}
export async function refreshPostStatus(env, postId) {
  const rows = await all(
    env,
    "SELECT status FROM publications WHERE post_id=?",
    postId,
  );
  if (!rows.length) return;
  const states = rows.map((r) => r.status),
    done = states.every((x) =>
      ["published", "failed", "needs_review", "cancelled"].includes(x),
    );
  const status = states.every((x) => x === "published")
    ? "published"
    : done
      ? states.includes("published")
        ? "partial"
        : states.includes("needs_review")
          ? "needs_review"
          : "failed"
      : "processing";
  await execute(
    env,
    "UPDATE posts SET delivery_status=?,updated_at=? WHERE id=?",
    status,
    now(),
    postId,
  );
}
export async function runOutbox(env, limit = 5, fetcher = fetch) {
  const jobs = await all(
    env,
    "SELECT p.* FROM publications p JOIN posts s ON s.id=p.post_id WHERE s.publish_mode='direct' AND p.status IN ('pending','processing','retry') AND (p.next_attempt_at IS NULL OR p.next_attempt_at<=?) AND (p.lease_until IS NULL OR p.lease_until<?) ORDER BY p.updated_at LIMIT ?",
    now(),
    now(),
    limit,
  );
  for (const pub of jobs) {
    const claimed = await one(
      env,
      "UPDATE publications SET lease_until=?,attempt=attempt+1 WHERE id=? AND (lease_until IS NULL OR lease_until<?) AND status IN ('pending','processing','retry') RETURNING id",
      new Date(Date.now() + 90000).toISOString(),
      pub.id,
      now(),
    );
    if (!claimed) continue;
    let state = {};
    try {
      const account = await one(
          env,
          "SELECT * FROM accounts WHERE id=?",
          pub.account_id,
        ),
        post = await one(env, "SELECT * FROM posts WHERE id=?", pub.post_id),
        media = await one(
          env,
          "SELECT * FROM media WHERE id=? AND niche_id=?",
          post.media_id,
          post.niche_id,
        );
      if (
        !account ||
        account.niche_id !== post.niche_id ||
        !media ||
        !env.MEDIA
      )
        fail(409, "The media or account is no longer available in this niche.");
      if (
        !providerInfo(env).find((x) => x.id === account.platform)
          ?.publishing_enabled
      )
        fail(
          503,
          "Provider publishing is disabled until configuration and approval are complete.",
        );
      state = pub.state_json.startsWith("v1.")
        ? await unseal(env, pub.state_json, `publication:${pub.id}`)
        : {};
      if (state.inflight) {
        if (account.platform === "youtube" && state.phase === "upload")
          state.inflight = false;
        else if (account.platform === "instagram" && state.phase === "finish")
          state = { ...state, phase: "confirm", inflight: false };
        else if (account.platform === "facebook" && state.phase === "finish")
          state = { ...state, phase: "poll", inflight: false };
        else
          throw Object.assign(
            new Error(
              "The last provider request has an uncertain outcome. Check the platform before retrying.",
            ),
            { uncertain: true },
          );
      }
      const options = resolveOptions(
        post,
        account,
        JSON.parse(post.options_json),
      );
      const token = await accessToken(env, account, fetcher),
        creator =
          account.platform === "tiktok" && !state.phase
            ? await creatorInfo(env, account, fetcher)
            : null;
      const phase = state.phase || "init",
        writes =
          phase !== "poll" && phase !== "container" && phase !== "confirm";
      if (writes) {
        state = { ...state, inflight: true };
        await execute(
          env,
          "UPDATE publications SET submission_started=1,state_json=? WHERE id=?",
          await seal(env, state, `publication:${pub.id}`),
          pub.id,
        );
      }
      const result = await advancePublisher({
        env,
        account,
        token,
        media,
        post,
        options,
        state,
        creator,
        mediaURL: ["init", "upload"].includes(phase)
          ? await mediaGrant(env, media, pub)
          : null,
        object: async (range) => {
          const object = await env.MEDIA.get(media.object_key, { range });
          if (!object) fail(404, "Media unavailable");
          return object.body;
        },
        fetcher,
      });
      await execute(
        env,
        "UPDATE publications SET status=?,provider_post_id=COALESCE(?,provider_post_id),state_json=?,lease_until=NULL,next_attempt_at=?,error=?,error_code=NULL,updated_at=? WHERE id=?",
        result.status,
        result.providerId || null,
        await seal(
          env,
          { ...result.state, inflight: false },
          `publication:${pub.id}`,
        ),
        new Date(Date.now() + 15000).toISOString(),
        result.error || null,
        now(),
        pub.id,
      );
    } catch (error) {
      const safeRead =
        ["poll", "container", "confirm"].includes(state.phase) &&
        !state.inflight;
      const uncertain =
          !safeRead &&
          (error.uncertain ||
            (state.inflight &&
              (!error.providerStatus || error.providerStatus >= 500))),
        retry =
          (error.providerStatus === 429 ||
            (safeRead && error.providerStatus !== 401)) &&
          pub.attempt < 20;
      if (error.providerStatus && error.providerStatus < 500)
        await execute(
          env,
          "UPDATE publications SET state_json=? WHERE id=?",
          await seal(
            env,
            { ...state, inflight: false },
            `publication:${pub.id}`,
          ),
          pub.id,
        );
      if (error.providerStatus === 401)
        await execute(
          env,
          "UPDATE accounts SET status='needs_reconnect' WHERE id=?",
          pub.account_id,
        );
      await execute(
        env,
        "UPDATE publications SET status=?,lease_until=NULL,next_attempt_at=?,error=?,error_code=?,updated_at=? WHERE id=?",
        uncertain ? "needs_review" : retry ? "retry" : "failed",
        new Date(Date.now() + 60000 * (pub.attempt + 1)).toISOString(),
        uncertain
          ? "Provider outcome uncertain. Check the platform before retrying."
          : error.status
            ? error.message
            : "The provider operation failed. Reconnect or check the platform before retrying.",
        uncertain ? "uncertain" : retry ? "rate_limit" : "provider_error",
        now(),
        pub.id,
      );
    }
    await refreshPostStatus(env, pub.post_id);
  }
}
export async function retryPublication(env, user, niche, pubId, data) {
  const pub = await one(
    env,
    "SELECT p.* FROM publications p JOIN posts s ON s.id=p.post_id WHERE p.id=? AND s.niche_id=?",
    pubId,
    niche.id,
  );
  if (!pub) fail(404, "Publication not found");
  if (!["failed", "needs_review"].includes(pub.status))
    fail(409, "Only failed or uncertain publications can be retried.");
  if (pub.status === "needs_review" && data.checked_not_published !== true)
    fail(
      409,
      "Check the social platform and explicitly confirm this post was not published before retrying.",
    );
  await execute(
    env,
    "UPDATE publications SET status='pending',state_json=?,submission_started=?,lease_until=NULL,next_attempt_at=?,error=NULL,error_code=NULL,updated_at=? WHERE id=?",
    pub.status === "needs_review" ? "{}" : pub.state_json,
    pub.status === "needs_review" ? 0 : pub.submission_started,
    now(),
    now(),
    pub.id,
  );
  await execute(
    env,
    "INSERT INTO audit_events VALUES (?,?,?,?,?,?)",
    id(),
    user.id,
    niche.id,
    "publication.retry_confirmed",
    pub.id,
    now(),
  );
  return { status: "pending" };
}
