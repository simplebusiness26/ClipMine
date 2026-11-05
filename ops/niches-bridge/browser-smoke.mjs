import { validateBrowserTarget } from "./target-policy.mjs";
import { chromium, devices } from "playwright";
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

async function verifyMetaNativeLink(page, base, nicheId, contextLabel, platform, unified = false) {
  if (!["facebook", "instagram"].includes(platform)) throw new Error("Unsupported Meta test platform");
  let state = null;
  let invalidParameters = false;
  const metaPattern = unified || platform === "facebook"
    ? /^https:\/\/(?:www|m|business)\.facebook\.com\//
    : /^https:\/\/www\.instagram\.com\//;
  const observeMeta = (request) => {
    const incoming = new URL(request.url());
    if (!["www.facebook.com", "m.facebook.com", "business.facebook.com", "www.instagram.com"].includes(incoming.hostname))
      return;
    // On Android, Meta often redirects its original /dialog/oauth page to
    // m.facebook.com/unified/login_via/app?next=<original OAuth URL>.
    const nested = incoming.searchParams.get("next");
    const auth = incoming.pathname.endsWith("/dialog/oauth") ||
      incoming.pathname === "/oauth/authorize"
      ? incoming
      : nested ? new URL(nested) : null;
    if (!auth || !(auth.pathname.endsWith("/dialog/oauth") || auth.pathname === "/oauth/authorize")) return;
    state = auth.searchParams.get("state");
    invalidParameters =
      request.method() !== "GET" ||
      auth.searchParams.get("redirect_uri") !== base + "/api/oauth/" + platform + "/callback" ||
      (unified
        ? !auth.searchParams.has("config_id") || auth.searchParams.has("scope")
        : !auth.searchParams.get("scope")?.includes(
            platform === "facebook" ? "pages_manage_posts" : "instagram_business_basic"
          ));
  };
  page.on("request", observeMeta);
  // Intercept either Facebook hostname, including mobile login redirects.
  // Never interact with a real Meta account in automated tests.
  await page.route(metaPattern, async (route) => {
    if (route.request().isNavigationRequest())
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><body>Meta authorisation intercepted for automated testing</body></html>",
      });
    else await route.abort();
  });
  try {
    await page.goto(base + "/?niche=" + encodeURIComponent(nicheId) + "&section=Accounts");
    const link = page.getByRole("link", { name: "+ Connect " + (platform === "facebook" ? "Facebook" : "Instagram") });
    await link.waitFor({ state: "visible" });
    const url = new URL(await link.getAttribute("href"), base);
    if (url.origin !== base || !url.pathname.endsWith("/accounts/" + platform + "/connect/start"))
      throw new Error(platform + " control is not a same-origin native link");
    await link.click({ noWaitAfter: true });
    await page.waitForURL((u) => ["www.facebook.com", "m.facebook.com", "business.facebook.com", "www.instagram.com"].includes(u.hostname), {
      waitUntil: "commit", timeout: 15000,
    });
    if (invalidParameters || !state || !/^[a-f0-9]{64}$/.test(state))
      throw new Error(platform + " native link did not navigate with a valid Meta OAuth state");
    // Return in the same browser with the scoped cookie; do not exchange any
    // token or authorise a real account.
    await page.goto(base + "/api/oauth/" + platform + "/callback?state=" +
      encodeURIComponent(state) + "&error=access_denied");
    await page.getByText(
      (platform === "facebook" ? "Facebook Pages & Reels" : "Instagram professional & Reels") + " authorisation was cancelled or denied. No account was added.",
    ).waitFor({ timeout: 15000 });
    console.log("PASS " + contextLabel + " " + platform + " native link → Meta OAuth → visible cancellation");
  } finally {
    page.off("request", observeMeta);
    await page.unroute(metaPattern);
  }
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
    // Exercise the real production Facebook Connect button, callback URL,
    // browser/session cookie flow and visible cancellation result. Intercept
    // Meta's website: never request a live person's Facebook permissions.
    const socialProviders = await (
      await page.request.get(base + "/api/providers")
    ).json();
    if (socialProviders.find((p) => p.id === "facebook")?.oauth_ready) {
      const registeredNiches = await (
        await page.request.get(base + "/api/niches")
      ).json();
      const testNiche = registeredNiches.find((n) => n.name === "Cars");
      if (!testNiche) throw new Error("Facebook OAuth smoke niche not found");
      for (const platform of ["facebook", "instagram"]) {
        if (!socialProviders.find((p) => p.id === platform)?.oauth_ready) {
          console.log("SKIP " + platform + " OAuth smoke: application credentials not configured");
          continue;
        }
        await verifyMetaNativeLink(page, base, testNiche.id, "local desktop", platform,
          platform === "instagram" && socialProviders.find((p) => p.id === platform)?.login_mode === "unified");
      }

      // A successful Meta callback returns a Page-selection ticket. The
      // browser should display authorised Pages without a second click.
      // Supply fixture choices without granting tokens or writing accounts.
      const selectionTicket = "f".repeat(64);
      const selectionEndpoint = base + "/api/niches/" +
        testNiche.id + "/connections/" + selectionTicket;
      await page.route(selectionEndpoint, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { id: "fixture-meta-page", name: "Demo Page", platform: "facebook" },
          ]),
        });
      });
      await page.goto(base + "/?niche=" + testNiche.id +
        "&section=Accounts&connect_ticket=" + selectionTicket);
      await page.getByText("Demo Page · facebook").waitFor({ timeout: 15000 });
      await page.unroute(selectionEndpoint);
      await page.goto(base + "/?niche=" + testNiche.id + "&section=Accounts");
    }
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
    await page.locator('input[type=file][accept^="video/"]').setInputFiles({
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
    // A multi-account draft must expose separate per-account controls, but
    // unconnected planning accounts must never be allowed to publish.
    const savedRow = page.locator(".n-post-row").filter({
      hasText: "My first original post",
    });
    const accountButtons = savedRow.getByRole("button", {
      name: /^Publish separately to /,
    });
    if ((await accountButtons.count()) !== 5)
      throw new Error("Five individual draft publishing controls expected");
    for (const button of await accountButtons.all())
      if (!(await button.isDisabled()))
        throw new Error("An unauthorised account was enabled for individual publishing");
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

      // Exercise the actual live Facebook button through its native form POST,
      // the Worker 303 redirect, the scoped OAuth cookie and the callback.
      // Intercept Meta before any real login: only simulate the user declining.
      const providers = await (
        await page.request.get(base + "/api/providers")
      ).json();
      if (providers.some((p) => p.id === "facebook" && p.oauth_ready)) {
        const ownedNiches = await (
          await page.request.get(base + "/api/niches")
        ).json();
        const smokeNiche = ownedNiches.find((n) => n.name === "Deployment check");
        if (!smokeNiche) throw new Error("Missing deployment acceptance niche for Facebook smoke");
        for (const platform of ["facebook", "instagram"]) {
          if (!providers.find((p) => p.id === platform)?.oauth_ready) {
            console.log("SKIP " + platform + " OAuth smoke: application credentials not configured");
            continue;
          }
          await verifyMetaNativeLink(page, base, smokeNiche.id, "production desktop", platform,
            platform === "instagram" && providers.find((p) => p.id === platform)?.login_mode === "unified");
        }

        // True Android touch/viewport/user-agent emulation, not just resizing
        // a desktop window. Reuse an existing disposable test login.
        const androidContext = await browser.newContext({
          ...devices["Pixel 7"],
          storageState: await context.storageState(),
        });
        try {
          const androidPage = await androidContext.newPage();
          androidPage.on("pageerror", (e) => findings.push(e.message));
          for (const platform of ["facebook", "instagram"]) {
            if (!providers.find((p) => p.id === platform)?.oauth_ready) continue;
            await verifyMetaNativeLink(androidPage, base, smokeNiche.id, "production Android", platform,
              platform === "instagram" && providers.find((p) => p.id === platform)?.login_mode === "unified");
          }
        } finally {
          await androidContext.close();
        }
      }
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
