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
        "social-oauth", "brands",
        "publishers",
        "outbox",
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
test("master release retains real brand hierarchy, social authorisations and schedules", async () => {
  const workspace=(await checked("/api/niches",{
    method:"POST",cookie:first,data:{name:"Release workspace"},
  },201)).data.id;
  const master=(await checked(`/api/niches/${workspace}/brands`,{
    method:"POST",cookie:first,data:{name:"Podclipcast",is_master:true},
  },201)).data;
  const child=(await checked(`/api/niches/${workspace}/brands`,{
    method:"POST",cookie:first,data:{name:"War Clipcast"},
  },201)).data;
  assert.equal(child.parent_id,master.id);
  const account=(await checked(`/api/niches/${workspace}/accounts`,{
    method:"POST",cookie:first,data:{
      platform:"instagram",display_name:"Podclipcast IG",handle:"podclipcast.test",brand_id:master.id,
    },
  },201)).data.id;
  const childAccount=(await checked(`/api/niches/${workspace}/accounts`,{
    method:"POST",cookie:first,data:{
      platform:"youtube",display_name:"War Clipcast YT",handle:"warclipcast.test",brand_id:child.id,
    },
  },201)).data.id;
  await db.prepare("UPDATE accounts SET status='connected',encrypted_tokens='vault-fixture' WHERE id=?")
    .bind(account).run();
  const post=(await checked(`/api/niches/${workspace}/posts`,{
    method:"POST",cookie:first,data:{
      title:"Keep scheduled",caption:"Keep scheduled",
      brand_id:master.id,destinations:[account],
    },
  },201)).data.id;
  const due="2027-01-01T18:00:00.000Z";
  await db.prepare("UPDATE posts SET publish_mode='direct',delivery_status='scheduled',status='scheduled',scheduled_at=? WHERE id=?")
    .bind(due,post).run();
  await checked(`/api/niches/${workspace}/brands/${master.id}/release-preview`,{cookie:second},404);
  const preview=(await checked(`/api/niches/${workspace}/brands/${master.id}/release-preview`,{
    cookie:first,
  })).data;
  assert.equal(preview.child_brands.length,1);
  assert.equal(preview.direct_accounts,1);
  assert.equal(preview.direct_posts,1);
  assert.equal(preview.scheduled_posts,1);
  await checked(`/api/niches/${workspace}/brands/${master.id}/release`,{
    method:"POST",cookie:first,data:{name:master.name,confirm:"no"},
  },400);
  const released=(await checked(`/api/niches/${workspace}/brands/${master.id}/release`,{
    method:"POST",cookie:first,data:{name:master.name,confirm:"RELEASE"},
  })).data;
  assert.equal(released.ok,true);
  assert.equal(released.released_child_brands,1);
  const brands=(await checked(`/api/niches/${workspace}/brands`,{cookie:first})).data;
  assert.equal(brands.some(b=>b.id===master.id),false);
  const independent=brands.find(b=>b.id===released.accounts_brand_id);
  assert.ok(independent);
  assert.equal(independent.is_master,0);
  assert.equal(independent.parent_id,null);
  assert.equal(brands.find(b=>b.id===child.id).parent_id,null);
  assert.equal((await db.prepare("SELECT brand_id FROM accounts WHERE id=?").bind(childAccount).first()).brand_id,child.id);
  const kept=await db.prepare("SELECT brand_id,status,encrypted_tokens FROM accounts WHERE id=?").bind(account).first();
  assert.deepEqual(kept,{brand_id:independent.id,status:"connected",encrypted_tokens:"vault-fixture"});
  const saved=await db.prepare("SELECT brand_id,scheduled_at,destinations_json,delivery_status FROM posts WHERE id=?")
    .bind(post).first();
  assert.equal(saved.brand_id,independent.id);
  assert.equal(saved.scheduled_at,due);
  assert.equal(saved.delivery_status,"scheduled");
  assert.deepEqual(JSON.parse(saved.destinations_json),[account]);
  const archived=(await checked(`/api/niches/${workspace}/brands/archived`,{cookie:first})).data;
  assert.equal(archived[0].id,master.id);
  await checked(`/api/niches/${workspace}/brands/${master.id}/release`,{
    method:"POST",cookie:first,data:{name:master.name,confirm:"RELEASE"},
  },404);
  const restored=(await checked(`/api/niches/${workspace}/brands/${master.id}/restore`,{
    method:"POST",cookie:first,data:{},
  })).data;
  assert.equal(restored.ok,true);
  const after=(await checked(`/api/niches/${workspace}/brands`,{cookie:first})).data;
  assert.equal(after.find(b=>b.id===child.id).parent_id,null);
  assert.equal(after.find(b=>b.id===master.id).is_master,1);
  const reattached=(await checked(`/api/niches/${workspace}/brands/${child.id}`,{
    method:"PATCH",cookie:first,data:{parent_id:master.id},
  })).data;
  assert.equal(reattached.parent_id,master.id);
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


test("master niche routes source drafts only to its master accounts", async () => {
  const { cookie: hubOwner } = await checked("/api/auth/register", {
    method: "POST", data: { email: "hub-owner@example.test", password: "master routing fixture password" },
  });
  const { data: hub } = await checked("/api/niches", {
    method: "POST", cookie: hubOwner, data: {
      name: "Podcasts", master_name: "PodClipCast",
      source_groups: "War Clip Cast, Football Clip Cast",
    },
  }, 201);
  const path = "/api/niches/" + hub.id;
  assert.deepEqual(JSON.parse(hub.source_groups_json), ["War Clip Cast", "Football Clip Cast"]);
  const { data: extended } = await checked(path + "/source-groups", {
    method: "POST", cookie: hubOwner, data: { name: "Comedy Clip Cast" },
  }, 201);
  assert.equal(JSON.parse(extended.source_groups_json).length, 3);
  const add = (handle) => checked(path + "/accounts", {
    method: "POST", cookie: hubOwner,
    data: { platform: "instagram", display_name: handle, handle },
  }, 201);
  const { data: master } = await add("podclipcasts");
  const { data: source } = await add("war.clipcast");
  const role = (account, group, cookie = hubOwner, status = 200) => checked(
    path + "/accounts/" + account.id + "/routing",
    { method: "PATCH", cookie, data: { group } },
    status,
  );
  await role(master, "master");
  await role(source, "source:War Clip Cast");
  const { cookie: outsider } = await checked("/api/auth/register", {
    method: "POST", data: { email: "hub-outsider@example.test", password: "outsider routing fixture password" },
  });
  await role(source, "master", outsider, 404);
  const create = (data, status = 201) => checked(path + "/posts", {
    method: "POST", cookie: hubOwner, data: { title: "Archive clip", ...data },
  }, status);
  const { data: draft } = await create({ source_group: "War Clip Cast", campaign_url: "https://contentrewards.com/c/example" });
  assert.equal(draft.campaign_url, "https://contentrewards.com/c/example");
  await create({ campaign_url: "javascript:alert(1)" }, 400);
  assert.equal(draft.source_group, "War Clip Cast");
  assert.deepEqual(draft.destinations, [master.id]);
  await create({ source_group: "War Clip Cast", destinations: [source.id] }, 400);
  await create({ source_group: "Unrelated source" }, 400);
  const { data: edited } = await checked(path + "/posts/" + draft.id, {
    method: "PATCH", cookie: hubOwner, data: { title: "Edited", destinations: [master.id] },
  });
  assert.equal(edited.source_group, "War Clip Cast");
  assert.equal(edited.campaign_url, draft.campaign_url);
  assert.deepEqual(edited.destinations, [master.id]);
});
