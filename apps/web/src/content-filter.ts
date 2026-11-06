type Filter = "All" | "Drafts" | "Scheduled" | "Published";
type Media = { id: string; filename: string };
type Post = { media_id?: string | null; title?: string | null; status: string };

export function contentMatches(media: Media, posts: Post[], query: string, filter: Filter) {
  const matchingPosts = posts.filter((post) => post.media_id === media.id);
  const textMatches = [media.filename, ...matchingPosts.map((post) => post.title || "")]
    .some((value) => value.toLowerCase().includes(query.toLowerCase()));
  const statuses = { Drafts: "draft", Scheduled: "scheduled", Published: "published" } as const;
  return textMatches && (filter === "All" || matchingPosts.some((post) => post.status === statuses[filter]));
}
