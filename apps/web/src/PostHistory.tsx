import { useEffect, useState } from "react";
import { call } from "./niches-api";
type Publication = {
  id: string;
  display_name: string;
  platform: string;
  status: string;
  provider_post_id: string | null;
  error: string | null;
  error_code: string | null;
};
export default function PostHistory({
  nicheId,
  postId,
  autoOpen = false,
  onChanged,
}: {
  nicheId: string;
  postId: string;
  autoOpen?: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(autoOpen),
    [rows, setRows] = useState<Publication[]>([]),
    [error, setError] = useState("");
  async function load() {
    try {
      setRows(
        await call(`/api/niches/${nicheId}/posts/${postId}/publications`),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!open) return;
    void load();
    const interval = setInterval(() => void load(), 10000);
    return () => clearInterval(interval);
  }, [open, nicheId, postId]);
  return (
    <div style={{ flexBasis: "100%", width: "100%" }}>
      <button type="button" onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} account publishing status
      </button>
      {open && (
        <div>
          {error && (
            <p className="n-error" role="alert">
              {error}
            </p>
          )}
          {rows.length ? (
            rows.map((r) => (
              <div className="n-post-row" key={r.id}>
                <div>
                  <strong>
                    {r.display_name} · {r.platform}
                  </strong>
                  <p className="n-badge">{r.status.replaceAll("_", " ")}</p>
                  {r.status === "inbox_delivered" && (
                    <p>Delivered to TikTok inbox. Open the notification in the TikTok app to edit the video, set its caption and audience, and finish posting.</p>
                  )}
                  {r.error && <p role="alert">{r.error}</p>}
                  {r.error_code === "owner_verified" ? (
                    <small>Confirmed live by account owner; no duplicate post submitted.</small>
                  ) : r.error_code ? (
                    <small>Provider error: {r.error_code}</small>
                  ) : null}
                </div>
                {r.platform === "youtube" &&
                  r.provider_post_id &&
                  /^[a-zA-Z0-9_-]+$/.test(r.provider_post_id) && (
                    <a
                      href={`https://www.youtube.com/watch?v=${r.provider_post_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open video
                    </a>
                  )}
                {r.status === "needs_review" && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(
                        `Have you personally checked ${r.display_name} on ${r.platform} and seen this exact post live? This only records your confirmation; it does not upload anything.`
                      )) return;
                      setError("");
                      try {
                        await call(
                          `/api/niches/${nicheId}/publications/${r.id}/confirm-live`,
                          "POST",
                          { confirmed_live: true },
                        );
                        await load();
                        onChanged();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Already published — confirm on Niches
                  </button>
                )}
                {["failed", "needs_review"].includes(r.status) && (
                  <button
                    onClick={async () => {
                      if (
                        r.status === "needs_review" &&
                        !confirm(
                          "Check this social account first. Have you confirmed this post was NOT published? Retrying without checking can cause a duplicate.",
                        )
                      )
                        return;
                      try {
                        await call(
                          `/api/niches/${nicheId}/publications/${r.id}/retry`,
                          "POST",
                          {
                            checked_not_published: r.status === "needs_review",
                          },
                        );
                        await load();
                        onChanged();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Retry this account
                  </button>
                )}
              </div>
            ))
          ) : (
            <p>No provider submissions have been created for this draft.</p>
          )}
        </div>
      )}
    </div>
  );
}
