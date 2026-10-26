import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const base = process.env.NICHES_URL;
if (!base) throw new Error("NICHES_URL is required; never default to AISO.");
const target = new URL(base);
if (/agentcart|ai-seo|ai-so/.test(target.hostname))
  throw new Error("AISO targets are forbidden.");
const local = ["localhost", "127.0.0.1"].includes(target.hostname);
const write = process.env.NICHES_TEST_WRITE === "1";
if (write && !local)
  throw new Error(
    "This disposable journey can only write to localhost. Production smoke is read-only except login.",
  );
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
      .getByRole("button", { name: "+ Create content", exact: true })
      .click();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=",
      "base64",
    );
    await page
      .locator("input[type=file]")
      .setInputFiles({
        name: "original-test.png",
        mimeType: "image/png",
        buffer: png,
      });
    await page
      .getByRole("heading", { name: "A home for your content." })
      .waitFor();
    await page
      .getByRole("button", { name: "Prepare post ↗", exact: true })
      .click();
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
    await page
      .getByLabel("Export reminder (optional)")
      .fill("2099-12-31T18:00");
    await page.getByLabel("I reviewed this saved draft").check();
    await page
      .getByRole("button", { name: "Prepare export / reminder ↗", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Pick up where you left off." })
      .waitFor();
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
      "PASS local browser: register → niche → upload → draft → export reminder; 12 tabs at 5 viewport widths",
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
