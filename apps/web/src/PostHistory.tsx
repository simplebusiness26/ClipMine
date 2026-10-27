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
  onChanged,
}: {
  nicheId: string;
  postId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false),
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
                  {r.error && <p>{r.error}</p>}
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
