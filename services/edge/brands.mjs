import { all, one, execute } from "./db.mjs";
import { fail, id, json, now, textValue } from "./security.mjs";

const activeBrand = async (env, nicheId, brandId) => {
  const brand = await one(env,
    "SELECT * FROM brands WHERE id=? AND niche_id=? AND status='active'",
    brandId, nicheId);
  if (!brand) fail(404, "Active brand not found in this niche.");
  return brand;
};

const details = async (env, nicheId, master) => {
  const [children, directAccounts, directPosts, scheduled] = await Promise.all([
    all(env, "SELECT id,name,is_master FROM brands WHERE niche_id=? AND parent_brand_id=? AND status='active' ORDER BY name", nicheId, master.id),
    one(env, "SELECT COUNT(*) AS total FROM accounts WHERE niche_id=? AND brand_id=? AND status!='archived'", nicheId, master.id),
    one(env, "SELECT COUNT(*) AS total FROM posts WHERE niche_id=? AND brand_id=?", nicheId, master.id),
    one(env, "SELECT COUNT(*) AS total FROM posts WHERE niche_id=? AND brand_id=? AND (delivery_status IN ('scheduled','queued','processing') OR status='scheduled')", nicheId, master.id),
  ]);
  return {
    master: { id: master.id, name: master.name },
    child_brands: children,
    direct_accounts: directAccounts.total,
    direct_posts: directPosts.total,
    scheduled_posts: scheduled.total,
    action: "release",
    note: "Existing publishing targets, scheduled deliveries, media and connection tokens are preserved. The former master and its cross-post relationship will be archived.",
  };
};

async function audit(env, userId, nicheId, action, resource) {
  return execute(env,
    "INSERT INTO audit_events VALUES (?,?,?,?,?,?)",
    id(), userId, nicheId, action, resource, now());
}

