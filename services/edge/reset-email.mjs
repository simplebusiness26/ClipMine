// Transactional reset email. Uses project-specific secrets; never exposes API keys
// to the browser. Brevo is optional and does not require paid activation.
export function resetEmailReady(env) {
  return !!(
    env.APP_URL &&
    ((env.RESET_EMAIL_ENDPOINT && env.RESET_EMAIL_KEY) ||
      (env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL))
  );
}

export async function sendResetEmail(env, to, token, fetcher = fetch) {
  if (!resetEmailReady(env))
    throw new Error("Reset email is not configured");
  const url = new URL(env.APP_URL);
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new Error("Invalid application origin");
  const link = new URL("/", url);
  link.searchParams.set("reset", token);
  let destination, headers, payload;
  if (env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL) {
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(env.BREVO_SENDER_EMAIL))
      throw new Error("Invalid transactional email sender");
    destination = "https://api.brevo.com/v3/smtp/email";
    headers = { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" };
    payload = {
      sender: {
        email: env.BREVO_SENDER_EMAIL,
        name: env.BREVO_SENDER_NAME || "Niches",
      },
      to: [{ email: to }],
      subject: "Reset your Niches password",
      textContent: "A password reset was requested for Niches. The link expires in 30 minutes. If this was not you, ignore this email.\n\n" + link.href,
    };
  } else {
    destination = new URL(env.RESET_EMAIL_ENDPOINT);
    if (destination.protocol !== "https:") throw new Error("Email adapter must use HTTPS");
    headers = { Authorization: "Bearer " + env.RESET_EMAIL_KEY, "Content-Type": "application/json" };
    payload = { to, template: "niches-password-reset", reset_url: link.href };
  }
  const response = await fetcher(destination, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    redirect: "manual",
  });
  if (!response.ok)
    throw new Error("Transactional email provider did not accept the request");
  return true;
}
