import assert from "node:assert/strict";
import { test } from "node:test";
import { advancePublisher, validatePost } from "./publishers.mjs";

const account = {
  platform: "instagram",
  provider_id: "123",
  display_name: "footballclipcast",
  connection_kind: "oauth",
};
const media = { mime: "video/mp4" };
const post = { title: "Football clip", caption: "Match reaction" };
const invite = { instagram_collaborator: " @PodClipCasts " };

test("Instagram Reel creates one container with the normalised collaborator", async () => {
  const requests = [];
  const result = await advancePublisher({
    env: {},
    account,
    token: "fixture",
    media,
    post,
    options: invite,
    state: {},
    mediaURL: "https://example.test/video.mp4",
    fetcher: async (url, init) => {
      requests.push([new URL(url), JSON.parse(init.body)]);
      return Response.json({ id: "container-123" });
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0].hostname, "graph.facebook.com");
  assert.equal(requests[0][1].media_type, "REELS");
  assert.deepEqual(requests[0][1].collaborators, ["podclipcasts"]);
  assert.ok(result);
});

test("an ordinary Reel keeps the existing direct Instagram Login payload", async () => {
  await advancePublisher({
    env: {},
    account: { ...account, connection_kind: "instagram_login" },
    token: "fixture",
    media,
    post,
    options: {},
    state: {},
    mediaURL: "https://example.test/video.mp4",
    fetcher: async (url, init) => {
      assert.equal(new URL(url).hostname, "graph.instagram.com");
      assert.equal("collaborators" in JSON.parse(init.body), false);
      return Response.json({ id: "container-123" });
    },
  });
});

test("approval rejects incompatible accounts, image posts and invalid handles", () => {
  assert.throws(() => validatePost({ ...account, connection_kind: "instagram_login" }, media, post, invite), /through Meta/);
  assert.throws(() => validatePost(account, { mime: "image/jpeg" }, post, invite), /require a Reel/);
  assert.throws(() => validatePost(account, media, post, { instagram_collaborator: "footballclipcast" }), /other than/);
  assert.throws(() => validatePost(account, media, post, { instagram_collaborator: "two handles" }), /valid Instagram/);
  assert.doesNotThrow(() => validatePost(account, media, post, invite));
});
