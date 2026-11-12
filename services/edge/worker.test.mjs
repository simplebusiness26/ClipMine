import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { scheduled } from "./worker.mjs";
let mf, db, first, second, niche, niche2, media, post;
const origin = "http://localhost";
async function req(
  path,
  { method = "GET", data, cookie, headers = {}, raw } = {},
) {
  return mf.dispatchFetch(origin + path, {
    method,
    headers: {
      ...(method === "GET" ? {} : { origin }),
      ...(cookie ? { cookie } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: raw || (data ? JSON.stringify(data) : undefined),
  });
}
async function checked(path, options = {}, status = 200) {
  const r = await req(path, options);
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return { data, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: [
        "worker",
        "kv-media",
        "reset-email",
        "security",
        "db",
        "token-vault",
        "social-oauth",
        "publishers",
        "outbox",
        "brands",
      ].map((name) => ({
        type: "ESModule",
        path: `services/edge/${name}.mjs`,
      })),
      compatibilityDate: "2026-09-01",
      d1Databases: ["DB"],
      r2Buckets: ["MEDIA"],
      bindings: { MAX_UPLOAD_MB: "25" },
      log: undefined,
    }),
  );
  db = await mf.getD1Database("DB");
  const sql = (
    await Promise.all(
      (await readdir("migrations"))
        .filter((n) => n.endsWith(".sql"))
        .sort()
        .map((n) => readFile("migrations/" + n, "utf8")),
    )
  ).join("\n");
  for (const statement of sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
});
after(async () => {
  await mf?.dispose();
});
test("anonymous protection and same-origin CSRF rejection", async () => {
  await checked("/api/niches", {}, 401);
  await checked(
    "/api/auth/register",
    {
      method: "POST",
      data: { email: "first@example.test", password: "first long password" },
      headers: { origin: "https://evil.example" },
    },
    403,
  );
});
test("register two users, hashed passwords and secure scoped sessions", async () => {
  first = (
    await checked("/api/auth/register", {
      method: "POST",
      data: { email: "first@example.test", password: "first long password" },
    })
  ).cookie;
  second = (
    await checked("/api/auth/register", {
      method: "POST",
      data: { email: "second@example.test", password: "second long password" },
    })
  ).cookie;
  assert.ok(first && second);
  const row = await db
    .prepare("SELECT password_hash FROM users LIMIT 1")
    .first();
  assert.ok(row.password_hash.startsWith("pbkdf2:100000:"));
  assert.ok(!row.password_hash.includes("password"));
  await checked("/api/auth/me", { cookie: first });
  await checked(
    "/api/auth/login",
    {
      method: "POST",
      data: { email: "first@example.test", password: "wrong" },
    },
    401,
  );
  await checked(
    "/api/auth/forgot",
    { method: "POST", data: { email: "first@example.test" } },
    503,
  );
});
test("create independent niches and enforce ownership on all workspace routes", async () => {
  niche = (
    await checked(
      "/api/niches",
      {
        method: "POST",
        cookie: first,
        data: { name: "Cars", description: "Original motoring stories" },
      },
      201,
    )
  ).data.id;
  niche2 = (
    await checked(
      "/api/niches",
      { method: "POST", cookie: second, data: { name: "Football" } },
      201,
    )
  ).data.id;
  const own = await checked("/api/niches", { cookie: first });
  assert.equal(own.data.length, 1);
  assert.equal(own.data[0].name, "Cars");
  for (const suffix of [
    "",
    "/media",
    "/posts",
    "/accounts",
    "/analytics",
    "/activity",
    "/ideas",
    "/revenue",
  ])
    await checked(`/api/niches/${niche}${suffix}`, { cookie: second }, 404);
  await checked(
    `/api/niches/${niche}`,
    { method: "PATCH", cookie: second, data: { name: "Stolen" } },
    404,
  );
});
test("master release preserves child brands, OAuth tokens, scheduled posts and tenant isolation", async () => {
  const workspace = (await checked("/api/niches", {
    method: "POST", cookie: first, data: { name: "Release fixture" },
  }, 201)).data.id;
  const initial = (await checked(`/api/niches/${workspace}/brands`, { cookie: first })).data;
  assert.equal(initial.length, 1);
  const master = initial[0];
  assert.equal(master.is_master, 1);
  const child = (await checked(`/api/niches/${workspace}/brands`, {
    method: "POST", cookie: first,
    data: { name: "War Clipcast", parent_brand_id: master.id },
  }, 201)).data;
  const direct = (await checked(`/api/niches/${workspace}/accounts`, {
    method: "POST", cookie: first,
    data: { platform: "instagram", display_name: "Master IG", handle: "master.example", brand_id: master.id },
  }, 201)).data.id;
  const childAccount = (await checked(`/api/niches/${workspace}/accounts`, {
    method: "POST", cookie: first,
    data: { platform: "youtube", display_name: "Child YouTube", handle: "child.example", brand_id: child.id },
  }, 201)).data.id;
  await db.prepare("UPDATE accounts SET status='connected',encrypted_tokens='encrypted-fixture' WHERE id=?").bind(direct).run();
  const scheduled = crypto.randomUUID();
  const stamp = new Date().toISOString();
  await db.prepare(
    "INSERT INTO posts(id,niche_id,media_id,title,caption,destinations_json,overrides_json,status,created_at,updated_at,delivery_status,publish_mode,brand_id,scheduled_at) VALUES (?,?,NULL,?,? ,?,'{}','scheduled',?,?,'scheduled','direct',?,?)",
  ).bind(scheduled, workspace, "Scheduled master post", "Keep schedule", JSON.stringify([direct]), stamp, stamp, master.id, "2027-01-01T18:00:00.000Z").run();
  await checked(`/api/niches/${workspace}/brands/${master.id}/release-preview`, {
    cookie: second,
  }, 404);
  const preview = (await checked(`/api/niches/${workspace}/brands/${master.id}/release-preview`, {
    cookie: first,
  })).data;
  assert.equal(preview.child_brands.length, 1);
  assert.equal(preview.direct_accounts, 1);
  assert.equal(preview.scheduled_posts, 1);
  await checked(`/api/niches/${workspace}/brands/${master.id}/release`, {
    method: "POST", cookie: first, data: { confirm: "wrong", name: master.name },
  }, 400);
  const released = (await checked(`/api/niches/${workspace}/brands/${master.id}/release`, {
    method: "POST", cookie: first, data: { confirm: "RELEASE", name: master.name },
  })).data;
  assert.equal(released.released_child_brands, 1);
  assert.equal(released.transferred_accounts, 1);
  assert.equal(released.preserved_scheduled_posts, 1);
  const rows = (await checked(`/api/niches/${workspace}/brands`, { cookie: first })).data;
  const standalone = rows.find((b) => b.name === "Release fixture Accounts");
  assert.ok(standalone);
  assert.equal(rows.find((b) => b.id === master.id).status, "archived");
  assert.equal(rows.find((b) => b.id === child.id).parent_brand_id, null);
  const directRow = await db.prepare("SELECT brand_id,status,encrypted_tokens FROM accounts WHERE id=?").bind(direct).first();
  const childRow = await db.prepare("SELECT brand_id FROM accounts WHERE id=?").bind(childAccount).first();
  assert.equal(directRow.brand_id, standalone.id);
  assert.equal(directRow.status, "connected");
  assert.equal(directRow.encrypted_tokens, "encrypted-fixture");
  assert.equal(childRow.brand_id, child.id);
  const postRow = await db.prepare("SELECT brand_id,delivery_status,scheduled_at,destinations_json FROM posts WHERE id=?").bind(scheduled).first();
  assert.equal(postRow.brand_id, standalone.id);
  assert.equal(postRow.delivery_status, "scheduled");
  assert.equal(postRow.scheduled_at, "2027-01-01T18:00:00.000Z");
  assert.deepEqual(JSON.parse(postRow.destinations_json), [direct]);
  await checked(`/api/niches/${workspace}/brands/${master.id}/release`, {
    method: "POST", cookie: first, data: { confirm: "RELEASE", name: master.name },
  }, 409);
  await checked(`/api/niches/${workspace}/brands/${master.id}/restore`, {
    method: "POST", cookie: first, data: {},
  });
  await checked(`/api/niches/${workspace}/brands/${child.id}`, {
    method: "PATCH", cookie: first, data: { parent_brand_id: master.id },
  });
  const moved = (await checked(`/api/niches/${workspace}/accounts/${direct}/brand`, {
    method: "POST", cookie: first, data: { brand_id: child.id },
  })).data;
  assert.equal(moved.brand_id, child.id);
});

