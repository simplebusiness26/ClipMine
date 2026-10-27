import { test } from "node:test";
import assert from "node:assert/strict";
import { resetEmailReady, sendResetEmail } from "./reset-email.mjs";

test("Brevo password reset uses a project-only API key and safe one-time link", async () => {
  const env = {
    APP_URL: "https://niches.ai-seo.workers.dev",
    BREVO_API_KEY: "fixture-not-a-secret",
    BREVO_SENDER_EMAIL: "verified@example.test",
    BREVO_SENDER_NAME: "Niches",
  };
  assert.equal(resetEmailReady(env), true);
  let calls = 0;
  await sendResetEmail(env, "owner@example.test", "abc123", async (url, opts) => {
    calls++;
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(opts.headers["api-key"], env.BREVO_API_KEY);
    const payload = JSON.parse(opts.body);
    assert.deepEqual(payload.to, [{ email: "owner@example.test" }]);
    assert.equal(payload.sender.email, "verified@example.test");
    assert.ok(payload.textContent.includes("https://niches.ai-seo.workers.dev/?reset=abc123"));
    assert.ok(!opts.body.includes(env.BREVO_API_KEY));
    return new Response(JSON.stringify({messageId:"fixture"}), {status:201});
  });
  assert.equal(calls, 1);
});
test("existing secure transactional adapter remains supported and false readiness is rejected", async () => {
  const env = {
    APP_URL:"https://niches.ai-seo.workers.dev",
    RESET_EMAIL_ENDPOINT:"https://mail.example.test/reset",
    RESET_EMAIL_KEY:"fixture",
  };
  assert.equal(resetEmailReady({}), false);
  assert.equal(resetEmailReady({ APP_URL:env.APP_URL }), false);
  await sendResetEmail(env,"owner@example.test","resetfixture",async(url,opts)=>{
    assert.equal(url.href,"https://mail.example.test/reset");
    assert.equal(opts.headers.Authorization,"Bearer fixture");
    assert.equal(JSON.parse(opts.body).reset_url,"https://niches.ai-seo.workers.dev/?reset=resetfixture");
    return new Response(null,{status:204});
  });
  await assert.rejects(sendResetEmail({ ...env, RESET_EMAIL_ENDPOINT:"http://unsafe.invalid" },"x@y.test","token",()=>{}));
  await assert.rejects(sendResetEmail({ ...env, RESET_EMAIL_ENDPOINT:"", RESET_EMAIL_KEY:"" },"x@y.test","token",()=>{}));
});
