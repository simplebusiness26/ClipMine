import { describe, expect, it } from "vitest";
import { contentMatches } from "./content-filter";

describe("content library filters", () => {
  const media = { id: "one", filename: "clip.mp4" };
  const posts = [
    { media_id: "one", title: "A funny title", status: "scheduled" },
    { media_id: "other", title: "Another", status: "published" },
  ];
  it("searches real filenames and associated post titles case-insensitively", () => {
    expect(contentMatches(media, posts, "FUNNY", "All")).toBe(true);
    expect(contentMatches(media, posts, "missing", "All")).toBe(false);
  });
  it("filters by associated post status without inventing a status for media", () => {
    expect(contentMatches(media, posts, "", "Scheduled")).toBe(true);
    expect(contentMatches(media, posts, "", "Published")).toBe(false);
    expect(contentMatches({ id: "empty", filename: "x" }, posts, "", "Drafts")).toBe(false);
    expect(contentMatches({ id: "empty", filename: "x" }, posts, "", "All")).toBe(true);
  });
});
