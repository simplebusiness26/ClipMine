import { fail } from "./security.mjs";
const enc = new TextEncoder();
export function base64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decode(s) {
  return Uint8Array.from(
    atob(s.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
async function keyFor(env) {
  if (!/^[a-f0-9]{64}$/i.test(env.NICHES_TOKEN_KEY || ""))
    fail(503, "Social account encryption has not been configured.");
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(env.NICHES_TOKEN_KEY.match(/../g), (x) => parseInt(x, 16)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(env, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(context) },
    await keyFor(env),
    enc.encode(JSON.stringify(value)),
  );
  return "v1." + base64url(iv) + "." + base64url(new Uint8Array(encrypted));
}
export async function unseal(env, value, context) {
  const [version, iv, data] = String(value || "").split(".");
  if (version !== "v1") fail(409, "Reconnect this social account.");
  try {
    return JSON.parse(
      new TextDecoder().decode(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: decode(iv),
            additionalData: enc.encode(context),
          },
          await keyFor(env),
          decode(data),
        ),
      ),
    );
  } catch {
    fail(
      409,
      "The connection could not be unlocked. Reconnect this social account.",
    );
  }
}
export const accountContext = (a) =>
  `account:${a.niche_id}:${a.platform}:${a.provider_id}`;
