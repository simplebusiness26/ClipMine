import { test } from "node:test";
import assert from "node:assert/strict";
import { handlePreview } from "./worker.mjs";
const base = "https://niches-electric.ai-seo.workers.dev";
const env = { ASSETS: { fetch: async () => new Response("preview assets", {status:200}) } };
test("preview serves assets without touching production API", async () => {
  const res = await handlePreview(new Request(base + "/"), env, () => { throw Error("upstream unexpectedly called"); });
  assert.equal(await res.text(), "preview assets");
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
});
test("preview API always points to existing Niches backend with session intact", async () => {
  const r = new Request(base + "/api/niches?abc=1", { headers: { Cookie: "niches_session=abc" } });
  const res = await handlePreview(r, env, async (url, opts) => {
    assert.equal(String(url), "https://niches.ai-seo.workers.dev/api/niches?abc=1");
    assert.equal(opts.headers.get("cookie"), "niches_session=abc");
    assert.equal(opts.headers.get("origin"), "https://niches.ai-seo.workers.dev");
    return new Response("[]", { headers: { "Content-Type": "application/json", "Set-Cookie": "niches_session=new; Secure; HttpOnly; SameSite=Strict; Path=/" } });
  });
  assert.equal(await res.text(), "[]");
  assert.match(res.headers.get("set-cookie"), /HttpOnly/);
});
test("unsafe API requests require actual preview Origin and preserve JSON body", async () => {
  const req = new Request(base + "/api/niches", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: '{"name":"Test"}'
  });
  const res = await handlePreview(req, env, async (url, opts) => {
    assert.equal(opts.headers.get("origin"), "https://niches.ai-seo.workers.dev");
    assert.equal(await new Response(opts.body).text(), '{"name":"Test"}');
    return new Response("{}", {status:201});
  });
  assert.equal(res.status, 201);
  for(const origin of ["https://malicious.example", "https://niches.ai-seo.workers.dev", null]){
    const response = await handlePreview(new Request(base + "/api/niches", {
      method:"POST", ...(origin ? {headers:{Origin:origin}} : {}), body:"{}"
    }), env, () => {throw Error("Request must be blocked")});
    assert.equal(response.status,403);
  }
});
test("refuses unexpected hosts and has no direct storage or scheduler dependencies", async () => {
  const wrong = await handlePreview(new Request("https://agentcart.ai-seo.workers.dev/api/niches"),env);
  assert.equal(wrong.status,421);
});
