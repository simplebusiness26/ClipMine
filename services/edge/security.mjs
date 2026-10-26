const encoder = new TextEncoder();
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export async function hash(value) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function passwordHash(password, salt = randomToken()) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  // WebCrypto Workers supports at most 100,000 PBKDF2 iterations. Benchmark before public launch.
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return `pbkdf2:100000:${salt}:${Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export async function verifyPassword(password, stored) {
  if (!/^pbkdf2:100000:[a-f0-9]{64}:[a-f0-9]{64}$/.test(stored)) return false;
  const calculated = await passwordHash(password, stored.split(":")[2]);
  let difference = calculated.length ^ stored.length;
  for (let i = 0; i < stored.length; i++)
    difference |= stored.charCodeAt(i) ^ calculated.charCodeAt(i);
  return difference === 0;
}
export function cookie(token, secure = true, maxAge = 604800) {
  return `niches_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
export function sessionToken(request) {
  return request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)niches_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}
export function fail(status, detail) {
  throw Object.assign(new Error(detail), { status });
}
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
export function textValue(value, max, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    fail(400, "A required field is missing or too long.");
  return value.trim();
}
export function validateUpload(bytes, type) {
  const starts = (...a) => a.every((n, i) => bytes[i] === n);
  if (type === "image/jpeg") return starts(255, 216, 255);
  if (type === "image/png") return starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (type === "image/webp")
    return (
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  if (["video/mp4", "video/quicktime"].includes(type))
    return new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
  if (type === "video/webm") return starts(26, 69, 223, 163);
  return false;
}
