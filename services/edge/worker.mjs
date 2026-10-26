import {
  id,
  now,
  randomToken,
  hash,
  passwordHash,
  verifyPassword,
  cookie,
  sessionToken,
  fail,
  json,
  textValue,
  validateUpload,
} from "./security.mjs";

export const providers = [
  {
    id: "facebook",
    name: "Facebook Pages & Reels",
    status: "not_configured",
    reason: "Meta app, Page permissions and app review required.",
  },
  {
    id: "instagram",
    name: "Instagram professional & Reels",
    status: "not_configured",
    reason:
      "Eligible professional account, Meta OAuth and app review required.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    status: "not_configured",
    reason: "Content Posting API app review and user authorisation required.",
  },
  {
    id: "youtube",
    name: "YouTube & Shorts",
    status: "not_configured",
    reason:
      "Google OAuth, YouTube upload permission and production verification required.",
  },
];
const execute = (env, sql, ...values) =>
  env.DB.prepare(sql)
    .bind(...values)
    .run();
const one = (env, sql, ...values) =>
  env.DB.prepare(sql)
    .bind(...values)
    .first();
const all = async (env, sql, ...values) =>
  (
    await env.DB.prepare(sql)
      .bind(...values)
      .all()
  ).results;
const audit = (env, user, niche, action, resource = null) =>
  execute(
    env,
    "INSERT INTO audit_events VALUES (?,?,?,?,?,?)",
    id(),
    user,
    niche,
    action,
    resource,
    now(),
  );
