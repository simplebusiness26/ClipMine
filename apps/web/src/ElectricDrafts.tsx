import { useMemo, useState } from "react";
import { mediaPath, type Media, type Post, type SocialAccount } from "./niches-api";

/**
 * The staging screen is deliberately read-only: opening a draft never queues
 * a publication. The owner must go through PublishingReview to deliver it.
 */
export default function ElectricDrafts({
  nicheId,
  posts,
  media,
  accounts,
  onEdit,
  onReview,
  onCreate,
}: {
  nicheId: string;
  posts: Post[];
  media: Media[];
  accounts: SocialAccount[];
  onEdit: (post: Post) => void;
  onReview: (post: Post) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "attention">("all");

  const drafts = useMemo(
    () => posts.filter((post) => ["draft", "blocked", "cancelled"].includes(post.status)),
    [posts],
  );
  const mediaById = useMemo(() => new Map(media.map((item) => [item.id, item])), [media]);
  const accountById = useMemo(() => new Map(accounts.map((item) => [item.id, item])), [accounts]);
  const needsAttention = (post: Post) =>
    !post.media_id ||
    !post.destinations.length ||
    post.destinations.some((id) => accountById.get(id)?.status !== "connected");

  const readyCount = drafts.filter((post) => !needsAttention(post)).length;
  const attentionCount = drafts.length - readyCount;
  const visible = drafts
    .filter((post) => {
      const text = [post.title, post.caption, ...post.destinations.map((id) => accountById.get(id)?.display_name || "")]
        .join(" ")
        .toLowerCase();
      if (!text.includes(query.trim().toLowerCase())) return false;
      return filter === "all" || (filter === "ready" ? !needsAttention(post) : needsAttention(post));
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <section className="electric-drafts" aria-label="Drafts workspace">
      <div className="electric-drafts-hero">
        <div className="electric-drafts-hero-copy">
          <span className="electric-overline"><span aria-hidden="true" className="electric-pulse" /> CREATOR CONTROL / 01</span>
          <h2>THE <em>STAGING BAY.</em></h2>
          <p>Your ideas are safe here. Nothing gets published until you explicitly approve it.</p>
        </div>
        <div className="electric-drafts-orbit" aria-hidden="true">
          <span className="electric-orbit-a" />
          <span className="electric-orbit-b" />
          <span className="electric-orbit-core">D</span>
        </div>
      </div>

      <div className="electric-drafts-metrics">
        <div><span>ALL DRAFTS</span><strong>{drafts.length.toString().padStart(2, "0")}</strong></div>
        <div><span>READY TO REVIEW</span><strong>{readyCount.toString().padStart(2, "0")}</strong></div>
        <div><span>NEEDS ATTENTION</span><strong>{attentionCount.toString().padStart(2, "0")}</strong></div>
      </div>

      <div className="electric-drafts-bar">
        <div className="electric-drafts-filter" role="group" aria-label="Filter drafts">
          {([
            ["all", "All"],
            ["ready", "Ready"],
            ["attention", "Needs work"],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value}
              onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        <label className="electric-drafts-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a draft…" aria-label="Search drafts" />
        </label>
      </div>

      <div className="electric-drafts-list" aria-live="polite">
        <div className="electric-drafts-list-heading">
          <span>YOUR UNPUBLISHED WORK</span>
          <span>{visible.length} shown</span>
        </div>
        {visible.length === 0 ? (
          <div className="electric-drafts-empty">
            <span aria-hidden="true">✧</span>
            <h3>{drafts.length ? "Nothing matches this view." : "A blank canvas."}</h3>
            <p>{drafts.length ? "Try clearing your search or switching filters." : "Your next brilliant idea starts here."}</p>
            <button type="button" onClick={onCreate}>+ Create a draft</button>
          </div>
        ) : visible.map((post, index) => {
          const item = post.media_id ? mediaById.get(post.media_id) : undefined;
          const requiresWork = needsAttention(post);
          const label = !post.media_id ? "Media missing" : !post.destinations.length
            ? "Choose platforms" : requiresWork ? "Check connections" : "Ready to review";
          return (
            <article className="electric-draft-line" key={post.id}>
              <span className="electric-draft-sequence">{String(index + 1).padStart(2, "0")}</span>
              <div className="electric-draft-art">
                {item ? (
                  item.mime.startsWith("image/")
                    ? <img loading="lazy" alt="" src={mediaPath(nicheId, item.id)} />
                    : <video muted playsInline preload="metadata" src={mediaPath(nicheId, item.id)} aria-label="Draft video preview" />
                ) : <span aria-hidden="true">▷</span>}
              </div>
              <div className="electric-draft-description">
                <span className={"electric-draft-state" + (requiresWork ? " attention" : "")}>
                  <i aria-hidden="true" /> {label}
                </span>
                <h3>{post.title || post.overrides?.youtube?.title || "Untitled draft"}</h3>
                <p>{post.caption || "Add a caption and make it yours."}</p>
                <div className="electric-draft-destinations" aria-label="Selected platforms">
                  {post.destinations.length
                    ? post.destinations.map((id) => {
                      const account = accountById.get(id);
                      return <span key={id}>{account ? account.platform : "Unlinked account"}</span>;
                    })
                    : <span>No platforms selected</span>}
                </div>
              </div>
              <div className="electric-draft-actions">
                <button type="button" className="electric-draft-edit" onClick={() => onEdit(post)}
                  aria-label={"Edit " + (post.title || "untitled draft")}>Edit</button>
                <button type="button" className="electric-draft-review" onClick={() => onReview(post)}
                  aria-label={"Review publishing for " + (post.title || "untitled draft")}>
                  Review <span aria-hidden="true">↗</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="electric-drafts-footnote"><span aria-hidden="true">●</span> YOUR DRAFTS ARE PRIVATE · PUBLISHING REQUIRES YOUR APPROVAL</p>
    </section>
  );
}
