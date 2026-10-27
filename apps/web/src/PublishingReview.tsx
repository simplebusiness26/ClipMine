import { useEffect, useState, type FormEvent } from "react";
import {
  call,
  type Post,
  type SocialAccount,
  type Provider,
} from "./niches-api";
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
  draft,
  accounts,
  providers,
  onResult,
  onAccounts,
}: {
  nicheId: string;
  draft: Post;
  accounts: SocialAccount[];
  providers: Provider[];
  onResult: (message: string) => void;
  onAccounts: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [creators, setCreators] = useState<Record<string, Creator>>({}),
    [mode, setMode] = useState<"now" | "schedule">("now");
  const selected = accounts.filter((a) => draft.destinations.includes(a.id));
  const blocked =
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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const settings: Record<string, unknown> = {};
    for (const a of selected) {
      settings[a.id] = {
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
      {selected.map((a) => {
        const creator = creators[a.id],
          p = providers.find((p) => p.id === a.platform);
        return (
          <details key={a.id} open>
            <summary>
              {a.display_name} · {a.platform}
            </summary>
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
