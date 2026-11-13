import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ElectricDrafts from "./ElectricDrafts";
import PublishingReview from "./PublishingReview";
import type { Post, SocialAccount } from "./niches-api";

const account: SocialAccount = {
  id: "youtube-1",
  platform: "youtube",
  display_name: "Cartoon Studio",
  status: "connected",
};
function post(id: string, status = "draft"): Post {
  return {
    id, status, publish_mode: "direct", media_id: "media-1",
    title: "Cartoon " + id,
    caption: "A new original cartoon.",
    destinations: [account.id], overrides: {},
    updated_at: "2026-11-09T01:00:00.000Z", scheduled_at: null,
  };
}
describe("Electric creator launch workflow", () => {
  it("separates editable drafts from queued and published items", () => {
    const html = renderToStaticMarkup(createElement(ElectricDrafts, {
      nicheId: "niche-1",
      posts: [post("A"), post("B", "scheduled"), post("C", "published")],
      media: [{ id: "media-1", filename: "sample.mp4", mime: "video/mp4", size: 100, created_at: "2026-11-09T01:00:00Z" }],
      accounts: [account],
      onEdit: () => {},
      onReview: () => {},
      onCreate: () => {},
    }));
    expect(html).toContain("THE ");
    expect(html).toContain("STAGING BAY.");
    expect(html).toContain("Cartoon A");
    expect(html).not.toContain("Cartoon B");
    expect(html).not.toContain("Cartoon C");
    expect(html).toContain("Review publishing for Cartoon A");
    expect(html).toContain("Nothing gets published until you explicitly approve it.");
  });
  it("shows a safe remove button for each selected destination at review", () => {
    const html = renderToStaticMarkup(createElement(PublishingReview, {
      nicheId: "niche-1",
      draft: post("A"),
      accounts: [account],
      providers: [{ id: "youtube", name: "YouTube", status: "connected", publishing_enabled: true, oauth_ready: true, reason: "" }],
      onAccounts: () => {},
      onResult: () => {},
      onDraftUpdated: () => {},
    }));
    expect(html).toContain("Remove Cartoon Studio from this draft");
    expect(html).toContain("Publish to selected accounts");
  });
});
