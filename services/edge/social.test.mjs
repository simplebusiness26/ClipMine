import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import worker from "./worker.mjs";
import { seal, unseal, accountContext } from "./token-vault.mjs";
import {
  beginOAuth,
  finishOAuth,
  saveConnection,
  selectConnections,
  providerInfo,
} from "./social-oauth.mjs";
import {
  queuePost,
  runOutbox,
  retryPublication,
  providerMedia,
} from "./outbox.mjs";
import {
  advancePublisher,
  validatePost,
  resolveOptions,
} from "./publishers.mjs";
import { hash, now } from "./security.mjs";
let mf, env, db, user, niche, cookie, otherCookie, otherUser;
const modules = [
  "worker",
  "security",
  "db",
  "token-vault",
  "social-oauth",
  "publishers",
  "outbox",
].map((name) => ({ type: "ESModule", path: `services/edge/${name}.mjs` }));
const settings = {
  NICHES_TOKEN_KEY: "ab".repeat(32),
  APP_URL: "http://localhost",
  YOUTUBE_CLIENT_ID: "fixture-client",
  YOUTUBE_CLIENT_SECRET: "fixture-secret",
  META_APP_ID: "fixture-meta",
  META_APP_SECRET: "fixture-secret",
  TIKTOK_CLIENT_KEY: "fixture-tiktok",
  TIKTOK_CLIENT_SECRET: "fixture-secret",
  YOUTUBE_PUBLISH_ENABLED: "1",
  FACEBOOK_PUBLISH_ENABLED: "1",
  INSTAGRAM_PUBLISH_ENABLED: "1",
  TIKTOK_PUBLISH_ENABLED: "1",
  TIKTOK_MEDIA_URL_VERIFIED: "1",
};
const response = (x) =>
  new Response(JSON.stringify(x), {
    headers: { "Content-Type": "application/json" },
  });
