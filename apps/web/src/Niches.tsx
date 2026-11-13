import PostHistory from "./PostHistory";
import { parseBatchArchive } from "./batch-zip";
import SocialAccounts from "./SocialAccounts";
import PublishingReview from "./PublishingReview";
import PublishingCalendar from "./PublishingCalendar";
import ElectricDrafts from "./ElectricDrafts";
import { contentMatches } from "./content-filter";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import ClipMine from "./App";
import {
  call,
  mediaPath,
  uploadMedia,
  type Niche,
  type Brand,
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
import "./niches-electric.css";
import "./electric-launch.css";
const electricSkin = import.meta.env.VITE_NICHES_SKIN === "electric";
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
    <div className={electricSkin ? "n-auth n-electric electric-auth" : "n-auth"}>
      <div className="n-auth-story">
        <div className="n-brand">
          <Mark /> {electricSkin ? "Niches" : "niches"}{!electricSkin && <span className="n-beta">BETA</span>}
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
    [mobileMenuOpen, setMobileMenuOpen] = useState(false),
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
          const requested = params.get("section");
          if (requested && tabs.some((section) => section === requested)) setTab(requested as Tab);
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
    <div className={electricSkin ? "n-app n-electric" : "n-app"}>
      <aside className="n-sidebar">
        <button
          className="n-brand"
          onClick={() => {
            setActive(null);
            setTab("Overview");
          }}
        >
          <Mark /> {electricSkin ? "Niches" : "niches"}{!electricSkin && <span className="n-beta">BETA</span>}
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
          {electricSkin ? (
            <>
              <div className="electric-niche-switch">
                <span aria-hidden="true">⚡</span>
                <label>
                  <select aria-label="Choose niche" value={active?.id || ""}
                    onChange={(event) => {
                      const n = niches.find((item) => item.id === event.target.value);
                      if (n) open(n, tab === "Calendar" ? "Calendar" : n.brand_count ? "Accounts" : "Overview");
                      else { setActive(null); setTab("Overview"); }
                    }}>
                    <option value="">All niches</option>
                    {niches.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="electric-toolbar">
                <span className="electric-preview-notice">NICHES ELECTRIC</span>
                <button className="n-icon-button" aria-label="Notifications"
                  onClick={() => setShowNotices(!showNotices)}>
                  ♧ {notices.filter((n) => !n.read_at).length || ""}
                </button>
                <button className="electric-menu-button" type="button"
                  aria-label="Open all Niches sections" aria-expanded={mobileMenuOpen}
                  onClick={() => setMobileMenuOpen((open) => !open)}>☰</button>
                <button className="electric-top-upload" onClick={() => {
                  if (active) setTab("Create");
                  else if (niches.length) open(niches[0], "Create");
                  else setCreating(true);
                }}>↑ Upload</button>
              </div>
            </>
          ) : (
            <>
              <span>
                <button onClick={() => setActive(null)}>Workspace</button> /{" "}
                <strong>{active ? active.name : "All niches"}</strong>
                {active && ` / ${tab}`}
              </span>
              <button className="n-icon-button" aria-label="Notifications"
                onClick={() => setShowNotices(!showNotices)}>
                ♧ {notices.filter((n) => !n.read_at).length || ""}
              </button>
            </>
          )}
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
          <span><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></span>
        </footer>
      </div>
      {electricSkin && mobileMenuOpen && (
        <div className="electric-menu-overlay">
          <nav className="electric-menu-drawer" aria-label="All Niches sections">
            <div className="electric-menu-header">
              <strong>All Niches sections</strong>
              <button type="button" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)}>✕</button>
            </div>
            <button type="button" onClick={() => {
              setMobileMenuOpen(false); setActive(null); setTab("Overview");
            }}>◈ All niches</button>
            {tabs.map((target, index) => (
              <button key={target} type="button"
                aria-current={active && tab === target ? "page" : undefined}
                onClick={() => {
                  setMobileMenuOpen(false);
                  if (active) setTab(target);
                  else if (niches.length) open(niches[0], target);
                  else setCreating(true);
                }}>
                <span aria-hidden="true">{symbols[index]}</span> {target}
              </button>
            ))}
            <button type="button" onClick={async () => {
              setMobileMenuOpen(false);
              await call("/api/auth/logout", "POST", {});
              setUser(null); setActive(null);
            }}>Log out</button>
          </nav>
        </div>
      )}
      {electricSkin && (
        <nav className="electric-bottom-nav" aria-label="Mobile navigation">
          {([
            ["Overview", "⌂", "Home"],
            ["Content", "▱", "Content"],
            ["Create", "+", "Create"],
            ["Drafts", "▤", "Drafts"],
            ["Calendar", "▦", "Calendar"],
            ["Accounts", "♧", "Accounts"],
          ] as const).map(([target, symbol, label]) => (
            <button key={target}
              className={`${active && tab === target ? "active " : ""}${target === "Create" ? "create" : ""}`}
              aria-current={active && tab === target ? "page" : undefined}
              onClick={() => {
                if (active) setTab(target);
                else if (niches.length) open(niches[0], target);
                else setCreating(true);
              }}>
              <strong aria-hidden="true">{symbol}</strong><span>{label}</span>
            </button>
          ))}
        </nav>
      )}
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
    [contentFilter, setContentFilter] = useState<"All" | "Drafts" | "Scheduled" | "Published">("All"),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [storageAvailable, setStorageAvailable] = useState(false),
    [draft, setDraft] = useState<Post | null>(null),
    [composeStage, setComposeStage] = useState<"prepare" | "review">("prepare"),
    [selectedMedia, setSelectedMedia] = useState(""),
    [sourceGroup, setSourceGroup] = useState(""),
    [brands, setBrands] = useState<Brand[]>([]),
    [brandId, setBrandId] = useState(""),
    [destinations, setDestinations] = useState<string[]>([]),
    [analytics, setAnalytics] = useState<{ source: string }>({
      source: "Loading metrics availability…",
    });
  const sourceGroups: string[] = JSON.parse(niche.source_groups_json || "[]");
  const destinationsFor = (list: SocialAccount[], selectedBrand = brandId) => selectedBrand
    ? list.filter((account) => account.brand_id === selectedBrand)
    : niche.master_name
    ? list.filter((account) => account.routing_group === "master")
    : list;
  async function load() {
    try {
      const [m, p, a, pr, ac, i, r, an, capabilities, nicheBrands] = await Promise.all([
        call<Media[]>(base + "/media"),
        call<Post[]>(base + "/posts"),
        call<SocialAccount[]>(base + "/accounts"),
        call<Provider[]>("/api/providers"),
        call<Activity[]>(base + "/activity"),
        call<Idea[]>(base + "/ideas"),
        call<Revenue[]>(base + "/revenue"),
        call<{ source: string }>(base + "/analytics"),
        call<{ storage_available: boolean }>("/api/config"),
        call<Brand[]>(base + "/brands"),
      ]);
      setStorageAvailable(capabilities.storage_available);
      setBrands(nicheBrands);
      setMedia(m);
      setPosts(p);
      setAccounts(a);
      setProviders(pr);
      setActivity(ac);
      setIdeas(i);
      setRevenue(r);
      setAnalytics(an);
      if (!draft) {
        const selectedBrand = brandId || nicheBrands.find((brand) => !brand.parent_id)?.id || "";
        setBrandId(selectedBrand);
        setDestinations(
          destinationsFor(a, selectedBrand).filter((x) => selectedBrand || niche.master_name ? x.status === "connected" : x.status !== "archived").map((x) => x.id),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [niche.id, refreshKey]);
  // Successful uploads/imports may navigate to another tab. Keep their result
  // message visible rather than erasing it immediately after navigation.
  useEffect(() => {
    setError("");
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
  function edit(post: Post, stage: "prepare" | "review" = "prepare") {
    setDraft(post);
    setComposeStage(stage);
    setSelectedMedia(post.media_id || "");
    setSourceGroup(post.source_group || "");
    setBrandId(post.brand_id || "");
    setDestinations(
      post.destinations.filter((id) => accounts.some((a) => a.id === id)),
    );
    setTab("Publish");
  }
  // Prepare a single-platform copy rather than approving every destination in
  // the original draft. Each account still requires its own final review.
  async function publishSeparately(post: Post, account: SocialAccount) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!post.media_id) throw new Error("Upload this cartoon before publishing.");
      let separate = post;
      const alreadySingle =
        post.destinations.length === 1 && post.destinations[0] === account.id;
      if (!alreadySingle) {
        separate = await call<Post>(base + "/posts", "POST", {
          title: post.title,
          caption: post.caption,
          media_id: post.media_id,
          destinations: [account.id],
          source_group: post.source_group,
          brand_id: post.brand_id,
          // Carry over only the target account and its platform metadata.
          // Archived accounts can no longer be valid keys in a new draft.
          overrides: Object.fromEntries(
            [account.platform, account.id]
              .filter((key) => post.overrides[key])
              .map((key) => [key, post.overrides[key]]),
          ),
        });
        await load();
        changed();
      }
      edit(separate);
      setStatus(
        alreadySingle
          ? `Review ${account.display_name}'s settings before publishing.`
          : `A separate draft for ${account.display_name} is ready. Your original draft is unchanged. Review before publishing.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
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
  async function importZip(file: File | undefined) {
    if (!file) return;
    if (!storageAvailable) {
      setError("Cloud media storage is not available. Try again when uploads are enabled.");
      return;
    }
    await run(async () => {
      const batch = await parseBatchArchive(file);
      let imported = 0;
      try {
        for (const asset of batch) {
          setStatus(`Importing ${asset.file.name} (${imported + 1}/${batch.length})…`);
          const uploaded = await uploadMedia(niche.id, asset.file, (percent) =>
            setStatus(`Importing ${asset.file.name}: ${percent}% (${imported + 1}/${batch.length})`),
          );
          await call(base + "/posts", "POST", {
            media_id: uploaded.id,
            title: asset.title,
            caption: asset.caption,
            brand_id: brandId || null,
            destinations: destinationsFor(accounts).filter(a => brandId || niche.master_name ? a.status === "connected" : a.status !== "archived").map(a => a.id),
          });
          imported++;
        }
      } catch (e) {
        throw new Error(`Imported ${imported} of ${batch.length} drafts. Other files may remain in your private library. ${(e as Error).message}`);
      }
      setStatus(`Imported ${imported} ZIP videos/images with their matched captions and titles as private drafts. Review each one before scheduling or publishing.`);
      setTab("Drafts");
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
          source_group: !brandId && niche.master_name ? sourceGroup : "",
          brand_id: brandId || null,
          overrides,
        },
      );
      setDraft(post);
      if (electricSkin) {
        setComposeStage("review");
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        });
      }
      setStatus(electricSkin
        ? "Draft saved safely. You're in publishing review — nothing goes live until you approve."
        : "Draft saved. Review below to prepare your export or reminder.");
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
  const visible = media.filter((m) => contentMatches(m, posts, query, electricSkin ? contentFilter : "All"));
  const pending = posts.filter(
    (p) =>
      p.status === "draft" ||
      p.status === "blocked" ||
      p.status === "cancelled",
  );
  return (
    <>
      <div className={electricSkin && (tab === "Overview" || tab === "Content" || tab === "Drafts") ? "n-page-head compact electric-workspace-heading" : "n-page-head compact"}>
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
      <div className={electricSkin && (tab === "Overview" || tab === "Content" || tab === "Drafts") ? "n-actions electric-overview-secondary-actions" : "n-actions"} style={{ marginBottom: 20 }}>
        <button type="button" onClick={() => setTab("Accounts")}>
          + Add / manage social accounts ({accounts.length})
        </button>
        <button type="button" onClick={() => setTab("Create")}>
          Upload content
        </button>
      </div>
      {!brands.length && niche.master_name && (tab === "Overview" || tab === "Accounts") && (
        <section className="n-panel" aria-label="Master and source accounts">
          <span className="n-kicker">MASTER PUBLISHING</span>
          <h2>{niche.master_name}</h2>
          <p>Only accounts in the master group receive published posts.</p>
          {[["master", niche.master_name], ...sourceGroups.map((name) => ["source:" + name, name]), ["", "Unassigned"]].map(([group, name]) => (
            <div key={group} className="n-panel">
              <h3>{name}{group === "master" ? " · Master" : ""}</h3>
              {accounts.filter((a) => (a.routing_group || "") === group).map((a) => (
                <div key={a.id}>
                  <label>
                    {a.display_name} · {a.platform} · {a.status}
                    <select
                      aria-label={`Group for ${a.display_name}`}
                      value={a.routing_group || ""}
                      disabled={busy}
                      onChange={(event) => {
                        const next = event.currentTarget.value;
                        void run(async () => { await call(base + `/accounts/${a.id}/routing`, "PATCH", { group: next }); });
                      }}
                    >
                      <option value="">Unassigned</option>
                      <option value="master">{niche.master_name} · Master</option>
                      {sourceGroups.map((source) => <option key={source} value={"source:" + source}>{source}</option>)}
                    </select>
                  </label>
                </div>
              ))}
              {group.startsWith("source:") && <button type="button" onClick={() => {
                setDraft(null);
                setSelectedMedia("");
                setSourceGroup(name);
                setComposeStage("prepare");
                setDestinations(destinationsFor(accounts).filter((a) => a.status === "connected").map((a) => a.id));
                setTab("Publish");
              }}>Create post from {name}</button>}
            </div>
          ))}
          <form onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const name = new FormData(form).get("source");
            void run(async () => {
              await call(base + "/source-groups", "POST", { name });
              form.reset();
            });
          }}>
            <label>New source group<input name="source" maxLength={80} required /></label>
            <button type="submit" disabled={busy}>Add source group</button>
          </form>
          {tab === "Overview" && <button type="button" onClick={() => setTab("Accounts")}>Connect social accounts</button>}
        </section>
      )}
      {tab === "Overview" && !electricSkin && (
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
      {tab === "Overview" && electricSkin && (
        <div className="electric-dashboard">
          <div className="electric-hero">
            <div>
              <h1>{niche.name}<span className="electric-desktop-title"> Workspace</span><span className="electric-mobile-title"> 👋</span></h1>
              <p>Manage your content, drafts, schedule and publishing.</p>
            </div>
            <div className={`electric-brand-art ${niche.name.trim().toLowerCase() === "craig's cartoons" ? "electric-cartoon-art" : ""}`} aria-label={`${niche.name} brand workspace`}>
              <strong>{niche.name}</strong>
              <small>{niche.description || "Your content workspace"}</small>
            </div>
          </div>
          <div className="electric-action-row">
            <label className="electric-action-tile">
              <span aria-hidden="true">♧</span>
              <strong>{busy ? "Uploading…" : "Upload Files"}</strong>
              <small>{storageAvailable ? "Add media to your library" : "Storage unavailable"}</small>
              <input type="file" multiple
                aria-label="Upload files to this niche"
                accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
                disabled={busy} onChange={(e) => void upload(e.target.files)} />
            </label>
            <label className="electric-action-tile">
              <span aria-hidden="true">▱</span>
              <strong>{busy ? "Importing…" : "Import ZIP"}</strong>
              <small>{storageAvailable ? "Import content as drafts" : "Storage unavailable"}</small>
              <input type="file" accept=".zip,application/zip" disabled={busy || !storageAvailable}
                aria-label="Import ZIP as drafts"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  void importZip(file);
                }} />
            </label>
            <button className="electric-action-tile" type="button" onClick={() => {
              setDraft(null); setSelectedMedia(""); setTab("Publish");
            }}>
              <span aria-hidden="true">✎</span>
              <strong>Create Draft</strong>
              <small>Add title, caption and destinations</small>
            </button>
          </div>
          <section className="electric-section" aria-label="Publishing queue">
            <div className="electric-section-head">
              <h2><span className="electric-desktop-queue">▦ Publishing Queue</span><span className="electric-mobile-queue">Next in Queue</span></h2>
              <button onClick={() => setTab("Calendar")}>View Calendar ›</button>
            </div>
            {posts.some((p) => p.status === "scheduled" && p.scheduled_at) ? (
              <div className="electric-queue-grid">
                {posts.filter((p) => p.status === "scheduled" && p.scheduled_at)
                  .sort((a,b) => a.scheduled_at!.localeCompare(b.scheduled_at!))
                  .slice(0,3).map((p) => {
                    const source = media.find((m) => m.id === p.media_id);
                    return (
                      <button className="electric-queue-item" key={p.id}
                        onClick={() => setTab("Calendar")} type="button">
                        <span className="electric-queue-thumb">
                          {source ? <Preview niche={niche.id} media={source} /> : "▷"}
                        </span>
                        <span className="electric-queue-copy">
                          <strong>{p.title || source?.filename || "Untitled post"}</strong>
                          <small>{date(p.scheduled_at!)}</small>
                          <span className="electric-status">{p.publish_mode === "direct" ? "Scheduled" : "Reminder"}</span>
                        </span>
                      </button>
                    );
                  })}
              </div>
            ) : (
              <div className="electric-empty">No upcoming posts. <button onClick={() => setTab("Drafts")}>View drafts</button></div>
            )}
          </section>
          <section className="electric-section" aria-label="Recent content">
            <div className="electric-section-head">
              <h2>Recent Content</h2>
              <button onClick={() => setTab("Content")}>View All Content ›</button>
            </div>
            {media.length ? (
              <div className="electric-card-grid">
                {media.slice(0,4).map((m) => {
                  const related = posts.find((p) => p.media_id === m.id);
                  return (
                    <button className="electric-content-card" key={m.id} type="button"
                      onClick={() => { setSelectedMedia(m.id); setDraft(null); setTab("Publish"); }}>
                      <Preview niche={niche.id} media={m} />
                      <span className="electric-card-info">
                        <strong title={m.filename}>{related?.title || m.filename}</strong>
                        <span className={`electric-status ${related?.status || "draft"}`}>
                          {related ? related.status.replaceAll("_"," ") : "Library"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="electric-empty">Your library is empty. Upload your first video to get started.</div>
            )}
          </section>
          <section className="electric-section" aria-label="Social accounts">
            <div className="electric-section-head">
              <h2>♧ Social Accounts</h2>
              <button onClick={() => setTab("Accounts")}>Manage Accounts ›</button>
            </div>
            {accounts.filter((a) => a.status !== "archived").length ? (
              <div className="electric-accounts">
                {accounts.filter((a) => a.status !== "archived").slice(0,8).map((a) => (
                  <div className="electric-account" key={a.id}>
                    <span className="electric-account-symbol" aria-hidden="true">
                      {a.platform === "youtube" ? "▶" : a.platform === "instagram" ? "◎" : a.platform === "facebook" ? "f" : a.platform === "tiktok" ? "♪" : "◈"}
                    </span>
                    <span className="electric-account-body">
                      <strong>{a.display_name || a.platform}</strong>
                      <small className={a.status === "connected" ? "connected" : "unconnected"}>
                        {a.platform} · {a.status === "connected" ? "Connected" : a.status.replaceAll("_"," ")}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="electric-empty">No accounts added. <button onClick={() => setTab("Accounts")}>Manage accounts</button></div>
            )}
          </section>
        </div>
      )}
      {(tab === "Content" || tab === "Create") && (
        <>
          <section className={electricSkin && tab === "Content" ? "n-upload electric-library-upload" : "n-upload"}>
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
          <section className={electricSkin && tab === "Content" ? "n-panel electric-library-import" : "n-panel"}>
            <span className="n-kicker">BULK CONTENT / PRIVATE BETA</span>
            <h2>Import a ready-made content ZIP.</h2>
            <p>
              Upload a ZIP containing up to 20 videos or images. Niches matches
              titles, captions, descriptions and hashtags by filename from
              metadata.json, manifest.json or captions.csv. Matching filename.txt
              caption files are supported too.
            </p>
            <p className="n-muted">
              Each file must be under 25 MB, with no more than 120 MB of media per ZIP.
              Imports become drafts, not published posts. Your accounts and each
              platform’s required permissions still need review before scheduling.
            </p>
            <label className="n-primary">
              {busy ? "Importing ZIP…" : "Import ZIP as drafts ↗"}
              <input
                aria-label="Import ZIP content pack"
                type="file"
                accept=".zip,application/zip"
                disabled={busy || !storageAvailable}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  void importZip(file);
                }}
              />
            </label>
            {!storageAvailable && <p className="n-status-note">Cloud upload must be available to import a ZIP.</p>}
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
              {electricSkin && <div className="electric-library-toolbar">
                <h2>▱ Content Library</h2>
                <div className="electric-library-actions">
                  <label className="n-primary">↑ Upload Files<input type="file" multiple aria-label="Upload files to content library" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => void upload(e.target.files)} /></label>
                  <label className="n-primary">▱ Import ZIP<input type="file" aria-label="Import ZIP to content library" accept=".zip,application/zip" disabled={busy || !storageAvailable} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void importZip(file); }} /></label>
                </div>
              </div>}
              {electricSkin && <div className="electric-library-filters" aria-label="Filter content by status">
                {(["All", "Drafts", "Scheduled", "Published"] as const).map((filter) => <button key={filter} type="button" aria-pressed={contentFilter === filter} onClick={() => setContentFilter(filter)}>{filter}</button>)}
              </div>}
              <div className="n-section-head">
                {!electricSkin && <h2>Content library</h2>}
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
        <div className={electricSkin ? "n-two-col composer electric-launch-flow" : "n-two-col composer"}>
          {electricSkin && (
            <div className="electric-launch-progress" aria-label="Publishing stages">
              <span className="electric-launch-brand">NICHES <b>·</b> LAUNCH SEQUENCE</span>
              <div className="electric-launch-steps">
                <span className={composeStage === "prepare" || !draft ? "active" : "done"}>01 <strong>COMPOSE</strong></span>
                <i aria-hidden="true" />
                <span className={composeStage === "review" && !!draft ? "active" : ""}>02 <strong>REVIEW</strong></span>
                <i aria-hidden="true" />
                <span>03 <strong>LAUNCH</strong></span>
              </div>
            </div>
          )}
          {(!electricSkin || composeStage === "prepare" || !draft) && (
          <section className="n-panel electric-stage electric-compose-stage">
            <span className="n-kicker">01 / PREPARE</span>
            <h2>{electricSkin ? "Build your next drop." : "One post. Your whole niche."}</h2>
            <form key={draft?.id || "new"} onSubmit={save}>
              {brands.length > 0 && (
                <label>Brand
                  <select value={brandId} onChange={(event) => {
                    const next = event.currentTarget.value;
                    setBrandId(next);
                    setDestinations(destinationsFor(accounts, next).filter((account) => account.status === "connected").map((account) => account.id));
                  }}>
                    {!brandId && <option value="">Existing niche draft</option>}
                    {brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}{!brand.parent_id ? " · Master" : ""}</option>)}
                  </select>
                </label>
              )}
              {!brandId && niche.master_name && (
                <label>
                  Source group · publishes only to {niche.master_name}
                  <select value={sourceGroup} onChange={(event) => setSourceGroup(event.currentTarget.value)}>
                    <option value="">Master brand post</option>
                    {sourceGroups.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
              )}
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
              {destinationsFor(accounts).length ? (
                destinationsFor(accounts).map((a) => (
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
                .filter((a) => destinations.includes(a.id) ||
                  (a.platform === "instagram" && brands.some((brand) =>
                    brand.id === brandId && !!brand.parent_id && brand.parent_id === a.brand_id)))
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
                {electricSkin ? "Save & enter launch review ↗" : "Save draft ↗"}
              </button>
            </form>
          </section>
          )}
          {(!electricSkin || (composeStage === "review" && !!draft)) && (
          <section className="n-panel n-review electric-stage electric-review-stage">
            {electricSkin && (
              <div className="electric-launch-review-intro">
                <span className="electric-pulse" aria-hidden="true" />
                <span>STAGE 02 · SAFETY CHECK</span>
                <button type="button" onClick={() => setComposeStage("prepare")}>← Edit details</button>
              </div>
            )}
            <span className="n-kicker">02 / REVIEW</span>
            <h2>{electricSkin ? "Ready for lift-off?" : "Your final say."}</h2>
            {electricSkin && <p className="electric-launch-review-subtitle">Check the destination accounts. Remove any platform you're unsure about. Nothing publishes until you confirm.</p>}
            {draft ? (
              <PublishingReview
                nicheId={niche.id}
                masterName={draft.brand_id ? undefined : niche.master_name}
                draft={draft}
                accounts={accounts}
                providers={providers}
                onAccounts={() => setTab("Accounts")}
                onDraftUpdated={(updated) => {
                  setDraft(updated);
                  setDestinations(updated.destinations);
                  setStatus("Platform removed from this saved draft. No publishing job was created.");
                  changed();
                }}
                onResult={(message) => {
                  setDraft(null);
                  setComposeStage("prepare");
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
          )}
        </div>
      )}
      {tab === "Drafts" && electricSkin && (
        <ElectricDrafts
          nicheId={niche.id}
          posts={posts}
          media={media}
          accounts={accounts}
          onEdit={(post) => edit(post)}
          onReview={(post) => edit(post, "review")}
          onCreate={() => {
            setDraft(null);
            setComposeStage("prepare");
            setSelectedMedia("");
            setSourceGroup("");
            const master = brands.find((brand) => !brand.parent_id)?.id || "";
            setBrandId(master);
            setDestinations(destinationsFor(accounts, master).filter((account) => account.status === "connected").map((account) => account.id));
            setTab("Publish");
          }}
        />
      )}
      {tab === "Drafts" && !electricSkin && (
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
                <div className="n-post-destinations" aria-label="Destination accounts">
                  {p.destinations.map((accountId) => {
                    const account = accounts.find((a) => a.id === accountId);
                    return (
                      <span className="n-post-destination" key={accountId}>
                        {account ? (
                          <>
                            <strong>{account.platform}</strong>
                            <span> · {account.display_name}</span>
                          </>
                        ) : (
                          "Previously selected account"
                        )}
                      </span>
                    );
                  })}
                </div>
                <small className="n-badge">
                  {p.status.replaceAll("_", " ")}
                  {p.scheduled_at ? ` · ${date(p.scheduled_at)}` : ""}
                </small>
                {["draft", "blocked", "cancelled"].includes(p.status) && (
                  <div className="n-draft-accounts" aria-label="Publish separately by account">
                    {p.destinations.map((accountId) => {
                      const account = accounts.find((a) => a.id === accountId);
                      if (!account) return null;
                      const ready =
                        account.status === "connected" &&
                        providers.some(
                          (provider) =>
                            provider.id === account.platform &&
                            provider.publishing_enabled,
                        );
                      return (
                        <div className="n-draft-account" key={account.id}>
                          <span>{account.display_name} · {account.platform}</span>
                          <button
                            type="button"
                            aria-label={`Publish separately to ${account.display_name} on ${account.platform}`}
                            disabled={busy || !p.media_id || !ready}
                            onClick={() => void publishSeparately(p, account)}
                          >
                            Publish separately ↗
                          </button>
                          {!ready && (
                            <small>
                              {account.status === "connected"
                                ? providers.find((provider) => provider.id === account.platform)?.reason ||
                                  "Publishing permissions or app verification required"
                                : "Connect this account first"}
                            </small>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
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
                autoOpen={p.status === "failed"}
                onChanged={changed}
              />
            </div>
          ))}
        </section>
      )}
      {tab === "Calendar" && (
        <PublishingCalendar
          nicheId={niche.id}
          posts={posts}
          accounts={accounts}
          brands={brands}
          media={media}
          onChanged={changed}
        />
      )}
      {tab === "Accounts" && (
        <SocialAccounts
          nicheId={niche.id}
          accounts={accounts}
          providers={providers}
          brands={brands}
          onCreatePost={(nextBrand) => {
            setDraft(null);
            setComposeStage("prepare");
            setSelectedMedia("");
            setBrandId(nextBrand);
            setSourceGroup("");
            setDestinations(destinationsFor(accounts, nextBrand).filter((account) => account.status === "connected").map((account) => account.id));
            setTab("Publish");
          }}
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
