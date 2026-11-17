import { useEffect, useRef, useState } from "react";
import { call, uploadMedia, type Niche, type Post, type SocialAccount } from "./niches-api";
import { receiveClipMineExport, type ClipMineTransfer } from "./clipmine-transfer";

type Target = SocialAccount & { niche_id: string; niche_name: string; brand_name?: string };
export default function ClipMineImport({ niches }: { niches: Niche[] }) {
  const [clip, setClip] = useState<ClipMineTransfer | null>(null);
  const [preview, setPreview] = useState("");
  const [accounts, setAccounts] = useState<Target[]>([]);
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
    void call<Target[]>("/api/accounts").then(setAccounts).catch((e: Error) => setError(e.message));
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
  const account = accounts.find((item) => item.id === target);
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
  return <main className="n-panel" style={{ maxWidth: 760, margin: "24px auto", padding: 24 }}>
    <h1>Review your ClipMine export</h1>
    <p>Choose the Instagram account after clipping. Your Niches sign-in stays in Niches.</p>
    {error && <p role="alert" className="n-error">{error}</p>}
    {!clip && <p>Waiting for the export from the ClipMine tab. Keep both tabs open.</p>}
    {clip && <>
      <video controls playsInline src={preview} style={{ width: "100%", maxHeight: "60vh" }} />
      <p>{clip.name} · {(clip.bytes.byteLength / 1048576).toFixed(1)} MiB</p>
      <label>Instagram destination<select value={target} disabled={busy || !!saved}
        onChange={(e) => { setTarget(e.target.value); setReviewed(false); }}>
        <option value="">Choose the exact Instagram handle</option>
        {accounts.filter((a) => a.platform === "instagram" && a.status === "connected" &&
          niches.some((n) => n.id === a.niche_id)).map((a) =>
          <option key={a.id} value={a.id}>{a.display_name} · {a.niche_name} · {a.brand_name || "No brand"}</option>)}
      </select></label>
      <label>Title<input value={title} maxLength={120} disabled={busy || !!saved} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Caption<textarea value={caption} maxLength={10000} disabled={busy || !!saved} onChange={(e) => setCaption(e.target.value)} /></label>
      <label>Campaign link<input type="url" value={campaign} disabled={busy || !!saved} onChange={(e) => setCampaign(e.target.value)} /></label>
      <label><input type="checkbox" checked={reviewed} disabled={busy || !!saved}
        onChange={(e) => setReviewed(e.target.checked)} />I reviewed the video, captions, campaign brief and selected handle.</label>
      {account && <p>Draft destination: <strong>{account.display_name}</strong>. Check distribution again before scheduling.</p>}
      <button type="button" disabled={!account || !reviewed || busy || !!saved} onClick={() => void save()}>
        {saved ? "Draft saved" : busy ? "Saving…" : "Save Instagram draft"}</button>
      {saved && <p role="status">Saved as a draft for {account?.display_name}. <a
        href={`/?niche=${encodeURIComponent(account!.niche_id)}&section=Drafts`}>Open Drafts</a></p>}
    </>}
  </main>;
}