test("validate uploads and keep object bytes private across users and niches", async () => {
  await checked(
    `/api/niches/${niche}/media`,
    {
      method: "POST",
      cookie: first,
      raw: "not an image",
      headers: { "Content-Type": "image/png", "Content-Length": "12" },
    },
    415,
  );
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
  media = (
    await checked(
      `/api/niches/${niche}/media`,
      {
        method: "POST",
        cookie: first,
        raw: png,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(png.length),
          "X-Filename": "original.png",
        },
      },
      201,
    )
  ).data.id;
  const bytes = await req(`/api/niches/${niche}/media/${media}`, {
    cookie: first,
  });
  assert.equal(bytes.status, 200);
  assert.equal(bytes.headers.get("cache-control"), "private, no-store");
  assert.equal((await bytes.arrayBuffer()).byteLength, png.length);
  await checked(`/api/niches/${niche}/media/${media}`, { cookie: second }, 404);
  await checked(
    `/api/niches/${niche2}/media/${media}`,
    { cookie: second },
    404,
  );
});
test("drafts reject cross-niche media and unauthorised destinations", async () => {
  await checked(
    `/api/niches/${niche2}/posts`,
    { method: "POST", cookie: second, data: { media_id: media } },
    404,
  );
  await checked(
    `/api/niches/${niche}/posts`,
    {
      method: "POST",
      cookie: first,
      data: { media_id: media, destinations: ["not-owned"] },
    },
    400,
  );
  post = (
    await checked(
      `/api/niches/${niche}/posts`,
      {
        method: "POST",
        cookie: first,
        data: {
          media_id: media,
          title: "Original story",
          caption: "Hello",
          overrides: { youtube: { title: "Custom title" } },
        },
      },
      201,
    )
  ).data.id;
  const rows = (await checked(`/api/niches/${niche}/posts`, { cookie: first }))
    .data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "draft");
  assert.deepEqual(rows[0].destinations, []);
  const exported = (
    await checked(`/api/niches/${niche}/posts/${post}/export`, {
      cookie: first,
    })
  ).data;
  assert.equal(exported.direct_publishing, false);
  assert.equal(exported.platforms.youtube.title, "Custom title");
  assert.ok(exported.media.download.includes(media));
});
test("review authorisation, immutable approved draft and duplicate prevention", async () => {
  await checked(
    `/api/niches/${niche}/posts/${post}/approve`,
    { method: "POST", cookie: first, data: { confirmed: false } },
    400,
  );
  await checked(
    `/api/niches/${niche}/posts/${post}/approve`,
    {
      method: "POST",
      cookie: first,
      data: { confirmed: true, scheduled_at: "invalid" },
    },
    400,
  );
  const approved = await checked(`/api/niches/${niche}/posts/${post}/approve`, {
    method: "POST",
    cookie: first,
    data: {
      confirmed: true,
      scheduled_at: new Date(Date.now() + 3600000).toISOString(),
    },
  });
  assert.equal(approved.data.status, "scheduled");
  await checked(
    `/api/niches/${niche}/posts/${post}/approve`,
    { method: "POST", cookie: first, data: { confirmed: true } },
    409,
  );
  await checked(
    `/api/niches/${niche}/posts/${post}`,
    { method: "PATCH", cookie: first, data: { caption: "changed" } },
    409,
  );
});
test("scheduled export reminders are idempotent and never report publication", async () => {
  await db
    .prepare("UPDATE posts SET scheduled_at=? WHERE id=?")
    .bind("2020-01-01T00:00:00Z", post)
    .run();
  await scheduled({ DB: db });
  await scheduled({ DB: db });
  const row = await db
    .prepare("SELECT status FROM posts WHERE id=?")
    .bind(post)
    .first();
  assert.equal(row.status, "export_ready");
  const notifications = (await checked("/api/notifications", { cookie: first }))
    .data;
  assert.equal(notifications.length, 1);
  assert.ok(
    notifications[0].message.includes("Direct publishing is not connected"),
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM publications").first()).n,
    0,
  );
});
test("brand kits, ideas and revenue remain niche scoped", async () => {
  await checked(`/api/niches/${niche}`, {
    method: "PATCH",
    cookie: first,
    data: {
      brand: { hashtags: "#original", logo_media_id: media },
      colour: "#ccff00",
    },
  });
  await checked(
    `/api/niches/${niche}/ideas`,
    { method: "POST", cookie: first, data: { text: "A great original idea" } },
    201,
  );
  await checked(
    `/api/niches/${niche}/revenue`,
    {
      method: "POST",
      cookie: first,
      data: {
        amount_pence: 2500,
        category: "sponsorship",
        note: "Test record",
        earned_at: "2026-10-26",
      },
    },
    201,
  );
  const analytics = (
    await checked(`/api/niches/${niche}/analytics`, { cookie: first })
  ).data;
  assert.equal(analytics.metrics.length, 0);
  assert.equal(analytics.revenue[0].amount_pence, 2500);
  const empty = (
    await checked(`/api/niches/${niche2}/ideas`, { cookie: second })
  ).data;
  assert.equal(empty.length, 0);
});
test("ClipMine and social connections fail closed without configuration", async () => {
  await checked(`/api/projects?niche_id=${niche}`, { cookie: first }, 503);
  await checked("/api/projects/not-owned/source", { cookie: first }, 503);
  await checked(
    `/api/niches/${niche}/accounts/youtube/connect`,
    { method: "POST", cookie: first, data: {} },
    503,
  );
  assert.ok(
    (await checked("/api/providers", { cookie: first })).data.every(
      (p) => p.status === "setup_required",
    ),
  );
});
test("logout revokes the session", async () => {
  await checked("/api/auth/logout", {
    method: "POST",
    cookie: second,
    data: {},
  });
  await checked("/api/auth/me", { cookie: second }, 401);
});