async function request(path, method = "GET", data, session = cookie) {
  return worker.fetch(
    new Request("http://localhost" + path, {
      method,
      headers: {
        Origin: "http://localhost",
        Cookie: session || "",
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    }),
    env,
  );
}
async function json(path, method = "GET", data, session) {
  const r = await request(path, method, data, session);
  const payload = await r.json();
  assert.ok(r.ok, JSON.stringify(payload));
  return payload;
}
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules,
      compatibilityDate: "2026-09-01",
      d1Databases: ["DB"],
      r2Buckets: ["MEDIA"],
    }),
  );
  db = await mf.getD1Database("DB");
  for (const f of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const sql of (await readFile("migrations/" + f, "utf8"))
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  env = { ...settings, DB: db, MEDIA: await mf.getR2Bucket("MEDIA") };
  let r = await request("/api/auth/register", "POST", {
    email: "owner@example.test",
    password: "Owner fixture passphrase",
  });
  assert.equal(r.status, 200);
  user = await r.json();
  cookie = r.headers.get("set-cookie").split(";")[0];
  niche = await json("/api/niches", "POST", { name: "Cars" });
  r = await request("/api/auth/register", "POST", {
    email: "other@example.test",
    password: "Other fixture passphrase",
  });
  otherUser = await r.json();
  otherCookie = r.headers.get("set-cookie").split(";")[0];
});
after(async () => {
  await mf.dispose();
});
test("encrypted grants reject tampering and cross-account transplantation", async () => {
  const value = await seal(
    env,
    { access_token: "fixture-access" },
    "account:one",
  );
  assert.ok(!value.includes("fixture-access"));
  assert.equal(
    (await unseal(env, value, "account:one")).access_token,
    "fixture-access",
  );
  await assert.rejects(unseal(env, value, "account:two"));
  await assert.rejects(unseal(env, value.slice(0, -3) + "zzz", "account:one"));
  assert.ok(
    providerInfo({}).every((p) => !p.oauth_ready && !p.publishing_enabled),
  );
});
test("multiple same-platform accounts can be planned without pretending they are connected", async () => {
  for (const [platform, handle] of [
    ["instagram", "cars_main"],
    ["instagram", "cars_daily"],
    ["instagram", "cars_classics"],
    ["tiktok", "cars_main"],
    ["tiktok", "cars_daily"],
    ["youtube", "cars"],
  ])
    await json(`/api/niches/${niche.id}/accounts`, "POST", {
      platform,
      handle,
      display_name: handle,
    });
  const rows = await json(`/api/niches/${niche.id}/accounts`);
  assert.equal(rows.length, 6);
  assert.equal(rows.filter((a) => a.platform === "instagram").length, 3);
  assert.ok(
    rows.every((a) => a.status === "disconnected" && !a.encrypted_tokens),
  );
  assert.equal(
    (
      await request(
        `/api/niches/${niche.id}/accounts`,
        "GET",
        undefined,
        otherCookie,
      )
    ).status,
    404,
  );
  const draft = await json(`/api/niches/${niche.id}/posts`, "POST", {
    title: "Planning draft",
  });
  assert.equal(draft.destinations.length, 6);
});
async function oauthStart(platform = "youtube") {
  const r = await beginOAuth(
    new Request("http://localhost/start", { headers: { Cookie: cookie } }),
    env,
    user,
    niche,
    platform,
  );
  const { url } = await r.json();
  return {
    state: new URL(url).searchParams.get("state"),
    browser: r.headers.get("set-cookie").split(";")[0],
    url,
  };
}
function googleFixture(channel) {
  return async (url, init) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      assert.equal(init.method, "POST");
      assert.ok(init.body.get("code_verifier"));
      return response({
        access_token: "fixture-access-" + channel,
        refresh_token: "fixture-refresh",
        expires_in: 3600,
      });
    }
    return response({
      items: [{ id: channel, snippet: { title: "Channel " + channel } }],
    });
  };
}
test("OAuth is browser/session bound, one-use, encrypted and permits multiple channels", async () => {
  const start = await oauthStart();
  assert.equal(
    new URL(start.url).searchParams.get("code_challenge_method"),
    "S256",
  );
  const callback = `http://localhost/api/oauth/youtube/callback?state=${start.state}&code=fixture`;
  await assert.rejects(
    finishOAuth(
      new Request(callback, {
        headers: { Cookie: "niches_oauth=" + "0".repeat(64) },
      }),
      env,
      "youtube",
      googleFixture("channel1"),
    ),
  );
  const result = await finishOAuth(
    new Request(callback, { headers: { Cookie: start.browser } }),
    env,
    "youtube",
    googleFixture("channel1"),
  );
  assert.equal(result.status, 303);
  await assert.rejects(
    finishOAuth(
      new Request(callback, { headers: { Cookie: start.browser } }),
      env,
      "youtube",
      googleFixture("channel1"),
    ),
  );
  const next = await oauthStart();
  await finishOAuth(
    new Request(
      `http://localhost/api/oauth/youtube/callback?state=${next.state}&code=fixture`,
      { headers: { Cookie: next.browser } },
    ),
    env,
    "youtube",
    googleFixture("channel2"),
  );
  const rows = (
    await db
      .prepare(
        "SELECT * FROM accounts WHERE niche_id=? AND connection_kind='oauth'",
      )
      .bind(niche.id)
      .all()
  ).results;
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every(
      (a) =>
        a.encrypted_tokens.startsWith("v1.") &&
        !a.encrypted_tokens.includes("fixture-access"),
    ),
  );
});
test("Meta Page selection reveals no tokens and cannot be claimed by another user", async () => {
  const start = await oauthStart("facebook");
  const fake = async (url) =>
    String(url).includes("/me/accounts")
      ? response({
          data: [
            {
              id: "page1",
              name: "Cars Page",
              access_token: "fixture-page-access",
            },
            {
              id: "page2",
              name: "Other Page",
              access_token: "fixture-other-access",
            },
          ],
        })
      : response({ access_token: "fixture-meta-grant", expires_in: 3600 });
  const result = await finishOAuth(
    new Request(
      `http://localhost/api/oauth/facebook/callback?state=${start.state}&code=fixture`,
      { headers: { Cookie: start.browser } },
    ),
    env,
    "facebook",
    fake,
  );
  const ticket = new URL(result.headers.get("location")).searchParams.get(
    "connect_ticket",
  );
  assert.ok(ticket);
  const choices = await selectConnections(env, user, niche.id, ticket);
  assert.equal(choices.length, 2);
  assert.ok(!JSON.stringify(choices).includes("fixture-page-access"));
  await assert.rejects(
    selectConnections(env, otherUser, niche.id, ticket, ["page1"]),
  );
  await assert.rejects(
    selectConnections(env, user, niche.id, ticket, ["not-owned"]),
  );
  await selectConnections(env, user, niche.id, ticket, ["page1"]);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM accounts WHERE provider_id IN ('page1','page2')",
        )
        .first()
    ).n,
    1,
  );
});
async function fixturePost(accounts, overrides = {}) {
  const media = crypto.randomUUID(),
    key = "fixture/" + media;
  const bytes = new Uint8Array([
    0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109,
  ]);
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: "video/mp4" },
  });
  await db
    .prepare(
      "INSERT INTO media(id,niche_id,object_key,filename,mime,size,duration_seconds,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .bind(
      media,
      niche.id,
      key,
      "original.mp4",
      "video/mp4",
      bytes.length,
      12,
      now(),
    )
    .run();
  return json(`/api/niches/${niche.id}/posts`, "POST", {
    media_id: media,
    title: "Master title",
    caption: "Master caption",
    destinations: accounts.map((a) => a.id),
    overrides,
  });
}
test("master caption fallback and per-account overrides survive a multi-account approval", async () => {
  const accounts = (
    await db
      .prepare(
        "SELECT * FROM accounts WHERE connection_kind='oauth' AND platform='youtube'",
      )
      .all()
  ).results;
  const draft = await fixturePost(accounts, {
    youtube: { caption: "Platform caption", title: "" },
    [accounts[0].id]: { caption: "One channel only" },
  });
  const raw = await db
    .prepare("SELECT * FROM posts WHERE id=?")
    .bind(draft.id)
    .first();
  assert.equal(resolveOptions(raw, accounts[0]).caption, "One channel only");
  assert.equal(resolveOptions(raw, accounts[1]).caption, "Platform caption");
  assert.equal(resolveOptions(raw, accounts[0]).title, "Master title");
  const data = {
    confirmed: true,
    accounts: Object.fromEntries(
      accounts.map((a) => [a.id, { privacy: "private", made_for_kids: false }]),
    ),
  };
  const results = await Promise.allSettled([
    queuePost(env, user, niche, raw, data),
    queuePost(env, user, niche, raw, data),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM publications WHERE post_id=?")
        .bind(draft.id)
        .first()
    ).n,
    2,
  );
  let initCount = 0,
    uploadCount = 0;
  const mock = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("uploadType=resumable")) {
      initCount++;
      assert.equal(JSON.parse(init.body).snippet.title, "Master title");
      return new Response("", {
        status: 200,
        headers: {
          location:
            "https://www.googleapis.com/upload/fixture?session=" + initCount,
        },
      });
    }
    if (u.includes("/upload/fixture")) {
      if (init.headers["Content-Range"].startsWith("bytes */"))
        return new Response(null, { status: 308 });
      uploadCount++;
      return response({ id: "video" + new URL(u).searchParams.get("session") });
    }
    return response({
      items: [
        {
          status: { uploadStatus: "processed", privacyStatus: "private" },
          processingDetails: { processingStatus: "succeeded" },
        },
      ],
    });
  };
  for (let i = 0; i < 3; i++) {
    await db.prepare("UPDATE publications SET next_attempt_at=NULL").run();
    await runOutbox(env, 10, mock);
  }
  const rows = (
    await db
      .prepare("SELECT * FROM publications WHERE post_id=?")
      .bind(draft.id)
      .all()
  ).results;
  assert.ok(rows.every((r) => r.status === "published" && r.provider_post_id));
  assert.equal(initCount, 2);
  assert.equal(uploadCount, 2);
  await runOutbox(env, 10, mock);
  assert.equal(initCount, 2);
  assert.equal(
    (
      await db
        .prepare("SELECT delivery_status FROM posts WHERE id=?")
        .bind(draft.id)
        .first()
    ).delivery_status,
    "published",
  );
  const grants = (
    await db.prepare("SELECT COUNT(*) AS n FROM media_grants").first()
  ).n;
  assert.ok(grants >= 2);
  assert.equal(
    (
      await request(`/api/niches/${niche.id}/posts/${draft.id}`, "PATCH", {
        caption: "changed",
      })
    ).status,
    409,
  );
});
test("scheduled jobs stay queued until due and uncertain submissions never retry silently", async () => {
  const account = await db
    .prepare("SELECT * FROM accounts WHERE provider_id='page1'")
    .first();
  const draft = await fixturePost([account]);
  // This test targets Facebook's one-request image publish path.
  await db
    .prepare("UPDATE media SET mime='image/jpeg' WHERE id=?")
    .bind(draft.media_id)
    .run();
  const raw = await db
    .prepare("SELECT * FROM posts WHERE id=?")
    .bind(draft.id)
    .first();
  await queuePost(env, user, niche, raw, {
    confirmed: true,
    scheduled_at: new Date(Date.now() + 3600000).toISOString(),
    accounts: {},
  });
  let sends = 0;
  const networkFailure = async () => {
    sends++;
    throw new Error("simulated connection loss");
  };
  await runOutbox(env, 10, networkFailure);
  assert.equal(sends, 0);
  await db
    .prepare("UPDATE publications SET next_attempt_at=NULL WHERE post_id=?")
    .bind(draft.id)
    .run();
  await runOutbox(env, 10, networkFailure);
  assert.equal(sends, 1);
  let pub = await db
    .prepare("SELECT * FROM publications WHERE post_id=?")
    .bind(draft.id)
    .first();
  assert.equal(pub.status, "needs_review");
  await runOutbox(env, 10, networkFailure);
  assert.equal(sends, 1);
  await assert.rejects(retryPublication(env, user, niche, pub.id, {}));
  await retryPublication(env, user, niche, pub.id, {
    checked_not_published: true,
  });
  await runOutbox(env, 10, async () => response({ id: "facebook-post" }));
  pub = await db
    .prepare("SELECT * FROM publications WHERE id=?")
    .bind(pub.id)
    .first();
  assert.equal(pub.status, "published");
});
test("TikTok visibility, duration and consent use actual creator capabilities", () => {
  const a = { platform: "tiktok" },
    m = { mime: "video/mp4", duration_seconds: 12 },
    p = { title: "Title", caption: "Caption" },
    creator = {
      privacy_level_options: ["SELF_ONLY"],
      max_video_post_duration_sec: 60,
    };
  assert.throws(() =>
    validatePost(
      a,
      m,
      p,
      { privacy: "PUBLIC_TO_EVERYONE", tiktok_consent: true },
      creator,
    ),
  );
  assert.throws(() => validatePost(a, m, p, { privacy: "SELF_ONLY" }, creator));
  validatePost(
    a,
    m,
    p,
    { privacy: "SELF_ONLY", tiktok_consent: true },
    creator,
  );
  assert.throws(() =>
    validatePost(
      a,
      { ...m, duration_seconds: 100 },
      p,
      { privacy: "SELF_ONLY", tiktok_consent: true },
      creator,
    ),
  );
});
test("Facebook and TikTok remain processing until the provider reports completion", async () => {
  const base = {
    env,
    token: "fixture-access",
    media: { mime: "video/mp4" },
    post: { title: "T", caption: "C" },
    options: {},
    fetcher: async () =>
      response({
        status: {
          video_status: "ready",
          publishing_phase: { status: "in_progress" },
        },
      }),
  };
  assert.equal(
    (
      await advancePublisher({
        ...base,
        account: { platform: "facebook" },
        state: { phase: "poll", video_id: "1" },
      })
    ).status,
    "processing",
  );
  assert.equal(
    (
      await advancePublisher({
        ...base,
        account: { platform: "facebook" },
        state: { phase: "poll", video_id: "1" },
        fetcher: async () =>
          response({ status: { publishing_phase: { status: "complete" } } }),
      })
    ).status,
    "published",
  );
  assert.equal(
    (
      await advancePublisher({
        ...base,
        account: { platform: "tiktok" },
        state: { phase: "poll", publish_id: "fixture" },
        fetcher: async () =>
          response({
            data: { status: "PROCESSING_DOWNLOAD" },
            error: { code: "ok" },
          }),
      })
    ).status,
    "processing",
  );
});
