import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PublishingCalendar from "./PublishingCalendar";
import type { Post } from "./niches-api";

function post(status: string, id: string, scheduled_at: string): Post {
  return {
    id,
    title: "Cartoon " + id,
    media_id: "media",
    caption: "Original comedy",
    destinations: ["youtube"],
    overrides: {},
    publish_mode: "direct",
    status,
    scheduled_at,
    updated_at: scheduled_at,
  };
}

describe("PublishingCalendar", () => {
  it("shows a real seven-column calendar and per-day publishing states", () => {
    const today = new Date();
    const when = today.toISOString();
    const html = renderToStaticMarkup(createElement(PublishingCalendar, {
      nicheId: "test-niche",
      posts: [
        post("published", "confirmed", when),
        post("needs_review", "uncertain", when),
      ],
      accounts: [{ id: "youtube", platform: "youtube", display_name: "Cartoons", status: "connected" }],
      onChanged: () => {},
    }));
    expect(html).toContain("Publishing calendar");
    expect(html).toContain("Mon");
    expect(html).toContain("Sun");
    expect(html).toContain("Published");
    expect(html).toContain("Problems / past due");
    expect(html).toContain("View status / errors");
    expect(html).toContain("youtube · Cartoons");
    expect((html.match(/class="n-calendar-cell(?: |")/g) || []).length).toBeGreaterThanOrEqual(28);
  });

  it("does not mislabel an overdue scheduled post as confirmed failed", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // If yesterday was in the previous month, the post still appears in
    // the original calendar timeline but not in this month's totals.
    const html = renderToStaticMarkup(createElement(PublishingCalendar, {
      nicheId: "test-niche",
      posts: [post("scheduled", "past-due", yesterday.toISOString())],
      accounts: [],
      onChanged: () => {},
    }));
    expect(html).toContain("Past due · check publishing status");
    expect(html).not.toContain("Provider confirmed failure");
  });

  it("never places undated drafts onto the calendar", () => {
    const draft = { ...post("draft", "undated", new Date().toISOString()), scheduled_at: null };
    const html = renderToStaticMarkup(createElement(PublishingCalendar, {
      nicheId: "test-niche",
      posts: [draft],
      accounts: [],
      onChanged: () => {},
    }));
    expect(html).toContain("Drafts without dates remain in Drafts");
    expect(html).not.toContain("Cartoon undated");
  });
});
