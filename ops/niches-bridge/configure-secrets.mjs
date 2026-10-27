// Run only inside the authorised deployment runner. Never reads secret values.
import { randomBytes } from "node:crypto";
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (
  !account ||
  account !== process.env.NICHES_EXPECTED_ACCOUNT_ID ||
  !process.env.CLOUDFLARE_API_TOKEN
)
  throw new Error("Missing or mismatched authorised deployment account");
const origin = "https://api.cloudflare.com/client/v4/accounts/" + account;
async function api(path, init = {}) {
  const r = await fetch(origin + path, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(25000),
    headers: {
      Authorization: "Bearer " + process.env.CLOUDFLARE_API_TOKEN,
      "Content-Type": "application/json",
    },
  });
  const data = await r.json();
  if (!r.ok || !data.success)
    throw new Error("Niches secret configuration failed: HTTP " + r.status);
  return data.result;
}
const namespace = await api("/workers/subdomain");
if (namespace.subdomain !== "ai-seo")
  throw new Error("Unexpected deployment namespace");
// The target is a literal, never a user-controlled project or AISO Worker name.
const path = "/workers/scripts/niches/secrets";
const existing = await api(path); // Metadata (names/types) only; no secret retrieval.
if (!existing.some((x) => x.name === "NICHES_TOKEN_KEY")) {
  await api(path, {
    method: "PUT",
    body: JSON.stringify({
      name: "NICHES_TOKEN_KEY",
      type: "secret_text",
      text: randomBytes(32).toString("hex"),
    }),
  });
  console.log(
    "Created dedicated Niches token encryption key. Existing keys are never rotated by deployment.",
  );
}
for (const name of [
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
  "BREVO_API_KEY",
]) {
  const value = process.env["NICHES_" + name];
  if (!value) continue;
  await api(path, {
    method: "PUT",
    body: JSON.stringify({ name, type: "secret_text", text: value }),
  });
  console.log("Configured Niches application secret: " + name);
}
console.log(
  "Niches-only secret configuration completed; no credential values printed.",
);
