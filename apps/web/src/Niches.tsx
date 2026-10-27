import PostHistory from "./PostHistory";
import SocialAccounts from "./SocialAccounts";
import PublishingReview from "./PublishingReview";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import ClipMine from "./App";
import {
  call,
  mediaPath,
  uploadMedia,
  type Niche,
  type Media,
  type Post,
  type Provider,
  type SocialAccount,
  type Activity,
  type Idea,
  type Revenue,
  type Notice,
} from "./niches-api";
import "./niches.css";
const tabs = [
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
] as const;
type Tab = (typeof tabs)[number];
const symbols = ["◈", "▦", "+", "▤", "↗", "▦", "↗", "◎", "✧", "£", "⚙", "▷"];
const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
function Mark() {
  return (
    <span className="n-mark" aria-hidden="true">
      n<span>↗</span>
    </span>
  );
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="n-empty">
      <span aria-hidden="true">✧</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Auth({ onLogin }: { onLogin: () => void }) {
  const resetToken = new URLSearchParams(location.search).get("reset");
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">(
    resetToken ? "reset" : "login",
  );
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await call<{ message?: string }>(
        `/api/auth/${mode}`,
        "POST",
        { ...data, token: resetToken },
      );
      if (mode === "forgot") setMessage(result.message || "Check your inbox.");
      else if (mode === "reset") {
        setMode("login");
        history.replaceState(null, "", location.pathname);
        setMessage("Password changed. Log in with your new password.");
      } else onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="n-auth">
      <div className="n-auth-story">
        <div className="n-brand">
          <Mark /> niches<span className="n-beta">BETA</span>
        </div>
        <div>
          <span className="n-kicker">YOUR BRANDS. ONE WORKSPACE.</span>
          <h1>
            Big ideas.
            <br />
            Every niche.
          </h1>
          <p>
            Your content, connected. Build your brands, shape your next post and
            keep everything moving from one place.
          </p>
          <div className="n-auth-chips">
            <span>CREATE</span>
            <span>ORGANISE</span>
            <span>GROW ↗</span>
          </div>
        </div>
        <small>ClipMine studio is now part of Niches.</small>
      </div>
      <main className="n-auth-form">
        <span className="n-kicker">LET’S MAKE SOMETHING GOOD</span>
        <h2>
          {mode === "register"
            ? "Your next chapter starts here."
            : mode === "forgot"
              ? "Forgot your password?"
              : mode === "reset"
                ? "Choose a new password."
                : "Welcome to your corner."}
        </h2>
        <p>
          {mode === "login"
            ? "Log in to your Niches workspace."
            : "Keep your content and brands in one place."}
        </p>
        <form onSubmit={submit}>
          {mode !== "reset" && (
            <label>
              Email
              <input name="email" type="email" required autoComplete="email" />
            </label>
          )}
          {mode !== "forgot" && (
            <label>
              Password
              <input
                aria-label="Password"
                name="password"
                type="password"
                required
                minLength={mode === "login" ? 1 : 12}
                maxLength={256}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
              />
              {mode !== "login" && <small>At least 12 characters.</small>}
            </label>
          )}
          {error && (
            <p className="n-error" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <button className="n-primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "register"
                ? "Create account ↗"
                : mode === "forgot"
                  ? "Send reset link"
                  : mode === "reset"
                    ? "Save password"
                    : "Log in ↗"}
          </button>
        </form>
        <div className="n-auth-links">
          <button
            onClick={() => {
              setMode(mode === "register" ? "login" : "register");
              setError("");
              setMessage("");
            }}
          >
            {mode === "register"
              ? "Already a member? Log in"
              : "Create an account"}
          </button>
          {mode === "login" && (
            <button onClick={() => setMode("forgot")}>Forgot password?</button>
          )}
        </div>
      </main>
    </div>
  );
}
export default function Niches() {
  const [user, setUser] = useState<{ email: string } | null>(null),
    [checking, setChecking] = useState(true),
    [niches, setNiches] = useState<Niche[]>([]),
    [active, setActive] = useState<Niche | null>(null),
    [tab, setTab] = useState<Tab>("Overview"),
    [creating, setCreating] = useState(false),
    [notices, setNotices] = useState<Notice[]>([]),
    [showNotices, setShowNotices] = useState(false),
    [error, setError] = useState(""),
    [refreshKey, setRefreshKey] = useState(0);
  async function refresh() {
    const [ns, nt] = await Promise.all([
      call<Niche[]>("/api/niches"),
      call<Notice[]>("/api/notifications"),
    ]);
    setNiches(ns);
    setNotices(nt);
    setActive((current) =>
      current ? ns.find((n) => n.id === current.id) || null : null,
    );
  }
  async function load() {
    try {
      setUser(await call("/api/auth/me"));
      await refresh();
      const params = new URLSearchParams(location.search),
        nicheId = params.get("niche");
      if (nicheId) {
        const list = await call<Niche[]>("/api/niches");
        const found = list.find((n) => n.id === nicheId);
        if (found) {
          setActive(found);
          if (params.get("section") === "Accounts") setTab("Accounts");
        }
      }
    } catch {
      setUser(null);
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const n = await call<Niche>(
        "/api/niches",
        "POST",
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      setCreating(false);
      await refresh();
      setActive(n);
      setTab("Overview");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (checking)
    return (
      <div className="n-loading">
        <Mark /> Opening your workspace…
      </div>
    );
  if (!user) return <Auth onLogin={() => void load()} />;
  function open(n: Niche, t: Tab = "Overview") {
    setActive(n);
    setTab(t);
    setError("");
    window.scrollTo(0, 0);
  }
  function changed() {
    void refresh().catch((e) => setError(e.message));
    setRefreshKey((k) => k + 1);
  }
  return (
    <div className="n-app">
      <aside className="n-sidebar">
        <button
          className="n-brand"
          onClick={() => {
            setActive(null);
            setTab("Overview");
          }}
        >
          <Mark /> niches<span className="n-beta">BETA</span>
        </button>
        <span className="n-sidebar-label">WORKSPACE</span>
        <button
          className={!active ? "n-nav active" : "n-nav"}
          onClick={() => setActive(null)}
        >
          ◈ <span>All niches</span>
          <small>{niches.length}</small>
        </button>
        <button
          className="n-nav"
          onClick={() => {
            setActive(null);
            setShowNotices(true);
          }}
        >
          ◉ <span>Notifications</span>
          <small>{notices.filter((n) => !n.read_at).length}</small>
        </button>
        {active && (
          <>
            <div className="n-switch">
              <span style={{ background: active.colour }}>
                {active.initials}
              </span>
              <strong>{active.name}</strong>
            </div>
            <nav aria-label="Niche workspace">
              {tabs.map((t, i) => (
                <button
                  key={t}
                  className={`n-nav ${tab === t ? "active" : ""}`}
                  onClick={() => setTab(t)}
                >
                  {symbols[i]} <span>{t}</span>
                  {t === "ClipMine" && <small>STUDIO</small>}
                </button>
              ))}
            </nav>
          </>
        )}
        <div className="n-sidebar-bottom">
          <div className="n-note">
            A little focus.
            <br />
            <strong>A lot of possibility.</strong>
            <span>Make your next idea happen ↗</span>
          </div>
          <div className="n-person">
            <span>{user.email.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>Your workspace</strong>
              <small>{user.email}</small>
            </div>
            <button
              aria-label="Log out of Niches"
              title="Log out of Niches"
              onClick={async () => {
                await call("/api/auth/logout", "POST", {});
                setUser(null);
                setActive(null);
              }}
            >
              Log out
            </button>
          </div>
        </div>
      </aside>
      <div className="n-main">
        <header className="n-topbar">
          <span>
            <button onClick={() => setActive(null)}>Workspace</button> /{" "}
            <strong>{active ? active.name : "All niches"}</strong>
            {active && ` / ${tab}`}
          </span>
          <button
            className="n-icon-button"
            aria-label="Notifications"
            onClick={() => setShowNotices(!showNotices)}
          >
            ♧ {notices.filter((n) => !n.read_at).length || ""}
          </button>
        </header>
        <main className="n-page">
          {error && (
            <p className="n-error" role="alert">
              {error}
            </p>
          )}
          {showNotices && (
            <section className="n-panel">
              <div className="n-section-head">
                <h2>Notifications</h2>
                <button
                  onClick={async () => {
                    await call("/api/notifications", "POST", {});
                    await refresh();
                    setShowNotices(false);
                  }}
                >
                  Mark read & close
                </button>
              </div>
              {notices.length ? (
                notices.map((n) => (
                  <p key={n.id}>
                    {n.message}
                    <small> · {date(n.created_at)}</small>
                  </p>
                ))
              ) : (
                <p>You’re all caught up.</p>
              )}
            </section>
          )}
          {!active ? (
            <>
              <div className="n-page-head">
                <div>
                  <span className="n-kicker">THE BIG PICTURE</span>
                  <h1>
                    Different niches.
                    <br />
                    <span>One place to grow.</span>
                  </h1>
                  <p>Good content starts with a little organisation.</p>
                </div>
                <button className="n-primary" onClick={() => setCreating(true)}>
                  + Create a niche
                </button>
              </div>
              <div className="n-stats">
                <Stat
                  label="Your niches"
                  value={niches.length}
                  detail="Independent brands"
                />
                <Stat
                  label="Content library"
                  value={niches.reduce((v, n) => v + (n.media_count || 0), 0)}
                  detail="Ready for your next idea"
                />
                <Stat
                  label="In drafts"
                  value={niches.reduce((v, n) => v + (n.draft_count || 0), 0)}
                  detail="A little work from ready"
                />
                <Stat
                  label="Scheduled exports"
                  value={niches.reduce(
                    (v, n) => v + (n.scheduled_count || 0),
                    0,
                  )}
                  detail="Scheduled content"
                />
              </div>
              <div className="n-section-head">
                <h2>
                  Your niches <span>{niches.length}</span>
                </h2>
                <span>A space for every interest.</span>
              </div>
              <div className="n-niche-grid">
                {niches.map((n, i) => (
                  <article className={`n-niche n-niche-${i % 3}`} key={n.id}>
                    <button className="n-niche-main" onClick={() => open(n)}>
                      <div
                        className="n-niche-art"
                        style={
                          { "--niche-colour": n.colour } as React.CSSProperties
                        }
                      >
                        <span>{n.initials}</span>
                        <i>↗</i>
                      </div>
                      <div className="n-niche-info">
                        <h3>{n.name}</h3>
                        <p>
                          {n.description || "Your next great idea lives here."}
                        </p>
                        <div className="n-platforms">
                          {["facebook", "instagram", "tiktok", "youtube"].map(
                            (platform, j) => {
                              const list = JSON.parse(
                                n.accounts_json || "[]",
                              ) as { platform: string; status: string }[];
                              const count = list.filter(
                                (a) => a.platform === platform,
                              ).length;
                              return (
                                <span
                                  key={platform}
                                  title={`${platform}: ${count} accounts`}
                                >
                                  {["f", "◎", "♪", "▶"][j]}
                                  {count > 0 && <sup>{count}</sup>}
                                </span>
                              );
                            },
                          )}
                          <small>
                            {n.account_count || 0} accounts ·{" "}
                            {n.connected_count || 0} connected
                          </small>
                        </div>
                      </div>
                    </button>
                    <div className="n-niche-footer">
                      <span>
                        {n.media_count || 0} media · {n.draft_count || 0} drafts
                      </span>
                      <button onClick={() => open(n, "Create")}>
                        Quick upload +
                      </button>
                    </div>
                  </article>
                ))}
                <button
                  className="n-add-card"
                  onClick={() => setCreating(true)}
                >
                  <span>+</span>
                  <h3>Room for your next idea.</h3>
                  <p>Create a niche and make it yours.</p>
                </button>
              </div>
              <div className="n-banner">
                <div>
                  <span className="n-kicker">
                    FROM LONG FORM TO YOUR NEXT POST
                  </span>
                  <h2>Meet your in-house clip studio.</h2>
                  <p>
                    Find the best moments. Trim, caption and send straight to a
                    niche.
                  </p>
                </div>
                <button
                  onClick={() =>
                    niches.length
                      ? open(niches[0], "ClipMine")
                      : setCreating(true)
                  }
                >
                  Open ClipMine ↗
                </button>
              </div>
            </>
          ) : (
            <Workspace
              key={active.id}
              niche={active}
              tab={tab}
              setTab={setTab}
              changed={changed}
              refreshKey={refreshKey}
            />
          )}
        </main>
        <footer className="n-footer">
          NICHES <span>Make something worth sharing.</span>
          <span>Private beta · Publishing requires authorised accounts</span>
        </footer>
      </div>
      {creating && (
        <div className="n-modal-backdrop">
          <section
            className="n-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-niche-title"
          >
            <button
              className="n-close"
              aria-label="Close"
              onClick={() => setCreating(false)}
            >
              ×
            </button>
            <span className="n-kicker">MAKE A LITTLE SPACE</span>
            <h2 id="create-niche-title">What’s your niche?</h2>
            <form onSubmit={create}>
              <label>
                Niche name
                <input
                  autoFocus
                  name="name"
                  maxLength={80}
                  placeholder="Cars, football, mysteries…"
                  required
                />
              </label>
              <label>
                A little about it
                <textarea
                  name="description"
                  maxLength={500}
                  rows={3}
                  placeholder="The people, passion or ideas behind this brand."
                />
              </label>
              <label>
                Brand colour
                <input name="colour" type="color" defaultValue="#c6f66b" />
              </label>
              {error && (
                <p className="n-error" role="alert">
                  {error}
                </p>
              )}
              <button className="n-primary">Create niche ↗</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | string;
  detail: string;
}) {
  return (
    <div className="n-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Workspace({
  niche,
  tab,
  setTab,
  changed,
  refreshKey,
}: {
  niche: Niche;
  tab: Tab;
  setTab: (tab: Tab) => void;
  changed: () => void;
  refreshKey: number;
}) {
  const base = `/api/niches/${niche.id}`;
  const [recentUploaded, setRecentUploaded] = useState<string[]>([]),
    [batchCaption, setBatchCaption] = useState("");
  const [localFiles, setLocalFiles] = useState<{ file: File; url: string }[]>(
    [],
  );
  useEffect(
    () => () => {
      localFiles.forEach((x) => URL.revokeObjectURL(x.url));
    },
    [localFiles],
  );
  const [media, setMedia] = useState<Media[]>([]),
    [posts, setPosts] = useState<Post[]>([]),
    [accounts, setAccounts] = useState<SocialAccount[]>([]),
    [providers, setProviders] = useState<Provider[]>([]),
    [activity, setActivity] = useState<Activity[]>([]),
    [ideas, setIdeas] = useState<Idea[]>([]),
    [revenue, setRevenue] = useState<Revenue[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [storageAvailable, setStorageAvailable] = useState(false),
    [draft, setDraft] = useState<Post | null>(null),
    [selectedMedia, setSelectedMedia] = useState(""),
    [destinations, setDestinations] = useState<string[]>([]),
    [analytics, setAnalytics] = useState<{ source: string }>({
      source: "Loading metrics availability…",
    });
  async function load() {
    try {
      const [m, p, a, pr, ac, i, r, an, capabilities] = await Promise.all([
        call<Media[]>(base + "/media"),
        call<Post[]>(base + "/posts"),
        call<SocialAccount[]>(base + "/accounts"),
        call<Provider[]>("/api/providers"),
        call<Activity[]>(base + "/activity"),
        call<Idea[]>(base + "/ideas"),
        call<Revenue[]>(base + "/revenue"),
        call<{ source: string }>(base + "/analytics"),
        call<{ storage_available: boolean }>("/api/config"),
      ]);
      setStorageAvailable(capabilities.storage_available);
      setMedia(m);
      setPosts(p);
      setAccounts(a);
      setProviders(pr);
      setActivity(ac);
      setIdeas(i);
      setRevenue(r);
      setAnalytics(an);
      if (!draft)
        setDestinations(
          a.filter((x) => x.status !== "archived").map((x) => x.id),
        );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [niche.id, refreshKey]);
  useEffect(() => {
    setError("");
    setStatus("");
  }, [tab]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(post: Post) {
    setDraft(post);
    setSelectedMedia(post.media_id || "");
    setDestinations(
      post.destinations.filter((id) => accounts.some((a) => a.id === id)),
    );
    setTab("Publish");
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (!storageAvailable) {
      setLocalFiles(
        Array.from(files).map((file) => ({
          file,
          url: URL.createObjectURL(file),
        })),
      );
      setStatus(
        "Files selected on this device. Cloudflare storage must be enabled before they can be saved or published. Keep this page open.",
      );
      setTab("Content");
      return;
    }
    await run(async () => {
      let count = 0;
      const errors: string[] = [];
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        try {
          const result = await uploadMedia(niche.id, file, (percent) =>
            setStatus(
              `Uploading ${file.name}: ${percent}% (${count + 1}/${files.length})`,
            ),
          );
          uploaded.push(result.id);
          setSelectedMedia(result.id);
          count++;
        } catch (e) {
          errors.push(`${file.name}: ${(e as Error).message}`);
        }
      }
      setRecentUploaded(uploaded);
      setStatus(`Uploaded ${count} of ${files.length} files.`);
      if (errors.length) setError(errors.join(" · "));
      setTab("Content");
    });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await run(async () => {
      const overrides: Post["overrides"] = {};
      providers.forEach((p) => {
        overrides[p.id] = {
          caption: String(data[`${p.id}_caption`] || ""),
          title: String(data[`${p.id}_title`] || ""),
        };
      });
      accounts.forEach((a) => {
        overrides[a.id] = {
          caption: String(data[`${a.id}_caption`] || ""),
          title: String(data[`${a.id}_title`] || ""),
        };
      });
      const post = await call<Post>(
        base + "/posts" + (draft ? `/${draft.id}` : ""),
        draft ? "PATCH" : "POST",
        {
          title: data.title,
          caption: data.caption,
          media_id: selectedMedia || null,
          destinations,
          overrides,
        },
      );
      setDraft(post);
      setStatus(
        "Draft saved. Review below to prepare your export or reminder.",
      );
    });
  }
  useEffect(() => {
    if (!["Drafts", "Calendar"].includes(tab)) return;
    const interval = setInterval(() => {
      void call<Post[]>(base + "/posts")
        .then(setPosts)
        .catch(() => {});
    }, 8000);
    return () => clearInterval(interval);
  }, [tab, niche.id]);
  const visible = media.filter((m) =>
    m.filename.toLowerCase().includes(query.toLowerCase()),
  );
  const pending = posts.filter(
    (p) =>
      p.status === "draft" ||
      p.status === "blocked" ||
      p.status === "cancelled",
  );
  return (
    <>
      <div className="n-page-head compact">
        <div>
          <span className="n-kicker">
            {niche.name.toUpperCase()} / {tab.toUpperCase()}
          </span>
          <h1>
            {tab === "Overview"
              ? "Your next chapter."
              : tab === "Create"
                ? "Make your next move."
                : tab === "Content"
                  ? "A home for your content."
                  : tab === "ClipMine"
                    ? "Find your best moments."
                    : tab}
          </h1>
          <p>
            {tab === "Overview"
              ? niche.description ||
                "Everything this brand needs, in one place."
              : tab === "ClipMine"
                ? "Long video in. Fresh ideas out. Saved directly to this niche."
                : "Create, review and keep your brand moving."}
          </p>
        </div>
        {!["Create", "Publish", "ClipMine"].includes(tab) && (
          <button
            className="n-primary"
            onClick={() => {
              setDraft(null);
              setTab("Create");
            }}
          >
            + Create content
          </button>
        )}
      </div>
      {error && (
        <p className="n-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="n-success" role="status">
          {status}
        </p>
      )}
      <div className="n-actions" style={{ marginBottom: 20 }}>
        <button type="button" onClick={() => setTab("Accounts")}>
          + Add / manage social accounts ({accounts.length})
        </button>
        <button type="button" onClick={() => setTab("Create")}>
          Upload content
        </button>
      </div>
      {tab === "Overview" && (
        <>
          <div className="n-stats">
            <Stat
              label="In your library"
              value={media.length}
              detail="Videos, images & clips"
            />
            <Stat
              label="Drafts"
              value={pending.length}
              detail="Waiting for your finishing touch"
            />
            <Stat
              label="Upcoming"
              value={posts.filter((p) => p.status === "scheduled").length}
              detail="Scheduled posts & legacy reminders"
            />
            <Stat
              label="Connections"
              value={accounts.filter((a) => a.status === "connected").length}
              detail="Authorised social accounts"
            />
          </div>
          <div className="n-two-col">
            <section className="n-panel">
              <div className="n-section-head">
                <h2>Fresh in your library</h2>
                <button onClick={() => setTab("Content")}>View all ↗</button>
              </div>
              {media.length ? (
                <div className="n-mini-media">
                  {media.slice(0, 3).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setSelectedMedia(m.id);
                        setDraft(null);
                        setTab("Publish");
                      }}
                    >
                      <Preview niche={niche.id} media={m} />
                      <strong>{m.filename}</strong>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty title="Your first post starts here.">
                  Upload something you own, or find a moment in ClipMine.
                </Empty>
              )}
            </section>
            <section className="n-panel">
              <h2>Recent activity</h2>
              {activity.length ? (
                activity.slice(0, 8).map((a, i) => (
                  <div className="n-activity" key={i}>
                    <span>↗</span>
                    <div>
                      <strong>
                        {a.action.replaceAll(".", " ").replaceAll("_", " ")}
                      </strong>
                      <small>{date(a.created_at)}</small>
                    </div>
                  </div>
                ))
              ) : (
                <Empty title="A fresh start.">
                  Your content journey will appear here.
                </Empty>
              )}
            </section>
          </div>
        </>
      )}
      {(tab === "Content" || tab === "Create") && (
        <>
          <section className="n-upload">
            {!storageAvailable && (
              <div className="n-status-note" role="status">
                Cloud storage is not enabled yet. You can choose and preview
                files here; they remain on this device until storage is enabled.
                Account setup and text drafts still work.
              </div>
            )}
            <span aria-hidden="true">↑</span>
            <h2>Drop your next great post here.</h2>
            <p>
              Videos & images · Up to 25 MB each in this beta · Batch uploads
              welcome
            </p>
            <label className="n-primary">
              {busy ? "Uploading…" : "Choose files ↗"}
              <input
                type="file"
                multiple
                accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(e) => void upload(e.target.files)}
              />
            </label>
            <p className="n-muted">
              Only upload media you own or are authorised to publish. Private to
              your account.
            </p>
          </section>
          {recentUploaded.length > 0 && (
            <section className="n-panel">
              <h3>Create drafts for this batch ({recentUploaded.length})</h3>
              <label>
                Caption for this batch
                <textarea
                  value={batchCaption}
                  onChange={(e) => setBatchCaption(e.target.value)}
                  maxLength={10000}
                  rows={3}
                />
              </label>
              <p>
                Every draft will propose this niche’s accounts. Review each
                draft before scheduling or publishing.
              </p>
              <button
                className="n-primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    for (const mediaId of recentUploaded) {
                      const item = media.find((m) => m.id === mediaId);
                      await call(base + "/posts", "POST", {
                        media_id: mediaId,
                        title:
                          item?.filename.replace(/\.[^.]+$/, "") || "New post",
                        caption: batchCaption,
                      });
                    }
                    setRecentUploaded([]);
                    setTab("Drafts");
                    setStatus(
                      "Batch drafts created. Review each post before publishing.",
                    );
                  })
                }
              >
                Create batch drafts
              </button>
            </section>
          )}
          {localFiles.length > 0 && (
            <section className="n-panel">
              <h2>Selected on this device ({localFiles.length})</h2>
              <p className="n-status-note">
                These files have not been uploaded. They are only available
                while this page stays open.
              </p>
              <div className="n-media-grid">
                {localFiles.map((x, i) => (
                  <article className="n-media-card" key={i}>
                    {x.file.type.startsWith("video/") ? (
                      <video
                        src={x.url}
                        controls
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <img src={x.url} alt={x.file.name} />
                    )}
                    <div>
                      <h3>{x.file.name}</h3>
                      <small>
                        Not uploaded · {(x.file.size / 1024 / 1024).toFixed(1)}{" "}
                        MB
                      </small>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          {tab === "Create" && (
            <div className="n-banner">
              <div>
                <h2>Got a longer video?</h2>
                <p>
                  Find, trim and caption the best moments in your ClipMine
                  studio.
                </p>
              </div>
              <button onClick={() => setTab("ClipMine")}>Open studio ↗</button>
            </div>
          )}
          {tab === "Content" && (
            <>
              <div className="n-section-head">
                <h2>Content library</h2>
                <input
                  aria-label="Search content"
                  placeholder="Search your content…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="n-media-grid">
                {visible.map((m) => (
                  <article className="n-media-card" key={m.id}>
                    <Preview niche={niche.id} media={m} controls />
                    <div>
                      <h3>{m.filename}</h3>
                      <small>
                        {(m.size / 1024 / 1024).toFixed(1)} MB ·{" "}
                        {date(m.created_at)}
                      </small>
                      <div className="n-actions">
                        <button
                          onClick={() => {
                            setSelectedMedia(m.id);
                            setDraft(null);
                            setTab("Publish");
                          }}
                        >
                          Prepare post ↗
                        </button>
                        <a download href={mediaPath(niche.id, m.id, true)}>
                          Download
                        </a>
                        <button
                          disabled={busy}
                          aria-label={`Delete ${m.filename} from your library`}
                          onClick={async () => {
                            if (!window.confirm(`Permanently delete ${m.filename} from this niche? Drafts using it will lose their attachment.`))
                              return;
                            setBusy(true);
                            setError("");
                            try {
                              await call(base + "/media/" + m.id, "DELETE");
                              if (selectedMedia === m.id) setSelectedMedia("");
                              setRecentUploaded((items) => items.filter((id) => id !== m.id));
                              await load();
                              changed();
                              setStatus("Media permanently removed from your private library.");
                            } catch (error) {
                              setError((error as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {!visible.length && (
                <Empty title="Nothing here yet.">
                  Upload media to start building your library.
                </Empty>
              )}
            </>
          )}
        </>
      )}
      {tab === "Publish" && (
        <div className="n-two-col composer">
          <section className="n-panel">
            <span className="n-kicker">01 / PREPARE</span>
            <h2>One post. Your whole niche.</h2>
            <form key={draft?.id || "new"} onSubmit={save}>
              <label>
                Media
                <select
                  value={selectedMedia}
                  onChange={(e) => setSelectedMedia(e.target.value)}
                >
                  <option value="">Choose from your library</option>
                  {media.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.filename}
                    </option>
                  ))}
                </select>
              </label>
              {selectedMedia && media.find((m) => m.id === selectedMedia) && (
                <div className="n-compose-preview">
                  <Preview
                    niche={niche.id}
                    media={media.find((m) => m.id === selectedMedia)!}
                    controls
                  />
                </div>
              )}
              <label>
                Post title
                <input
                  name="title"
                  maxLength={120}
                  defaultValue={draft?.title || ""}
                  placeholder="Give this post a name"
                />
              </label>
              <label>
                Master caption
                <textarea
                  name="caption"
                  maxLength={10000}
                  rows={5}
                  defaultValue={draft?.caption || ""}
                  placeholder="Start with a hook. Give people a reason to stay."
                />
              </label>
              <div className="n-section-head">
                <h3>Destinations</h3>
                <small>Selected from this niche</small>
              </div>
              {accounts.length ? (
                accounts.map((a) => (
                  <label className="n-checkbox" key={a.id}>
                    <input
                      type="checkbox"
                      disabled={a.status === "archived"}
                      checked={destinations.includes(a.id)}
                      onChange={(e) =>
                        setDestinations((d) =>
                          e.target.checked
                            ? [...d, a.id]
                            : d.filter((x) => x !== a.id),
                        )
                      }
                    />
                    {a.display_name} · {a.platform}
                  </label>
                ))
              ) : (
                <p className="n-muted">
                  No accounts connected yet. You can save a draft and export for
                  manual posting.
                </p>
              )}
              {providers.map((p) => (
                <details key={p.id}>
                  <summary>
                    {p.name} <small>Customise metadata</small>
                  </summary>
                  <label>
                    Platform title
                    <input
                      name={`${p.id}_title`}
                      maxLength={100}
                      defaultValue={draft?.overrides[p.id]?.title || ""}
                    />
                  </label>
                  <label>
                    Platform caption
                    <textarea
                      name={`${p.id}_caption`}
                      rows={3}
                      defaultValue={draft?.overrides[p.id]?.caption || ""}
                    />
                  </label>
                  <p className="n-muted">
                    Available in your export. Direct posting and covers require
                    an authorised API integration.
                  </p>
                </details>
              ))}
              {accounts
                .filter((a) => destinations.includes(a.id))
                .map((a) => (
                  <details key={a.id}>
                    <summary>
                      {a.display_name} · {a.platform}
                    </summary>
                    <label>
                      Account-specific title
                      <input
                        name={`${a.id}_title`}
                        maxLength={100}
                        defaultValue={draft?.overrides[a.id]?.title || ""}
                      />
                    </label>
                    <label>
                      Account-specific caption
                      <textarea
                        name={`${a.id}_caption`}
                        rows={3}
                        defaultValue={draft?.overrides[a.id]?.caption || ""}
                        placeholder="Leave blank to use the platform or master caption"
                      />
                    </label>
                  </details>
                ))}
              <button className="n-primary" disabled={busy}>
                Save draft ↗
              </button>
            </form>
          </section>
          <section className="n-panel n-review">
            <span className="n-kicker">02 / REVIEW</span>
            <h2>Your final say.</h2>
            {draft ? (
              <PublishingReview
                nicheId={niche.id}
                draft={draft}
                accounts={accounts}
                providers={providers}
                onAccounts={() => setTab("Accounts")}
                onResult={(message) => {
                  setDraft(null);
                  setStatus(message);
                  setTab("Drafts");
                  changed();
                }}
              />
            ) : (
              <Empty title="Review your saved draft.">
                Save your post, then check destinations and publish options
                here.
              </Empty>
            )}
          </section>
        </div>
      )}
      {tab === "Drafts" && (
        <section className="n-panel">
          <h2>Pick up where you left off.</h2>
          {!posts.length && (
            <Empty title="No drafts yet.">
              Prepare your first post from the content library.
            </Empty>
          )}
          {posts.map((p) => (
            <div className="n-post-row" key={p.id}>
              <div>
                <strong>{p.title || "Untitled post"}</strong>
                <p>{p.caption.slice(0, 100) || "No caption"}</p>
                <small className="n-badge">
                  {p.status.replaceAll("_", " ")}
                  {p.scheduled_at ? ` · ${date(p.scheduled_at)}` : ""}
                </small>
              </div>
              <div className="n-actions">
                {["draft", "blocked", "cancelled"].includes(p.status) ? (
                  <button onClick={() => edit(p)}>Continue ↗</button>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await call(`${base}/posts/${p.id}/cancel`, "POST", {});
                      })
                    }
                  >
                    Cancel approval
                  </button>
                )}
                <a href={`${base}/posts/${p.id}/export`} download>
                  Export
                </a>
              </div>
              <PostHistory
                nicheId={niche.id}
                postId={p.id}
                onChanged={changed}
              />
            </div>
          ))}
        </section>
      )}
      {tab === "Calendar" && (
        <section className="n-panel">
          <div className="n-section-head">
            <h2>Coming up next.</h2>
            <span>Device timezone · Scheduled posts & legacy reminders</span>
          </div>
          {posts
            .filter((p) => p.scheduled_at && p.status === "scheduled")
            .sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!))
            .map((p) => (
              <div className="n-post-row" key={p.id}>
                <div>
                  <span className="n-kicker">{date(p.scheduled_at!)}</span>
                  <h3>{p.title || "Untitled post"}</h3>
                  <p>
                    {p.publish_mode === "direct"
                      ? "Scheduled social publication"
                      : "Legacy export reminder · No automatic social posting"}
                  </p>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await call(`${base}/posts/${p.id}/cancel`, "POST", {});
                    })
                  }
                >
                  Cancel
                </button>
              </div>
            ))}
          {!posts.some((p) => p.status === "scheduled") && (
            <Empty title="A little breathing room.">
              Choose Schedule for later when reviewing your post.
            </Empty>
          )}
        </section>
      )}
      {tab === "Accounts" && (
        <SocialAccounts
          nicheId={niche.id}
          accounts={accounts}
          providers={providers}
          onChanged={changed}
        />
      )}
      {tab === "Analytics" && (
        <>
          <div className="n-stats">
            <Stat
              label="Views"
              value="—"
              detail="Awaiting authorised metrics"
            />
            <Stat
              label="Engagement"
              value="—"
              detail="Awaiting authorised metrics"
            />
            <Stat
              label="Followers"
              value="—"
              detail="Awaiting authorised metrics"
            />
            <Stat
              label="Recorded revenue"
              value={`£${(revenue.reduce((v, r) => v + r.amount_pence, 0) / 100).toFixed(2)}`}
              detail="Manually recorded, not API earnings"
            />
          </div>
          <section className="n-panel">
            <Empty title="Real results take real connections.">
              {analytics.source}. Connect approved platform apps to unlock
              performance comparisons and data-backed recommendations.
            </Empty>
          </section>
        </>
      )}
      {tab === "Ideas" && (
        <section className="n-panel">
          <span className="n-kicker">GOOD IDEAS NEED A PLACE TO LAND</span>
          <h2>Your next “what if”.</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const text = new FormData(form).get("text");
              void run(async () => {
                await call(base + "/ideas", "POST", { text });
                form.reset();
              });
            }}
          >
            <label>
              Content idea
              <textarea
                name="text"
                required
                maxLength={2000}
                rows={3}
                placeholder="A hook, a series, a question worth asking…"
              />
            </label>
            <button className="n-primary" disabled={busy}>
              Save idea +
            </button>
          </form>
          <div className="n-idea-grid">
            {ideas.map((i) => (
              <article key={i.id}>
                <span>✧ IDEA</span>
                <p>{i.text}</p>
                <button
                  onClick={() => {
                    setDraft(null);
                    setTab("Publish");
                  }}
                >
                  Open composer ↗
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
      {tab === "Revenue" && (
        <section className="n-panel">
          <h2>Track what your niche earns.</h2>
          <p>
            Manual records in GBP. Platform earnings are not automatically
            synced.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = Object.fromEntries(new FormData(form));
              void run(async () => {
                await call(base + "/revenue", "POST", {
                  amount_pence: Math.round(Number(data.amount) * 100),
                  category: data.category,
                  note: data.note,
                  earned_at: data.date,
                });
                form.reset();
              });
            }}
          >
            <div className="n-form-grid">
              <label>
                Amount (£)
                <input
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                />
              </label>
              <label>
                Source
                <select name="category">
                  <option value="sponsorship">Sponsorship</option>
                  <option value="affiliate">Affiliate</option>
                  <option value="platform">Platform earnings</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Date
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </label>
              <label>
                Note
                <input name="note" maxLength={500} />
              </label>
            </div>
            <button className="n-primary" disabled={busy}>
              Record revenue
            </button>
          </form>
          {revenue.map((r) => (
            <div className="n-post-row" key={r.id}>
              <div>
                <strong>{r.category}</strong>
                <p>{r.note}</p>
                <small>{date(r.earned_at)}</small>
              </div>
              <strong>£{(r.amount_pence / 100).toFixed(2)}</strong>
            </div>
          ))}
        </section>
      )}
      {tab === "Settings" && (
        <section className="n-panel">
          <span className="n-kicker">MAKE IT FEEL LIKE YOU</span>
          <h2>Your brand kit.</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = Object.fromEntries(
                new FormData(event.currentTarget),
              );
              void run(async () => {
                await call(base, "PATCH", {
                  name: data.name,
                  description: data.description,
                  colour: data.colour,
                  brand: {
                    hashtags: data.hashtags,
                    caption_style: data.caption_style,
                    preferences: data.preferences,
                    logo_media_id: data.logo_media_id,
                  },
                });
                setStatus("Brand kit saved.");
              });
            }}
          >
            <div className="n-form-grid">
              <label>
                Name
                <input
                  name="name"
                  defaultValue={niche.name}
                  maxLength={80}
                  required
                />
              </label>
              <label>
                Brand colour
                <input type="color" name="colour" defaultValue={niche.colour} />
              </label>
            </div>
            <label>
              Description
              <textarea
                name="description"
                maxLength={500}
                defaultValue={niche.description}
              />
            </label>
            <label>
              Logo from your library
              <select
                name="logo_media_id"
                defaultValue={JSON.parse(niche.brand_json).logo_media_id || ""}
              >
                <option value="">No logo</option>
                {media
                  .filter((m) => m.mime.startsWith("image/"))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.filename}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Default hashtags
              <textarea
                name="hashtags"
                maxLength={1000}
                defaultValue={JSON.parse(niche.brand_json).hashtags || ""}
              />
            </label>
            <label>
              Caption style
              <input
                name="caption_style"
                maxLength={500}
                defaultValue={JSON.parse(niche.brand_json).caption_style || ""}
                placeholder="Friendly, sharp, playful…"
              />
            </label>
            <label>
              Content preferences
              <textarea
                name="preferences"
                maxLength={2000}
                defaultValue={JSON.parse(niche.brand_json).preferences || ""}
              />
            </label>
            <button className="n-primary" disabled={busy}>
              Save brand kit ↗
            </button>
          </form>
        </section>
      )}
      {tab === "ClipMine" && <Studio niche={niche} changed={changed} />}
    </>
  );
}
function Preview({
  niche,
  media,
  controls = false,
}: {
  niche: string;
  media: Media;
  controls?: boolean;
}) {
  return media.mime.startsWith("video/") ? (
    <video
      src={mediaPath(niche, media.id)}
      controls={controls}
      preload="metadata"
      playsInline
    />
  ) : (
    <img src={mediaPath(niche, media.id)} alt={media.filename} loading="lazy" />
  );
}
function Studio({ niche, changed }: { niche: Niche; changed: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    void call<{ clipmine_available: boolean }>("/api/config")
      .then((c) => setAvailable(c.clipmine_available))
      .catch(() => setAvailable(false));
  }, []);
  if (available === null) return <p>Checking studio connection…</p>;
  if (!available)
    return (
      <section className="n-panel">
        <Empty title="The studio needs its rendering engine.">
          ClipMine’s original FFmpeg editor is preserved. A private Python
          rendering service must be connected before processing can run here.
          Cloudflare Workers cannot run the existing FFmpeg process.
        </Empty>
        <p className="n-muted">
          No paid compute has been enabled. Upload-ready content can already be
          organised in your niche.
        </p>
      </section>
    );
  return (
    <div className="n-studio">
      <ClipMine nicheId={niche.id} onSent={changed} />
    </div>
  );
}
