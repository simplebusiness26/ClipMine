import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { prepareContentRewardsForm } from "./content-rewards-dry-run.mjs";

test("Chromium fills the target campaign form and leaves its acknowledgement and submit untouched", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const input = {
      campaign_url: "https://contentrewards.com/c/campaigns/00000000-0000-4000-8000-000000000001",
      reel_url: "https://www.instagram.com/reel/example/",
      deadline: new Date(Date.now() + 60_000).toISOString(),
    };
    await page.route("**/*", async (route) => {
      if (route.request().url() !== input.campaign_url) return route.abort();
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><button id="open">Submit clip</button>
          <dialog><form><label>Submit video link <textarea></textarea></label>
          <label><input type="checkbox">I have read the requirements</label>
          <button>Submit clip</button></form></dialog>
          <script>
          document.querySelector('#open').onclick = () => document.querySelector('dialog').showModal();
          document.querySelector('form').onsubmit = event => {
            event.preventDefault();
            document.body.dataset.submitted = 'true';
          };
          </script>`,
      });
    });
    assert.equal(await prepareContentRewardsForm(page, input), "form_prepared");
    assert.equal(await page.locator("textarea").inputValue(), input.reel_url);
    assert.equal(await page.locator("input").isChecked(), false);
    assert.equal(await page.locator("body").getAttribute("data-submitted"), null);
  } finally {
    await browser.close();
  }
});
