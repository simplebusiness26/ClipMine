import { useMemo, useState } from "react";
import PostHistory from "./PostHistory";
import type { Post, SocialAccount, Brand, Media } from "./niches-api";
import "./publishing-calendar.css";

type Filter = "all" | "scheduled" | "pending" | "issues" | "published";
type Tone = "scheduled" | "published" | "issues" | "working" | "cancelled";

function localKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function postDate(post: Post): Date | null {
  // Drafts without a chosen date cannot be placed on a calendar.
  const fallback = ["published", "partial", "failed", "needs_review", "cancelled", "export_ready", "queued", "pending", "processing", "retry"].includes(post.status);
  const source = post.scheduled_at || (fallback ? post.updated_at : null);
  if (!source) return null;
  const parsed = new Date(source);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function isOverdue(post: Post, now: number): boolean {
  return post.status === "scheduled" &&
    post.publish_mode === "direct" &&
    !!post.scheduled_at &&
    new Date(post.scheduled_at).getTime() < now - 5 * 60 * 1000;
}

function tone(post: Post, now: number): Tone {
  if (["partial", "failed", "needs_review", "blocked"].includes(post.status) || isOverdue(post, now)) return "issues";
  if (post.status === "published" || post.status === "export_ready") return "published";
  if (post.status === "scheduled") return "scheduled";
  if (["queued", "processing", "pending", "retry"].includes(post.status)) return "working";
  return "cancelled";
}

function stateLabel(post: Post, now: number): string {
  if (isOverdue(post, now)) return "Past due · check publishing status";
  if (post.status === "needs_review") return "Needs review · check platform";
  if (post.status === "export_ready") return "Export reminder ready";
  if (post.status === "partial") return "Partially published · check deliveries";
  return post.status.replaceAll("_", " ");
}

function monthTitle(value: Date) {
  return value.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function readableDay(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

export default function PublishingCalendar({
  nicheId,
  posts,
  accounts,
  brands = [],
  media = [],
  onChanged,
}: {
  nicheId: string;
  posts: Post[];
  accounts: SocialAccount[];
  brands?: Brand[];
  media?: Media[];
  onChanged: () => void;
}) {
  const [view, setView] = useState<"month" | "week">("month");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [chosenDay, setChosenDay] = useState(() => localKey(new Date()));
  const [filter, setFilter] = useState<Filter>("all");
  const [platform, setPlatform] = useState("");
  const [brand, setBrand] = useState("");
  const platforms = [...new Set(accounts.map((account) => account.platform))].sort();
  const platformAccounts = new Set(accounts.filter((account) => account.platform === platform).map((account) => account.id));
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const now = Date.now();
  const todayKey = localKey(new Date(now));

  const entries = useMemo(() => posts.flatMap((post) => {
    const when = postDate(post);
    return when ? [{ post, when, key: localKey(when) }] : [];
  }), [posts]);

  const platformEntries = entries.filter(({ post }) =>
    (!platform || post.destinations.some((id) => platformAccounts.has(id))) &&
    (!brand || post.brand_id === brand || post.destinations.some((id) => accounts.some((account) => account.id === id && account.brand_id === brand)))
  );
  const visibleEntries = platformEntries.filter(({ post }) =>
    filter === "all" ||
    (filter === "issues" && tone(post, now) === "issues") ||
    (filter === "published" && tone(post, now) === "published") ||
    (filter === "scheduled" && tone(post, now) === "scheduled") ||
    (filter === "pending" && tone(post, now) === "working")
  );

  const itemsByDay = new Map<string, typeof entries>();
  for (const entry of visibleEntries) {
    const day = itemsByDay.get(entry.key) || [];
    day.push(entry);
    itemsByDay.set(entry.key, day);
  }
  for (const day of itemsByDay.values())
    day.sort((a, b) => a.when.getTime() - b.when.getTime());

  const monthPrefix = localKey(month).slice(0, 7);
  const monthEntries = platformEntries.filter((entry) => entry.key.startsWith(monthPrefix));
  const counts = {
    scheduled: monthEntries.filter((entry) => tone(entry.post, now) === "scheduled").length,
    published: monthEntries.filter((entry) => tone(entry.post, now) === "published").length,
    issues: monthEntries.filter((entry) => tone(entry.post, now) === "issues").length,
  };

  const startOffset = (month.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7) * 7;
  const monthCells = Array.from({ length: totalCells }, (_, index) =>
    new Date(month.getFullYear(), month.getMonth(), index + 1 - startOffset)
  );
  const [year, monthNumber, dayNumber] = chosenDay.split("-").map(Number);
  const selectedDate = new Date(year, monthNumber - 1, dayNumber);
  const weekStart = dayNumber - (selectedDate.getDay() + 6) % 7;
  const cells = view === "month" ? monthCells : Array.from({ length: 7 }, (_, index) =>
    new Date(year, monthNumber - 1, weekStart + index)
  );
  const selected = itemsByDay.get(chosenDay) || [];
  const chosenInMonth = chosenDay.startsWith(monthPrefix);

  function moveDate(delta: number) {
    const next = view === "month"
      ? new Date(month.getFullYear(), month.getMonth() + delta, 1)
      : new Date(year, monthNumber - 1, dayNumber + delta * 7);
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    setChosenDay(localKey(next));
    setExpandedPost(null);
  }

  function jumpToday() {
    const date = new Date();
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setChosenDay(localKey(date));
    setExpandedPost(null);
  }

  return (
    <section className="n-panel n-calendar" aria-label="Publishing calendar">
      <div className="n-calendar-top">
        <div>
          <span className="n-kicker">PUBLISHING OVERVIEW</span>
          <h2>Publishing calendar</h2>
          <p>All dates use your device timezone. Posts refresh automatically.</p>
        </div>
        <div className="n-calendar-tools">
          <label className="n-calendar-filter">
            View
            <select aria-label="Calendar view" value={view} onChange={(event) => setView(event.target.value === "week" ? "week" : "month")}>
              <option value="month">Month</option>
              <option value="week">Week</option>
            </select>
          </label>
          <label className="n-calendar-filter">
            Show
            <select aria-label="Publishing status" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
              <option value="all">All dated posts</option>
              <option value="scheduled">Scheduled</option>
              <option value="pending">Pending / processing</option>
              <option value="issues">Problems / overdue</option>
              <option value="published">Published</option>
            </select>
          </label>
          <label className="n-calendar-filter">
            Platform
            <select aria-label="Platform" value={platform} onChange={(event) => setPlatform(event.target.value)}>
              <option value="">All platforms</option>
              {platforms.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          {brands.length > 0 && <label className="n-calendar-filter">
            Brand
            <select aria-label="Brand" value={brand} onChange={(event) => setBrand(event.target.value)}>
              <option value="">All brands</option>
              {brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>}
        </div>
      </div>

      <div className="n-calendar-summary" aria-label="Month publishing totals">
        <span className="n-calendar-count scheduled"><b>{counts.scheduled}</b> Scheduled</span>
        <span className="n-calendar-count published"><b>{counts.published}</b> Published</span>
        <span className="n-calendar-count issues"><b>{counts.issues}</b> Problems / past due</span>
      </div>

      <div className="n-calendar-nav">
        <div className="n-calendar-direction">
          <button type="button" onClick={() => moveDate(-1)} aria-label={`Previous ${view}`}>‹</button>
          <h3 aria-live="polite">{monthTitle(view === "month" ? month : selectedDate)}</h3>
          <button type="button" onClick={() => moveDate(1)} aria-label={`Next ${view}`}>›</button>
        </div>
        <button type="button" className="n-calendar-today" onClick={jumpToday}>Today</button>
      </div>

      <div className="n-calendar-weekdays" aria-hidden="true">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="n-calendar-grid">
        {cells.map((day) => {
          const key = localKey(day);
          const events = itemsByDay.get(key) || [];
          const outOfMonth = day.getMonth() !== month.getMonth();
          const deliveryCount = events.reduce((count, { post }) => count + Math.max(post.destinations.length, 1), 0);
          const problems = events.filter((entry) => tone(entry.post, now) === "issues").length;
          return (
            <button
              type="button"
              key={key}
              className={"n-calendar-cell" +
                (outOfMonth ? " outside" : "") +
                (key === todayKey ? " today" : "") +
                (key === chosenDay ? " chosen" : "")}
              aria-pressed={key === chosenDay}
              aria-label={readableDay(key) + ", " + events.length + " posts, " + deliveryCount + " destinations" + (problems ? ", " + problems + " require attention" : "")}
              onClick={() => {
                if (outOfMonth) setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
                setChosenDay(key);
                setExpandedPost(null);
              }}
            >
              <span className="n-calendar-day-number">{day.getDate()}</span>
              <span className="n-calendar-cell-events">
                {events.slice(0, 2).map(({ post }) => (
                  <span className={"n-calendar-event " + tone(post, now)} key={post.id} title={post.title || "Untitled post"}>
                    <i aria-hidden="true" />
                    <span>{post.title || "Untitled"}</span>
                  </span>
                ))}
                {events.length > 2 && <span className="n-calendar-more">+{events.length - 2} more</span>}
              </span>
              <span className="n-calendar-mobile-dots" aria-hidden="true">
                {events.length > 0 && <>
                  <i className={problems ? "issues" : tone(events[0].post, now)} />
                  <small>{deliveryCount}</small>
                </>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="n-calendar-legend" aria-label="Calendar colour key">
        <span><i className="scheduled" /> Scheduled</span>
        <span><i className="published" /> Published</span>
        <span><i className="working" /> Processing</span>
        <span><i className="issues" /> Failed / review / past due</span>
        <span><i className="cancelled" /> Cancelled</span>
      </div>

      <div className="n-calendar-details" aria-live="polite">
        <div className="n-calendar-detail-head">
          <h3>{readableDay(chosenDay)}</h3>
          <span>{chosenInMonth ? selected.length + " posts" : "Outside viewed month"}</span>
        </div>
        {selected.length === 0 ? (
          <p className="n-calendar-empty">No {filter === "all" ? "dated posts" : filter + " posts"} for this day. Drafts without dates remain in Drafts.</p>
        ) : (
          selected.map(({ post, when }) => {
            const t = tone(post, now);
            const open = expandedPost === post.id;
            const filename = media.find((item) => item.id === post.media_id)?.filename;
            return (
              <article className={"n-calendar-detail " + t} key={post.id}>
                <div className="n-calendar-detail-primary">
                  <div>
                    <span className={"n-calendar-state " + t}>{stateLabel(post, now)}</span>
                    <h4>{post.title || post.overrides?.youtube?.title || "Untitled post"}</h4>
                    <p className="n-calendar-time">
                      {when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · {post.publish_mode === "direct" ? "Direct publishing" : "Export reminder / manual"}
                    </p>
                    <div className="n-calendar-platforms">
                      {post.destinations.map((id) => {
                        const account = accounts.find((item) => item.id === id);
                        const brandName = brands.find((item) => item.id === account?.brand_id)?.name;
                        return <span key={id}>{account ? [account.platform, account.display_name, brandName].filter(Boolean).join(" · ") : "Previous destination"}</span>;
                      })}
                    </div>
                  </div>
                  <button type="button" onClick={() => setExpandedPost(open ? null : post.id)} aria-expanded={open}>
                    {open ? "Hide details" : "View status / errors"}
                  </button>
                </div>
                {open && (
                  <div className="n-calendar-expanded">
                    {filename && <p>Media · {filename}</p>}
                    <p>{post.caption || "No master caption; platform-specific captions may be set."}</p>
                    <PostHistory nicheId={nicheId} postId={post.id} autoOpen onChanged={onChanged} />
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
