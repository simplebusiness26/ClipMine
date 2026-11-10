import {
  id,
  now,
  randomToken,
  hash,
  fail,
  json,
  textValue,
  sessionToken,
} from "./security.mjs";
import { one, all, execute } from "./db.mjs";
import { seal, unseal, accountContext, base64url } from "./token-vault.mjs";
export const platforms = ["facebook", "instagram", "tiktok", "youtube"];
export const graph = (env) =>
  `https://graph.facebook.com/${/^v\d+\.\d+$/.test(env.META_GRAPH_VERSION || "") ? env.META_GRAPH_VERSION : "v26.0"}`;
const names = {
  facebook: "Facebook Pages & Reels",
  instagram: "Instagram professional & Reels",
  tiktok: "TikTok",
  youtube: "YouTube & Shorts",
};
export function credentials(env, p) {
  return p === "youtube"
    ? { id: env.YOUTUBE_CLIENT_ID, secret: env.YOUTUBE_CLIENT_SECRET }
    : p === "tiktok"
      ? { id: env.TIKTOK_CLIENT_KEY, secret: env.TIKTOK_CLIENT_SECRET }
      : p === "instagram"
        ? env.INSTAGRAM_CONFIG_ID
          ? { id: env.META_APP_ID, secret: env.META_APP_SECRET }
          : { id: env.INSTAGRAM_APP_ID, secret: env.INSTAGRAM_APP_SECRET }
        : { id: env.META_APP_ID, secret: env.META_APP_SECRET };
}
export function providerInfo(env) {
  return platforms.map((p) => {
    const c = credentials(env, p),
      configured = !!(c.id && c.secret && env.NICHES_TOKEN_KEY && env.APP_URL);
    return {
      id: p,
      name: names[p],
      status: configured ? "oauth_ready" : "setup_required",
      oauth_ready: configured,
      login_mode: p === "instagram" && env.INSTAGRAM_CONFIG_ID ? "unified" : "standard",
      publishing_enabled:
        configured &&
        env[`${p.toUpperCase()}_PUBLISH_ENABLED`] === "1" &&
        (p !== "tiktok" || env.TIKTOK_MEDIA_URL_VERIFIED === "1"),
      reason: configured
        ? p === "tiktok" && env.TIKTOK_MEDIA_URL_VERIFIED !== "1"
          ? "TikTok requires ownership verification of the hosted video URL prefix before direct publishing."
          : "Authorise each account you want to add to this niche."
        : `The Niches owner must register the ${p === "youtube" ? "Google" : p === "tiktok" ? "TikTok" : "Meta"} developer app and configure its credentials.`,
      callback: env.APP_URL ? `${env.APP_URL}/api/oauth/${p}/callback` : null,
    };
  });
}
function providerFailureMessage(url, data, status) {
  if (status === 401)
    return "Social authorisation expired. Reconnect this account.";
  if (new URL(String(url)).hostname === "open.tiktokapis.com") {
    // Only disclose documented, non-sensitive error identifiers; never echo provider text.
    const safeCodes = new Set([
      "access_token_invalid", "scope_not_authorized", "url_ownership_unverified",
      "invalid_param", "spam_risk_too_many_pending_share",
      "spam_risk_user_banned_from_posting", "spam_risk_user_has_reached_active_user_cap",
      "privacy_level_option_mismatch", "unaudited_client_can_only_post_to_private_accounts",
      "unaudited_client_can_only_post_to_private_users", "rate_limit_exceeded",
      "internal_error", "client_not_audited",
    ]);
    const code = data?.error?.code;
    return typeof code === "string" && safeCodes.has(code)
      ? `TikTok rejected the request (${code}).`
      : "TikTok rejected the request. Check its developer configuration and permissions.";
  }
  if (!["graph.facebook.com", "graph.instagram.com", "api.instagram.com"].includes(new URL(String(url)).hostname))
    return "The social provider rejected this operation.";
  const raw = String(data?.error?.message || "");
  const code = String(data?.error?.code || "");
  if (/redirect.?uri|redirect.?url|url blocked|whitelist/i.test(raw))
    return "Meta rejected the login return address. Check both exact Valid OAuth Redirect URIs in Facebook Login for Business settings.";
  if (/config_id|configuration (?:id|missing)|login configuration/i.test(raw))
    return "Meta requires a Facebook Login for Business configuration for these permissions. Check its Configurations settings.";
  if (/invalid scope|invalid permission/i.test(raw))
    return "Meta rejected one of the requested permissions. Confirm all required Page permissions say Ready for testing.";
  if (/development mode|app not set up|application.*not available|role/i.test(raw))
    return "Meta restricted this connection. Use a Facebook account with a role on the unpublished Niches app.";
  if (["10", "200"].includes(code) || /permission/i.test(raw))
    return "Meta did not grant the required Page permissions. Check app permissions and that your Facebook account manages the Page.";
  if (code === "190")
    return "Meta access has expired or was rejected. Restart Facebook authorisation.";
  return `Meta rejected the connection${code ? ` (error ${code})` : ""}. Check the app login settings and Page access.`;
}
export async function providerJSON(url, init = {}, fetcher = fetch) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(25000),
    ...init,
    redirect: "manual",
  });
  let data;
  try {
    data = await response.json();
  } catch {
    fail(502, "The social provider returned an unreadable response.");
  }
  if (!response.ok || (data.error && data.error.code !== "ok")) {
    const e = Object.assign(
      new Error(
        providerFailureMessage(url, data, response.status),
      ),
      {
        status: response.status === 401 ? 409 : 502,
        providerStatus: response.status,
        providerCode: String(
          data.error?.code || data.error || "provider_error",
        ),
      },
    );
    throw e;
  }
  return data;
}
export async function formToken(url, values, fetcher = fetch) {
  return providerJSON(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values),
    },
    fetcher,
  );
}
function browserCookie(value, secure = true) {
  return `niches_oauth=${value}; HttpOnly; SameSite=Lax; Path=/api/oauth/; Max-Age=${value ? 600 : 0}${secure ? "; Secure" : ""}`;
}
function redirect(url, cookie) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: url,
      ...(cookie ? { "Set-Cookie": cookie } : {}),
      "Cache-Control": "no-store",
    },
  });
}
export async function beginOAuth(request, env, user, niche, p) {
  const info = providerInfo(env).find((x) => x.id === p);
  if (!info) fail(400, "Choose a supported platform.");
  if (!info.oauth_ready) fail(503, info.reason);
  const paramsFromRequest = new URL(request.url).searchParams;
  const accountId = p === "instagram" ? paramsFromRequest.get("account") : null;
  const brandId = paramsFromRequest.get("brand");
  if (brandId !== null && !(await one(
    env, "SELECT id FROM brands WHERE id=? AND niche_id=?", brandId, niche.id,
  ))) fail(404, "This brand is no longer listed in this niche.");
  if (accountId !== null && !(await one(
    env,
    "SELECT id FROM accounts WHERE id=? AND niche_id=? AND platform='instagram' AND status!='archived'",
    accountId,
    niche.id,
  ))) fail(404, "This Instagram account is no longer listed in this niche.");
  const token = sessionToken(request),
    state = randomToken(),
    browser = randomToken(),
    verifier = randomToken(),
    c = credentials(env, p),
    callback = info.callback;
  const auth = new URL(
    p === "youtube"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : p === "tiktok"
        ? "https://www.tiktok.com/v2/auth/authorize/"
        : p === "instagram" && !env.INSTAGRAM_CONFIG_ID
          ? "https://www.instagram.com/oauth/authorize"
          : `https://www.facebook.com/${graph(env).split("/").pop()}/dialog/oauth`,
  );
  const params = { response_type: "code", redirect_uri: callback, state };
  if (p === "youtube")
    Object.assign(params, {
      client_id: c.id,
      scope:
        "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      access_type: "offline",
      prompt: "consent select_account",
      code_challenge_method: "S256",
      code_challenge: base64url(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier),
          ),
        ),
      ),
    });
  else if (p === "tiktok")
    Object.assign(params, {
      client_key: c.id,
      scope: "user.info.basic,video.publish,video.upload",
    });
  else if (p === "instagram" && env.INSTAGRAM_CONFIG_ID)
    Object.assign(params, {
      client_id: c.id,
      config_id: env.INSTAGRAM_CONFIG_ID,
      override_default_response_type: "true",
      prompt: "login",
    });
  else if (p === "instagram")
    Object.assign(params, {
      client_id: c.id,
      scope: "instagram_business_basic,instagram_business_content_publish",
      enable_fb_login: "false",
    });
  else
    Object.assign(params, {
      client_id: c.id,
      auth_type: "rerequest",
      scope: "pages_show_list,pages_read_engagement,pages_manage_posts",
    });
  for (const [k, v] of Object.entries(params)) auth.searchParams.set(k, v);
  await execute(
    env,
    "INSERT INTO oauth_states VALUES (?,?,?,?,?,?,?,?)",
    await hash(state),
    user.id,
    niche.id,
    p,
    await hash(token),
    await hash(browser),
    await seal(env, { verifier, accountId, brandId }, `oauth:${state}`),
    new Date(Date.now() + 600000).toISOString(),
  );
  const oauthCookie = browserCookie(
    browser,
    new URL(request.url).protocol === "https:",
  );
  // A browser-native POST form follows this redirect without relying on an
  // asynchronous JavaScript navigation, which can stall on mobile browsers.
  // Fetch/XHR clients still receive the existing JSON contract.
  const nativeNavigation =
    request.headers.get("sec-fetch-mode") === "navigate" ||
    request.headers.get("accept")?.includes("text/html");
  return nativeNavigation
    ? redirect(auth.href, oauthCookie)
    : json({ url: auth.href }, 200, { "Set-Cookie": oauthCookie });
}
export async function saveConnection(env, niche, choice, accountId = null, brandId = null) {
  if (choice.platform === "instagram" && accountId) {
    const providerId = String(choice.provider_id);
    const encrypted = await seal(env, choice.tokens, accountContext({
      id: accountId,
      niche_id: niche,
      platform: "instagram",
      provider_id: providerId,
    }));
    // Keep the row ID and its routing and publication references. The
    // conditional update protects against concurrent reconnects or a stale link.
    const updated = await one(
      env,
      `UPDATE accounts SET provider_id=?,display_name=?,status='connected',
         encrypted_tokens=?,connection_kind=?,expires_at=?,token_lock_until=NULL
       WHERE id=? AND niche_id=? AND platform='instagram' AND status!='archived'
         AND (provider_id=? OR (connection_kind='manual' AND provider_id LIKE 'manual:%'))
         AND NOT EXISTS (
           SELECT 1 FROM accounts AS existing
           WHERE existing.niche_id=? AND existing.platform='instagram'
             AND existing.provider_id=? AND existing.id<>?
         )
       RETURNING id`,
      providerId,
      choice.name,
      encrypted,
      choice.connection_kind || "oauth",
      choice.tokens.expires_at || null,
      accountId,
      niche,
      providerId,
      niche,
      providerId,
      accountId,
    );
    if (updated) return updated.id;
    const existing = await one(
      env,
      "SELECT id FROM accounts WHERE niche_id=? AND platform='instagram' AND provider_id=? AND id<>?",
      niche,
      providerId,
      accountId,
    );
    if (existing)
      fail(409, "That Instagram profile already has a record in this niche. Move the existing account to the intended brand in Accounts. The pending row is retained for review.");
    fail(409, "This connection could not be applied. Reopen Accounts and authorise the Instagram profile associated with the selected row.");
  }
  const existing = await one(
    env,
    "SELECT * FROM accounts WHERE niche_id=? AND platform=? AND provider_id=?",
    niche,
    choice.platform,
    String(choice.provider_id),
  );
  const record = {
    id: existing?.id || id(),
    niche_id: niche,
    platform: choice.platform,
    provider_id: String(choice.provider_id),
  };
  const encrypted = await seal(env, choice.tokens, accountContext(record));
  const saved = await one(
    env,
    "INSERT INTO accounts(id,niche_id,platform,display_name,provider_id,status,encrypted_tokens,connection_kind,expires_at,created_at,brand_id) VALUES (?,?,?,?,?,'connected',?,?,?,?,?) ON CONFLICT(niche_id,platform,provider_id) DO UPDATE SET display_name=excluded.display_name,status='connected',encrypted_tokens=excluded.encrypted_tokens,connection_kind=excluded.connection_kind,expires_at=excluded.expires_at,token_lock_until=NULL WHERE excluded.brand_id IS NULL OR accounts.brand_id IS excluded.brand_id RETURNING id",
    record.id,
    niche,
    choice.platform,
    choice.name,
    record.provider_id,
    encrypted,
    choice.connection_kind || "oauth",
    choice.tokens.expires_at || null,
    now(),
    brandId,
  );
  if (!saved)
    fail(409, "This profile already belongs to this niche. Move the existing account to the intended brand in Accounts.");
  return saved.id;
}
async function existingInstagram(env, nicheId, accountId, choice) {
  if (!accountId || choice.platform !== "instagram") return null;
  return one(env, `SELECT id,display_name FROM accounts
    WHERE niche_id=? AND platform='instagram' AND provider_id=?
      AND id<>? AND status!='archived' AND encrypted_tokens IS NOT NULL`,
    nicheId, String(choice.provider_id), accountId);
}

