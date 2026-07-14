import {
  findFolder,
  getUploadTokenRecord,
  type AlbumFolder,
  type AlbumUser,
  type AlbumUserPermissions,
  type FolderVisibilityType,
} from "./cloudbase";

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
  contentHash?: string;
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

export function isSuperAdmin(user?: AlbumUser | null): boolean {
  return user?.accountLabel === "alishan-tea";
}

const ALL_PERMISSIONS: AlbumUserPermissions = {
  read: true,
  upload: true,
  edit: true,
  delete: true,
  manageFolders: true,
  assignTitles: true,
};

const ROLE_PERMISSIONS: Record<AlbumUser["role"], AlbumUserPermissions> = {
  admin: { ...ALL_PERMISSIONS, assignTitles: false },
  uploader: { ...ALL_PERMISSIONS, edit: false, delete: false, manageFolders: false, assignTitles: false },
  member: { ...ALL_PERMISSIONS, upload: false, edit: false, delete: false, manageFolders: false, assignTitles: false },
};

export function effectiveUserPermissions(user?: AlbumUser | null): AlbumUserPermissions {
  if (!user) return { ...ALL_PERMISSIONS, read: false, upload: false, edit: false, delete: false, manageFolders: false, assignTitles: false };
  if (isSuperAdmin(user)) return { ...ALL_PERMISSIONS };
  return { ...ROLE_PERMISSIONS[user.role], ...(user.permissions || {}) };
}

export function canReadAlbum(user?: AlbumUser | null): boolean {
  return effectiveUserPermissions(user).read;
}

export function canUploadMedia(user?: AlbumUser | null): boolean {
  return effectiveUserPermissions(user).upload;
}

export function canEditMedia(user?: AlbumUser | null): boolean {
  return effectiveUserPermissions(user).edit;
}

export function canDeleteMedia(user?: AlbumUser | null): boolean {
  return effectiveUserPermissions(user).delete;
}

export function canManageFolders(user?: AlbumUser | null): boolean {
  return effectiveUserPermissions(user).manageFolders;
}

export function canAssignUserTitles(user?: AlbumUser | null): boolean {
  return effectiveUserPermissions(user).assignTitles;
}

export function folderVisibilityType(folder: AlbumFolder): FolderVisibilityType {
  if (folder.visibilityType === "all" || folder.visibilityType === "admins" || folder.visibilityType === "specific") {
    return folder.visibilityType;
  }
  return folder.passwordHash ? "admins" : "all";
}

export function canUserReadFolder(folder: AlbumFolder, user?: AlbumUser | null): boolean {
  if (!user || !canReadAlbum(user)) return false;
  if (isSuperAdmin(user)) return true;
  if (folder.creatorUserId === user.id) return true;
  const visibilityType = folderVisibilityType(folder);
  if (visibilityType === "all") return true;
  if (visibilityType === "admins") return canManageFolders(user);
  return Array.isArray(folder.visibleUserIds) && folder.visibleUserIds.includes(user.id);
}

export function canManageFolderVisibility(folder: AlbumFolder, user?: AlbumUser | null): boolean {
  return Boolean(user && (isSuperAdmin(user) || (canManageFolders(user) && folder.creatorUserId === user.id)));
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
  void request;
  if (!folderSlug || !user) return false;
  const folder = await findFolder(folderSlug);
  if (!folder || !canUserReadFolder(folder, user)) return false;
  if (canUploadMedia(user)) return true;
  if (!uploadToken) return false;
  const tokenHash = await hashUploadToken(uploadToken);
  const match = await getUploadTokenRecord(folderSlug);
  return Boolean(match && constantEqual(match.tokenHash, tokenHash));
}

export function unauthorized() {
  return Response.json({ error: "需要上传权限或有效的文件夹上传链接" }, { status: 403 });
}