test("password reset is one-time and revokes existing sessions", async () => {
  const { hash } = await import("./security.mjs");
  const token = "a".repeat(64);
  const user = await db
    .prepare("SELECT id FROM users WHERE email=?")
    .bind("first@example.test")
    .first();
  await db
    .prepare("INSERT INTO password_resets VALUES (?,?,?)")
    .bind(
      await hash(token),
      user.id,
      new Date(Date.now() + 600000).toISOString(),
    )
    .run();
  await checked("/api/auth/reset", {
    method: "POST",
    data: { token, password: "A replacement long password" },
  });
  await checked("/api/auth/me", { cookie: first }, 401);
  await checked(
    "/api/auth/reset",
    {
      method: "POST",
      data: { token, password: "A replacement long password" },
    },
    400,
  );
  await checked("/api/auth/login", {
    method: "POST",
    data: {
      email: "first@example.test",
      password: "A replacement long password",
    },
  });
});

test("storage-disabled deployment keeps drafts available and fails uploads clearly", async () => {
  const { default: worker } = await import("./worker.mjs");
  const login = await checked("/api/auth/login", {
    method: "POST",
    data: {
      email: "first@example.test",
      password: "A replacement long password",
    },
  });
  const headers = { origin: "http://localhost", cookie: login.cookie };
  const config = await worker.fetch(
    new Request("http://localhost/api/config", { headers }),
    { DB: db },
  );
  assert.equal((await config.json()).storage_available, false);
  const response = await worker.fetch(
    new Request(`http://localhost/api/niches/${niche}/media`, {
      method: "POST",
      headers,
      body: "file",
    }),
    { DB: db },
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /storage access/);
  const drafts = await worker.fetch(
    new Request(`http://localhost/api/niches/${niche}/posts`, { headers }),
    { DB: db },
  );
  assert.equal(drafts.status, 200);
});