async function reconcileInstagram(env, nicheId, accountId, providerId, existingId) {
  // Archive only an empty manual placeholder. The verified account keeps its
  // identity, credentials, publication history and any references from drafts.
  const rows = await all(env, `
    WITH pair AS MATERIALIZED (
      SELECT pending.id AS pending_id, pending.brand_id, verified.id AS verified_id
      FROM accounts pending JOIN accounts verified ON verified.niche_id=pending.niche_id
      WHERE pending.id=? AND verified.id=? AND pending.niche_id=?
        AND pending.platform='instagram' AND verified.platform='instagram'
        AND pending.connection_kind='manual' AND pending.status='disconnected'
        AND pending.provider_id LIKE 'manual:%' AND pending.encrypted_tokens IS NULL
        AND verified.provider_id=? AND verified.status!='archived' AND verified.encrypted_tokens IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM publications WHERE account_id=pending.id)
        AND NOT EXISTS (
          SELECT 1 FROM posts p WHERE p.niche_id=pending.niche_id AND (
            EXISTS(SELECT 1 FROM json_each(p.destinations_json) WHERE value=pending.id) OR
            EXISTS(SELECT 1 FROM json_each(p.overrides_json) WHERE key=pending.id)
          )
        )
        AND (pending.brand_id IS NULL OR pending.brand_id IS verified.brand_id OR NOT EXISTS (
          SELECT 1 FROM publications WHERE account_id=verified.id
            AND status IN ('pending','processing','retry','needs_review')
        ))
    )
    UPDATE accounts SET
      status=CASE WHEN id=(SELECT pending_id FROM pair) THEN 'archived' ELSE status END,
      brand_id=CASE WHEN id=(SELECT verified_id FROM pair)
        THEN COALESCE((SELECT brand_id FROM pair),brand_id) ELSE brand_id END
    WHERE id IN (SELECT pending_id FROM pair UNION ALL SELECT verified_id FROM pair)
    RETURNING id`, accountId, existingId, nicheId, String(providerId));
  if (rows.length !== 2)
    fail(409, "These accounts have references or active publishing work. Both records were kept. Review the existing account and move it when its queue is clear.");
}

