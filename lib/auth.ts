import {
  findUser,
  findUserByAccountLabel,
  saveUser,
  type AlbumUser,
  type AlbumUserPermissions,
} from "./cloudbase";
import { effectiveUserPermissions } from "./access";

const SESSION_COOKIE = "album-session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const PASSWORD_ITERATIONS = 210_000;
const encoder = new TextEncoder();

type SessionPayload = {
  userId: string;
  expiresAt: number;
};

export type PublicAlbumUser = Pick<
  AlbumUser,
  "id" | "provider" | "accountLabel" | "displayName" | "title" | "avatarUrl" | "role" | "status" | "createdAt" | "lastLoginAt"
> & { permissions: AlbumUserPermissions };

function defaultTitle(user: Pick<AlbumUser, "displayName" | "accountLabel">): string {
  return user.accountLabel === "alishan-tea" ? "伞兵指挥官" : "";
}

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

export function publicUser(user: AlbumUser): PublicAlbumUser {
  const {
    id,
    provider,
    accountLabel,
    displayName,
    title,
    avatarUrl,
    role,
    status,
    createdAt,
    lastLoginAt,
  } = user;
  return {
    id,
    provider,
    accountLabel,
    displayName,
    title: title?.trim() || defaultTitle(user),
    avatarUrl,
    role,
    permissions: effectiveUserPermissions(user),
    status,
    createdAt,
    lastLoginAt,
  };
}

export async function createSessionToken(userId: string): Promise<string> {
  return createSignedToken({
    userId,
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
  } satisfies SessionPayload);
}

export async function createSessionCookie(request: Request, userId: string, sessionToken?: string): Promise<string> {
  const token = sessionToken || await createSessionToken(userId);
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
  const authorization = request.headers.get("authorization") || "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  return userFromSessionToken(bearerToken || cookieValue(request, SESSION_COOKIE));
}

export function isMiniProgramRequest(request: Request): boolean {
  return request.headers.get("x-album-client") === "miniprogram";
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

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateCredentials(username: string, password: string): string | null {
  if (username === "administrator") return "这个用户名不可使用";
  if (!/^[a-z0-9][a-z0-9_.-]{2,23}$/.test(username)) {
    return "用户名需为 3-24 位字母、数字、点、下划线或短横线";
  }
  if (password.length < 8 || password.length > 72) return "密码需为 8-72 个字符";
  return null;
}

export function validateDisplayName(value: string): string | null {
  const length = Array.from(value.trim()).length;
  return length >= 1 && length <= 20 ? null : "昵称需为 1-20 个字符";
}

async function derivePassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PASSWORD_ITERATIONS },
    key,
    256,
  );
  return Buffer.from(bits).toString("base64url");
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${Buffer.from(salt).toString("base64url")}$${await derivePassword(password, salt)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationText, saltText, expected] = stored.split("$");
  const iterations = Number(iterationText);
  if (algorithm !== "pbkdf2-sha256" || iterations !== PASSWORD_ITERATIONS || !saltText || !expected) return false;
  const actual = await derivePassword(password, Buffer.from(saltText, "base64url"));
  return constantEqual(actual, expected);
}

export async function registerLocalUser(usernameInput: string, password: string, displayNameInput: string): Promise<AlbumUser> {
  const username = normalizeUsername(usernameInput);
  const displayName = displayNameInput.trim();
  const invalid = validateCredentials(username, password) || validateDisplayName(displayName);
  if (invalid) throw new Error(invalid);
  if (await findUserByAccountLabel(username)) throw new Error("这个用户名已经被注册");
  const now = new Date().toISOString();
  const user: AlbumUser = {
    id: `local_${(await digest(`local:${username}`)).slice(0, 32)}`,
    provider: "local",
    providerUserId: username,
    accountLabel: username,
    displayName,
    title: defaultTitle({ displayName, accountLabel: username }),
    avatarUrl: "",
    passwordHash: await hashPassword(password),
    role: "member",
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
  await saveUser(user);
  return user;
}

export async function authenticateLocalUser(usernameInput: string, password: string): Promise<AlbumUser> {
  const username = normalizeUsername(usernameInput);
  const invalid = validateCredentials(username, password);
  if (invalid) throw new Error("用户名或密码错误");
  const user = await findUserByAccountLabel(username);
  const validPassword = user?.provider === "local" && user.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : false;
  if (!user || !validPassword) throw new Error("用户名或密码错误");
  if (user.status === "disabled") throw new Error("这个账号已被管理员停用");
  const updated = { ...user, lastLoginAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await saveUser(updated);
  return updated;
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
    title: existing?.title || "",
    avatarUrl: "",
    passwordHash: existing?.passwordHash,
    role: "admin",
    status: "active",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastLoginAt: now,
  };
  await saveUser(user);
  return user;
}
