import { useEffect, useState, type FormEvent } from "react";
import { call, type SocialAccount, type Provider } from "./niches-api";
function FacebookConnectForm({
  url,
  label,
  disabled,
  prominent = false,
}: {
  url: string;
  label: string;
  disabled: boolean;
  prominent?: boolean;
}) {
  // A real form submission preserves browser-controlled user navigation on
  // mobile. Meta's OAuth cookie and 303 redirect are issued by our own Worker.
  return (
    <form action={url} method="POST">
      <button type="submit" disabled={disabled} className={prominent ? "n-primary" : undefined}>
        {label}
      </button>
    </form>
  );
}

export default function SocialAccounts({
  nicheId,
  accounts,
  providers,
  onChanged,
}: {
  nicheId: string;
  accounts: SocialAccount[];
  providers: Provider[];
  onChanged: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [connectingPlatform, setConnectingPlatform] = useState<string | null>(null),
    [pendingAuthorisation, setPendingAuthorisation] = useState<{ platform: string; url: string } | null>(null),
    [connectionFeedback, setConnectionFeedback] = useState<{ platform: string; message: string; failed: boolean } | null>(null),
    [setup, setSetup] = useState<Provider | null>(null),
    [choices, setChoices] = useState<
      { id: string; name: string; platform: string }[] | null
    >(null),
    [selected, setSelected] = useState<string[]>([]);
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
  async function connect(platform: string) {
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
        `${base}/accounts/${platform}/connect`,
        "POST",
        {},
      );
      const url = new URL(result.url);
      const hosts: Record<string, string> = {
        facebook: "www.facebook.com",
        instagram: "www.facebook.com",
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
        Object.fromEntries(new FormData(form)),
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
  return (
    <>
      <section className="n-panel">
        <div className="n-section-head">
          <div>
            <h2>Social accounts in this niche</h2>
            <p>
              Add as many accounts as your brand needs—even several on the same
              platform.
            </p>
          </div>
          <button className="n-primary" onClick={() => setShowAdd(!showAdd)}>
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
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, c.id]
                        : old.filter((x) => x !== c.id),
                    )
                  }
                />
                {c.name} · {c.platform}
              </label>
            ))}
            <button
              disabled={!selected.length || busy}
              className="n-primary"
              onClick={async () => {
                setBusy(true);
                try {
                  await call(`${base}/connections/${ticket}`, "POST", {
                    selected,
                  });
                  history.replaceState(
                    null,
                    "",
                    `/?niche=${nicheId}&section=Accounts`,
                  );
                  setChoices(null);
                  onChanged();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add selected accounts
            </button>
          </section>
        )}
        {showAdd && (
          <form className="n-panel" onSubmit={add}>
            <h3>Add an account</h3>
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
        {accounts.length ? (
          accounts.map((a) => (
            <div className="n-post-row" key={a.id}>
              <div>
                <strong>{a.display_name}</strong>
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
                {a.platform === "facebook" ? (
                  <FacebookConnectForm
                    url={`${base}/accounts/facebook/connect`}
                    label={a.status === "connected" ? "Add another / reconnect" : "Connect for publishing"}
                    disabled={busy || !providers.find((p) => p.id === "facebook")?.oauth_ready}
                  />
                ) : (
                  <button disabled={busy} onClick={() => void connect(a.platform)}>
                    {a.status === "connected" ? "Add another / reconnect" : "Connect for publishing"}
                  </button>
                )}
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
          ))
        ) : (
          <div className="n-empty">
            <h3>Add your first social accounts.</h3>
            <p>
              For example: three Instagrams, two TikToks and one YouTube channel
              can all belong to this niche.
            </p>
          </div>
        )}
      </section>
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
            {p.id === "facebook" ? (
              <FacebookConnectForm
                url={`${base}/accounts/facebook/connect`}
                label="+ Connect an account"
                disabled={busy || !p.oauth_ready}
                prominent
              />
            ) : (
              <button className="n-primary" disabled={busy} onClick={() => void connect(p.id)}>
                {connectingPlatform === p.id
                  ? `Opening ${p.name} authorisation…`
                  : `+ Connect ${p.id === "youtube" ? "a channel" : "an account"}`}
              </button>
            )}
            {connectionFeedback?.platform === p.id && (
              <p className={connectionFeedback.failed ? "n-error" : "n-status-note"} role="status">
                {connectionFeedback.message}
              </p>
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
