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
  providerJSON,
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
        "kv-media",
        "reset-email",
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
  INSTAGRAM_APP_ID: "fixture-instagram-app",
  INSTAGRAM_APP_SECRET: "fixture-instagram-secret",
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
test("TikTok errors expose only allowlisted provider codes", async () => {
  const fetcher = async () => new Response(JSON.stringify({ error: { code: "url_ownership_unverified", message: "private detail" } }), { status: 403 });
  await assert.rejects(providerJSON("https://open.tiktokapis.com/v2/post/publish/video/init/", {}, fetcher), /url_ownership_unverified/);
  const unsafe = async () => new Response(JSON.stringify({ error: { code: "sensitive_value", message: "secret detail" } }), { status: 403 });
  await assert.rejects(providerJSON("https://open.tiktokapis.com/v2/post/publish/video/init/", {}, unsafe), e => !e.message.includes("sensitive_value") && !e.message.includes("secret detail"));
});

test("TikTok readiness requires verified media URL ownership even when credentials and publishing switch exist", () => {
  const unverified = providerInfo({ ...settings, TIKTOK_MEDIA_URL_VERIFIED: "0" });
  const tiktok = unverified.find((p) => p.id === "tiktok");
  assert.ok(tiktok.oauth_ready);
  assert.equal(tiktok.publishing_enabled, false);
  assert.match(tiktok.reason, /ownership verification/i);
  assert.equal(unverified.find((p) => p.id === "facebook").publishing_enabled, true);
  const verified = providerInfo(settings).find((p) => p.id === "tiktok");
  assert.equal(verified.publishing_enabled, true);
  assert.equal(providerInfo({ ...settings, TIKTOK_PUBLISH_ENABLED: "0" })
    .find((p) => p.id === "tiktok").publishing_enabled, false);
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
test("Facebook Connect direct link follows a native GET and cannot bypass login", async () => {
  const route = `http://localhost/api/niches/${niche.id}/accounts/facebook/connect/start`;
  const anonymous = await worker.fetch(
    new Request(route, { headers: { Accept: "text/html" } }),
    env,
  );
  assert.equal(anonymous.status, 401, "An unsigned-in visitor cannot begin OAuth");

  const response = await worker.fetch(
    new Request(route, {
      headers: {
        Cookie: cookie,
        Accept: "text/html",
        "Sec-Fetch-Mode": "navigate",
      },
    }),
    env,
  );
  assert.equal(response.status, 303, "Normal browser links must redirect to Meta");
  const destination = new URL(response.headers.get("location"));
  assert.equal(destination.origin, "https://www.facebook.com");
  assert.ok(destination.pathname.endsWith("/dialog/oauth"));
  assert.equal(destination.searchParams.get("client_id"), settings.META_APP_ID);
  assert.equal(destination.searchParams.get("redirect_uri"), settings.APP_URL + "/api/oauth/facebook/callback");
  assert.ok(destination.searchParams.get("scope")?.includes("pages_manage_posts"));
  assert.match(destination.searchParams.get("state") || "", /^[a-f0-9]{64}$/);
  assert.match(response.headers.get("set-cookie") || "", /niches_oauth=[a-f0-9]{64};/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("Facebook Connect uses browser-native navigation and preserves scoped OAuth cookie", async () => {
  const route = `http://localhost/api/niches/${niche.id}/accounts/facebook/connect`;
  const response = await worker.fetch(
    new Request(route, {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        Cookie: cookie,
        Accept: "text/html",
        "Sec-Fetch-Mode": "navigate",
      },
    }),
    env,
  );
  assert.equal(response.status, 303);
  const destination = new URL(response.headers.get("location"));
  assert.equal(destination.origin, "https://www.facebook.com");
  assert.ok(destination.pathname.startsWith("/v") && destination.pathname.endsWith("/dialog/oauth"));
  assert.equal(destination.searchParams.get("client_id"), settings.META_APP_ID);
  assert.equal(destination.searchParams.get("redirect_uri"), settings.APP_URL + "/api/oauth/facebook/callback");
  assert.ok(destination.searchParams.get("scope")?.includes("pages_manage_posts"));
  assert.match(response.headers.get("set-cookie") || "", /niches_oauth=[a-f0-9]{64};/);
  assert.ok(response.headers.get("content-security-policy")?.includes("form-action 'self' https://www.facebook.com"));
});
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
test("Facebook OAuth initiation returns a real Meta URL and scoped callback cookie", async () => {
  const start = await oauthStart("facebook");
  const url = new URL(start.url);
  assert.equal(url.hostname, "www.facebook.com");
  assert.equal(url.searchParams.get("client_id"), settings.META_APP_ID);
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "http://localhost/api/oauth/facebook/callback",
  );
  assert.ok(url.searchParams.get("scope").includes("pages_manage_posts"));
  assert.match(start.browser, /^niches_oauth=[a-f0-9]{64}$/);
});

test("Instagram Login opens Instagram directly and connects the authorised IG account", async () => {
  const start = await oauthStart("instagram");
  const url = new URL(start.url);
  assert.equal(url.hostname, "www.instagram.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), settings.INSTAGRAM_APP_ID);
  assert.equal(url.searchParams.get("enable_fb_login"), "false");
  assert.ok(url.searchParams.get("scope").includes("instagram_business_content_publish"));
  assert.ok(!url.searchParams.get("scope").includes("pages_show_list"));
  const visited = [];
  const mock = async (requestUrl) => {
    visited.push(String(requestUrl));
    if (String(requestUrl).includes("/oauth/access_token")) return response({
      access_token: "short-ig-token", user_id: "ig-test",
      expires_in: 3600,
    });
    if (String(requestUrl).includes("/access_token?")) return response({
      access_token: "long-ig-token", expires_in: 5184000,
    });
    if (String(requestUrl).includes("/me?")) return response({
      id: "ig-test", username: "crazycartoons", account_type: "CREATOR",
    });
    throw Error("Unexpected Instagram request");
  };
  const result = await finishOAuth(
    new Request(
      `http://localhost/api/oauth/instagram/callback?state=${start.state}&code=fixture`,
      { headers: { Cookie: start.browser } },
    ),
    env, "instagram", mock,
  );
  assert.equal(new URL(result.headers.get("location")).searchParams.get("connection"), "connected");
  const connected = await db.prepare(
    "SELECT * FROM accounts WHERE provider_id='ig-test' AND platform='instagram'"
  ).first();
  assert.equal(connected.connection_kind, "instagram_login");
  const grant = await unseal(env, connected.encrypted_tokens, accountContext(connected));
  assert.equal(grant.access_token, "long-ig-token");
  assert.ok(visited.every((v) => !v.includes("graph.facebook.com")));
  const publication = await advancePublisher({
    env, account: connected, token: grant.access_token,
    media: { mime: "image/jpeg" },
    post: { title: "Test", caption: "Test photo" },
    options: {}, state: {}, mediaURL: "https://example.test/photo.jpg",
    fetcher: async (requestUrl) => {
      assert.equal(new URL(String(requestUrl)).hostname, "graph.instagram.com");
      return response({ id: "ig-media-container" });
    },
  });
  assert.equal(publication.state.container_id, "ig-media-container");
});

test("Instagram Unified Login uses config_id and saves assigned business Instagram accounts", async () => {
  env.INSTAGRAM_CONFIG_ID = "957793303720161";
  try {
    const start = await oauthStart("instagram");
    const url = new URL(start.url);
    assert.equal(url.hostname, "www.facebook.com");
    assert.equal(url.searchParams.get("config_id"), env.INSTAGRAM_CONFIG_ID);
    assert.equal(url.searchParams.get("client_id"), settings.META_APP_ID);
    assert.equal(url.searchParams.get("prompt"), "login");
    assert.equal(url.searchParams.get("scope"), null);
    assert.equal(url.searchParams.get("redirect_uri"),
      settings.APP_URL + "/api/oauth/instagram/callback");
    const visited = [];
    const mock = async (requestUrl) => {
      visited.push(String(requestUrl));
      if (String(requestUrl).includes("/oauth/access_token")) return response({
        access_token: "unified-system-user-token",
      });
      if (String(requestUrl).includes("/me/assigned_instagram_accounts")) return response({
        data: [{ id: "ig-unified-1", username: "craigscartoons" }],
      });
      throw Error("Unexpected Unified Login request");
    };
    const result = await finishOAuth(
      new Request(
        `http://localhost/api/oauth/instagram/callback?state=${start.state}&code=fixture`,
        { headers: { Cookie: start.browser } },
      ), env, "instagram", mock,
    );
    assert.equal(new URL(result.headers.get("location")).searchParams.get("connection"), "connected");
    const connected = await db.prepare(
      "SELECT * FROM accounts WHERE provider_id='ig-unified-1' AND platform='instagram'"
    ).first();
    assert.equal(connected.connection_kind, "instagram_unified");
    const grant = await unseal(env, connected.encrypted_tokens, accountContext(connected));
    assert.equal(grant.access_token, "unified-system-user-token");
    assert.equal(grant.expires_at, null);
    assert.ok(visited.every((url) => new URL(url).hostname === "graph.facebook.com"));
    const publication = await advancePublisher({
      env, account: connected, token: grant.access_token,
      media: { mime: "image/jpeg" },
      post: { title: "Test", caption: "Unified image" },
      options: {}, state: {}, mediaURL: "https://example.test/photo.jpg",
      fetcher: async (requestUrl) => {
        assert.equal(new URL(String(requestUrl)).hostname, "graph.facebook.com");
        return response({ id: "unified-container" });
      },
    });
    assert.equal(publication.state.container_id, "unified-container");
  } finally {
    delete env.INSTAGRAM_CONFIG_ID;
  }
});

test("failed Facebook OAuth returns a scoped diagnostic instead of silently landing on Accounts", async () => {
  const start = await oauthStart("facebook");
  const response = await finishOAuth(
    new Request(
      `http://localhost/api/oauth/facebook/callback?state=${start.state}&code=bad-code`,
      { headers: { Cookie: start.browser } },
    ),
    env,
    "facebook",
    async () =>
      new Response(
        JSON.stringify({ error: { code: 100, message: "Invalid OAuth redirect URI" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
  );
  assert.equal(response.status, 303);
  const destination = new URL(response.headers.get("location"));
  assert.equal(destination.searchParams.get("section"), "Accounts");
  assert.equal(destination.searchParams.get("platform"), "facebook");
  assert.equal(destination.searchParams.get("connection"), "failed");
  const noticeId = destination.searchParams.get("connection_error");
  assert.match(noticeId, /^[a-f0-9-]{36}$/);
  assert.ok(!response.headers.get("location").includes("Invalid OAuth"));
  const note = await db
    .prepare("SELECT user_id,niche_id,message FROM notifications WHERE id=?")
    .bind(noticeId)
    .first();
  assert.equal(note.user_id, user.id);
  assert.equal(note.niche_id, niche.id);
  assert.match(note.message, /Meta rejected the login return address/i);
  const otherNotices = await json("/api/notifications", "GET", undefined, otherCookie);
  assert.ok(otherNotices.every((entry) => entry.id !== noticeId));
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
test("Instagram direct and Unified Login accounts can be approved without reconnecting", async () => {
  for (const kind of ["instagram_login", "instagram_unified"]) {
    const providerId = "publish-" + kind;
    await saveConnection(env, niche.id, {
      platform: "instagram",
      provider_id: providerId,
      name: providerId,
      connection_kind: kind,
      tokens: { access_token: "fixture-" + kind, expires_at: null },
    });
    const account = await db
      .prepare("SELECT * FROM accounts WHERE niche_id=? AND platform='instagram' AND provider_id=?")
      .bind(niche.id, providerId)
      .first();
    assert.equal(account.connection_kind, kind);
    const draft = await fixturePost([account]);
    const raw = await db.prepare("SELECT * FROM posts WHERE id=?").bind(draft.id).first();
    const result = await queuePost(env, user, niche, raw, {
      confirmed: true,
      accounts: { [account.id]: {} },
    });
    assert.equal(result.status, "queued");
    const publications = (
      await db.prepare("SELECT account_id,status FROM publications WHERE post_id=?")
        .bind(draft.id).all()
    ).results;
    assert.deepEqual(publications, [{ account_id: account.id, status: "pending" }]);
  }
});
test("Instagram Collab schedules one publisher and rejects a second destination", async () => {
  const accounts = (
    await db.prepare("SELECT * FROM accounts WHERE niche_id=? AND platform='instagram' AND status='connected' ORDER BY connection_kind DESC")
      .bind(niche.id).all()
  ).results;
  const publisher = accounts.find((account) => account.connection_kind === "instagram_unified");
  const other = accounts.find((account) => account.id !== publisher.id);
  const both = await fixturePost([publisher, other]);
  const single = await fixturePost([publisher]);
  const settings = { [publisher.id]: { instagram_collaborator: "@podclipcasts" } };
  const approved = {
    confirmed: true,
    scheduled_at: new Date(Date.now() + 300000).toISOString(),
    accounts: settings,
  };
  const raw = (draft) => db.prepare("SELECT * FROM posts WHERE id=?").bind(draft.id).first();
  await assert.rejects(queuePost(env, user, niche, await raw(both), approved), /one Instagram publishing account/);
  assert.equal((await raw(both)).delivery_status, "draft");
  assert.equal((await queuePost(env, user, niche, await raw(single), approved)).status, "scheduled");
  assert.deepEqual(JSON.parse((await raw(single)).options_json), settings);
  assert.deepEqual((await db.prepare("SELECT account_id FROM publications WHERE post_id=?")
    .bind(single.id).all()).results, [{ account_id: publisher.id }]);
});
test("single-account draft copy leaves the original multi-account draft intact", async () => {
  const accounts = (
    await db
      .prepare("SELECT * FROM accounts WHERE connection_kind='oauth' AND platform='youtube'")
      .all()
  ).results;
  const original = await fixturePost(accounts, {
    youtube: { caption: "YouTube caption" },
    [accounts[0].id]: { caption: "Account-specific caption" },
  });
  const isolated = await json(`/api/niches/${niche.id}/posts`, "POST", {
    title: original.title,
    caption: original.caption,
    media_id: original.media_id,
    destinations: [accounts[0].id],
    overrides: {
      youtube: original.overrides.youtube,
      [accounts[0].id]: original.overrides[accounts[0].id],
    },
  });
  assert.notEqual(isolated.id, original.id);
  assert.equal(isolated.media_id, original.media_id);
  assert.deepEqual(isolated.destinations, [accounts[0].id]);
  assert.equal(isolated.status, "draft");
  const drafts = await json(`/api/niches/${niche.id}/posts`, "GET");
  const intact = drafts.find((post) => post.id === original.id);
  assert.ok(intact);
  assert.deepEqual(intact.destinations, accounts.map((a) => a.id));
  assert.equal(intact.status, "draft");
  assert.equal(isolated.overrides[accounts[0].id].caption, "Account-specific caption");
});
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
test("owner can confirm a provider-uncertain post already live without a second upload", async () => {
  const account = await db.prepare("SELECT * FROM accounts WHERE provider_id='page1'").first();
  const draft = await fixturePost([account]);
  await db.prepare("UPDATE media SET mime='image/jpeg' WHERE id=?").bind(draft.media_id).run();
  const raw = await db.prepare("SELECT * FROM posts WHERE id=?").bind(draft.id).first();
  await queuePost(env, user, niche, raw, { confirmed: true, accounts: {} });
  let submissions = 0;
  await runOutbox(env, 10, async () => {
    submissions++;
    throw new Error("Provider connection lost after submission");
  });
  const pub = await db.prepare("SELECT * FROM publications WHERE post_id=?").bind(draft.id).first();
  assert.equal(pub.status, "needs_review");
  const url = `/api/niches/${niche.id}/publications/${pub.id}/confirm-live`;
  assert.ok((await request(url, "POST", { confirmed_live: true }, otherCookie)).status >= 400);
  assert.equal((await request(url, "POST", { confirmed_live: false })).status, 400);
  const confirmation = await json(url, "POST", { confirmed_live: true });
  assert.deepEqual(confirmation, { status: "published", verification: "owner_verified" });
  const confirmed = await db.prepare("SELECT * FROM publications WHERE id=?").bind(pub.id).first();
  assert.equal(confirmed.status, "published");
  assert.equal(confirmed.error_code, "owner_verified");
  const updatedPost = await db.prepare("SELECT delivery_status FROM posts WHERE id=?").bind(draft.id).first();
  assert.equal(updatedPost.delivery_status, "published");
  assert.equal((await request(url, "POST", { confirmed_live: true })).status, 409);
  await assert.rejects(retryPublication(env, user, niche, pub.id, { checked_not_published: true }));
  await runOutbox(env, 10, async () => {
    submissions++;
    throw new Error("Do not send again");
  });
  assert.equal(submissions, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM publications WHERE post_id=?").bind(draft.id).first()).total, 1);
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