test("media deletion enforces ownership and unlinks harmless drafts while removing private bytes", async () => {
  // Earlier reset tests intentionally revoked the original sessions.
  await db.prepare("DELETE FROM rate_limits").run();
  const ownerCookie = (await checked("/api/auth/login", {
    method:"POST", data:{ email:"first@example.test", password:"A replacement long password" },
  })).cookie;

  const otherCookie = (await checked("/api/auth/login", {
    method:"POST", data:{ email:"second@example.test", password:"second long password" },
  })).cookie;
  const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0]);
  const uploaded = (await checked(
    `/api/niches/${niche}/media`,
    { method: "POST", cookie: ownerCookie, raw: png, headers: {
      "Content-Type": "image/png", "Content-Length": String(png.length), "X-Filename": "delete-me.png",
    } }, 201,
  )).data.id;
  const draft = (await checked(`/api/niches/${niche}/posts`, {
    method: "POST", cookie: ownerCookie, data: { title: "Draft to unlink", media_id: uploaded },
  }, 201)).data;
  await checked(`/api/niches/${niche}/media/${uploaded}`, {method:"DELETE",cookie:otherCookie},404);
  await checked(`/api/niches/${niche}/media/${uploaded}`, {method:"DELETE",cookie:ownerCookie});
  const posts = (await checked(`/api/niches/${niche}/posts`,{cookie:ownerCookie})).data;
  assert.equal(posts.find(p=>p.id===draft.id).media_id,null);
  await checked(`/api/niches/${niche}/media/${uploaded}`,{cookie:ownerCookie},404);
  const mediaList = (await checked(`/api/niches/${niche}/media`,{cookie:ownerCookie})).data;
  assert.ok(!mediaList.some(x=>x.id===uploaded));
});


