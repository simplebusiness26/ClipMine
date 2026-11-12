import test from "node:test";
import assert from "node:assert/strict";
import { advancePublisher, validatePost } from "./publishers.mjs";
import { refreshPostStatus } from "./outbox.mjs";

const account = { platform: "tiktok" };
const media = { mime: "video/mp4", duration_seconds: 17, size: 4096 };
const post = { title: "Original cartoon", caption: "A creator-owned video." };
const inboxOptions = { tiktok_delivery: "inbox", tiktok_upload_consent: true };
const creator = {
  privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 60,
  comment_disabled: false, duet_disabled: true, stitch_disabled: true,
};
const directOptions = { privacy: "SELF_ONLY", tiktok_consent: true };
const reply = (data) => new Response(JSON.stringify({ data, error: { code: "ok" } }));
const input = (options = inboxOptions, state = {}) => ({
  env: {}, account, media, post, options, state, creator: null,
  token: "fixture-token", mediaURL: "https://example.test/owned-video",
});

test("TikTok inbox upload requires its own explicit transfer consent", () => {
  assert.throws(() => validatePost(account, media, post, { tiktok_delivery: "inbox" }, null), /Confirm sending/);
  assert.doesNotThrow(() => validatePost(account, media, post, inboxOptions, null));
  assert.throws(() => validatePost(account, media, post, { ...inboxOptions, tiktok_delivery: "unknown" }, creator), /Choose Direct Post/);
});

test("TikTok inbox upload validates media and keeps direct publishing consent separate", () => {
  assert.throws(() => validatePost(account, { ...media, mime: "image/jpeg" }, post, inboxOptions, null), /supports videos/);
  assert.throws(() => validatePost(account, { ...media, duration_seconds: null }, post, inboxOptions, null), /missing its duration/);
  assert.throws(() => validatePost(account, media, post, { tiktok_upload_consent: true, privacy: "SELF_ONLY" }, creator), /Music Usage Confirmation/);
});

test("TikTok inbox uses the draft endpoint without publishing metadata", async () => {
  const result = await advancePublisher({ ...input(), fetcher: async (url, init) => {
    assert.equal(url, "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/");
    assert.deepEqual(JSON.parse(init.body), { source_info: { source: "PULL_FROM_URL", video_url: "https://example.test/owned-video" } });
    return reply({ publish_id: "fixture-inbox" });
  } });
  assert.equal(result.status, "processing");
  assert.equal(result.providerId, "fixture-inbox");
  assert.deepEqual(result.state, { phase: "poll", publish_id: "fixture-inbox", inbox: true });
});

test("TikTok draft delivery polls the original upload without resubmitting", async () => {
  const state = { phase: "poll", publish_id: "fixture-inbox", inbox: true };
  const result = await advancePublisher({ ...input(inboxOptions, state), fetcher: async (url, init) => {
    assert.equal(url, "https://open.tiktokapis.com/v2/post/publish/status/fetch/");
    assert.deepEqual(JSON.parse(init.body), { publish_id: "fixture-inbox" });
    return reply({ status: "SEND_TO_USER_INBOX" });
  } });
  assert.equal(result.status, "inbox_delivered");
  assert.notEqual(result.status, "published");
});

test("TikTok inbox processing and failures preserve their actual outcomes", async () => {
  for (const [status, expected] of [["PROCESSING_DOWNLOAD", "processing"], ["FAILED", "failed"], ["PUBLISH_COMPLETE", "published"]]) {
    const result = await advancePublisher({ ...input(inboxOptions, { phase: "poll", publish_id: "fixture-inbox", inbox: true }), fetcher: async () => reply({ status }) });
    assert.equal(result.status, expected);
  }
});

test("Existing TikTok Direct Post remains the default", async () => {
  const result = await advancePublisher({ ...input(directOptions), creator, fetcher: async (url, init) => {
    assert.equal(url, "https://open.tiktokapis.com/v2/post/publish/video/init/");
    assert.equal(JSON.parse(init.body).post_info.privacy_level, "SELF_ONLY");
    return reply({ publish_id: "fixture-direct" });
  } });
  assert.equal(result.state.inbox, undefined);
  const published = await advancePublisher({ ...input(directOptions, { phase: "poll", publish_id: "fixture-direct" }), fetcher: async () => reply({ status: "PUBLISH_COMPLETE" }) });
  assert.equal(published.status, "published");
});

test("Inbox delivery is terminal and aggregates without claiming a published post", async () => {
  for (const [states, expected] of [
    [["inbox_delivered"], "inbox_delivered"],
    [["inbox_delivered", "published"], "partial"],
    [["inbox_delivered", "failed"], "partial"],
    [["inbox_delivered", "processing"], "processing"],
  ]) {
    let savedStatus;
    const env = { DB: { prepare: (sql) => ({ bind: (...args) => ({
      all: async () => ({ results: states.map((status) => ({ status })) }),
      run: async () => { assert.match(sql, /UPDATE posts/); savedStatus = args[0]; },
    }) }) } };
    await refreshPostStatus(env, "fixture-post");
    assert.equal(savedStatus, expected);
  }
});