export async function finishOAuth(request, env, p, fetcher = fetch) {
  const url = new URL(request.url),
    state = url.searchParams.get("state") || "",
    browser = request.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)niches_oauth=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!/^[a-f0-9]{64}$/.test(state) || !browser)
    fail(
      400,
      "This connection request is invalid or expired. Start again from Accounts.",
    );
  const row = await one(
    env,
    "SELECT * FROM oauth_states WHERE state_hash=? AND platform=? AND browser_hash=? AND expires_at>?",
    await hash(state),
    p,
    await hash(browser),
    now(),
  );
  if (
    !row ||
    !(await one(
      env,
      "SELECT token_hash FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?",
      row.session_hash,
      row.user_id,
      now(),
    ))
  )
    fail(400, "This connection request expired. Log in and try again.");
  const consumed = await one(
    env,
    "DELETE FROM oauth_states WHERE state_hash=? RETURNING state_hash",
    await hash(state),
  );
  if (!consumed) fail(400, "This connection link was already used.");
  const destination = new URL(env.APP_URL);
  destination.searchParams.set("niche", row.niche_id);
  destination.searchParams.set("section", "Accounts");
  destination.searchParams.set("platform", p);
  const clear = browserCookie("", url.protocol === "https:");
  if (url.searchParams.has("error")) {
    destination.searchParams.set("connection", "cancelled");
    return redirect(destination.href, clear);
  }
  const code = url.searchParams.get("code");
  if (!code || code.length > 4096)
    fail(400, "The social provider did not return a valid authorisation code.");
  const c = credentials(env, p),
    callback = `${env.APP_URL}/api/oauth/${p}/callback`,
    context = await unseal(env, row.encrypted_context, `oauth:${state}`);
  const endpoint =
    p === "youtube"
      ? "https://oauth2.googleapis.com/token"
      : p === "tiktok"
        ? "https://open.tiktokapis.com/v2/oauth/token/"
        : p === "instagram" && !env.INSTAGRAM_CONFIG_ID
        ? "https://api.instagram.com/oauth/access_token"
        : `${graph(env)}/oauth/access_token`;
  const values = {
    client_secret: c.secret,
    code,
    redirect_uri: callback,
    grant_type: "authorization_code",
    ...(p === "tiktok" ? { client_key: c.id } : { client_id: c.id }),
    ...(p === "youtube" ? { code_verifier: context.verifier } : {}),
  };
  try {
    let tokens = await formToken(endpoint, values, fetcher);
    if (!tokens.access_token)
      fail(502, "The provider did not grant account access.");
    tokens = {
      ...tokens,
      expires_at: new Date(
        Date.now() + Number(tokens.expires_in || 3600) * 1000,
      ).toISOString(),
    };
    let choices = [];
    if (p === "instagram" && env.INSTAGRAM_CONFIG_ID) {
      // Unified Login's business system-user token covers explicitly shared
      // Instagram accounts. Unlike standalone login, /me is not an Instagram user.
      const assigned = await providerJSON(
        `${graph(env)}/me/assigned_instagram_accounts?fields=id,username&limit=100`,
        { headers: { Authorization: "Bearer " + tokens.access_token } }, fetcher,
      );
      tokens = { access_token: tokens.access_token, expires_at: tokens.expires_in
        ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString() : null };
      choices = (assigned.data || []).filter((x) => x.id && x.username).map((x) => ({
        platform: "instagram", provider_id: String(x.id), name: x.username,
        tokens, connection_kind: "instagram_unified",
      }));
    } else if (p === "instagram") {
      // Instagram Login returns an IG-user token, not a Facebook Page token.
      const grant = await providerJSON(
        `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(c.secret)}&access_token=${encodeURIComponent(tokens.access_token)}`,
        {}, fetcher,
      );
      if (!grant.access_token) fail(502, "Instagram did not return a long-lived access token.");
      tokens = {
        access_token: grant.access_token,
        expires_at: new Date(Date.now() + Number(grant.expires_in || 5184000) * 1000).toISOString(),
      };
      const profile = await providerJSON(
        "https://graph.instagram.com/me?fields=id,user_id,username,account_type",
        { headers: { Authorization: "Bearer " + tokens.access_token } }, fetcher,
      );
      if (!profile.id || !profile.username) fail(502, "Instagram did not return an account identity.");
      choices = [{ platform: p, provider_id: profile.user_id || profile.id,
        name: profile.username, tokens, connection_kind: "instagram_login" }];
    } else if (p === "youtube") {
      const profile = await providerJSON(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: "Bearer " + tokens.access_token } },
        fetcher,
      );
      choices = (profile.items || []).map((x) => ({
        platform: p,
        provider_id: x.id,
        name: x.snippet.title,
        tokens,
      }));
    } else if (p === "tiktok") {
      const profile = await providerJSON(
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
        { headers: { Authorization: "Bearer " + tokens.access_token } },
        fetcher,
      );
      const u = profile.data?.user;
      if (u?.open_id)
        choices = [
          { platform: p, provider_id: u.open_id, name: u.display_name, tokens },
        ];
    } else {
      // Facebook Page OAuth is independent of direct Instagram Login.
      const extended = await formToken(
        `${graph(env)}/oauth/access_token`,
        {
          grant_type: "fb_exchange_token",
          client_id: c.id,
          client_secret: c.secret,
          fb_exchange_token: tokens.access_token,
        },
        fetcher,
      );
      if (extended.access_token)
        tokens = {
          ...tokens,
          ...extended,
          expires_at: new Date(
            Date.now() + Number(extended.expires_in || 5184000) * 1000,
          ).toISOString(),
        };
      const result = await providerJSON(
        `${graph(env)}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100`,
        { headers: { Authorization: "Bearer " + tokens.access_token } },
        fetcher,
      );
      for (const page of result.data || []) {
        const ig = page.instagram_business_account;
        if (p === "instagram" && ig)
          choices.push({
            platform: p,
            provider_id: ig.id,
            name: ig.username,
            tokens: {
              access_token: page.access_token,
              expires_at: tokens.expires_at,
            },
          });
        else if (p === "facebook" && page.access_token)
          choices.push({
            platform: p,
            provider_id: page.id,
            name: page.name,
            tokens: {
              access_token: page.access_token,
              expires_at: tokens.expires_at,
            },
          });
      }
    }
    if (!choices.length)
      fail(
        409,
        "No eligible account was returned. Check the channel/Page/professional account and permissions.",
      );
    const hasExisting = context.accountId && choices.length === 1
      ? await existingInstagram(env, row.niche_id, context.accountId, choices[0]) : null;
    if (p === "facebook" || choices.length > 1 || hasExisting) {
      const ticket = randomToken();
      await execute(
        env,
        "INSERT INTO oauth_selections VALUES (?,?,?,?,?)",
        await hash(ticket),
        row.user_id,
        row.niche_id,
        await seal(env, choices.map((choice) => ({ ...choice, accountId: context.accountId, brandId: context.brandId })), `selection:${row.user_id}:${row.niche_id}`),
        new Date(Date.now() + 600000).toISOString(),
      );
      destination.searchParams.set("connect_ticket", ticket);
    } else {
      await saveConnection(env, row.niche_id, choices[0], context.accountId, context.brandId);
      destination.searchParams.set("connection", "connected");
    }
  } catch (error) {
    // The browser lands back on Accounts even on failure. Preserve a short-lived,
    // user-scoped notice identifier so the page can show the real failure.
    // Never put provider tokens, error text or account details in the URL.
    const noticeId = id();
    await execute(
      env,
      "INSERT INTO notifications VALUES (?,?,?,?,NULL,?)",
      noticeId,
      row.user_id,
      row.niche_id,
      error.status
        ? error.message
        : "Social connection failed. Start again from Accounts.",
      now(),
    );
    destination.searchParams.set("connection_error", noticeId);
    destination.searchParams.set("connection", "failed");
  }
  return redirect(destination.href, clear);
}
export async function selectConnections(env, user, niche, ticket, selected, confirmExisting) {
  if (!/^[a-f0-9]{64}$/.test(ticket)) fail(400, "Invalid selection ticket");
  const row = await one(
    env,
    "SELECT * FROM oauth_selections WHERE ticket_hash=? AND user_id=? AND niche_id=? AND expires_at>?",
    await hash(ticket),
    user.id,
    niche,
    now(),
  );
  if (!row) fail(404, "Account selection expired. Connect again.");
  const choices = await unseal(
    env,
    row.encrypted_choices,
    `selection:${user.id}:${niche}`,
  );
  const accountId = choices[0]?.accountId;
  if (selected === undefined)
    return Promise.all(choices.map(async (choice) => {
      const existing = await existingInstagram(env, niche, accountId, choice);
      return {
        id: choice.provider_id,
        name: choice.name,
        platform: choice.platform,
        ...(accountId ? { single: true } : {}),
        ...(existing ? { existing: existing.display_name } : {}),
      };
    }));
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    (accountId && selected.length !== 1) ||
    selected.some((x) => !choices.some((c) => c.provider_id === x))
  )
    fail(400, accountId ? "Choose one authorised Instagram account." : "Choose at least one authorised account.");
  const chosen = choices.filter((choice) => selected.includes(choice.provider_id));
  const existing = accountId ? await existingInstagram(env, niche, accountId, chosen[0]) : null;
  if (existing && confirmExisting !== true)
    fail(409, "Confirm that you want to use the verified Instagram account already in this niche.");
  const consumed = await one(
    env,
    "DELETE FROM oauth_selections WHERE ticket_hash=? RETURNING ticket_hash",
    await hash(ticket),
  );
  if (!consumed) fail(409, "Selection already used.");
  if (existing) {
    await reconcileInstagram(env, niche, accountId, chosen[0].provider_id, existing.id);
    return { connected: 1, reconciled: true };
  }
  for (const choice of chosen)
    await saveConnection(env, niche, choice, accountId, choice.brandId);
  return { connected: chosen.length };
}
export async function accessToken(env, account, fetcher = fetch) {
  if (account.status !== "connected" || !account.encrypted_tokens)
    fail(409, "Connect this account for publishing first.");
  let tokens = await unseal(
    env,
    account.encrypted_tokens,
    accountContext(account),
  );
  if (
    tokens.expires_at &&
    new Date(tokens.expires_at).getTime() > Date.now() + 120000
  )
    return tokens.access_token;
  if (account.platform === "instagram" && account.connection_kind === "instagram_unified") {
    if (!tokens.expires_at) return tokens.access_token;
    await execute(env, "UPDATE accounts SET status='needs_reconnect' WHERE id=?", account.id);
    fail(409, "Your Instagram business authorisation expired. Reconnect the account.");
  }
  if (account.platform === "instagram" && account.connection_kind === "instagram_login") {
    const lock = await one(env,
      "UPDATE accounts SET token_lock_until=? WHERE id=? AND (token_lock_until IS NULL OR token_lock_until<?) RETURNING id",
      new Date(Date.now() + 30000).toISOString(), account.id, now());
    if (!lock) fail(409, "This account is refreshing. Try again shortly.");
    try {
      const refreshed = await providerJSON(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(tokens.access_token)}`,
        {}, fetcher,
      );
      if (!refreshed.access_token) fail(502, "Instagram did not renew access.");
      tokens = { access_token: refreshed.access_token,
        expires_at: new Date(Date.now() + Number(refreshed.expires_in || 5184000) * 1000).toISOString() };
      await execute(env,
        "UPDATE accounts SET encrypted_tokens=?,expires_at=?,token_lock_until=NULL WHERE id=?",
        await seal(env, tokens, accountContext(account)), tokens.expires_at, account.id);
      return tokens.access_token;
    } catch (error) {
      await execute(env,
        "UPDATE accounts SET status='needs_reconnect',token_lock_until=NULL WHERE id=?", account.id);
      throw error;
    }
  }
  if (!tokens.refresh_token) {
    await execute(
      env,
      "UPDATE accounts SET status='needs_reconnect' WHERE id=?",
      account.id,
    );
    fail(
      409,
      "Reconnect this account: its provider authorisation has expired.",
    );
  }
  const lock = await one(
    env,
    "UPDATE accounts SET token_lock_until=? WHERE id=? AND (token_lock_until IS NULL OR token_lock_until<?) RETURNING id",
    new Date(Date.now() + 30000).toISOString(),
    account.id,
    now(),
  );
  if (!lock) fail(409, "This account is refreshing. Try again shortly.");
  try {
    const c = credentials(env, account.platform);
    const refreshed = await formToken(
      account.platform === "youtube"
        ? "https://oauth2.googleapis.com/token"
        : "https://open.tiktokapis.com/v2/oauth/token/",
      {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_secret: c.secret,
        ...(account.platform === "youtube"
          ? { client_id: c.id }
          : { client_key: c.id }),
      },
      fetcher,
    );
    tokens = {
      ...tokens,
      ...refreshed,
      expires_at: new Date(
        Date.now() + Number(refreshed.expires_in || 3600) * 1000,
      ).toISOString(),
    };
    await execute(
      env,
      "UPDATE accounts SET encrypted_tokens=?,expires_at=?,token_lock_until=NULL WHERE id=?",
      await seal(env, tokens, accountContext(account)),
      tokens.expires_at,
      account.id,
    );
    return tokens.access_token;
  } catch (error) {
    await execute(
      env,
      "UPDATE accounts SET status='needs_reconnect',token_lock_until=NULL WHERE id=?",
      account.id,
    );
    throw error;
  }
}