async function body(request) {
  if (Number(request.headers.get("content-length") || 0) > 32768)
    fail(413, "Request too large");
  const value = await request.text();
  if (value.length > 32768) fail(413, "Request too large");
  try {
    const data = JSON.parse(value);
    if (!data || Array.isArray(data) || typeof data !== "object")
      fail(400, "Expected an object");
    return data;
  } catch {
    fail(400, "Invalid JSON");
  }
}
async function rate(env, key, limit = 20) {
  const bucket = Math.floor(Date.now() / 60000);
  const result = await one(
    env,
    "INSERT INTO rate_limits(key,hits,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits",
    `${key}:${bucket}`,
    Math.floor(Date.now() / 1000) + 120,
  );
  if (result.hits > limit)
    fail(429, "Too many requests. Try again in a minute.");
}
async function userFor(request, env) {
  const token = sessionToken(request);
  if (!token) fail(401, "Please log in.");
  const user = await one(
    env,
    "SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
    await hash(token),
    now(),
  );
  if (!user) fail(401, "Your session has expired. Please log in.");
  return user;
}
async function nicheFor(env, user, niche) {
  const row = await one(
    env,
    "SELECT * FROM niches WHERE id=? AND user_id=?",
    niche,
    user,
  );
  if (!row) fail(404, "Niche not found");
  return row;
}
async function issueSession(env, user, secure) {
  const token = randomToken();
  await execute(
    env,
    "INSERT INTO sessions VALUES (?,?,?)",
    await hash(token),
    user,
    new Date(Date.now() + 604800000).toISOString(),
  );
  return cookie(token, secure);
}
function postRow(row) {
  return {
    ...row,
    destinations: JSON.parse(row.destinations_json),
    overrides: JSON.parse(row.overrides_json),
  };
}
async function readBounded(stream, max) {
  if (!stream) fail(400, "The uploaded file is empty.");
  const reader = stream.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        fail(413, "The file exceeds the upload limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
async function quota(env, user, size) {
  const usage = await one(
    env,
    "SELECT COALESCE(SUM(size),0) AS bytes,COUNT(*) AS files FROM media WHERE niche_id IN (SELECT id FROM niches WHERE user_id=?)",
    user,
  );
  if (usage.bytes + size > 250 * 1024 * 1024 || usage.files >= 100)
    fail(413, "This beta account has reached its 250 MB or 100 file limit.");
}
async function clipRequest(request, env, user, path) {
  if (!env.CLIPMINE_ORIGIN || !env.CLIPMINE_GATEWAY_KEY)
    fail(
      503,
      "ClipMine rendering service is not connected. The original local studio remains available.",
    );
  const url = new URL(request.url);
  const project = path.split("/")[3];
  if (project) {
    const owned = await one(
      env,
      "SELECT cp.project_id FROM clip_projects cp JOIN niches n ON n.id=cp.niche_id WHERE cp.project_id=? AND n.user_id=?",
      project,
      user.id,
    );
    if (!owned) fail(404, "Project not found");
  }
  const origin = new URL(env.CLIPMINE_ORIGIN);
  if (
    origin.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(origin.hostname)
  )
    fail(503, "The rendering connection must use HTTPS.");
  let niche = null;
  if (request.method === "POST" && path === "/api/projects") {
    niche = await nicheFor(env, user.id, url.searchParams.get("niche_id"));
    const length = Number(request.headers.get("content-length"));
    if (!length || length > 90 * 1024 * 1024)
      fail(
        413,
        "Studio gateway uploads are limited to 90 MB. Use the private local studio for larger sources.",
      );
    const count = await one(
      env,
      "SELECT COUNT(*) AS total FROM clip_projects cp JOIN niches n ON n.id=cp.niche_id WHERE n.user_id=?",
      user.id,
    );
    if (count.total >= 5)
      fail(
        413,
        "This beta account allows up to five studio projects. Delete one before adding another.",
      );
  }
  const headers = new Headers();
  headers.set("X-Niches-Gateway-Key", env.CLIPMINE_GATEWAY_KEY);
  if (request.headers.has("content-type"))
    headers.set("Content-Type", request.headers.get("content-type"));
  if (request.headers.has("range"))
    headers.set("Range", request.headers.get("range"));
  const response = await fetch(new URL(path, origin), {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400)
    fail(502, "Rendering service redirects are not permitted.");
  if (path === "/api/projects" && response.ok) {
    const data = await response.json();
    if (request.method === "POST") {
      await execute(
        env,
        "INSERT INTO clip_projects VALUES (?,?,?)",
        data.id,
        niche.id,
        now(),
      );
      await audit(env, user.id, niche.id, "clip.created", data.id);
      return json(data, 202);
    }
    const links = await all(
      env,
      "SELECT cp.project_id FROM clip_projects cp JOIN niches n ON n.id=cp.niche_id WHERE n.user_id=? AND (? IS NULL OR n.id=?)",
      user.id,
      url.searchParams.get("niche_id"),
      url.searchParams.get("niche_id"),
    );
    const ids = new Set(links.map((x) => x.project_id));
    return json(data.filter((x) => ids.has(x.id)));
  }
  if (request.method === "DELETE" && project && response.ok)
    await execute(env, "DELETE FROM clip_projects WHERE project_id=?", project);
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
      ...(response.headers.has("content-disposition")
        ? { "Content-Disposition": response.headers.get("content-disposition") }
        : {}),
    },
  });
}
async function api(request, env) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  const secure = url.protocol === "https:";
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const origin = request.headers.get("origin");
    if (origin !== url.origin) fail(403, "A same-origin request is required.");
  }
  if (path === "/api/health")
    return json({
      service: "niches",
      build: env.BUILD_SHA || "development",
      database: !!env.DB,
      storage: !!env.MEDIA,
      clipmine: !!(env.CLIPMINE_ORIGIN && env.CLIPMINE_GATEWAY_KEY),
      publishing: "not_configured",
    });
  if (path.startsWith("/api/auth/")) {
    const action = path.slice(10);
    if (action === "me" && method === "GET")
      return json(await userFor(request, env));
    if (method !== "POST") fail(405, "Method not allowed");
    await rate(
      env,
      `auth:${request.headers.get("CF-Connecting-IP") || "local"}`,
      10,
    );
    if (action === "logout") {
      const token = sessionToken(request);
      if (token)
        await execute(
          env,
          "DELETE FROM sessions WHERE token_hash=?",
          await hash(token),
        );
      return json({ ok: true }, 200, { "Set-Cookie": cookie("", secure, 0) });
    }
    const data = await body(request);
    if (action === "reset") {
      const password = textValue(data.password, 256, true);
      if (password.length < 12) fail(400, "Use at least 12 characters.");
      const token = textValue(data.token, 64, true);
      const reset = await one(
        env,
        "SELECT * FROM password_resets WHERE token_hash=? AND expires_at>?",
        await hash(token),
        now(),
      );
      if (!reset) fail(400, "The reset link is invalid or expired.");
      const encoded = await passwordHash(password);
      // Atomic one-time consumption prevents concurrent reset-link reuse.
      const consumed = await one(
        env,
        "DELETE FROM password_resets WHERE token_hash=? RETURNING user_id",
        await hash(token),
      );
      if (!consumed) fail(400, "The reset link has already been used.");
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(
          encoded,
          reset.user_id,
        ),
        env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(
          reset.user_id,
        ),
      ]);
      return json({ ok: true });
    }
    const email = textValue(data.email, 254, true).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(400, "Enter a valid email address.");
    if (action === "forgot") {
      if (!env.RESET_EMAIL_ENDPOINT || !env.RESET_EMAIL_KEY || !env.APP_URL)
        fail(503, "Password reset email is not configured yet.");
      const user = await one(env, "SELECT id FROM users WHERE email=?", email);
      if (user) {
        const token = randomToken();
        await execute(
          env,
          "INSERT INTO password_resets VALUES (?,?,?)",
          await hash(token),
          user.id,
          new Date(Date.now() + 1800000).toISOString(),
        );
        const endpoint = new URL(env.RESET_EMAIL_ENDPOINT);
        if (endpoint.protocol !== "https:")
          fail(503, "Email delivery requires HTTPS");
        const sent = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESET_EMAIL_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: email,
            template: "niches-password-reset",
            reset_url: `${env.APP_URL}/?reset=${token}`,
          }),
          redirect: "manual",
        });
        if (!sent.ok)
          fail(503, "Reset email could not be delivered. Try later.");
      }
      return json({
        message: "If the account exists, a reset link has been sent.",
      });
    }
    const password = textValue(data.password, 256, true);
    let user = await one(env, "SELECT * FROM users WHERE email=?", email);
    if (action === "register") {
      if (password.length < 12) fail(400, "Use at least 12 characters.");
      if (user)
        fail(
          409,
          "Unable to create this account. Try logging in or resetting your password.",
        );
      user = { id: id(), email };
      await execute(
        env,
        "INSERT INTO users VALUES (?,?,?,?)",
        user.id,
        email,
        await passwordHash(password),
        now(),
      );
      await audit(env, user.id, null, "account.created");
    } else if (action === "login") {
      // Equal hashing cost for unknown accounts limits account timing disclosure.
      const valid = user
        ? await verifyPassword(password, user.password_hash)
        : (await passwordHash(password), false);
      if (!valid) fail(401, "Email or password is incorrect.");
    } else fail(404, "Unknown authentication action");
    return json({ id: user.id, email: user.email }, 200, {
      "Set-Cookie": await issueSession(env, user.id, secure),
    });
  }
  const user = await userFor(request, env);
  if (!["GET", "HEAD"].includes(method))
    await rate(env, `write:${user.id}`, 60);
  if (path === "/api/providers" && method === "GET") return json(providers);
  if (path === "/api/notifications") {
    if (method === "GET")
      return json(
        await all(
          env,
          "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
          user.id,
        ),
      );
    if (method === "POST") {
      await execute(
        env,
        "UPDATE notifications SET read_at=? WHERE user_id=?",
        now(),
        user.id,
      );
      return json({ ok: true });
    }
  }
  if (path === "/api/config")
    return json({
      persistence: "gateway",
      database_connected: true,
      max_upload_mb: 90,
      max_source_minutes: 180,
      transcription_provider: "remote ClipMine",
      render_size: [720, 1280],
      authentication: "niches",
      clipmine_available: !!(env.CLIPMINE_ORIGIN && env.CLIPMINE_GATEWAY_KEY),
    });
  if (
    path === "/api/projects" ||
    /^\/api\/projects\/[a-zA-Z0-9-]+(?:\/(?:source|retry|candidates\/[a-zA-Z0-9-]+(?:\/(?:render|download))?))?$/.test(
      path,
    )
  )
    return clipRequest(request, env, user, path);
  if (path === "/api/niches") {
    if (method === "GET")
      return json(
        await all(
          env,
          `SELECT n.*, (SELECT COUNT(*) FROM media WHERE niche_id=n.id) AS media_count,(SELECT COUNT(*) FROM posts WHERE niche_id=n.id AND status='draft') AS draft_count,(SELECT COUNT(*) FROM posts WHERE niche_id=n.id AND status='scheduled') AS scheduled_count,(SELECT COUNT(*) FROM accounts WHERE niche_id=n.id AND status='connected') AS account_count FROM niches n WHERE user_id=? ORDER BY created_at DESC`,
          user.id,
        ),
      );
    if (method === "POST") {
      const data = await body(request),
        name = textValue(data.name, 80, true),
        niche = id();
      const colour = /^#[a-f0-9]{6}$/i.test(data.colour || "")
        ? data.colour
        : "#c6f66b";
      await execute(
        env,
        "INSERT INTO niches(id,user_id,name,description,colour,initials,created_at) VALUES (?,?,?,?,?,?,?)",
        niche,
        user.id,
        name,
        textValue(data.description || "", 500),
        colour,
        name.slice(0, 2).toUpperCase(),
        now(),
      );
      await audit(env, user.id, niche, "niche.created", niche);
      return json(await nicheFor(env, user.id, niche), 201);
    }
  }
  const match = path.match(/^\/api\/niches\/([a-zA-Z0-9-]+)(?:\/(.*))?$/);
  if (!match) fail(404, "Not found");
  const niche = await nicheFor(env, user.id, match[1]),
    sub = match[2] || "";
  if (!sub) {
    if (method === "GET") return json(niche);
    if (method === "PATCH") {
      const data = await body(request);
      const brand = data.brand || {};
      if (typeof brand !== "object" || Array.isArray(brand))
        fail(400, "Invalid brand kit");
      const allowed = {
        hashtags: textValue(brand.hashtags || "", 1000),
        caption_style: textValue(brand.caption_style || "", 500),
        preferences: textValue(brand.preferences || "", 2000),
        logo_media_id: textValue(brand.logo_media_id || "", 80),
      };
      if (
        allowed.logo_media_id &&
        !(await one(
          env,
          "SELECT id FROM media WHERE id=? AND niche_id=? AND mime LIKE ?",
          allowed.logo_media_id,
          niche.id,
          "image/%",
        ))
      )
        fail(400, "Choose a logo from this niche’s image library.");
      const colour = data.colour ?? niche.colour;
      if (!/^#[a-f0-9]{6}$/i.test(colour))
        fail(400, "Choose a valid brand colour.");
      await execute(
        env,
        "UPDATE niches SET name=?,description=?,colour=?,brand_json=? WHERE id=?",
        textValue(data.name ?? niche.name, 80, true),
        textValue(data.description ?? niche.description, 500),
        colour,
        JSON.stringify(allowed),
        niche.id,
      );
      await audit(env, user.id, niche.id, "niche.updated", niche.id);
      return json(await nicheFor(env, user.id, niche.id));
    }
  }
  if (sub === "accounts" && method === "GET")
    return json(
      await all(
        env,
        "SELECT id,niche_id,platform,display_name,status FROM accounts WHERE niche_id=?",
        niche.id,
      ),
    );
  if (sub.startsWith("accounts/") && method === "POST")
    fail(
      503,
      "Official OAuth is not configured. No social account has been connected. Use draft/export in the meantime.",
    );
  if (sub === "activity" && method === "GET")
    return json(
      await all(
        env,
        "SELECT action,resource_id,created_at FROM audit_events WHERE niche_id=? ORDER BY created_at DESC LIMIT 50",
        niche.id,
      ),
    );
  if (sub === "analytics" && method === "GET")
    return json({
      source: "No authorised provider metrics available",
      metrics: [],
      revenue: await all(
        env,
        "SELECT category,SUM(amount_pence) AS amount_pence FROM revenue WHERE niche_id=? GROUP BY category",
        niche.id,
      ),
    });
  if (sub === "ideas") {
    if (method === "GET")
      return json(
        await all(
          env,
          "SELECT * FROM ideas WHERE niche_id=? ORDER BY created_at DESC",
          niche.id,
        ),
      );
    if (method === "POST") {
      const data = await body(request);
      const idea = id();
      await execute(
        env,
        "INSERT INTO ideas VALUES (?,?,?,?,?)",
        idea,
        niche.id,
        textValue(data.text, 2000, true),
        "idea",
        now(),
      );
      return json({ id: idea }, 201);
    }
  }
  if (sub === "revenue") {
    if (method === "GET")
      return json(
        await all(
          env,
          "SELECT * FROM revenue WHERE niche_id=? ORDER BY earned_at DESC",
          niche.id,
        ),
      );
    if (method === "POST") {
      const data = await body(request);
      if (
        !Number.isSafeInteger(data.amount_pence) ||
        data.amount_pence < 0 ||
        data.amount_pence > 100000000
      )
        fail(400, "Enter a valid amount.");
      if (
        !["sponsorship", "affiliate", "platform", "other"].includes(
          data.category,
        )
      )
        fail(400, "Choose a revenue category.");
      const earned = new Date(data.earned_at);
      if (!Number.isFinite(earned.getTime())) fail(400, "Enter a valid date");
      const record = id();
      await execute(
        env,
        "INSERT INTO revenue VALUES (?,?,?,?,?,?,?)",
        record,
        niche.id,
        data.amount_pence,
        data.category,
        textValue(data.note || "", 500),
        earned.toISOString(),
        now(),
      );
      return json({ id: record }, 201);
    }
  }
  if (sub === "media" && method === "GET")
    return json(
      await all(
        env,
        "SELECT * FROM media WHERE niche_id=? ORDER BY created_at DESC LIMIT 500",
        niche.id,
      ),
    );
  if (sub === "media" && method === "POST") {
    const length = Number(request.headers.get("content-length")),
      max = Number(env.MAX_UPLOAD_MB || 25) * 1024 * 1024;
    if (!length || length > max)
      fail(413, `Upload a file up to ${max / 1024 / 1024} MB.`);
    const type = request.headers.get("content-type")?.split(";")[0],
      bytes = await readBounded(request.body, max);
    if (bytes.length > max || !validateUpload(bytes, type))
      fail(
        415,
        "File contents must match a supported video, JPEG, PNG or WebP file.",
      );
    await quota(env, user.id, bytes.length);
    const media = id(),
      key = `${user.id}/${niche.id}/${media}`;
    const filename = textValue(
      request.headers.get("x-filename") || "Upload",
      200,
      true,
    );
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
    try {
      await execute(
        env,
        "INSERT INTO media(id,niche_id,object_key,filename,mime,size,created_at) VALUES (?,?,?,?,?,?,?)",
        media,
        niche.id,
        key,
        filename,
        type,
        bytes.length,
        now(),
      );
    } catch (error) {
      await env.MEDIA.delete(key);
      throw error;
    }
    await audit(env, user.id, niche.id, "media.uploaded", media);
    return json({ id: media }, 201);
  }
  const mediaMatch = sub.match(/^media\/([a-zA-Z0-9-]+)$/);
  if (mediaMatch && method === "GET") {
    const media = await one(
      env,
      "SELECT * FROM media WHERE id=? AND niche_id=?",
      mediaMatch[1],
      niche.id,
    );
    if (!media) fail(404, "Media not found");
    const partial = request.headers.has("range");
    const object = await env.MEDIA.get(
      media.object_key,
      partial ? { range: request.headers } : {},
    );
    if (!object) fail(404, "Media unavailable");
    const headers = new Headers({
      "Content-Type": media.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${url.searchParams.has("download") ? "attachment" : "inline"}; filename="${media.filename.replace(/[^a-zA-Z0-9._ -]/g, "_")}"`,
      "Accept-Ranges": "bytes",
    });
    headers.set("Content-Length", String(object.range?.length ?? object.size));
    if (partial && object.range)
      headers.set(
        "Content-Range",
        `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`,
      );
    return new Response(object.body, {
      status: partial && object.range ? 206 : 200,
      headers,
    });
  }
  if (sub === "clips/import" && method === "POST") {
    const data = await body(request),
      project = textValue(data.project_id, 80, true),
      candidate = textValue(data.candidate_id, 80, true);
    if (!/^[a-zA-Z0-9-]+$/.test(candidate) || !/^[a-zA-Z0-9-]+$/.test(project))
      fail(400, "Invalid clip");
    const owned = await one(
      env,
      "SELECT cp.project_id FROM clip_projects cp JOIN niches n ON n.id=cp.niche_id WHERE cp.project_id=? AND n.user_id=?",
      project,
      user.id,
    );
    if (!owned) fail(404, "Project not found");
    const existing = await one(
      env,
      "SELECT id FROM media WHERE niche_id=? AND source_project=? AND source_candidate=?",
      niche.id,
      project,
      candidate,
    );
    if (existing) return json(existing);
    const clip = await clipRequest(
      new Request(request.url),
      env,
      user,
      `/api/projects/${project}/candidates/${candidate}/download`,
    );
    if (!clip.ok) fail(409, "Render this clip before sending it to Niches.");
    const bytes = await readBounded(
      clip.body,
      Number(env.MAX_UPLOAD_MB || 25) * 1024 * 1024,
    );
    await quota(env, user.id, bytes.length);
    if (bytes.length > Number(env.MAX_UPLOAD_MB || 25) * 1024 * 1024)
      fail(413, "Rendered clip exceeds the beta upload limit.");
    const media = id(),
      key = `${user.id}/${niche.id}/${media}`;
    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: "video/mp4" },
    });
    try {
      await execute(
        env,
        "INSERT INTO media VALUES (?,?,?,?,?,?,?,?,?)",
        media,
        niche.id,
        key,
        `${textValue(data.title || "ClipMine clip", 120)}.mp4`,
        "video/mp4",
        bytes.length,
        project,
        candidate,
        now(),
      );
    } catch (error) {
      await env.MEDIA.delete(key);
      const duplicate = await one(
        env,
        "SELECT id FROM media WHERE niche_id=? AND source_project=? AND source_candidate=?",
        niche.id,
        project,
        candidate,
      );
      if (duplicate) return json(duplicate);
      throw error;
    }
    await audit(env, user.id, niche.id, "clip.imported", media);
    return json({ id: media }, 201);
  }
  if (sub === "posts" && method === "GET")
    return json(
      (
        await all(
          env,
          "SELECT * FROM posts WHERE niche_id=? ORDER BY updated_at DESC LIMIT 500",
          niche.id,
        )
      ).map(postRow),
    );
  const postMatch = sub.match(
    /^posts\/([a-zA-Z0-9-]+)(?:\/(approve|cancel|export))?$/,
  );
  if (
    (sub === "posts" && method === "POST") ||
    (postMatch && !postMatch[2] && method === "PATCH")
  ) {
    const data = await body(request),
      existing = postMatch
        ? await one(
            env,
            "SELECT * FROM posts WHERE id=? AND niche_id=?",
            postMatch[1],
            niche.id,
          )
        : null;
    if (postMatch && !existing) fail(404, "Draft not found");
    if (
      existing &&
      existing.status !== "draft" &&
      existing.status !== "blocked" &&
      existing.status !== "cancelled"
    )
      fail(409, "Cancel this post before editing it.");
    const mediaId = data.media_id || null;
    if (
      mediaId &&
      !(await one(
        env,
        "SELECT id FROM media WHERE id=? AND niche_id=?",
        mediaId,
        niche.id,
      ))
    )
      fail(404, "Media not found in this niche");
    const accounts = await all(
      env,
      "SELECT id FROM accounts WHERE niche_id=? AND status='connected'",
      niche.id,
    );
    const destinations = data.destinations ?? accounts.map((a) => a.id);
    if (
      !Array.isArray(destinations) ||
      destinations.some((a) => !accounts.some((b) => b.id === a))
    )
      fail(400, "Every destination must be a connected account in this niche.");
    const overrides = data.overrides || {};
    if (
      typeof overrides !== "object" ||
      Array.isArray(overrides) ||
      JSON.stringify(overrides).length > 16000
    )
      fail(400, "Invalid platform overrides");
    const title = textValue(data.title || "", 120),
      caption = textValue(data.caption || "", 10000),
      post = existing?.id || id(),
      stamp = now();
    if (existing)
      await execute(
        env,
        "UPDATE posts SET media_id=?,title=?,caption=?,destinations_json=?,overrides_json=?,status='draft',scheduled_at=NULL,approved_at=NULL,updated_at=? WHERE id=?",
        mediaId,
        title,
        caption,
        JSON.stringify([...new Set(destinations)]),
        JSON.stringify(overrides),
        stamp,
        post,
      );
    else
      await execute(
        env,
        "INSERT INTO posts(id,niche_id,media_id,title,caption,destinations_json,overrides_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        post,
        niche.id,
        mediaId,
        title,
        caption,
        JSON.stringify([...new Set(destinations)]),
        JSON.stringify(overrides),
        stamp,
        stamp,
      );
    await audit(env, user.id, niche.id, "draft.saved", post);
    return json(
      postRow(await one(env, "SELECT * FROM posts WHERE id=?", post)),
      existing ? 200 : 201,
    );
  }
  if (postMatch) {
    const post = await one(
      env,
      "SELECT * FROM posts WHERE id=? AND niche_id=?",
      postMatch[1],
      niche.id,
    );
    if (!post) fail(404, "Post not found");
    if (postMatch[2] === "export" && method === "GET") {
      const media = await one(
        env,
        "SELECT id,filename FROM media WHERE id=? AND niche_id=?",
        post.media_id,
        niche.id,
      );
      return json(
        {
          brand: niche.name,
          title: post.title,
          caption: post.caption,
          platforms: JSON.parse(post.overrides_json),
          media: media
            ? {
                ...media,
                download: `/api/niches/${niche.id}/media/${media.id}?download=1`,
              }
            : null,
          direct_publishing: false,
        },
        200,
        {
          "Content-Disposition": `attachment; filename="niches-post-${post.id}.json"`,
        },
      );
    }
    if (postMatch[2] === "cancel" && method === "POST") {
      await execute(
        env,
        "UPDATE posts SET status='cancelled',updated_at=? WHERE id=?",
        now(),
        post.id,
      );
      await audit(env, user.id, niche.id, "post.cancelled", post.id);
      return json({ ok: true });
    }
    if (postMatch[2] === "approve" && method === "POST") {
      const data = await body(request);
      if (data.confirmed !== true)
        fail(400, "Review and confirm your publishing plan first.");
      if (!post.media_id) fail(400, "Add media before approving.");
      if (!["draft", "blocked", "cancelled"].includes(post.status))
        fail(409, "This post has already been approved.");
      const scheduled = data.scheduled_at ? new Date(data.scheduled_at) : null;
      if (
        scheduled &&
        (!Number.isFinite(scheduled.getTime()) ||
          scheduled.getTime() < Date.now() + 60000)
      )
        fail(400, "Choose a time at least one minute in the future.");
      // No adapter is authorised: scheduling is an export reminder, never a false success.
      const status = scheduled ? "scheduled" : "export_ready";
      const updated = await one(
        env,
        "UPDATE posts SET status=?,scheduled_at=?,approved_at=?,updated_at=? WHERE id=? AND status IN ('draft','blocked','cancelled') RETURNING id",
        status,
        scheduled?.toISOString() || null,
        now(),
        now(),
        post.id,
      );
      if (!updated) fail(409, "This post has already been approved.");
      await audit(
        env,
        user.id,
        niche.id,
        scheduled ? "export.scheduled" : "export.prepared",
        post.id,
      );
      return json({
        status,
        message: scheduled
          ? "Export reminder scheduled. Direct publishing is not connected."
          : "Export ready. No social platform has received this post.",
      });
    }
  }
  fail(404, "Not found");
}
export async function scheduled(env) {
  const due = await all(
    env,
    "SELECT p.id,p.niche_id,n.user_id FROM posts p JOIN niches n ON n.id=p.niche_id WHERE status='scheduled' AND scheduled_at<=? LIMIT 25",
    now(),
  );
  for (const post of due) {
    // Claim + notification + audit in an atomic batch. Repeated ticks cannot duplicate it.
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO notifications SELECT ?,?,?,'Your scheduled export is ready. Direct publishing is not connected.',NULL,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=? AND status='scheduled')",
      ).bind(id(), post.user_id, post.niche_id, now(), post.id),
      env.DB.prepare(
        "UPDATE posts SET status='export_ready',updated_at=? WHERE id=? AND status='scheduled'",
      ).bind(now(), post.id),
    ]);
  }
  await execute(
    env,
    "DELETE FROM rate_limits WHERE expires_at<?",
    Math.floor(Date.now() / 1000),
  );
  await execute(env, "DELETE FROM sessions WHERE expires_at<?", now());
  await execute(env, "DELETE FROM password_resets WHERE expires_at<?", now());
}
export default {
  async fetch(request, env) {
    let response;
    try {
      response = new URL(request.url).pathname.startsWith("/api/")
        ? await api(request, env)
        : await env.ASSETS.fetch(request);
    } catch (error) {
      response = json(
        {
          detail: error.status
            ? error.message
            : "Something went wrong. Please try again.",
        },
        error.status || 500,
      );
    }
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "same-origin");
    headers.set("X-Frame-Options", "DENY");
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_controller, env) {
    await scheduled(env);
  },
};