// Called only after the parent route authenticates the user and verifies niche ownership.
export async function brandRoute(request, env, user, niche, sub, readBody) {
  const method = request.method;
  const accountMove = sub.match(/^accounts\/([a-zA-Z0-9-]+)\/brand$/);
  if (accountMove && method === "POST") {
    const data = await readBody(request);
    const brand = await activeBrand(env, niche.id, data.brand_id);
    const existing = await one(env,
      "SELECT id FROM accounts WHERE id=? AND niche_id=? AND status!='archived'",
      accountMove[1], niche.id);
    if (!existing) fail(404, "Account not found.");
    await execute(env,
      "UPDATE accounts SET brand_id=? WHERE id=? AND niche_id=? AND status!='archived'",
      brand.id, existing.id, niche.id);
    await audit(env, user.id, niche.id, "account.brand_moved", existing.id);
    return json({ ok: true, account_id: existing.id, brand_id: brand.id });
  }
  if (sub === "brands" && method === "GET") {
    return json(await all(env,
      `SELECT b.*, 
      (SELECT COUNT(*) FROM accounts a WHERE a.brand_id=b.id AND a.status!='archived') AS account_count,
      (SELECT COUNT(*) FROM posts p WHERE p.brand_id=b.id) AS post_count
      FROM brands b WHERE b.niche_id=? AND 
      (b.status='active' OR b.archived_at>?)
      ORDER BY b.status,b.is_master DESC,b.created_at,b.name`,
      niche.id, new Date(Date.now() - 30*86400000).toISOString()));
  }
  if (sub === "brands" && method === "POST") {
    const data = await readBody(request);
    const name = textValue(data.name, 80, true);
    const isMaster = data.is_master === true;
    const parent = data.parent_brand_id || null;
    if (parent && isMaster) fail(400, "Master brands cannot be children.");
    if (parent) {
      const root = await activeBrand(env, niche.id, parent);
      if (!root.is_master || root.parent_brand_id)
        fail(400, "Choose an active master brand as the parent.");
    }
    const count = await one(env, "SELECT COUNT(*) AS total FROM brands WHERE niche_id=? AND status='active'", niche.id);
    if (count.total >= 100) fail(400, "This niche supports up to 100 active brands.");
    const brandId = id();
    await execute(env,
      "INSERT INTO brands(id,niche_id,name,parent_brand_id,is_master,status,created_at) VALUES (?,?,?,?,?,'active',?)",
      brandId, niche.id, name, parent, Number(isMaster), now());
    await audit(env, user.id, niche.id, "brand.created", brandId);
    return json(await one(env, "SELECT * FROM brands WHERE id=?", brandId), 201);
  }
  const match = sub.match(/^brands\/([a-zA-Z0-9-]+)(?:\/(release-preview|release|restore))?$/);
  if (!match) fail(404, "Brand route not found.");
  const brand = await one(env, "SELECT * FROM brands WHERE id=? AND niche_id=?", match[1], niche.id);
  if (!brand) fail(404, "Brand not found in this niche.");
  const action = match[2];
  if (!action && method === "PATCH") {
    if (brand.status !== "active") fail(409, "Restore this brand before editing it.");
    const data = await readBody(request);
    const name = data.name === undefined ? brand.name : textValue(data.name, 80, true);
    const parent = data.parent_brand_id === undefined ? brand.parent_brand_id : data.parent_brand_id || null;
    if (parent && brand.is_master) fail(400, "Master brands cannot have a parent.");
    if (parent) {
      if (parent === brand.id) fail(400, "A brand cannot parent itself.");
      const root = await activeBrand(env, niche.id, parent);
      if (!root.is_master || root.parent_brand_id)
        fail(400, "Choose an active master brand as the parent.");
    }
    await execute(env, "UPDATE brands SET name=?,parent_brand_id=? WHERE id=? AND niche_id=? AND status='active'",
      name, parent, brand.id, niche.id);
    await audit(env, user.id, niche.id, "brand.updated", brand.id);
    return json({ ...brand, name, parent_brand_id: parent });
  }
  if (action === "release-preview" && method === "GET") {
    if (!brand.is_master || brand.status !== "active")
      fail(409, "Only an active master brand can be released.");
    return json(await details(env, niche.id, brand));
  }
  if (action === "release" && method === "POST") {
    if (!brand.is_master || brand.status !== "active")
      fail(409, "Only an active master brand can be released.");
    const data = await readBody(request);
    if (data.confirm !== "RELEASE" || data.name !== brand.name)
      fail(400, "Confirm RELEASE and the exact master brand name.");
    const preview = await details(env, niche.id, brand);
    const stamp = now();
    const replacementId = id();
    const replacementName = textValue(brand.name + " Accounts", 80, true);
    // D1 batch is atomic. Only the request which archives this active master
    // can release children, and account/post IDs never change.
    const statements = [
      env.DB.prepare("UPDATE brands SET status='archived',archived_at=? WHERE id=? AND niche_id=? AND is_master=1 AND status='active'")
        .bind(stamp, brand.id, niche.id),
      env.DB.prepare("INSERT INTO brands(id,niche_id,name,parent_brand_id,is_master,status,created_at) SELECT ?,?,?,NULL,0,'active',? WHERE EXISTS(SELECT 1 FROM brands WHERE id=? AND niche_id=? AND status='archived' AND archived_at=?) AND (EXISTS(SELECT 1 FROM accounts WHERE brand_id=?) OR EXISTS(SELECT 1 FROM posts WHERE brand_id=?))")
        .bind(replacementId, niche.id, replacementName, stamp, brand.id, niche.id, stamp, brand.id, brand.id),
      env.DB.prepare("UPDATE brands SET parent_brand_id=NULL WHERE niche_id=? AND parent_brand_id=? AND status='active' AND EXISTS(SELECT 1 FROM brands WHERE id=? AND status='archived' AND archived_at=?)")
        .bind(niche.id, brand.id, brand.id, stamp),
      env.DB.prepare("UPDATE accounts SET brand_id=? WHERE niche_id=? AND brand_id=? AND EXISTS(SELECT 1 FROM brands WHERE id=? AND status='archived' AND archived_at=?)")
        .bind(replacementId, niche.id, brand.id, brand.id, stamp),
      env.DB.prepare("UPDATE posts SET brand_id=? WHERE niche_id=? AND brand_id=? AND EXISTS(SELECT 1 FROM brands WHERE id=? AND status='archived' AND archived_at=?)")
        .bind(replacementId, niche.id, brand.id, brand.id, stamp),
    ];
    const results = await env.DB.batch(statements);
    if (!results[0].meta.changes)
      fail(409, "Master brand already changed. Refresh and review again.");
    await audit(env, user.id, niche.id, "brand.master_released", brand.id);
    return json({
      ok: true, archived_master_id: brand.id,
      released_child_brands: preview.child_brands.length,
      transferred_accounts: preview.direct_accounts,
      transferred_posts: preview.direct_posts,
      preserved_scheduled_posts: preview.scheduled_posts,
      accounts_brand_id: results[1].meta.changes ? replacementId : null,
    });
  }
  if (action === "restore" && method === "POST") {
    if (brand.status !== "archived") fail(409, "This brand is already active.");
    if (!brand.archived_at || Date.parse(brand.archived_at) < Date.now() - 30 * 86400000)
      fail(410, "The 30-day restore window has ended.");
    const result = await execute(env,
      "UPDATE brands SET status='active',archived_at=NULL WHERE id=? AND niche_id=? AND status='archived'",
      brand.id, niche.id);
    if (!result.meta.changes) fail(409, "Brand was already restored.");
    await audit(env, user.id, niche.id, "brand.restored", brand.id);
    return json({ ok: true, brand_id: brand.id, note: "Released child brands remain independent until you reattach them." });
  }
  fail(405, "Method not allowed.");
}
