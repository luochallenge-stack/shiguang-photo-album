import {
  findUser,
  saveUser,
  type AlbumUser,
  type AlbumUserProvider,
} from "./cloudbase";

const SESSION_COOKIE = "album-session";
const OAUTH_COOKIE = "album-oauth-state";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_SECONDS = 10 * 60;
const encoder = new TextEncoder();

type SessionPayload = {
  userId: string;
  expiresAt: number;
};

type OAuthStatePayload = {
  provider: SocialProvider;
  state: string;
  returnTo: string;
  expiresAt: number;
};

type ProviderProfile = {
  providerUserId: string;
  accountLabel: string;
  displayName: string;
  avatarUrl: string;
};

export type SocialProvider = "wechat" | "qq";

export type PublicAlbumUser = Pick<
  AlbumUser,
  "id" | "provider" | "accountLabel" | "displayName" | "avatarUrl" | "role" | "status" | "createdAt" | "lastLoginAt"
>;

function authSecret(): string {
  const secret = process.env.ALBUM_SESSION_SECRET || process.env.ALBUM_ADMIN_KEY || "";
  if (!secret) throw new Error("相册会话签名密钥尚未配置");
  return secret;
}

function constantEqual(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

async function digest(value: string): Promise<string> {
  const data = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Buffer.from(data).toString("base64url");
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(authSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Buffer.from(signature).toString("base64url");
}

async function createSignedToken(payload: object): Promise<string> {
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${await sign(encoded)}`;
}

async function readSignedToken<T>(token: string): Promise<T | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !constantEqual(signature, await sign(payload))) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string): string {
  const prefix = `${name}=`;
  return (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || "";
}

function secureCookie(request: Request): string {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwardedProtocol === "https" || new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

function sanitizeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value.slice(0, 1500);
}

function providerCredentials(provider: SocialProvider): { clientId: string; clientSecret: string } {
  if (provider === "wechat") {
    return {
      clientId: process.env.WECHAT_APP_ID || "",
      clientSecret: process.env.WECHAT_APP_SECRET || "",
    };
  }
  return {
    clientId: process.env.QQ_APP_ID || "",
    clientSecret: process.env.QQ_APP_KEY || "",
  };
}

export function providerAvailability(): Record<SocialProvider, boolean> {
  return {
    wechat: Boolean(process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET),
    qq: Boolean(process.env.QQ_APP_ID && process.env.QQ_APP_KEY),
  };
}

export function publicUser(user: AlbumUser): PublicAlbumUser {
  const {
    id,
    provider,
    accountLabel,
    displayName,
    avatarUrl,
    role,
    status,
    createdAt,
    lastLoginAt,
  } = user;
  return { id, provider, accountLabel, displayName, avatarUrl, role, status, createdAt, lastLoginAt };
}

export async function createSessionCookie(request: Request, userId: string): Promise<string> {
  const token = await createSignedToken({
    userId,
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
  } satisfies SessionPayload);
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Lax${secureCookie(request)}`;
}

export function clearSessionCookie(request: Request): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureCookie(request)}`;
}

export async function userFromSessionToken(token: string): Promise<AlbumUser | null> {
  if (!token) return null;
  const payload = await readSignedToken<SessionPayload>(token);
  if (!payload || typeof payload.userId !== "string" || payload.expiresAt <= Date.now()) return null;
  const user = await findUser(payload.userId);
  return user?.status === "active" ? user : null;
}

export async function currentUser(request: Request): Promise<AlbumUser | null> {
  return userFromSessionToken(cookieValue(request, SESSION_COOKIE));
}

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}

export function unauthenticated() {
  return Response.json({ error: "登录状态已失效，请重新登录" }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: "只有管理员可以执行此操作" }, { status: 403 });
}

export async function createOAuthStart(
  request: Request,
  provider: SocialProvider,
  requestedReturnTo: string | null,
): Promise<{ authorizationUrl: string; cookie: string }> {
  if (!providerAvailability()[provider]) throw new Error(`${provider === "wechat" ? "微信" : "QQ"}登录尚未配置`);
  const { clientId } = providerCredentials(provider);
  const state = crypto.randomUUID().replace(/-/g, "");
  const returnTo = sanitizeReturnTo(requestedReturnTo);
  const payload: OAuthStatePayload = {
    provider,
    state,
    returnTo,
    expiresAt: Date.now() + OAUTH_SECONDS * 1000,
  };
  const stateToken = await createSignedToken(payload);
  const cookie = `${OAUTH_COOKIE}=${stateToken}; Path=/api/auth/callback; Max-Age=${OAUTH_SECONDS}; HttpOnly; SameSite=Lax${secureCookie(request)}`;
  const redirectUri = `${publicOrigin(request)}/api/auth/callback/${provider}`;
  const authorizationUrl = provider === "wechat"
    ? `https://open.weixin.qq.com/connect/qrconnect?appid=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_login&state=${encodeURIComponent(state)}#wechat_redirect`
    : `https://graph.qq.com/oauth2.0/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=get_user_info`;
  return { authorizationUrl, cookie };
}

