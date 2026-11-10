import { useEffect, useState, type FormEvent } from "react";
import {
  call,
  type Post,
  type SocialAccount,
  type Provider,
} from "./niches-api";
type DeliveryPlan = { selected: string[]; automatic: string | null; notice?: string };
type Creator = {
  creator_nickname: string;
  creator_username: string;
  privacy_level_options: string[];
  max_video_post_duration_sec: number;
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
};
export default function PublishingReview({
  nicheId,
  masterName,
  draft,
  accounts,
  providers,
  onResult,
  onAccounts,
  onDraftUpdated,
}: {
  nicheId: string;
  masterName?: string;
  draft: Post;
  accounts: SocialAccount[];
  providers: Provider[];
  onResult: (message: string) => void;
  onAccounts: () => void;
  onDraftUpdated?: (updated: Post) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [removingAccountId, setRemovingAccountId] = useState<string | null>(null),
    [creators, setCreators] = useState<Record<string, Creator>>({}),
    [mode, setMode] = useState<"now" | "schedule">("now"),
    [reviewed, setReviewed] = useState<{ key: string; plan: DeliveryPlan } | null>(null);
  const planKey = [draft.id, draft.brand_id, ...draft.destinations].join(":");
  const plan = reviewed?.key === planKey ? reviewed.plan : null;
  const selected = accounts.filter((a) => draft.destinations.includes(a.id) || plan?.automatic === a.id);
  useEffect(() => {
    if (!draft.brand_id) return;
    let active = true;
    void call<DeliveryPlan>(`/api/niches/${nicheId}/posts/${draft.id}/destinations`)
      .then((result) => { if (active) setReviewed({ key: planKey, plan: result }); })
      .catch((error: Error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [nicheId, draft.id, draft.brand_id, planKey]);
  const blocked =
    (!!draft.brand_id && (!plan || (!!plan.automatic && !selected.some((a) => a.id === plan.automatic)))) ||
    selected.some(
      (a) =>
        a.status !== "connected" ||
        !providers.find((p) => p.id === a.platform)?.publishing_enabled,
    ) ||
    !selected.length ||
    !draft.media_id;
  useEffect(() => {
    let alive = true;
    for (const a of selected.filter(
      (a) => a.platform === "tiktok" && a.status === "connected",
    ))
      void call<Creator>(`/api/niches/${nicheId}/accounts/${a.id}/creator`)
        .then((c) => {
          if (alive) setCreators((old) => ({ ...old, [a.id]: c }));
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [draft.id, draft.destinations.join(","), nicheId]);
  async function removeAccount(account: SocialAccount) {
    if (busy || removingAccountId) return;
    // Only an editable draft can be changed. The server refuses any draft
    // with existing publication records, preventing accidental alterations
    // to queued/published content.
    setError("");
    setRemovingAccountId(account.id);
    try {
      const updated = await call<Post>(
        `/api/niches/${nicheId}/posts/${draft.id}`,
        "PATCH",
        {
          media_id: draft.media_id,
          title: draft.title,
          caption: draft.caption,
          overrides: draft.overrides,
          destinations: draft.destinations.filter((id) => id !== account.id),
        },
      );
      onDraftUpdated?.(updated);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setRemovingAccountId(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const settings: Record<string, unknown> = {};
    for (const a of selected) {
      const collaborator = String(data.get(`${a.id}_collaborator`) || "").trim();
      settings[a.id] = {
        ...(collaborator ? { instagram_collaborator: collaborator } : {}),
        privacy: data.get(`${a.id}_privacy`),
        made_for_kids: data.get(`${a.id}_audience`) === "yes",
        allow_comments: data.get(`${a.id}_comments`) === "on",
        allow_duet: data.get(`${a.id}_duet`) === "on",
        allow_stitch: data.get(`${a.id}_stitch`) === "on",
        tiktok_consent: data.get(`${a.id}_consent`) === "on",
        commercial_content: data.get(`${a.id}_commercial`) === "on",
        brand_organic: data.get(`${a.id}_organic`) === "on",
        brand_content: data.get(`${a.id}_brand`) === "on",
        aigc: data.get(`${a.id}_aigc`) === "on",
        ...(data.get(`${a.id}_cover`)
          ? { cover_ms: Number(data.get(`${a.id}_cover`)) }
          : {}),
      };
    }
    try {
      const result = await call<{ message: string }>(
        `/api/niches/${nicheId}/posts/${draft.id}/deliver`,
        "POST",
        {
          confirmed: data.get("confirmed") === "on",
          scheduled_at:
            mode === "schedule"
              ? new Date(String(data.get("scheduled_at"))).toISOString()
              : null,
          accounts: settings,
          automatic_destination: plan?.automatic ?? null,
        },
      );
      onResult(result.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <h3>{draft.title || "Untitled draft"}</h3>
      <p className="n-caption-preview">
        {draft.caption || "No master caption"}
      </p>
      <p>
        <strong>{selected.length} destination accounts</strong>
      </p>
      {!selected.length && (
        <p className="n-status-note">
          Select this niche’s accounts in the composer, then save the draft.
        </p>
      )}
      {!draft.media_id && (
        <p className="n-status-note">
          Upload media before direct publishing. A device-only file has not been
          uploaded.
        </p>
      )}
      {plan?.notice && <p className="n-status-note">{plan.notice}</p>}
      {masterName && <p className="n-status-note">{draft.source_group ? `${draft.source_group} → ` : ""}{masterName} only.</p>}
      {selected.map((a) => {
        const creator = creators[a.id],
          p = providers.find((p) => p.id === a.platform);
        return (
          <div className="electric-review-account" key={a.id}>
            <div className="electric-review-account-bar">
              <div className="electric-review-platform-title">
                <span className="electric-review-platform-icon" aria-hidden="true">{a.platform.slice(0, 1).toUpperCase()}</span>
                <span><strong>{a.display_name}</strong><small>{a.platform.toUpperCase()}</small></span>
              </div>
              {a.id === plan?.automatic ? <small>Automatic master Instagram</small> : <button type="button" className="electric-review-remove"
                disabled={busy || !!removingAccountId || !onDraftUpdated}
                onClick={() => void removeAccount(a)}
                aria-label={`Remove ${a.display_name} from this draft`}>
                {removingAccountId === a.id ? "Removing…" : "✕ Remove"}
              </button>}
            </div>
            <details open>
              <summary>Platform preview and posting options</summary>
            <p className="n-muted">
              {a.status === "connected"
                ? p?.publishing_enabled
                  ? "Authorised destination"
                  : "Connected; publishing configuration/approval still required"
                : "This account needs authorisation."}
            </p>
            <p className="n-caption-preview">
              {draft.overrides[a.id]?.caption ||
                draft.overrides[a.platform]?.caption ||
                draft.caption}
            </p>
            {a.platform === "instagram" && (
              <p className="n-status-note">
                Instagram publishes this Reel or post to the connected account.
                There is no Private visibility option in this publishing flow.
                Only confirm when you are ready for the post to go live.
              </p>
            )}
            {a.platform === "instagram" && a.status === "connected" && !masterName && (
              a.connection_kind === "instagram_login" ? (
                <p className="n-muted">Collab invites require an Instagram connection through Meta. Direct Instagram Login can still publish ordinary Reels.</p>
              ) : (
                <label>
                  Instagram Reel collaborator (optional)
                  <input
                    name={`${a.id}_collaborator`}
                    placeholder="@podclipcasts"
                    maxLength={31}
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                  <small>Select one Instagram publishing account. The collaborator accepts the invite in Instagram.</small>
                </label>
              )
            )}
            {a.platform === "facebook" && (
              <p className="n-status-note">
                Facebook publishes this video or Reel to the connected Page.
                Check the Page and caption before confirming the public post.
              </p>
            )}
            {a.platform === "tiktok" && (
              <p className="n-status-note">
                TikTok requires verified media URL ownership and publishing access.
                Unaudited apps are limited to private accounts and Only you posts.
                Choose Only you for the first test if it is available.
                {!p?.publishing_enabled && p?.reason ? ` ${p.reason}` : ""}
              </p>
            )}
            {a.platform === "youtube" && (
              <>
                <label>
                  Visibility
                  <select name={`${a.id}_privacy`} required defaultValue="">
                    <option value="" disabled>
                      Choose visibility
                    </option>
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <label>
                  Is this video made for children?
                  <select name={`${a.id}_audience`} required defaultValue="">
                    <option value="" disabled>
                      Choose audience
                    </option>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>
                <label className="n-checkbox">
                  <input type="checkbox" name={`${a.id}_aigc`} />
                  Contains realistic altered or synthetic content
                </label>
              </>
            )}
            {a.platform === "tiktok" && (
              <>
                {creator ? (
                  <>
                    <p>
                      Posting as <strong>{creator.creator_nickname}</strong> (@
                      {creator.creator_username}) · Maximum{" "}
                      {creator.max_video_post_duration_sec} seconds
                    </p>
                    <label>
                      Who can watch?
                      <select name={`${a.id}_privacy`} required defaultValue="">
                        <option value="" disabled>
                          Choose visibility
                        </option>
                        {creator.privacy_level_options.map((v) => (
                          <option key={v} value={v}>
                            {v.replaceAll("_", " ").toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="n-checkbox">
                      <input
                        type="checkbox"
                        name={`${a.id}_comments`}
                        disabled={creator.comment_disabled}
                      />
                      Allow comments
                    </label>
                    <label className="n-checkbox">
                      <input
                        type="checkbox"
                        name={`${a.id}_duet`}
                        disabled={creator.duet_disabled}
                      />
                      Allow duet
                    </label>
                    <label className="n-checkbox">
                      <input
                        type="checkbox"
                        name={`${a.id}_stitch`}
                        disabled={creator.stitch_disabled}
                      />
                      Allow stitch
                    </label>
                  </>
                ) : (
                  <p>
                    Connect this account to load its latest posting permissions.
                  </p>
                )}
                <label className="n-checkbox">
                  <input type="checkbox" name={`${a.id}_commercial`} />
                  This post promotes a brand, product or service
                </label>
                <label className="n-checkbox">
                  <input type="checkbox" name={`${a.id}_organic`} />
                  Promotes my own brand
                </label>
                <label className="n-checkbox">
                  <input type="checkbox" name={`${a.id}_brand`} />
                  Paid partnership / branded content
                </label>
                <label className="n-checkbox">
                  <input type="checkbox" name={`${a.id}_aigc`} />
                  AI-generated content
                </label>
                <label className="n-checkbox">
                  <input
                    type="checkbox"
                    name={`${a.id}_consent`}
                    required={!blocked}
                  />
                  I agree to TikTok’s Music Usage Confirmation and, where
                  applicable, Branded Content Policy.
                </label>
                <p>
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                  >
                    Music Usage Confirmation
                  </a>{" "}
                  ·{" "}
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                  >
                    Branded Content Policy
                  </a>
                </p>
              </>
            )}
            {["tiktok", "instagram"].includes(a.platform) && (
              <label>
                Video cover frame (milliseconds, optional)
                <input type="number" min="0" step="1" name={`${a.id}_cover`} />
              </label>
            )}
            </details>
          </div>
        );
      })}
      {blocked && (
        <>
          <p className="n-status-note">
            Direct publishing becomes available when media is uploaded and every
            selected account is authorised with an enabled provider integration.
            Your draft can already be saved and exported.
          </p>
          <button type="button" onClick={onAccounts}>
            Manage / connect accounts
          </button>
        </>
      )}
      <label>
        Publish timing
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "now" | "schedule")}
        >
          <option value="now">Publish now</option>
          <option value="schedule">Schedule for later</option>
        </select>
      </label>
      {mode === "schedule" && (
        <label>
          Publication date and time
          <input type="datetime-local" name="scheduled_at" required />
          <small>
            Your device timezone. Background checks run every minute; provider
            processing may take longer.
          </small>
        </label>
      )}
      <label className="n-checkbox">
        <input name="confirmed" type="checkbox" required disabled={blocked} />I
        reviewed this saved post, selected the destinations and have permission
        to publish the content.
      </label>
      {error && (
        <p className="n-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="n-primary"
        disabled={
          busy ||
          blocked ||
          selected.some((a) => a.platform === "tiktok" && !creators[a.id])
        }
      >
        {busy
          ? "Submitting…"
          : mode === "schedule"
            ? "Schedule publication"
            : "Publish to selected accounts"}
      </button>
      <p className="n-muted">
        A queued post is not marked published until its provider confirms the
        result.
      </p>
      <a href={`/api/niches/${nicheId}/posts/${draft.id}/export`} download>
        Download draft metadata for manual posting
      </a>
    </form>
  );
}
