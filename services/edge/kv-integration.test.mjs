import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("KV-only Worker accepts private uploads and supports authenticated ranges", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: [
        "worker", "kv-media", "reset-email", "security", "db", "token-vault",
        "social-oauth", "publishers", "outbox",
      ].map((name) => ({ type: "ESModule", path: "services/edge/" + name + ".mjs" })),
      compatibilityDate: "2026-09-01",
      d1Databases: ["DB"],
      kvNamespaces: ["MEDIA_KV"],
      bindings: { MAX_UPLOAD_MB: "25" },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const f of (await readdir("migrations")).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = await readFile("migrations/" + f, "utf8");
      for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean))
        await db.prepare(statement).run();
    }
    let cookie = "";
    async function call(path, method = "GET", raw, headers = {}) {
      return mf.dispatchFetch("http://localhost" + path, {
        method,
        headers: {
          ...(method !== "GET" ? { origin: "http://localhost" } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: raw,
      });
    }
    const health = await (await call("/api/health")).json();
    assert.equal(health.storage, true);
    assert.equal(health.storage_backend, "kv");
    let response = await call("/api/auth/register", "POST",
      JSON.stringify({ email: "kv-owner@example.test", password: "Long and unique kv password" }),
      { "Content-Type": "application/json" });
    assert.equal(response.status, 200);
    cookie = response.headers.get("set-cookie").split(";")[0];
    response = await call("/api/niches", "POST", JSON.stringify({ name: "Private KV studio" }), { "Content-Type": "application/json" });
    assert.equal(response.status, 201);
    const niche = (await response.json()).id;
    const image = Uint8Array.from([137,80,78,71,13,10,26,10,0,0]);
    response = await call("/api/niches/" + niche + "/media", "POST", image, {
      "Content-Type": "image/png", "Content-Length": String(image.length), "X-Filename": "test.png"
    });
    assert.equal(response.status, 201);
    const media = (await response.json()).id;
    response = await call("/api/niches/" + niche + "/media/" + media, "GET", undefined, { Range: "bytes=2-5" });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), image.slice(2,6));
    response = await call("/api/auth/logout", "POST");
    assert.equal(response.status, 200);
    cookie = "";
    assert.equal((await call("/api/niches/" + niche + "/media/" + media)).status, 401);
  } finally {
    await mf.dispose();
  }
});
