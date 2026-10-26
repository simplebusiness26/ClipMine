// Real local media acceptance test: no production resources or customer media.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const dir = await mkdtemp(join(tmpdir(), "niches-render-"));
const key = randomBytes(32).toString("hex");
const python = spawn(
  "python",
  [
    "-m",
    "uvicorn",
    "clipmine_api.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
  ],
  {
    cwd: "services/api",
    env: {
      ...process.env,
      CLIPMINE_DATA_DIR: dir,
      CLIPMINE_TRANSCRIPTION_PROVIDER: "off",
      NICHES_GATEWAY_KEY: key,
    },
    stdio: "ignore",
  },
);
let mf;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://127.0.0.1:8000/api/health", {
        headers: { "X-Niches-Gateway-Key": key },
      });
      if (r.ok) break;
    } catch {}
    if (i === 59) throw new Error("Renderer did not start");
    await wait(100);
  }
  assert.equal((await fetch("http://127.0.0.1:8000/api/projects")).status, 401);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=12",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=22050",
      "-t",
      "12",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      join(dir, "fixture.mp4"),
    ],
    { stdio: "ignore" },
  );
  mf = new Miniflare(
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
        CLIPMINE_ORIGIN: "http://127.0.0.1:8000",
        CLIPMINE_GATEWAY_KEY: key,
      },
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const sql of (await readFile("migrations/0001_niches.sql", "utf8"))
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
  let cookie = "";
  async function req(path, method = "GET", data) {
    const form = data instanceof FormData;
    const encoded = form
      ? new Request("http://localhost" + path, { method, body: data })
      : null;
    return mf.dispatchFetch("http://localhost" + path, {
      method,
      headers: {
        origin: "http://localhost",
        cookie,
        ...(encoded
          ? {
              "Content-Type": encoded.headers.get("content-type"),
              "Content-Length": String(
                (await encoded.clone().arrayBuffer()).byteLength,
              ),
            }
          : data
            ? { "Content-Type": "application/json" }
            : {}),
      },
      body: encoded
        ? new Uint8Array(await encoded.arrayBuffer())
        : data
          ? JSON.stringify(data)
          : undefined,
    });
  }
  async function get(path, method = "GET", data) {
    const response = await req(path, method, data);
    const parsed = await response.json();
    assert.ok(
      response.ok,
      `${path}: ${response.status} ${JSON.stringify(parsed)}`,
    );
    return parsed;
  }
  const register = await req("/api/auth/register", "POST", {
    email: "render@example.test",
    password: "A disposable rendering password",
  });
  assert.equal(register.status, 200);
  cookie = register.headers.get("set-cookie").split(";")[0];
  const niche = await get("/api/niches", "POST", { name: "Render test" });
  const form = new FormData();
  form.append(
    "file",
    new Blob([await readFile(join(dir, "fixture.mp4"))], { type: "video/mp4" }),
    "fixture.mp4",
  );
  for (const [k, v] of Object.entries({
    rights_confirmed: "true",
    desired_clips: "1",
    min_clip_seconds: "5",
    max_clip_seconds: "10",
  }))
    form.append(k, v);
  let project = await get(`/api/projects?niche_id=${niche.id}`, "POST", form);
  for (let i = 0; i < 100; i++) {
    project = await get(`/api/projects/${project.id}`);
    if (project.status === "ready") break;
    if (project.status === "failed") throw new Error(project.error_message);
    await wait(100);
  }
  assert.equal(project.status, "ready");
  assert.ok(project.candidates.length);
  const candidate = project.candidates[0];
  await get(`/api/projects/${project.id}/candidates/${candidate.id}`, "PATCH", {
    caption_text: "Original synthetic test footage",
  });
  await get(
    `/api/projects/${project.id}/candidates/${candidate.id}/render`,
    "POST",
    {},
  );
  for (let i = 0; i < 200; i++) {
    project = await get(`/api/projects/${project.id}`);
    if (project.candidates[0].render_status === "ready") break;
    if (project.candidates[0].render_status === "failed")
      throw new Error(project.candidates[0].render_error);
    await wait(100);
  }
  assert.equal(project.candidates[0].render_status, "ready");
  const media = await get(`/api/niches/${niche.id}/clips/import`, "POST", {
    project_id: project.id,
    candidate_id: candidate.id,
    title: "Rendered clip",
  });
  const duplicate = await get(`/api/niches/${niche.id}/clips/import`, "POST", {
    project_id: project.id,
    candidate_id: candidate.id,
  });
  assert.equal(media.id, duplicate.id);
  const file = await req(`/api/niches/${niche.id}/media/${media.id}`);
  assert.equal(file.status, 200);
  assert.ok((await file.arrayBuffer()).byteLength > 10000);
  const list = await get(`/api/niches/${niche.id}/media`);
  assert.equal(list.length, 1);
  // Another account cannot view, list or transfer the first user's clip.
  cookie = (
    await req("/api/auth/register", "POST", {
      email: "other-render@example.test",
      password: "Another disposable rendering password",
    })
  ).headers
    .get("set-cookie")
    .split(";")[0];
  assert.equal((await req(`/api/projects/${project.id}`)).status, 404);
  assert.equal((await get("/api/projects")).length, 0);
  const other = await get("/api/niches", "POST", { name: "Other" });
  assert.equal(
    (
      await req(`/api/niches/${other.id}/clips/import`, "POST", {
        project_id: project.id,
        candidate_id: candidate.id,
      })
    ).status,
    404,
  );
  console.log(
    "PASS: protected FastAPI → real upload → FFmpeg analyse/edit/render → direct R2 import → duplicate protection → cross-user denial",
  );
} finally {
  await mf?.dispose();
  python.kill("SIGTERM");
  await new Promise((resolve) => python.once("exit", resolve));
  await rm(dir, { recursive: true, force: true });
}
