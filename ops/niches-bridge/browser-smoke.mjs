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
      let intercepted = false;
      const metaPattern = "https://www.facebook.com/**";
      await page.route(metaPattern, async (route) => {
        const auth = new URL(route.request().url());
        if (!auth.pathname.startsWith("/v") || !auth.pathname.endsWith("/dialog/oauth"))
          throw new Error("Facebook Connect navigated to the wrong path");
        if (!auth.searchParams.get("client_id") ||
            auth.searchParams.get("redirect_uri") !==
              base + "/api/oauth/facebook/callback" ||
            !auth.searchParams.get("scope")?.includes("pages_manage_posts"))
          throw new Error("Facebook Connect generated invalid OAuth parameters");
        intercepted = true;
        // A real Meta user-denial redirect, without exchanging any tokens.
        await route.fulfill({
          status: 302,
          headers: {
            location: base + "/api/oauth/facebook/callback?state=" +
              encodeURIComponent(auth.searchParams.get("state") || "") +
              "&error=access_denied",
          },
          body: "",
        });
      });
      await page.locator(".n-account-grid section").filter({
        has: page.getByRole("heading", { name: "Facebook Pages & Reels" }),
      }).getByRole("button", { name: "+ Connect an account" }).click();
      await page.getByText(
        "Facebook Pages & Reels authorisation was cancelled or denied. No account was added.",
      ).waitFor({ timeout: 15000 });
      if (!intercepted)
        throw new Error("Facebook Connect button never opened provider OAuth");
      await page.unroute(metaPattern);

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
        let metaState = null;
        let metaProblem = null;
        const metaPattern = "https://www.facebook.com/**";
        // The first navigation in a 303 redirect chain may not be intercepted
        // by Playwright route handlers; observe network requests instead.
        const observeMeta = (request) => {
          const auth = new URL(request.url());
          if (auth.origin !== "https://www.facebook.com" ||
              !auth.pathname.endsWith("/dialog/oauth")) return;
          if (request.method() !== "GET" ||
              auth.searchParams.get("redirect_uri") !== base + "/api/oauth/facebook/callback" ||
              !auth.searchParams.get("scope")?.includes("pages_manage_posts"))
            metaProblem = "Meta OAuth navigation parameters were incorrect";
          metaState = auth.searchParams.get("state");
        };
        page.on("request", observeMeta);
        // Keep the test away from real account authorisation. If Playwright
        // intercepts the OAuth navigation, use a harmless fake Meta page.
        // Block any auxiliary Meta requests (e.g. /ajax/qm/) rather than
        // treating them as OAuth navigations.
        await page.route(metaPattern, async (route) => {
          const auth = new URL(route.request().url());
          if (auth.pathname.endsWith("/dialog/oauth"))
            await route.fulfill({
              status: 200,
              contentType: "text/html",
              body: "<!doctype html><html><body>Meta login intercepted for Niches automated test</body></html>",
            });
          else await route.abort();
        });
        await page.goto(base + "/?niche=" + encodeURIComponent(smokeNiche.id) + "&section=Accounts");
        await page.locator(".n-account-grid section").filter({
          has: page.getByRole("heading", { name: "Facebook Pages & Reels" }),
        }).getByRole("button", { name: "+ Connect an account" }).click({ noWaitAfter: true });
        // A working browser-native connection MUST leave the Niches origin.
        await page.waitForURL(
          (url) => url.hostname === "www.facebook.com",
          { waitUntil: "commit", timeout: 15000 },
        );
        if (metaProblem) throw new Error(metaProblem);
        if (!metaState || !/^[a-f0-9]{64}$/.test(metaState))
          throw new Error("Facebook Connect did not reach Meta with a valid OAuth state");
        // Simulate Facebook user cancellation by visiting the real callback
        // from the same browser. This also tests scoped cookie/state handling
        // and the visible feedback after returning to Niches.
        await page.goto(base + "/api/oauth/facebook/callback?state=" +
          encodeURIComponent(metaState) + "&error=access_denied");
        try {
          await page.getByText(
            "Facebook Pages & Reels authorisation was cancelled or denied. No account was added.",
          ).waitFor({ timeout: 15000 });
        } catch (error) {
          const current = new URL(page.url());
          console.log("Facebook OAuth callback status diagnostics:", JSON.stringify({
            host: current.hostname,
            path: current.pathname,
            connection: current.searchParams.get("connection"),
            showingLogin: await page.getByRole("heading", { name: "Welcome to your corner." }).isVisible().catch(() => false),
            messages: (await page.locator(".n-error, .n-status-note").allTextContents()).filter((m) => m.includes("authorisation") || m.includes("connection")).map((m) => m.slice(0, 150)),
          }));
          throw error;
        }
        page.off("request", observeMeta);
        await page.unroute(metaPattern);
        console.log("PASS live Facebook native browser POST → OAuth redirect → denied callback → visible result");
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
