import { useEffect, useState, type FormEvent } from "react";
import { call, type SocialAccount, type Provider, type Brand } from "./niches-api";
function MetaConnectLink({
  url,
  label,
  prominent = false,
}: {
  url: string;
  label: string;
  prominent?: boolean;
}) {
  // The browser follows this same-origin link directly; no JavaScript
  // navigation or form POST is required for Meta OAuth.
  return (
    <a
      href={url}
      className={prominent ? "n-primary" : "n-connect-link"}
      style={{ textDecoration: "none" }}
    >
      {label}
    </a>
  );
}

export default function SocialAccounts({
  nicheId,
  accounts,
  providers,
  brands,
  onCreatePost,
  onChanged,
}: {
  nicheId: string;
  accounts: SocialAccount[];
  providers: Provider[];
  brands: Brand[];
  onCreatePost: (brandId: string) => void;
  onChanged: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false),
    [addBrandId, setAddBrandId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [connectingPlatform, setConnectingPlatform] = useState<string | null>(null),
    [pendingAuthorisation, setPendingAuthorisation] = useState<{ platform: string; url: string } | null>(null),
    [connectionFeedback, setConnectionFeedback] = useState<{ platform: string; message: string; failed: boolean } | null>(null),
    [setup, setSetup] = useState<Provider | null>(null),
    [choices, setChoices] = useState<
      { id: string; name: string; platform: string; existing?: string; single?: boolean }[] | null
    >(null),
    [selected, setSelected] = useState<string[]>([]);
  // The setup modal offers a planning account, not an OAuth connection.
  // Reveal the actual form after closing the modal so mobile users can see it.
  useEffect(() => {
    if (!showAdd || setup) return;
    const form = document.getElementById("niches-add-social-account");
    form?.scrollIntoView({ block: "center", behavior: "instant" });
    form?.querySelector<HTMLInputElement>('input[name="display_name"]')?.focus({ preventScroll: true });
  }, [showAdd, setup]);
  const ticket = new URLSearchParams(location.search).get("connect_ticket");
  const base = `/api/niches/${nicheId}`;
  // The provider returns via a full-page redirect; without this explicit
  // acknowledgement the user appears to land back on an unchanged Accounts tab.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const outcome = params.get("connection");
    if (!["failed", "cancelled", "connected"].includes(outcome || "")) return;
    // Provider metadata loads asynchronously after the OAuth redirect. Do not
    // consume the one-time URL status until the display names have arrived;
    // otherwise "facebook" is shown instead of "Facebook Pages & Reels".
    if (!providers.length) return;
    const platform = params.get("platform") || "social";
    const name = providers.find((p) => p.id === platform)?.name || platform;
    if (outcome === "failed") {
      const fallback = `${name} connection failed. No account was added. Check your Meta app settings and retry.`;
      const noticeId = params.get("connection_error");
      if (noticeId) {
        void call<{ id: string; niche_id: string | null; message: string }[]>("/api/notifications")
          .then((notices) => {
            const notice = notices.find((n) => n.id === noticeId && n.niche_id === nicheId);
            setConnectionFeedback({ platform, message: notice?.message || fallback, failed: true });
          })
          .catch(() => setConnectionFeedback({ platform, message: fallback, failed: true }));
      } else setConnectionFeedback({ platform, message: fallback, failed: true });
    } else {
      setConnectionFeedback({
        platform,
        message: outcome === "cancelled"
          ? `${name} authorisation was cancelled or denied. No account was added.`
          : `${name} is connected. Check the account list below.`,
        failed: outcome !== "connected",
      });
    }
    // Only strip one-time connection status; preserve the niche, selected tab
    // and any pending Page-selection ticket.
    const clean = new URL(location.href);
    for (const key of ["connection", "connection_error", "platform"])
      clean.searchParams.delete(key);
    history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
  }, [nicheId, providers]);
  async function connect(platform: string, brandId?: string | null) {
    setError("");
    setConnectionFeedback(null);
    setPendingAuthorisation(null);
    const provider = providers.find((p) => p.id === platform);
    if (!provider?.oauth_ready) {
      setSetup(provider || null);
      return;
    }
    setBusy(true);
    setConnectingPlatform(platform);
    try {
      const result = await call<{ url: string }>(
        `${base}/accounts/${platform}/connect${brandId ? `?brand=${encodeURIComponent(brandId)}` : ""}`,
        "POST",
        {},
      );
      const url = new URL(result.url);
      const hosts: Record<string, string> = {
        facebook: "www.facebook.com",
        instagram: "www.instagram.com",
        tiktok: "www.tiktok.com",
        youtube: "accounts.google.com",
      };
      if (url.protocol !== "https:" || url.hostname !== hosts[platform])
        throw new Error("Unexpected authorisation address. The connection was stopped for safety.");
      setPendingAuthorisation({ platform, url: url.href });
      location.assign(url.href);
      // Keep the direct-link fallback available if a mobile browser blocks
      // the scripted navigation after an asynchronous request.
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      setConnectionFeedback({ platform, message, failed: true });
      setBusy(false);
      setConnectingPlatform(null);
    }
  }
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      await call(
        base + "/accounts",
        "POST",
        { ...Object.fromEntries(new FormData(form)), brand_id: addBrandId || null },
      );
      form.reset();
      setShowAdd(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadChoices() {
    setError("");
    try {
      setChoices(await call(`${base}/connections/${ticket}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  // Meta returns a selection ticket after authorisation. Load the authorised
  // Pages automatically instead of leaving the user on an unchanged screen
  // with a second button they may never notice.
  useEffect(() => {
    if (ticket) void loadChoices();
  }, [ticket, nicheId]);
  useEffect(() => {
    if (choices?.length)
      document.getElementById("niches-page-choices")?.scrollIntoView({ block: "start" });
  }, [choices]);
  async function change(path: string, method: "POST" | "PATCH", data: object) {
    setError("");
    setBusy(true);
    try {
      await call(base + path, method, data);
      onChanged();
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const renderAccount = (a: SocialAccount) => (
            <div className="n-post-row" key={a.id}>
              <div>
                <strong><span className="n-account-platform-icon" aria-hidden="true">{a.platform.slice(0, 1).toUpperCase()}</span> <span>{a.display_name}</span></strong>
                <p>
                  {a.platform} · {a.provider_id?.replace(/^manual:/, "@")}
                </p>
                <span className="n-badge">
                  {a.status === "connected"
                    ? "Connected"
                    : a.status === "needs_reconnect"
                      ? "Reconnect required"
                      : "Needs connection"}
                </span>
              </div>
              <div className="n-actions">
                {a.platform === "facebook" || a.platform === "instagram" ? (
                  providers.some((p) => p.id === a.platform && p.oauth_ready) ? (
                    <MetaConnectLink
                      url={`${base}/accounts/${a.platform}/connect/start${a.platform === "instagram" ? `?account=${encodeURIComponent(a.id)}` : a.brand_id ? `?brand=${encodeURIComponent(a.brand_id)}` : ""}`}
                      label={a.status === "connected" ? (a.platform === "instagram" ? "Reconnect" : "Add another / reconnect") : "Connect for publishing"}
                    />
                  ) : (
                    <button type="button" onClick={() => setSetup(providers.find((p) => p.id === a.platform) || null)}>
                      {a.platform === "facebook" ? "Facebook" : "Instagram"} connection setup required
                    </button>
                  )
                ) : (
                  <button disabled={busy} onClick={() => void connect(a.platform, a.brand_id)}>
                    {a.status === "connected" ? "Add another / reconnect" : "Connect for publishing"}
                  </button>
                )}
                {brands.length > 0 && <select aria-label={`Brand for ${a.display_name}`} value={a.brand_id || ""}
                  onChange={(event) => void change(`/accounts/${a.id}/brand`, "PATCH", { brand_id: event.currentTarget.value || null })}>
                  <option value="">Unassigned</option>
                  {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </select>}
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !confirm(
                        `Remove ${a.display_name} from this niche? Existing publishing history will be retained.`,
                      )
                    )
                      return;
                    try {
                      await call(
                        `${base}/accounts/${a.id}/archive`,
                        "POST",
                        {},
                      );
                      onChanged();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
  );
  function renderBrand(brand: Brand) {
    const members = accounts.filter((account) => account.brand_id === brand.id);
    const connected = new Set(members.filter((account) => account.status === "connected").map((account) => account.platform)).size;
    return (
      <details className={brand.parent_id ? "n-brand-tree-row n-brand-child" : "n-brand-tree-row n-brand-master"} key={brand.id}>
        <summary>
          <strong>{brand.name}</strong>
          {!brand.parent_id && <span className="n-badge">Master brand</span>}
          <small>{connected} connected {connected === 1 ? "platform" : "platforms"}</small>
        </summary>
        <div className="n-brand-body">
          <div className="n-actions">
            <button type="button" onClick={() => onCreatePost(brand.id)}>Create post</button>
            <button type="button" onClick={() => { setAddBrandId(brand.id); setShowAdd(true); }}>Add planned account</button>
          </div>
          {!brand.parent_id && (
            <label className="n-checkbox">
              <input type="checkbox" checked={!!brand.auto_instagram} disabled={busy}
                onChange={(event) => void change(`/brands/${brand.id}`, "PATCH", { auto_instagram: event.currentTarget.checked })} />
              Also deliver child Instagram posts to this master brand
            </label>
          )}
          {members.map(renderAccount)}
          <details className="n-brand-manage">
            <summary>Connect or manage</summary>
            <div className="n-actions">
              {providers.filter((provider) => provider.oauth_ready).map((provider) =>
                ["instagram", "facebook"].includes(provider.id) ? (
                  <MetaConnectLink key={provider.id}
                    url={`${base}/accounts/${provider.id}/connect/start?brand=${encodeURIComponent(brand.id)}`}
                    label={`Connect ${provider.id}`} />
                ) : (
                  <button key={provider.id} type="button" disabled={busy}
                    onClick={() => void connect(provider.id, brand.id)}>Connect {provider.id}</button>
                )
              )}
            </div>
            <form onSubmit={(event) => {
              event.preventDefault();
              const name = new FormData(event.currentTarget).get("name");
              void change(`/brands/${brand.id}`, "PATCH", { name });
            }}>
              <label>Brand name<input name="name" required maxLength={80} defaultValue={brand.name} key={brand.name} /></label>
              <button type="submit" disabled={busy}>Rename brand</button>
            </form>
          </details>
        </div>
      </details>
    );
  }
  const existingChoice = choices?.find((choice) => selected.includes(choice.id) && choice.existing);
  return (
    <>
      <section className="n-panel">
        <div className="n-section-head">
          <div>
            <h2>Brands &amp; accounts</h2>
            <p>
              Add as many accounts as your brand needs—even several on the same
              platform.
            </p>
          </div>
          <button className="n-primary" onClick={() => { setAddBrandId(""); setShowAdd(!showAdd); }}>
            + Add an account
          </button>
        </div>
        <p className="n-status-note">
          Connected accounts can receive posts after you review and approve
          them. Accounts added for planning stay marked “Needs connection” until
          their owner authorises access.
        </p>
        {error && (
          <p className="n-error" role="alert">
            {error}
          </p>
        )}
        {connectionFeedback && (
          <p className={connectionFeedback.failed ? "n-error" : "n-status-note"} role="alert">
            {connectionFeedback.message}
          </p>
        )}
        {ticket && !choices && (
          <button className="n-primary" onClick={() => void loadChoices()}>
            Choose authorised Pages / accounts
          </button>
        )}
        {choices && (
          <section id="niches-page-choices" className="n-panel">
            <h3>Choose what to add to this niche</h3>
            {choices.map((c) => (
              <label className="n-checkbox" key={c.id}>
                <input
                  type={c.single ? "radio" : "checkbox"}
                  name={c.single ? "verified-account" : undefined}
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? (c.single ? [c.id] : [...old, c.id])
                        : old.filter((x) => x !== c.id),
                    )
                  }
                />
                {c.name} · {c.platform}{c.existing && " · Already connected here"}
              </label>
            ))}
            {existingChoice && <p className="n-status-note">
              Use the existing verified account {existingChoice.existing}. It moves to the planned account’s brand if assigned. Niches archives the planning row only if it has no draft or publishing references.
            </p>}
            <button
              disabled={!selected.length || busy}
              className="n-primary"
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await call<{ reconciled?: boolean }>(`${base}/connections/${ticket}`, "POST", {
                    selected, confirm_existing: !!existingChoice,
                  });
                  history.replaceState(
                    null,
                    "",
                    `/?niche=${nicheId}&section=Accounts`,
                  );
                  setConnectionFeedback({
                    platform: existingChoice ? "instagram" : "social",
                    message: result.reconciled ? "Verified Instagram connection retained and the empty planning row archived." : "Selected accounts are connected.",
                    failed: false,
                  });
                  setChoices(null);
                  onChanged();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {existingChoice ? "Use existing verified account" : "Connect selected accounts"}
            </button>
          </section>
        )}
        {showAdd && (
          <form id="niches-add-social-account" className="n-panel" onSubmit={add}>
            <h3>Add an account{addBrandId && ` · ${brands.find((brand) => brand.id === addBrandId)?.name}`}</h3>
            <label>
              Platform
              <select name="platform" aria-label="Platform">
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Account name
              <input
                name="display_name"
                aria-label="Account name"
                required
                maxLength={100}
                placeholder="Cars — main account"
              />
            </label>
            <label>
              Username, handle or channel identifier
              <input
                name="handle"
                aria-label="Username, handle or channel identifier"
                required
                maxLength={100}
                placeholder="@youraccount"
              />
            </label>
            <p className="n-muted">
              This adds the account to your plan. Use Connect to authorise
              direct publishing. Never enter a social account password here.
            </p>
            <button disabled={busy} className="n-primary">
              Add to this niche
            </button>
          </form>
        )}
        <div className="n-brand-list">
          {brands.map(renderBrand)}
          {brands.length > 0 && accounts.some((account) => !account.brand_id) && (
            <details className="n-brand-tree-row">
              <summary>Unassigned accounts</summary>
              {accounts.filter((account) => !account.brand_id).map(renderAccount)}
            </details>
          )}
          {!brands.length && accounts.map(renderAccount)}
        </div>
        <form className="n-brand-create" onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          if (await change("/brands", "POST", { name: new FormData(form).get("name") })) form.reset();
        }}>
          <label>{brands.length ? "New brand name" : "Master brand name"}<input name="name" maxLength={80} required /></label>
          <button type="submit" disabled={busy}>{brands.length ? "Add brand" : "Create master brand"}</button>
        </form>
      </section>
      <details className="n-provider-settings" open={!brands.length}>
        <summary>Platform connections and setup</summary>
        <div className="n-account-grid">
        {providers.map((p) => (
          <section className="n-panel" key={p.id}>
            <h2>{p.name}</h2>
            <p>
              {accounts.filter((a) => a.platform === p.id).length} accounts in
              this niche ·{" "}
              {
                accounts.filter(
                  (a) => a.platform === p.id && a.status === "connected",
                ).length
              }{" "}
              connected
            </p>
            {p.id === "facebook" || p.id === "instagram" ? (
              p.oauth_ready ? (
                <MetaConnectLink
                  url={`${base}/accounts/${p.id}/connect/start`}
                  label={p.id === "facebook" ? "+ Connect Facebook" : "+ Connect Instagram"}
                  prominent
                />
              ) : (
                <button type="button" className="n-primary" onClick={() => setSetup(p)}>
                  {p.id === "facebook" ? "Facebook" : "Instagram"} setup required — view details
                </button>
              )
            ) : (
              <button className="n-primary" disabled={busy} onClick={() => void connect(p.id)}>
                {connectingPlatform === p.id
                  ? `Opening ${p.name} authorisation…`
                  : `+ Connect ${p.id === "youtube" ? "a channel" : "an account"}`}
              </button>
            )}
            {pendingAuthorisation?.platform === p.id && (
              <p className="n-status-note">
                If your browser has not opened the provider,{" "}
                <a href={pendingAuthorisation.url}>continue to {p.name} authorisation</a>.
              </p>
            )}
            {!p.oauth_ready && (
              <p className="n-muted">
                Developer app setup required before authorisation is available.
              </p>
            )}
          </section>
        ))}
        </div>
      </details>
      {setup && (
        <div className="n-modal-backdrop">
          <section
            className="n-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Provider setup"
          >
            <button
              className="n-close"
              aria-label="Close"
              onClick={() => setSetup(null)}
            >
              ×
            </button>
            <h2>{setup.name} connection setup</h2>
            <p>{setup.reason}</p>
            <p>
              Once the owner registers the developer app, each account holder
              can authorise their accounts here. No account passwords are
              collected by Niches.
            </p>
            {setup.callback && (
              <p className="n-muted">
                Authorisation return URL:{" "}
                <code style={{ overflowWrap: "anywhere" }}>
                  {setup.callback}
                </code>
              </p>
            )}
            <button
              className="n-primary"
              onClick={() => {
                setSetup(null);
                setShowAdd(true);
              }}
            >
              Add an account for planning
            </button>
          </section>
        </div>
      )}
    </>
  );
}
