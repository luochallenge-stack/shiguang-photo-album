import { getUploadTokenRecord, type AlbumFolder, type AlbumUser } from "./cloudbase";

const FOLDER_ACCESS_SECONDS = 12 * 60 * 60;
const PASSWORD_ITERATIONS = 210_000;
const UPLOAD_TICKET_SECONDS = 2 * 60 * 60;
const encoder = new TextEncoder();

function constantEqual(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function toBase64Url(value: Uint8Array | string): string {
  return Buffer.from(typeof value === "string" ? encoder.encode(value) : value).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: salt as BufferSource,
    iterations,
  }, key, 256));
}

export async function hashFolderPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyFolderPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationValue, saltValue, hashValue] = stored.split("$");
  const iterations = Number(iterationValue);
  if (algorithm !== "pbkdf2-sha256" || !Number.isSafeInteger(iterations) || iterations < 100_000 || !saltValue || !hashValue) {
    return false;
  }
  const actual = await derivePassword(password, fromBase64Url(saltValue), iterations);
  const expected = fromBase64Url(hashValue);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

async function folderCookieName(folderSlug: string): Promise<string> {
  return `album-folder-${toBase64Url(await sha256(folderSlug)).slice(0, 18)}`;
}

async function lockVersion(passwordHash: string): Promise<string> {
  return toBase64Url(await sha256(passwordHash)).slice(0, 22);
}

async function sign(value: string): Promise<string> {
  const secret = process.env.ALBUM_ADMIN_KEY || "";
  if (!secret) throw new Error("相册访问签名密钥尚未配置");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export type MediaUploadTicket = {
  id: string;
  folderSlug: string;
  objectKey: string;
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  expiresAt: number;
};

export async function createMediaUploadTicket(data: Omit<MediaUploadTicket, "expiresAt">): Promise<string> {
  const payload = toBase64Url(JSON.stringify({
    ...data,
    expiresAt: Date.now() + UPLOAD_TICKET_SECONDS * 1000,
  }));
  return `${payload}.${await sign(payload)}`;
}

export async function readMediaUploadTicket(ticket: string): Promise<MediaUploadTicket | null> {
  const [payload, signature] = ticket.split(".");
  if (!payload || !signature || !constantEqual(signature, await sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MediaUploadTicket;
    return data
      && typeof data.id === "string"
      && typeof data.folderSlug === "string"
      && typeof data.objectKey === "string"
      && typeof data.fileId === "string"
      && typeof data.name === "string"
      && typeof data.size === "number"
      && typeof data.mimeType === "string"
      && typeof data.expiresAt === "number"
      && data.expiresAt > Date.now()
      ? data
      : null;
  } catch {
    return null;
  }
}

export async function createFolderAccessToken(folder: AlbumFolder): Promise<string> {
  if (!folder.passwordHash) throw new Error("这个文件夹没有设置密码");
  const payload = toBase64Url(JSON.stringify({
    slug: folder.slug,
    version: await lockVersion(folder.passwordHash),
    expiresAt: Date.now() + FOLDER_ACCESS_SECONDS * 1000,
  }));
  return `${payload}.${await sign(payload)}`;
}

export async function createFolderAccessCookie(folder: AlbumFolder, accessToken?: string): Promise<string> {
  const token = accessToken || await createFolderAccessToken(folder);
  const name = await folderCookieName(folder.slug);
  return `${name}=${token}; Path=/; Max-Age=${FOLDER_ACCESS_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request, name: string): string {
  const prefix = `${name}=`;
  return (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || "";
}

export async function canReadFolder(request: Request, folder: AlbumFolder, user?: AlbumUser | null): Promise<boolean> {
  if (!folder.passwordHash || user?.role === "admin") return true;
  const token = request.headers.get("x-album-folder-token")?.trim()
    || readCookie(request, await folderCookieName(folder.slug));
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !constantEqual(signature, await sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      slug?: string;
      version?: string;
      expiresAt?: number;
    };
    return data.slug === folder.slug
      && data.version === await lockVersion(folder.passwordHash)
      && typeof data.expiresAt === "number"
      && data.expiresAt > Date.now();
  } catch {
    return false;
  }
}

export async function hashUploadToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function canWriteFolder(
  request: Request,
  folderSlug: string,
  uploadToken?: string,
  user?: AlbumUser | null,
): Promise<boolean> {
  if (user?.role === "admin") return true;
  if (!folderSlug || !uploadToken) return false;
  const tokenHash = await hashUploadToken(uploadToken);
  const match = await getUploadTokenRecord(folderSlug);
  return Boolean(match && constantEqual(match.tokenHash, tokenHash));
}

export function unauthorized() {
  return Response.json({ error: "需要管理员权限或有效的文件夹上传链接" }, { status: 403 });
}
