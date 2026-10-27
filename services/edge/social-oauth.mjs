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
      publishing_enabled:
        configured && env[`${p.toUpperCase()}_PUBLISH_ENABLED`] === "1",
      reason: configured
        ? "Authorise each account you want to add to this niche."
        : `The Niches owner must register the ${p === "youtube" ? "Google" : p === "tiktok" ? "TikTok" : "Meta"} developer app and configure its credentials.`,
      callback: env.APP_URL ? `${env.APP_URL}/api/oauth/${p}/callback` : null,
    };
  });
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
        response.status === 401
          ? "Social authorisation expired. Reconnect this account."
          : "The social provider rejected this operation.",
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
  else
    Object.assign(params, {
      client_id: c.id,
      auth_type: "rerequest",
      scope:
        p === "instagram"
          ? "pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish"
          : "pages_show_list,pages_read_engagement,pages_manage_posts",
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
    await seal(env, { verifier }, `oauth:${state}`),
    new Date(Date.now() + 600000).toISOString(),
  );
  return json({ url: auth.href }, 200, {
    "Set-Cookie": browserCookie(
      browser,
      new URL(request.url).protocol === "https:",
    ),
  });
}
export async function saveConnection(env, niche, choice) {
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
  await execute(
    env,
    "INSERT INTO accounts(id,niche_id,platform,display_name,provider_id,status,encrypted_tokens,connection_kind,expires_at,created_at) VALUES (?,?,?,?,?,'connected',?,'oauth',?,?) ON CONFLICT(niche_id,platform,provider_id) DO UPDATE SET display_name=excluded.display_name,status='connected',encrypted_tokens=excluded.encrypted_tokens,connection_kind='oauth',expires_at=excluded.expires_at,token_lock_until=NULL",
    record.id,
    niche,
    choice.platform,
    choice.name,
    record.provider_id,
    encrypted,
    choice.tokens.expires_at || null,
    now(),
  );
  return record.id;
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
    if (p === "youtube") {
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
      // Extend the user grant before discovering its authorised Page tokens.
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
    if (p === "facebook" || p === "instagram" || choices.length > 1) {
      const ticket = randomToken();
      await execute(
        env,
        "INSERT INTO oauth_selections VALUES (?,?,?,?,?)",
        await hash(ticket),
        row.user_id,
        row.niche_id,
        await seal(env, choices, `selection:${row.user_id}:${row.niche_id}`),
        new Date(Date.now() + 600000).toISOString(),
      );
      destination.searchParams.set("connect_ticket", ticket);
    } else {
      await saveConnection(env, row.niche_id, choices[0]);
      destination.searchParams.set("connection", "connected");
    }
  } catch (error) {
    await execute(
      env,
      "INSERT INTO notifications VALUES (?,?,?,?,NULL,?)",
      id(),
      row.user_id,
      row.niche_id,
      error.status
        ? error.message
        : "Social connection failed. Start again from Accounts.",
      now(),
    );
    destination.searchParams.set("connection", "failed");
  }
  return redirect(destination.href, clear);
}
export async function selectConnections(env, user, niche, ticket, selected) {
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
  if (selected === undefined)
    return choices.map((x) => ({
      id: x.provider_id,
      name: x.name,
      platform: x.platform,
    }));
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    selected.some((x) => !choices.some((c) => c.provider_id === x))
  )
    fail(400, "Choose at least one authorised account.");
  const consumed = await one(
    env,
    "DELETE FROM oauth_selections WHERE ticket_hash=? RETURNING ticket_hash",
    await hash(ticket),
  );
  if (!consumed) fail(409, "Selection already used.");
  for (const choice of choices.filter((x) => selected.includes(x.provider_id)))
    await saveConnection(env, niche, choice);
  return { connected: selected.length };
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
