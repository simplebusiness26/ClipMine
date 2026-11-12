import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PublishingCalendar from "./PublishingCalendar";

afterEach(() => vi.useRealTimers());

it("shows a delivered TikTok draft without counting it as published", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
  const html = renderToStaticMarkup(createElement(PublishingCalendar, {
    nicheId: "fixture-niche",
    accounts: [{ id: "fixture-account", platform: "tiktok", display_name: "Creator", status: "connected" }],
    posts: [{
      id: "fixture-post", title: "Original cartoon", caption: "Creator-owned content",
      media_id: "fixture-media", destinations: ["fixture-account"], overrides: {},
      publish_mode: "direct", status: "inbox_delivered", scheduled_at: null,
      updated_at: "2026-11-12T12:00:00Z",
    }],
    onChanged: () => {},
  }));
  expect(html).toContain("Delivered to TikTok inbox");
  expect(html).toContain('class="n-calendar-count published"><b>0</b>');
  expect(html).toContain('class="n-calendar-count reminder"><b>1</b>');
});
