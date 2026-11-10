import assert from "node:assert/strict";
import { chromium } from "playwright";
import { validateBrowserTarget } from "./target-policy.mjs";
const base = process.env.NICHES_URL || "http://127.0.0.1:8787";
validateBrowserTarget(base, true);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, timezoneId: "Europe/London" });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  const api = async (path, data, method = "POST") => {
    const r = await context.request.fetch(base + path, { method, data, headers: { Origin: base } });
    assert.ok(r.ok(), `${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  await api("/api/auth/register", { email: `smoke-${Date.now()}@example.test`, password: "Synthetic test password" });
  const niche = await api("/api/niches", { name: "Podcasts" });
  const root = `/api/niches/${niche.id}`;
  const master = await api(root + "/brands", { name: "Podclipcast" });
  const war = await api(root + "/brands", { name: "War Clipcast" });
  const football = await api(root + "/brands", { name: "Football Clipcast" });
  const instagram = await api(root + "/accounts", { brand_id: war.id, platform: "instagram", display_name: "War Instagram", handle: "war" });
  const youtube = await api(root + "/accounts", { brand_id: football.id, platform: "youtube", display_name: "Football YouTube", handle: "football" });
  const overflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const location = (section) => base + `/?niche=${niche.id}&section=${section}`;
  await page.goto(location("Accounts"));
  await page.locator(".n-brand-master > summary").waitFor({ timeout: 8000 });
  const parent = page.locator(".n-brand-master > summary");
  const child = page.locator(".n-brand-child > summary").filter({ hasText: "War Clipcast" });
  assert.match(await parent.textContent(), /Podclipcast.*Master brand/s);
  assert.equal(await page.getByText("War Instagram", { exact: true }).isVisible(), false);
  await child.click();
  await page.getByText("War Instagram", { exact: true }).waitFor();
  await page.getByLabel("Brand for War Instagram").selectOption(master.id);
  await parent.click();
  await page.locator(".n-brand-master").getByText("War Instagram", { exact: true }).waitFor();
  await child.click();
  assert.equal(await page.locator(".n-brand-child").filter({ hasText: "War Clipcast" }).getByText("War Instagram", { exact: true }).count(), 0);
  await overflow();
  const now = new Date().toISOString();
  await page.route(base + root + "/posts", (route) => route.fulfill({ json: [
    { id: "test-one", title: "Fixture published video", media_id: null, caption: "Caption", destinations: [instagram.id], overrides: {}, status: "published", updated_at: now },
    { id: "test-two", title: "Fixture review video", media_id: null, caption: "Caption", destinations: [youtube.id], overrides: {}, status: "needs_review", updated_at: now },
    { id: "test-three", title: "Fixture pending video", media_id: null, caption: "Caption", destinations: [instagram.id], overrides: {}, status: "pending", updated_at: now },
  ] }));
  await page.route("**/posts/test-two/publications", (route) => route.fulfill({ json: [
    { id: "fixture-job", account_id: youtube.id, display_name: "Football YouTube", platform: "youtube", status: "needs_review", error: "Provider response uncertain", attempt: 1 },
  ] }));
  await page.goto(location("Calendar"));
  await page.getByRole("heading", { name: "Publishing calendar" }).waitFor();
  const agenda = page.locator(".n-calendar-details");
  await agenda.getByText("Fixture review video").waitFor();
  assert.ok(await page.locator(".n-calendar-cell").count() >= 28);
  await page.getByLabel("View", { exact: true }).selectOption("week");
  assert.equal(await page.locator(".n-calendar-cell").count(), 7);
  await page.getByRole("button", { name: "Next week" }).click();
  await agenda.getByText(/No dated posts/).waitFor();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByLabel("Platform", { exact: true }).selectOption("youtube");
  assert.equal(await agenda.getByText("Fixture published video").count(), 0);
  await agenda.getByRole("button", { name: "View status / errors" }).click();
  await agenda.getByText("Provider response uncertain", { exact: false }).waitFor();
  await page.getByLabel("Platform", { exact: true }).selectOption("");
  await page.getByLabel("Brand", { exact: true }).selectOption(master.id);
  await page.getByLabel("Show", { exact: true }).selectOption("pending");
  await agenda.getByText("Fixture pending video").waitFor();
  assert.equal(await agenda.getByText("Fixture published video").count(), 0);
  await page.getByLabel("View", { exact: true }).selectOption("month");
  for (const width of [320, 360, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await overflow();
  }
  assert.deepEqual(problems, []);
  console.log("PASS Electric mobile brand hierarchy, account assignment, calendar month/week/agenda, brand/platform/status filters, delivery errors and no overflow at 320–1440px");
} finally {
  await browser.close();
}
