// Separate, opt-in UI skin. No database, secrets, publisher cron or migrations.
// All authenticated API requests are served by the existing Niches backend.
// This keeps exactly one source of truth for users, accounts, drafts and media.
const PRODUCTION = "https://niches.ai-seo.workers.dev";
const PREVIEW = "https://niches-electric.ai-seo.workers.dev";
const unsafe = (method) => !["GET", "HEAD", "OPTIONS"].includes(method);

export async function handlePreview(request, env, upstreamFetch) {
  const incoming = new URL(request.url);
  if (incoming.origin !== PREVIEW) {
    return new Response("Unexpected preview hostname", { status: 421 });
  }
  if (!incoming.pathname.startsWith("/api/")) {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("X-Robots-Tag", "noindex, nofollow");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  }

  // The backend enforces Origin == URL.origin on writes. Verify the browser's
  // actual preview Origin BEFORE remapping it to the fixed backend origin.
  if (unsafe(request.method) && request.headers.get("origin") !== PREVIEW) {
    return new Response(JSON.stringify({ detail: "A same-origin request is required." }), {
      status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
  const target = new URL(incoming.pathname + incoming.search, PRODUCTION);
  const headers = new Headers(request.headers);
  headers.set("Origin", PRODUCTION);
  // Never pass client-supplied routing headers to the API.
  for (const h of ["host", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip"]) {
    headers.delete(h);
  }
  // Do not change the body or session cookies. Existing backend owns all
  // authorisation, idempotency, per-account publication checks and storage.
  // Cloudflare Service Binding: worker-to-worker, no public fetch or database access.
  const backend = upstreamFetch || env.NICHES_API?.fetch?.bind(env.NICHES_API);
  if (!backend) return new Response('Preview backend unavailable', { status: 503 });
  const upstream = await backend(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "manual",
  });
  const out = new Headers(upstream.headers);
  out.set("Cache-Control", "no-store");
  out.set("X-Robots-Tag", "noindex, nofollow");
  out.set("X-Content-Type-Options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
export default { fetch: (request, env) => handlePreview(request, env) };
