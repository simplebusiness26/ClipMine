import { chromium } from "playwright";
const base = process.env.NICHES_URL;
if (base !== "http://127.0.0.1:8787") throw new Error("Disposable workspace only");
async function verifyCampaignNotification(page, nicheId) {
  const notifications = base + "/api/notifications";
  const update = base + `/api/niches/${nicheId}/publications/campaign-fixture/campaign`;
  const timestamp = "2026-11-18T15:00:00.000Z";
  const campaign = "https://contentrewards.com/c/campaigns/00000000-0000-4000-8000-000000000001";
  const reel = "https://www.instagram.com/reel/fixture/";
  let readAt = null, submittedAt = null, updates = 0;
  await page.route(notifications, async (route) => {
    if (route.request().method() === "POST") {
      readAt = timestamp;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: [
      { id: "publication-campaign-fixture", publication_id: "campaign-fixture",
        niche_id: nicheId, title: "Campaign Reel fixture", platform: "instagram",
        display_name: "Instagram Main", public_url: reel, campaign_url: campaign,
        campaign_submitted_at: submittedAt, published_at: timestamp, created_at: timestamp,
        read_at: readAt },
      { id: "publication-noncampaigned", publication_id: "noncampaigned",
        niche_id: nicheId, title: "Ordinary post fixture", platform: "instagram",
        created_at: timestamp, read_at: readAt },
    ] });
  });
  await page.route(update, async (route) => {
    if (route.request().method() !== "PATCH" || route.request().postDataJSON()?.submitted !== true)
      throw new Error("A campaign checkbox must save a manual submission confirmation");
    updates++;
    submittedAt = timestamp;
    return route.fulfill({ json: { ok: true, campaign_submitted_at: submittedAt } });
  });
  const bell = page.locator(".n-topbar").getByRole("button", { name: "Notifications", exact: true });
  const panel = page.getByRole("region", { name: "Notifications" });
  const check = panel.getByRole("checkbox", { name: /Campaign Reel fixture/ });
  try {
    await bell.click();
    await check.waitFor();
    if (await check.isChecked() || await panel.getByRole("checkbox").count() !== 1)
      throw new Error("Only the campaign Reel should have an initially unchecked box");
    if (await panel.getByRole("link", {name: "View post"}).getAttribute("href") !== reel ||
        await panel.getByRole("link", {name: "Open campaign"}).getAttribute("href") !== campaign)
      throw new Error("The campaign notification must link to its post and campaign");
    await panel.getByRole("button", { name: "Mark read & close" }).click();
    await panel.waitFor({ state: "hidden" });
    await bell.click();
    if (await check.isChecked() || updates !== 0)
      throw new Error("Marking notifications read must not record a submission");
    await check.click();
    await panel.getByText("Submitted to Content Rewards", { exact: true }).waitFor();
    await page.reload();
    await bell.click();
    await panel.getByText("Submitted to Content Rewards", { exact: true }).waitFor();
    if (!await check.isChecked() || updates !== 1)
      throw new Error("The campaign submission tick did not persist on reload");
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
      throw new Error("The in-app notification panel overflows its mobile viewport");
    await bell.click();
    console.log("PASS mobile notifications: publication links, separate read action and persistent submission tick");
  } finally {
    await page.unroute(notifications);
    await page.unroute(update);
  }
}


const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width:390, height:900 } });
  const page = await context.newPage();
  const register = await page.request.post(base + "/api/auth/register", {
    headers: { Origin: base }, data: { email: "notifications@example.test", password: "Disposable test password 123" }
  });
  if (!register.ok()) throw new Error("Could not register the notification fixture user");
  const nicheResponse = await page.request.post(base + "/api/niches", {
    headers: { Origin: base }, data: { name: "Notification fixture" }
  });
  if (!nicheResponse.ok()) throw new Error("Could not create the notification fixture niche");
  const niche = await nicheResponse.json();
  await page.goto(base);
  await verifyCampaignNotification(page, niche.id);
} finally {
  await browser.close();
}
