import { readFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { contentRewardsDryRunInput } from "../../services/edge/outbox.mjs";

export async function prepareContentRewardsForm(page, input) {
  const campaign = new URL(input.campaign_url);
  await page.goto(campaign.href, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // A signed-out session or a campaign redirect must never receive the Reel URL.
  const current = new URL(page.url());
  if (current.origin !== campaign.origin ||
      current.pathname.replace(/\/$/, "") !== campaign.pathname.replace(/\/$/, "")) {
    return "campaign_unavailable";
  }

  const open = page.getByRole("button", { name: "Submit clip", exact: true });
  await open.click({ timeout: 12_000 });
  const field = page.getByRole("textbox", { name: "Submit video link", exact: false })
    .or(page.getByPlaceholder("Submit video link", { exact: false }));
  if (Date.now() >= Date.parse(input.deadline)) return "deadline_passed";
  await field.fill(input.reel_url, { timeout: 12_000 });
  if (await field.inputValue() !== input.reel_url) return "form_unavailable";
  return "form_prepared";
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const input = contentRewardsDryRunInput(event.client_payload ?? event.inputs ?? {});
  if (!input) throw new Error("A current Content Rewards campaign and public Instagram Reel are required.");

  let result = "sign_in_required";
  const state = process.env.CONTENT_REWARDS_BROWSER_STATE;
  if (state) {
    let browser;
    try {
      browser = await chromium.launch();
      const context = await browser.newContext({ storageState: JSON.parse(state) });
      const page = await context.newPage();
      result = await prepareContentRewardsForm(page, input);
    } catch {
      // Browser errors can contain private page contents or details about the stored session.
      result = "form_unavailable";
    } finally {
      await browser?.close();
    }
  }
  const summary = {
    sign_in_required: "Content Rewards sign-in is required in the runner.",
    campaign_unavailable: "The browser did not stay on the intended campaign page. Check its sign-in and access.",
    deadline_passed: "The submission deadline passed while the browser was opening the form.",
    form_unavailable: "The browser could not fill the campaign’s Reel link field. Check access and the form.",
    form_prepared: "The Reel link was entered in the original campaign’s form. Dry run complete.",
  }[result];
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  if (result !== "form_prepared") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
