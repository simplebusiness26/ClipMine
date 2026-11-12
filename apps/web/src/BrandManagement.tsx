import { useEffect, useState, type FormEvent } from "react";
import { call, type SocialAccount } from "./niches-api";

interface Brand {
  id: string;
  niche_id: string;
  name: string;
  parent_brand_id: string | null;
  is_master: number;
  status: "active" | "archived";
  account_count: number;
  post_count: number;
  archived_at: string | null;
}
interface ReleasePreview {
  master: { id: string; name: string };
  child_brands: { id: string; name: string }[];
  direct_accounts: number;
  direct_posts: number;
  scheduled_posts: number;
  note: string;
}

export default function BrandManagement({
  nicheId, accounts, onChanged,
}: {
  nicheId: string;
  accounts: SocialAccount[];
  onChanged: () => void;
}) {
  const base = `/api/niches/${nicheId}`;
  const [brands, setBrands] = useState<Brand[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"master" | "child" | "independent">("child");
  const [preview, setPreview] = useState<ReleasePreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [confirmationName, setConfirmationName] = useState("");
  const active = brands.filter((b) => b.status === "active");
  const masters = active.filter((b) => b.is_master && !b.parent_brand_id);
  const archived = brands.filter((b) => b.status === "archived");

  async function refresh() {
    const rows = await call<Brand[]>(base + "/brands");
    setBrands(rows);
  }
  useEffect(() => {
    setPreview(null);
    setMessage("");
    setError("");
    void refresh().catch((e) => setError((e as Error).message));
  }, [nicheId]);

  async function execute(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
      await refresh();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    await execute(async () => {
      await call(base + "/brands", "POST", {
        name: fields.get("name"),
        is_master: kind === "master",
        parent_brand_id: kind === "child" ? fields.get("parent_brand_id") || null : null,
      });
      form.reset();
      setMessage("Brand created. You can now assign social accounts to it.");
    });
  }

  async function showPreview(brand: Brand) {
    await execute(async () => {
      const data = await call<ReleasePreview>(
        base + "/brands/" + brand.id + "/release-preview",
      );
      setConfirmation("");
      setConfirmationName("");
      setPreview(data);
    });
  }

  async function release() {
    if (!preview || confirmation !== "RELEASE" || confirmationName !== preview.master.name)
      return;
    const selected = preview;
    await execute(async () => {
      const result = await call<{
        released_child_brands: number;
        transferred_accounts: number;
        preserved_scheduled_posts: number;
      }>(base + "/brands/" + selected.master.id + "/release", "POST", {
        confirm: "RELEASE",
        name: selected.master.name,
      });
      setPreview(null);
      setMessage(
        `Master archived. ${result.released_child_brands} sub-brands released, ${result.transferred_accounts} direct accounts transferred, and ${result.preserved_scheduled_posts} existing schedules preserved.`,
      );
    });
  }

  return (
    <section className="n-panel" aria-label="Manage brands">
      <span className="n-kicker">ORGANISE YOUR CONTENT</span>
      <h2>Brands and master brands</h2>
      <p>Each brand lives inside this niche. Release a master without disconnecting accounts or changing scheduled publishing destinations.</p>
      {error && <p className="n-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <div style={{ display: "grid", gap: 12 }}>
        {active.map((brand) => (
          <article
            key={brand.id}
            style={{
              padding: 14, border: "1px solid #dbe2d9", borderRadius: 12,
              marginLeft: brand.parent_brand_id ? 20 : 0,
              background: brand.parent_brand_id ? "#f3f8f1" : "white",
            }}
          >
            <div className="n-section-head">
              <div>
                <strong>{brand.name}</strong>
                <p style={{ margin: "2px 0 0" }}>
                  {brand.is_master ? "Master brand" : brand.parent_brand_id ? "Sub-brand" : "Independent brand"}
                  {" · "}{brand.account_count} accounts · {brand.post_count} posts
                </p>
              </div>
              {!!brand.is_master && (
                <button type="button" disabled={busy} onClick={() => void showPreview(brand)}>
                  Release &amp; archive
                </button>
              )}
            </div>
            {!brand.is_master && (
              <label>
                Brand belongs to
                <select value={brand.parent_brand_id || ""}
                  disabled={busy}
                  onChange={(event) => {
                    const value = event.target.value || null;
                    void execute(async () => {
                      await call(base + "/brands/" + brand.id, "PATCH", { parent_brand_id: value });
                      setMessage("Brand organisation updated.");
                    });
                  }}>
                  <option value="">Independent (no master)</option>
                  {masters.map((master) => (
                    <option key={master.id} value={master.id}>{master.name}</option>
                  ))}
                </select>
              </label>
            )}
          </article>
        ))}
      </div>

      <h3>Create a brand</h3>
      <form onSubmit={(event) => void addBrand(event)}>
        <div className="n-form-grid">
          <label>Brand name
            <input name="name" required maxLength={80} placeholder="War Clipcast" />
          </label>
          <label>Brand type
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="child" disabled={!masters.length}>Sub-brand</option>
              <option value="master">Master brand</option>
              <option value="independent">Independent brand</option>
            </select>
          </label>
          {kind === "child" && (
            <label>Parent master brand
              <select name="parent_brand_id" required>
                <option value="">Choose a master</option>
                {masters.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <button className="n-primary" disabled={busy || (kind === "child" && !masters.length)}>
          Create brand
        </button>
      </form>

      <h3>Move social accounts between brands</h3>
      <p>Moving an account keeps its authorisation and the destinations of existing posts unchanged.</p>
      {accounts.length ? accounts.map((account) => (
        <div key={account.id} className="n-post-row">
          <div><strong>{account.display_name}</strong><p>{account.platform}</p></div>
          <label>
            Brand
            <select
              aria-label={`Brand for ${account.display_name}`}
              value={account.brand_id || ""}
              disabled={busy}
              onChange={(event) => {
                const brandId = event.target.value;
                if (!brandId) return;
                void execute(async () => {
                  await call(base + "/accounts/" + account.id + "/brand", "POST", { brand_id: brandId });
                  setMessage(`${account.display_name} moved to its new brand.`);
                });
              }}
            >
              <option value="" disabled>Choose a brand</option>
              {active.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
        </div>
      )) : <p>No social accounts have been added to this niche.</p>}

      {preview && (
        <section className="n-panel" aria-label="Review master brand release" style={{ border: "2px solid #a56c1c" }}>
          <h3>Review: Release {preview.master.name}</h3>
          <p>Nothing is deleted from Instagram, YouTube, Facebook or TikTok. Child brands become independent. Accounts and posts owned directly by this master move into a new standalone brand.</p>
          <ul>
            <li>{preview.child_brands.length} sub-brands will be released</li>
            <li>{preview.direct_accounts} direct accounts will be moved</li>
            <li>{preview.direct_posts} direct posts will be preserved</li>
            <li>{preview.scheduled_posts} scheduled/queued posts retain their destinations and schedules</li>
          </ul>
          <p>The archived master can be restored for 30 days; released sub-brands will remain independent unless manually reattached.</p>
          <label>Type the master name to confirm
            <input value={confirmationName} onChange={(e) => setConfirmationName(e.target.value)} placeholder={preview.master.name} />
          </label>
          <label>Type RELEASE
            <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="RELEASE" />
          </label>
          <div className="n-actions">
            <button type="button" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
            <button type="button" className="n-primary"
              disabled={busy || confirmation !== "RELEASE" || confirmationName !== preview.master.name}
              onClick={() => void release()}>
              Release brands and archive master
            </button>
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section aria-label="Recently archived master brands">
          <h3>Recently archived masters</h3>
          <p>Masters can be restored for up to 30 days. This does not automatically reattach released brands.</p>
          {archived.map((b) => (
            <div key={b.id} className="n-post-row">
              <div><strong>{b.name}</strong><p>Archived {b.archived_at ? new Date(b.archived_at).toLocaleDateString() : ""}</p></div>
              <button type="button" disabled={busy}
                onClick={() => void execute(async () => {
                  await call(base + "/brands/" + b.id + "/restore", "POST", {});
                  setMessage("Master restored. Released brands remain independent.");
                })}>
                Restore master
              </button>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
