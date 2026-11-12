import { all, one, execute } from "./db.mjs";
import { fail, id, textValue } from "./security.mjs";
import { providerInfo } from "./social-oauth.mjs";

export function listBrands(env, nicheId) {
  return all(env, "SELECT * FROM brands WHERE niche_id=? AND archived_at IS NULL ORDER BY is_master DESC,parent_id IS NOT NULL,name", nicheId);
}

export async function brandFor(env, nicheId, brandId) {
  const brand = await one(env, "SELECT * FROM brands WHERE id=? AND niche_id=? AND archived_at IS NULL", brandId, nicheId);
  if (!brand) fail(404, "Choose a brand in this niche.");
  return brand;
}

export async function saveBrand(env, nicheId, data, brandId) {
  const brand = brandId ? await brandFor(env, nicheId, brandId) : null;
  const name = textValue(data.name ?? brand?.name, 80, true).trim();
  if (!name) fail(400, "Enter a brand name.");
  if (brand) {
    if (data.auto_instagram !== undefined &&
        (!brand.is_master || typeof data.auto_instagram !== "boolean"))
      fail(400, "Set automatic Instagram distribution on the master brand.");
    const result = await execute(env,
      "UPDATE OR IGNORE brands SET name=?,auto_instagram=? WHERE id=? AND niche_id=?",
      name, Number(data.auto_instagram ?? brand.auto_instagram), brand.id, nicheId);
    if (!result.meta.changes) fail(409, "That brand name is already in use.");
    return brandFor(env, nicheId, brand.id);
  }
  const master = await one(env, "SELECT id FROM brands WHERE niche_id=? AND is_master=1 AND archived_at IS NULL", nicheId);
  const newId = id();
  const isMaster = data.is_master === true ||
    (data.is_master === undefined && !master && data.independent !== true);
  if (isMaster && master) fail(409, "This niche already has an active master.");
  const parent = isMaster || data.independent === true ? null : (master?.id ?? null);
  const result = await execute(env,
    "INSERT OR IGNORE INTO brands(id,niche_id,parent_id,name,is_master) VALUES (?,?,?,?,?)",
    newId, nicheId, parent, name, Number(isMaster));
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

/**
 * Preview is read-only and never returns connection credentials.
 * Ownership is enforced by the caller's scoped niche lookup.
 */
export async function masterReleasePreview(env, nicheId, masterId) {
  const master = await one(env,
    "SELECT * FROM brands WHERE id=? AND niche_id=? AND is_master=1 AND archived_at IS NULL",
    masterId,nicheId);
  if (!master) fail(404, "Active master brand not found.");
  const [children, accounts, posts, schedules, legacyAccounts] = await Promise.all([
    all(env,"SELECT id,name FROM brands WHERE niche_id=? AND parent_id=? AND archived_at IS NULL ORDER BY name",nicheId,masterId),
    one(env,"SELECT COUNT(*) AS total FROM accounts WHERE niche_id=? AND brand_id=? AND status!='archived'",nicheId,masterId),
    one(env,"SELECT COUNT(*) AS total FROM posts WHERE niche_id=? AND brand_id=?",nicheId,masterId),
    one(env,"SELECT COUNT(*) AS total FROM posts WHERE niche_id=? AND brand_id=? AND (delivery_status IN ('queued','scheduled','processing') OR status='scheduled')",nicheId,masterId),
    one(env,"SELECT COUNT(*) AS total FROM accounts WHERE niche_id=? AND brand_id IS NULL AND routing_group='master' AND status!='archived'",nicheId),
  ]);
  return {
    master: { id: master.id, name: master.name },
    child_brands: children,
    direct_accounts: accounts.total + legacyAccounts.total,
    direct_posts: posts.total,
    scheduled_posts: schedules.total,
    note: "Child brands become independent. Connected accounts, media, publishing jobs and their destinations stay intact.",
  };
}

export async function archivedMasters(env,nicheId) {
  return all(env,
    "SELECT id,name,archived_at FROM brands WHERE niche_id=? AND is_master=1 AND archived_at>? ORDER BY archived_at DESC",
    nicheId,new Date(Date.now()-30*86400000).toISOString());
}

export async function releaseMaster(env,userId,nicheId,masterId,data) {
  const preview=await masterReleasePreview(env,nicheId,masterId);
  if(data?.confirm!=="RELEASE" || data?.name!==preview.master.name)
    fail(400,"Confirm RELEASE and type the master name exactly.");
  const stamp=new Date().toISOString();
  const independentId=id();
  const suffix=independentId.slice(0,6);
  const base=(preview.master.name+" Accounts").slice(0,72);
  const existing=await one(env,"SELECT id FROM brands WHERE niche_id=? AND name=? COLLATE NOCASE",nicheId,base);
  const independentName=existing?base.slice(0,72)+" "+suffix:base;
  const legacy=await one(env,"SELECT master_name FROM niches WHERE id=?",nicheId);
  // In pre-brand-ownership drafts the old master group can be unassigned.
  // Keep those posts and accounts by moving them together; do not modify IDs.
  const masterMatches=legacy?.master_name?.trim().toLowerCase()===preview.master.name.trim().toLowerCase();
  const hasDirect=await one(env,
    `SELECT
       (SELECT COUNT(*) FROM accounts WHERE niche_id=? AND (brand_id=? OR (?=1 AND brand_id IS NULL AND routing_group='master'))) +
       (SELECT COUNT(*) FROM posts WHERE niche_id=? AND (brand_id=? OR (?=1 AND brand_id IS NULL AND source_group=''))) AS total`,
       nicheId,masterId,Number(masterMatches),nicheId,masterId,Number(masterMatches));
  const statements=[
    env.DB.prepare("UPDATE brands SET archived_at=? WHERE id=? AND niche_id=? AND is_master=1 AND archived_at IS NULL")
      .bind(stamp,masterId,nicheId),
  ];
  if(hasDirect.total) statements.push(
    env.DB.prepare("INSERT INTO brands(id,niche_id,parent_id,name,is_master) VALUES (?,?,NULL,?,0)")
      .bind(independentId,nicheId,independentName));
  statements.push(
    env.DB.prepare("UPDATE brands SET parent_id=NULL WHERE niche_id=? AND parent_id=? AND archived_at IS NULL")
      .bind(nicheId,masterId));
  if(hasDirect.total){
    statements.push(
      env.DB.prepare(`UPDATE accounts SET brand_id=?,routing_group=''
        WHERE niche_id=? AND (brand_id=? OR (?=1 AND brand_id IS NULL AND routing_group='master'))`)
        .bind(independentId,nicheId,masterId,Number(masterMatches)),
      env.DB.prepare(`UPDATE posts SET brand_id=?,source_group=''
        WHERE niche_id=? AND (brand_id=? OR (?=1 AND brand_id IS NULL AND source_group=''))`)
        .bind(independentId,nicheId,masterId,Number(masterMatches))
    );
  }
  if(masterMatches) statements.push(
    env.DB.prepare("UPDATE niches SET master_name='',source_groups_json='[]' WHERE id=? AND lower(trim(master_name))=lower(?)")
      .bind(nicheId,preview.master.name));
  statements.push(
    env.DB.prepare("INSERT INTO audit_events VALUES (?,?,?,?,?,?)")
      .bind(id(),userId,nicheId,"brand.master_released",masterId,stamp));
  // D1 batch is atomic. If any constraint fails, none of the account or post
  // ownership moves are committed.
  const result=await env.DB.batch(statements);
  if(!result[0]?.meta?.changes) fail(409,"Master brand already changed; refresh.");
  return {
    ok:true, archived_master_id:masterId, released_child_brands:preview.child_brands.length,
    transferred_accounts:preview.direct_accounts, transferred_posts:preview.direct_posts,
    preserved_scheduled_posts:preview.scheduled_posts,
    accounts_brand_id:hasDirect.total?independentId:null,
  };
}

export async function restoreMaster(env,userId,nicheId,masterId) {
  const master=await one(env,
    "SELECT * FROM brands WHERE id=? AND niche_id=? AND is_master=1 AND archived_at IS NOT NULL",
    masterId,nicheId);
  if(!master) fail(404,"Archived master brand not found.");
  if(Date.parse(master.archived_at)<Date.now()-30*86400000)
    fail(410,"The 30-day restore period has ended.");
  const live=await one(env,
    "SELECT id FROM brands WHERE niche_id=? AND is_master=1 AND archived_at IS NULL",nicheId);
  if(live) fail(409,"Archive the existing master before restoring this one.");
  const stamp=new Date().toISOString();
  try{
    const results=await env.DB.batch([
      env.DB.prepare("UPDATE brands SET archived_at=NULL WHERE id=? AND niche_id=? AND archived_at IS NOT NULL")
        .bind(masterId,nicheId),
      env.DB.prepare("UPDATE niches SET master_name=? WHERE id=? AND master_name=''")
        .bind(master.name,nicheId),
      env.DB.prepare("INSERT INTO audit_events VALUES (?,?,?,?,?,?)")
        .bind(id(),userId,nicheId,"brand.master_restored",masterId,stamp),
    ]);
    if(!results[0]?.meta?.changes) fail(409,"Master changed; refresh.");
  }catch(e){
    if(e.status)throw e;
    fail(409,"Master could not be restored because its name or hierarchy conflicts with an active brand.");
  }
  return {ok:true,brand_id:masterId,note:"Released sub-brands and accounts remain independent until reassigned."};
}
