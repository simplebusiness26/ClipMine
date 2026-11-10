import { all, one, execute } from "./db.mjs";
import { fail, id, textValue } from "./security.mjs";
import { providerInfo } from "./social-oauth.mjs";

export function listBrands(env, nicheId) {
  return all(env, "SELECT * FROM brands WHERE niche_id=? ORDER BY parent_id IS NOT NULL,name", nicheId);
}

export async function brandFor(env, nicheId, brandId) {
  const brand = await one(env, "SELECT * FROM brands WHERE id=? AND niche_id=?", brandId, nicheId);
  if (!brand) fail(404, "Choose a brand in this niche.");
  return brand;
}

export async function saveBrand(env, nicheId, data, brandId) {
  const brand = brandId ? await brandFor(env, nicheId, brandId) : null;
  const name = textValue(data.name ?? brand?.name, 80, true).trim();
  if (!name) fail(400, "Enter a brand name.");
  if (brand) {
    if (data.auto_instagram !== undefined &&
        (brand.parent_id || typeof data.auto_instagram !== "boolean"))
      fail(400, "Set automatic Instagram distribution on the master brand.");
    const result = await execute(env,
      "UPDATE OR IGNORE brands SET name=?,auto_instagram=? WHERE id=? AND niche_id=?",
      name, Number(data.auto_instagram ?? brand.auto_instagram), brand.id, nicheId);
    if (!result.meta.changes) fail(409, "That brand name is already in use.");
    return brandFor(env, nicheId, brand.id);
  }
  const master = await one(env, "SELECT id FROM brands WHERE niche_id=? AND parent_id IS NULL", nicheId);
  const newId = id();
  const result = await execute(env,
    "INSERT OR IGNORE INTO brands(id,niche_id,parent_id,name) VALUES (?,?,?,?)",
    newId, nicheId, master?.id ?? null, name);
  if (!result.meta.changes) fail(409, "The brand name or master changed. Refresh and try again.");
  return brandFor(env, nicheId, newId);
}

export async function deliveryDestinations(env, niche, post) {
  const selected = [...new Set(JSON.parse(post.destinations_json))];
  const brand = post.brand_id ? await brandFor(env, niche.id, post.brand_id) : null;
  if (!brand) return { selected, automatic: null };
  const accounts = await all(env,
    "SELECT id,brand_id,platform FROM accounts WHERE niche_id=? AND status!='archived'", niche.id);
  if (selected.some((id) => !accounts.some((a) => a.id === id && a.brand_id === brand.id)))
    fail(409, "A destination moved or was removed. Update the draft before publishing.");
  if (!brand.parent_id || !accounts.some((a) => selected.includes(a.id) && a.platform === "instagram") ||
      !providerInfo(env).find((p) => p.id === "instagram")?.publishing_enabled)
    return { selected, automatic: null };
  const master = await brandFor(env, niche.id, brand.parent_id);
  if (!master.auto_instagram) return { selected, automatic: null };
  const eligible = await all(env, `SELECT id FROM accounts
    WHERE niche_id=? AND brand_id=? AND platform='instagram' AND status='connected'
      AND encrypted_tokens IS NOT NULL AND provider_id NOT LIKE 'manual:%'
      AND connection_kind IN ('oauth','instagram_login','instagram_unified')
      AND (expires_at IS NULL OR expires_at>?) LIMIT 2`,
    niche.id, master.id, new Date().toISOString());
  return {
    selected,
    automatic: eligible.length === 1 ? eligible[0].id : null,
    notice: eligible.length === 1 ? undefined : eligible.length
      ? "Master Instagram was skipped because multiple eligible accounts are assigned. Keep one on the master brand to enable automatic delivery."
      : "Master Instagram was skipped because it has no eligible connection.",
  };
}
