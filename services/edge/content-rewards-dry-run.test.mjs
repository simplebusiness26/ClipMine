import { test } from "node:test";
import assert from "node:assert/strict";
import { contentRewardsDryRunInput } from "./outbox.mjs";
import { prepareContentRewardsForm } from "../../ops/niches-bridge/content-rewards-dry-run.mjs";

const input = {
  campaign_url: "https://contentrewards.com/c/campaigns/00000000-0000-4000-8000-000000000001",
  reel_url: "https://www.instagram.com/reel/example/",
  deadline: new Date(Date.now() + 600_000).toISOString(),
};

test("validates and normalises the handoff URLs and deadline", () => {
  assert.deepEqual(contentRewardsDryRunInput({
    ...input, campaign_url: input.campaign_url + "?from=discover", reel_url: input.reel_url + "?igsh=example",
  }), input);
  assert.equal(contentRewardsDryRunInput({ ...input, campaign_url: input.campaign_url.replace("contentrewards.com", "example.org") }), null);
  assert.equal(contentRewardsDryRunInput({ ...input, reel_url: input.reel_url.replace("/reel/", "/p/") }), null);
  assert.equal(contentRewardsDryRunInput(input, Date.parse(input.deadline)), null);
});

test("the browser dry run enters the link without pressing the submission button", async () => {
  const actions = [];
  let value;
  const field = {
    or: () => field,
    fill: async (link) => { value = link; actions.push("filled"); },
    inputValue: async () => value,
  };
  const page = {
    goto: async (url) => assert.equal(url, input.campaign_url),
    url: () => input.campaign_url,
    getByRole(role, { name }) {
      if (role === "button") assert.equal(name, "Submit clip");
      else {
        assert.match("Clip link", name);
        assert.match("Submit video link", name);
      }
      return role === "button"
        ? { click: async () => { actions.push("opened"); } }
        : field;
    },
    getByPlaceholder: () => ({}),
  };
  assert.equal(await prepareContentRewardsForm(page, input), "form_prepared");
  assert.equal(value, input.reel_url);
  assert.deepEqual(actions, ["opened", "filled"]);
  page.url = () => "https://contentrewards.com/login";
  assert.equal(await prepareContentRewardsForm(page, input), "campaign_unavailable");
  assert.deepEqual(actions, ["opened", "filled"]);
});