export async function completeOAuth(
  request: Request,
  provider: SocialProvider,
  code: string,
  state: string,
): Promise<{ user: AlbumUser; returnTo: string }> {
  const payload = await readSignedToken<OAuthStatePayload>(cookieValue(request, OAUTH_COOKIE));
  if (
    !payload
    || payload.provider !== provider
    || !constantEqual(payload.state, state)
    || payload.expiresAt <= Date.now()
  ) {
    throw new Error("第三方登录请求已失效，请重新发起登录");
  }
  const redirectUri = `${publicOrigin(request)}/api/auth/callback/${provider}`;
  const profile = provider === "wechat"
    ? await fetchWeChatProfile(code)
    : await fetchQQProfile(code, redirectUri);
  const user = await upsertSocialUser(provider, profile);
  return { user, returnTo: sanitizeReturnTo(payload.returnTo) };
}

export function clearOAuthCookie(request: Request): string {
  return `${OAUTH_COOKIE}=; Path=/api/auth/callback; Max-Age=0; HttpOnly; SameSite=Lax${secureCookie(request)}`;
}

export async function createBootstrapAdmin(key: string): Promise<AlbumUser | null> {
  const configured = process.env.ALBUM_ADMIN_KEY || "";
  if (!constantEqual(configured, key)) return null;
  const now = new Date().toISOString();
  const id = `admin_${(await digest("album:bootstrap-admin")).slice(0, 32)}`;
  const existing = await findUser(id);
  const user: AlbumUser = {
    id,
    provider: "admin",
    providerUserId: "bootstrap-admin",
    accountLabel: "administrator",
    displayName: existing?.displayName || "相册管理员",
    avatarUrl: "",
    role: "admin",
    status: "active",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastLoginAt: now,
  };
  await saveUser(user);
  return user;
}

async function upsertSocialUser(provider: AlbumUserProvider, profile: ProviderProfile): Promise<AlbumUser> {
  const id = `${provider}_${(await digest(`${provider}:${profile.providerUserId}`)).slice(0, 32)}`;
  const existing = await findUser(id);
  if (existing?.status === "disabled") throw new Error("这个账号已被管理员停用");
  const now = new Date().toISOString();
  const user: AlbumUser = {
    id,
    provider,
    providerUserId: profile.providerUserId,
    accountLabel: profile.accountLabel,
    displayName: profile.displayName || existing?.displayName || "相册用户",
    avatarUrl: profile.avatarUrl || existing?.avatarUrl || "",
    role: existing?.role || "member",
    status: existing?.status || "active",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastLoginAt: now,
  };
  await saveUser(user);
  return user;
}

function publicOrigin(request: Request): string {
  const configured = process.env.ALBUM_PUBLIC_ORIGIN?.replace(/\/$/, "");
  if (configured) return configured;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(request.url).protocol.replace(":", "");
  return host ? `${protocol}://${host}` : new URL(request.url).origin;
}

async function jsonRequest<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  const text = await response.text();
  let payload: T & { errcode?: number; errmsg?: string; error?: string; error_description?: string };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    payload = Object.fromEntries(new URLSearchParams(text)) as typeof payload;
  }
  if (!response.ok || payload.errcode || payload.error) {
    throw new Error(payload.errmsg || payload.error_description || "第三方登录服务返回错误");
  }
  return payload;
}

async function fetchWeChatProfile(code: string): Promise<ProviderProfile> {
  const { clientId, clientSecret } = providerCredentials("wechat");
  const token = await jsonRequest<{ access_token: string; openid: string }>(
    `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(clientId)}&secret=${encodeURIComponent(clientSecret)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`,
  );
  const profile = await jsonRequest<{ nickname?: string; headimgurl?: string; unionid?: string }>(
    `https://api.weixin.qq.com/sns/userinfo?access_token=${encodeURIComponent(token.access_token)}&openid=${encodeURIComponent(token.openid)}&lang=zh_CN`,
  );
  const providerUserId = profile.unionid || token.openid;
  return {
    providerUserId,
    accountLabel: `wx_${providerUserId.slice(-8)}`,
    displayName: profile.nickname || "微信用户",
    avatarUrl: profile.headimgurl || "",
  };
}

async function fetchQQProfile(code: string, redirectUri: string): Promise<ProviderProfile> {
  const { clientId, clientSecret } = providerCredentials("qq");
  const token = await jsonRequest<{ access_token: string }>(
    `https://graph.qq.com/oauth2.0/token?grant_type=authorization_code&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}&fmt=json`,
  );
  const identity = await jsonRequest<{ openid: string }>(
    `https://graph.qq.com/oauth2.0/me?access_token=${encodeURIComponent(token.access_token)}&fmt=json`,
  );
  const profile = await jsonRequest<{ ret: number; msg?: string; nickname?: string; figureurl_qq_2?: string; figureurl_qq_1?: string }>(
    `https://graph.qq.com/user/get_user_info?access_token=${encodeURIComponent(token.access_token)}&oauth_consumer_key=${encodeURIComponent(clientId)}&openid=${encodeURIComponent(identity.openid)}&fmt=json`,
  );
  if (profile.ret !== 0) throw new Error(profile.msg || "读取 QQ 用户资料失败");
  return {
    providerUserId: identity.openid,
    accountLabel: `qq_${identity.openid.slice(-8)}`,
    displayName: profile.nickname || "QQ 用户",
    avatarUrl: profile.figureurl_qq_2 || profile.figureurl_qq_1 || "",
  };
}
