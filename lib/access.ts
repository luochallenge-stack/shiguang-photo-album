import { getUploadTokenRecord } from "./cloudbase";

function constantEqual(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function isAdminRequest(request: Request): boolean {
  const configured = process.env.ALBUM_ADMIN_KEY || "";
  const provided = request.headers.get("x-album-admin-key") || "";
  return constantEqual(configured, provided);
}

export async function hashUploadToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function canWriteFolder(
  request: Request,
  folderSlug: string,
  uploadToken?: string,
): Promise<boolean> {
  if (isAdminRequest(request)) return true;
  if (!folderSlug || !uploadToken) return false;
  const tokenHash = await hashUploadToken(uploadToken);
  const match = await getUploadTokenRecord(folderSlug);
  return Boolean(match && constantEqual(match.tokenHash, tokenHash));
}

export function unauthorized() {
  return Response.json({ error: "需要管理口令或有效的文件夹上传链接" }, { status: 401 });
}
