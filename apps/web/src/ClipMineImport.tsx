import { useEffect, useRef, useState } from "react";
import { call, uploadMedia, type Niche, type Post, type SocialAccount } from "./niches-api";
import { receiveClipMineExport, type ClipMineTransfer } from "./clipmine-transfer";

type Target = SocialAccount & { niche_id: string; niche_name: string; brand_name?: string };
export default function ClipMineImport({ niches }: { niches: Niche[] }) {
  const [clip, setClip] = useState<ClipMineTransfer | null>(null);
  const [preview, setPreview] = useState("");
  const [accounts, setAccounts] = useState<Target[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [campaign, setCampaign] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Post | null>(null);
  const received = useRef(false);
  const uploaded = useRef<{ niche: string; media: string } | null>(null);
  useEffect(() => {
    void call<Target[]>("/api/accounts")
      .then(setAccounts)
      .catch((e: Error) => setError(e.message))
      .finally(() => setAccountsLoading(false));
    const listener = (event: MessageEvent) => {
      if (received.current) return;
      const incoming = receiveClipMineExport(event, window.opener);
      if (!incoming) return;
      received.current = true;
      setClip(incoming); setTitle(incoming.title);
      window.opener?.postMessage({ type: "niches-clipmine-received-v1" }, event.origin);
    };
    window.addEventListener("message", listener);
    // Only a readiness signal is sent. No account, session or media data leaves Niches.
    window.opener?.postMessage({ type: "niches-clipmine-ready-v1" }, "*");
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => {
    if (!clip) return;
    const url = URL.createObjectURL(new Blob([clip.bytes], { type: "video/mp4" }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [clip]);
  const destinations = accounts.filter((account) =>
    account.platform === "instagram" && account.status === "connected" &&
    niches.some((niche) => niche.id === account.niche_id),
  );
  const account = destinations.find((item) => item.id === target);
  async function save() {
    if (!clip || !account || !reviewed || busy || saved) return;
    setBusy(true); setError("");
    try {
      if (!uploaded.current || uploaded.current.niche !== account.niche_id) {
        const media = await uploadMedia(account.niche_id,
          new File([clip.bytes], clip.name, { type: "video/mp4" }));
        uploaded.current = { niche: account.niche_id, media: media.id };
      }
      const path = `/api/niches/${account.niche_id}/posts`;
      const previous = (await call<Post[]>(path)).find((p) =>
        p.media_id === uploaded.current!.media && p.destinations.length === 1 &&
        p.destinations[0] === account.id);
      if (previous && (previous.status !== "draft" || previous.scheduled_at))
        throw new Error("This export already has a publishing record. Check Niches before retrying.");
      const draft = previous || await call<Post>(path, "POST", {
        media_id: uploaded.current.media, title, caption, campaign_url: campaign || null,
        brand_id: account.brand_id || null, destinations: [account.id],
      });
      if (draft.status !== "draft" || draft.scheduled_at ||
          draft.destinations.length !== 1 || draft.destinations[0] !== account.id)
        throw new Error("Unexpected saved destination or state. Check Niches Drafts before retrying.");
      setSaved(draft);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <main className="clipmine-page clipmine-import">
      <header>
        <h1>Review your ClipMine export</h1>
        <p>Preview the clip and choose the Instagram account for your draft.</p>
      </header>
      {error && <p role="alert" className="clipmine-import__error">{error}</p>}
      {!clip ? (
        <div className="clipmine-import__waiting" role="status">
          <h2>Waiting for your clip</h2>
          <p>Keep both tabs open. If the clip does not appear, return to ClipMine and send it again.</p>
        </div>
      ) : (
        <div className="clipmine-import__grid">
          <figure className="clipmine-import__panel clipmine-import__preview">
            <video aria-label="Clip preview" controls playsInline preload="metadata" src={preview || undefined} />
            <figcaption>{clip.name} · {(clip.bytes.byteLength / 1048576).toFixed(1)} MiB</figcaption>
          </figure>
          <div className="clipmine-import__panel clipmine-import__fields">
            <label className="clipmine-field">
              Instagram destination
              <select value={target} disabled={busy || !!saved || accountsLoading}
                onChange={(event) => { setTarget(event.target.value); setReviewed(false); }}>
                <option value="">{accountsLoading ? "Loading accounts…" : "Choose the Instagram account"}</option>
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.display_name} · {destination.niche_name} · {destination.brand_name || "No brand"}
                  </option>
                ))}
              </select>
            </label>
            {!accountsLoading && !error && destinations.length === 0 && (
              <p role="status">Connect an Instagram account in Niches to save this clip as a draft.</p>
            )}
            <label className="clipmine-field">
              Title
              <input value={title} maxLength={120} disabled={busy || !!saved} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="clipmine-field">
              Caption
              <textarea value={caption} maxLength={10000} rows={4} disabled={busy || !!saved} onChange={(event) => setCaption(event.target.value)} />
            </label>
            <label className="clipmine-field">
              Campaign link (optional)
              <input type="url" value={campaign} disabled={busy || !!saved} onChange={(event) => setCampaign(event.target.value)} />
            </label>
            <label className="clipmine-import__check">
              <input type="checkbox" checked={reviewed} disabled={busy || !!saved}
                onChange={(event) => setReviewed(event.target.checked)} />
              I reviewed the clip, caption, selected account and any campaign requirements.
            </label>
            {saved && account ? (
              <p role="status">Draft saved for <strong>{account.display_name}</strong>. <a
                href={`/?niche=${encodeURIComponent(account.niche_id)}&section=Drafts`}>Open Drafts</a></p>
            ) : (
              <button className="clipmine-button" type="button" disabled={!account || !reviewed || busy}
                onClick={() => void save()}>
                {busy ? "Saving…" : "Save Instagram draft"}
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
