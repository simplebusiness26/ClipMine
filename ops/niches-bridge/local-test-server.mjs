// Disposable LOCAL test infrastructure. Never accepts Cloudflare credentials.
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, extname, sep } from "node:path";
const root = resolve("apps/web/dist");
const contentTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const mf = new Miniflare(
  convertV4MiniflareOptions({
    host: "127.0.0.1",
    modules: [
      { type: "ESModule", path: "services/edge/worker.mjs" },
      { type: "ESModule", path: "services/edge/security.mjs" },
    ],
    compatibilityDate: "2026-09-01",
    d1Databases: ["DB"],
    r2Buckets: ["MEDIA"],
    bindings: {
      MAX_UPLOAD_MB: "25",
      ...(process.env.NICHES_LOCAL_RENDERER
        ? {
            CLIPMINE_ORIGIN: "http://127.0.0.1:8000",
            CLIPMINE_GATEWAY_KEY: process.env.NICHES_LOCAL_RENDERER,
          }
        : {}),
    },
    serviceBindings: {
      ASSETS: async (request) => {
        const path = resolve(root, "." + new URL(request.url).pathname);
        if (!path.startsWith(root + sep) && path !== root)
          return new Response("Not found", { status: 404 });
        let file = path;
        let data;
        try {
          data = await readFile(file);
        } catch {
          file = resolve(root, "index.html");
          data = await readFile(file);
        }
        return new Response(data, {
          headers: {
            "Content-Type":
              contentTypes[extname(file)] || "application/octet-stream",
          },
        });
      },
    },
  }),
);
const db = await mf.getD1Database("DB");
for (const sql of (await readFile("migrations/0001_niches.sql", "utf8"))
  .split(";")
  .map((x) => x.trim())
  .filter(Boolean))
  await db.prepare(sql).run();
await mf.ready;
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await mf.dispatchFetch(
      `http://${req.headers.host}${req.url}`,
      {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : Buffer.concat(chunks),
      },
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("Local test server error");
  }
});
server.listen(8787, "127.0.0.1", () =>
  console.log("Niches disposable test server: http://127.0.0.1:8787/"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    server.close();
    await mf.dispose();
    process.exit(0);
  });
