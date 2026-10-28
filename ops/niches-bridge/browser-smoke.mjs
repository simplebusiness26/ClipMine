import { validateBrowserTarget } from "./target-policy.mjs";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const base = process.env.NICHES_URL;
if (!base) throw new Error("NICHES_URL is required; never default to AISO.");
const write = process.env.NICHES_TEST_WRITE === "1";
validateBrowserTarget(base, write);

// Small disposable archive with an original PNG and matching caption metadata.
function zipFixture(files) {
  const u16 = (n) => [n & 255, (n >>> 8) & 255];
  const u32 = (n) => [...u16(n), ...u16(n >>> 16)];
  const utf8 = new TextEncoder();
  const local = [], directory = [];
  for (const [filename, content] of files) {
    const name = utf8.encode(filename);
    const data = typeof content === "string" ? utf8.encode(content) : content;
    const offset = local.length;
    local.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u32(0), ...u32(0), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...name, ...data);
    directory.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0),
      ...u16(0), ...u32(0), ...u32(0), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset), ...name);
  }
  return Buffer.from([...local, ...directory, ...u32(0x06054b50),
    ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(directory.length), ...u32(local.length), ...u16(0)]);
}

const browser = await chromium.launch({ headless: true });
const findings = [];
await mkdir("test-results", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => findings.push(e.message));
  await page.goto(base);
  await page
    .getByRole("heading", { name: "Welcome to your corner." })
    .waitFor();
  if (write) {
    await page
      .getByRole("button", { name: "Create an account", exact: true })
      .click();
    await page
      .getByLabel("Email", { exact: true })
      .fill(`niches-e2e-${Date.now()}@example.test`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("A long disposable test password");
    await page
      .getByRole("button", { name: "Create account ↗", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Different niches. One place to grow." })
      .waitFor();
    await page
      .getByRole("button", { name: "+ Create a niche", exact: true })
      .click();
    await page.getByLabel("Niche name").fill("Cars");
    await page
      .getByLabel("A little about it")
      .fill("Original stories for people who love driving.");
    await page
      .getByRole("button", { name: "Create niche ↗", exact: true })
      .click();
    await page.getByRole("heading", { name: "Your next chapter." }).waitFor();
    await page
      .locator('nav[aria-label="Niche workspace"] button')
      .filter({ has: page.locator("span", { hasText: /^Accounts$/ }) })
      .click();
    for (const account of [
      { platform: "instagram", name: "Instagram Main", handle: "carsmain" },
      { platform: "instagram", name: "Instagram Daily", handle: "carsdaily" },
      {
        platform: "instagram",
        name: "Instagram Classics",
        handle: "carsclassics",
      },
      { platform: "tiktok", name: "TikTok Main", handle: "carsmain" },
      { platform: "tiktok", name: "TikTok Daily", handle: "carsdaily" },
      {
        platform: "youtube",
        name: "YouTube Cars",
        handle: "carschannelfixture",
      },
    ]) {
      await page
        .getByRole("button", { name: "+ Add an account", exact: true })
        .click();
      await page
        .getByLabel("Platform", { exact: true })
        .selectOption(account.platform);
      await page.getByLabel("Account name", { exact: true }).fill(account.name);
      await page
        .getByLabel("Username, handle or channel identifier", { exact: true })
        .fill(account.handle);
      await page
        .getByRole("button", { name: "Add to this niche", exact: true })
        .click();
      await page.getByText(account.name, { exact: true }).waitFor();
    }
    const storage = (
      await (await page.request.get(base + "/api/health")).json()
    ).storage;
    await page
      .getByRole("button", { name: "+ Create content", exact: true })
      .click();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=",
      "base64",
    );
    await page.locator("input[type=file]").setInputFiles({
      name: "original-test.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page
      .getByRole("heading", { name: "A home for your content." })
      .waitFor();
    if (storage)
      await page
        .getByRole("button", { name: "Prepare post ↗", exact: true })
        .click();
    else {
      await page
        .getByRole("heading", { name: "Selected on this device (1)" })
        .waitFor();
      await page
        .locator('nav[aria-label="Niche workspace"] button')
        .filter({ has: page.locator("span", { hasText: /^Publish$/ }) })
        .click();
    }
    await page.getByLabel(/TikTok Daily/).uncheck();
    await page
      .getByLabel("Post title", { exact: true })
      .fill("My first original post");
    await page
      .getByLabel("Master caption", { exact: true })
      .fill("A fresh original idea.");
    await page
      .getByRole("button", { name: "Save draft ↗", exact: true })
      .click();
    await page.getByText("Draft saved. Review below").waitFor();
    if (
      !(await page
        .getByRole("button", {
          name: "Publish to selected accounts",
          exact: true,
        })
        .isDisabled())
    )
      throw new Error(
        "Unconnected accounts were incorrectly enabled for publishing",
      );
    await page.getByText("5 destination accounts", { exact: false }).waitFor();
    await page
      .locator('nav[aria-label="Niche workspace"] button')
      .filter({ has: page.locator("span", { hasText: /^Drafts$/ }) })
      .click();
    await page
      .getByRole("heading", { name: "Pick up where you left off." })
      .waitFor();
    if (storage) {
      // Browser-level real import → upload → draft persistence, never social publishing.
      await page
        .locator('nav[aria-label="Niche workspace"] button')
        .filter({ has: page.locator("span", { hasText: /^Create$/ }) })
        .click();
      const zip = zipFixture([
        ["original-zip.png", png],
        ["metadata.json", JSON.stringify({ posts: [
          { filename: "original-zip.png", title: "ZIP browser test",
            description: "ZIP caption matched", hashtags: ["#realmetadata"] },
        ] })],
      ]);
      await page.getByLabel("Import ZIP content pack").setInputFiles({
        name: "niches-batch.zip",
        mimeType: "application/zip",
        buffer: zip,
      });
      await page.getByText("Imported 1 ZIP videos/images", { exact: false }).waitFor();
      await page.getByText("ZIP caption matched", { exact: false }).waitFor();
      await page.getByText("ZIP browser test", { exact: true }).waitFor();
    }
    await page
      .getByRole("button", { name: "◈ All niches 1" })
      .click()
      .catch(() => page.locator(".n-sidebar>.n-nav").first().click());
    await page.screenshot({
      path: "test-results/niches-desktop.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: /Cars Original stories/ }).click();
    for (const width of [320, 375, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tab of [
        "Overview",
        "Content",
        "Create",
        "Drafts",
        "Publish",
        "Calendar",
        "Analytics",
        "Accounts",
        "Ideas",
        "Revenue",
        "Settings",
        "ClipMine",
      ]) {
        await page
          .locator('nav[aria-label="Niche workspace"] button')
          .filter({
            has: page.locator("span", { hasText: new RegExp(`^${tab}$`) }),
          })
          .click();
        await page.waitForTimeout(70);
        if (
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 2,
          )
        )
          findings.push(`${width}px ${tab}: page overflow`);
      }
      if (width === 390) {
        await page.locator(".n-sidebar>.n-nav").first().click();
        await page.screenshot({
          path: "test-results/niches-mobile.png",
          fullPage: true,
        });
        await page
          .getByRole("button", { name: /Cars Original stories/ })
          .click();
      }
    }
    console.log(
      "PASS local browser: register → niche → 3 Instagrams/2 TikToks/1 YouTube → select destinations → file upload/preview → draft → ZIP metadata import; 12 tabs at 5 viewport widths",
    );
  } else {
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 900 });
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        )
      )
        findings.push(`${width}px login overflow`);
    }
    if (process.env.NICHES_TEST_EMAIL && process.env.NICHES_TEST_PASSWORD) {
      await page
        .getByLabel("Email", { exact: true })
        .fill(process.env.NICHES_TEST_EMAIL);
      await page
        .getByLabel("Password", { exact: true })
        .fill(process.env.NICHES_TEST_PASSWORD);
      await page.getByRole("button", { name: "Log in ↗", exact: true }).click();
      await page
        .getByRole("heading", { name: "Different niches. One place to grow." })
        .waitFor();
    } else
      console.log(
        "SKIP authenticated production smoke: dedicated Niches credentials are not configured.",
      );
    console.log("PASS public mobile smoke");
  }
  await context.close();
} finally {
  await browser.close();
}
if (findings.length) throw new Error(findings.join("\n"));