test("approved exports protect media until explicit cancellation", async () => {
  // Earlier reset tests intentionally revoked the original sessions.
  await db.prepare("DELETE FROM rate_limits").run();
  const ownerCookie = (await checked("/api/auth/login", {
    method:"POST", data:{ email:"first@example.test", password:"A replacement long password" },
  })).cookie;

  const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0]);
  const uploaded = (await checked(`/api/niches/${niche}/media`,{
    method:"POST", cookie:ownerCookie, raw:png,
    headers:{"Content-Type":"image/png","Content-Length":String(png.length),"X-Filename":"protected.png"},
  },201)).data.id;
  const post = (await checked(`/api/niches/${niche}/posts`,{
    method:"POST",cookie:ownerCookie,data:{title:"Approved media",media_id:uploaded},
  },201)).data;
  await checked(`/api/niches/${niche}/posts/${post.id}/approve`,{
    method:"POST",cookie:ownerCookie,data:{confirmed:true},
  });
  await checked(`/api/niches/${niche}/media/${uploaded}`,{
    method:"DELETE",cookie:ownerCookie,
  },409);
  await checked(`/api/niches/${niche}/posts/${post.id}/cancel`,{
    method:"POST",cookie:ownerCookie,data:{},
  });
  await checked(`/api/niches/${niche}/media/${uploaded}`,{
    method:"DELETE",cookie:ownerCookie,
  });
});
