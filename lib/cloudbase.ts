import cloudbaseSdk from "@cloudbase/node-sdk";

export type AlbumFolder = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  creatorUserId?: string;
  visibilityType?: FolderVisibilityType;
  visibleUserIds?: string[];
  passwordHash?: string;
  sortOrder?: number;
  deletedAt?: string;
};

export type FolderVisibilityType = "all" | "admins" | "specific";

export type AlbumPhoto = {
  id: string;
  folderSlug: string;
  objectKey: string;
  fileId: string;
  name: string;
  url: string;
  size: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  coverFileId?: string;
  createdAt: string;
  deletedAt?: string;
  purgeAt?: string;
  lastAction?: "upload" | "rename" | "move" | "recycle" | "restore";
  lastActionBy?: string;
  lastActionAt?: string;
};

export type AlbumPhotoPage = {
  photos: AlbumPhoto[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type AlbumUserRole = "admin" | "uploader" | "member";
export type AlbumUserStatus = "active" | "disabled";
export type AlbumUserProvider = "local" | "admin";
export type AlbumUserPermissions = {
  read: boolean;
  upload: boolean;
  edit: boolean;
  delete: boolean;
  manageFolders: boolean;
  assignTitles: boolean;
};

export type AlbumUser = {
  id: string;
  provider: AlbumUserProvider;
  providerUserId: string;
  accountLabel: string;
  displayName: string;
  title?: string;
  avatarUrl: string;
  passwordHash?: string;
  role: AlbumUserRole;
  permissions?: Partial<AlbumUserPermissions>;
  status: AlbumUserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
};

export type AlbumAuditLog = {
  id: string;
  userId: string;
  userName: string;
  provider: AlbumUserProvider;
  action: string;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  method: string;
  path: string;
  ipHash: string;
  userAgent: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
};

type UploadTokenRecord = {
  folderSlug: string;
  tokenHash: string;
  createdAt: string;
};

const COLLECTIONS = {
  folders: "album_folders",
  photos: "album_photos",
  uploadTokens: "album_upload_tokens",
  users: "album_users",
  auditLogs: "album_audit_logs",
} as const;

let app: ReturnType<typeof cloudbaseSdk.init> | null = null;

function envId(): string {
  return process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV || "";
}

export function cloudBaseIsConfigured(): boolean {
  return Boolean(envId());
}

export function getCloudBase() {
  if (!cloudBaseIsConfigured()) {
    throw new Error("腾讯云 CloudBase 环境尚未配置");
  }
  if (!app) {
    app = cloudbaseSdk.init({ env: envId() });
  }
  return app;
}

function database() {
  return getCloudBase().database();
}

function rows<T>(result: { data?: unknown[] }): T[] {
  return (result.data || []).map((item) => {
    const source = item as { data?: unknown };
    const record = (source.data && typeof source.data === "object" ? source.data : item) as T & { _id?: string };
    const value = { ...record } as T & { _id?: string };
    delete value._id;
    return value;
  });
}

function pageBounds(offset: number, limit: number): { offset: number; limit: number } {
  return {
    offset: Number.isSafeInteger(offset) && offset > 0 ? offset : 0,
    limit: Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 48,
  };
}

function activePhotoFilter(folderSlug?: string, excludedFolderSlugs: string[] = []): Record<string, unknown> {
  const command = database().command;
  return {
    deletedAt: command.exists(false).or(command.eq("")),
    ...(folderSlug
      ? { folderSlug }
      : excludedFolderSlugs.length
        ? { folderSlug: command.nin(excludedFolderSlugs) }
        : {}),
  };
}

function recycledPhotoFilter(excludedFolderSlugs: string[] = []): Record<string, unknown> {
  const command = database().command;
  return {
    deletedAt: command.exists(true).and(command.neq("")),
    ...(excludedFolderSlugs.length ? { folderSlug: command.nin(excludedFolderSlugs) } : {}),
  };
}

async function queryPhotoPage(
  filter: Record<string, unknown>,
  orderField: "createdAt" | "deletedAt",
  offset: number,
  limit: number,
): Promise<AlbumPhotoPage> {
  const bounds = pageBounds(offset, limit);
  const collection = database().collection(COLLECTIONS.photos);
  const [result, count] = await Promise.all([
    collection
      .where(filter)
      .orderBy(orderField, "desc")
      .skip(bounds.offset)
      .limit(bounds.limit)
      .get(),
    collection.where(filter).count(),
  ]);
  const photos = rows<AlbumPhoto>(result);
  const total = Math.max(0, Number(count.total) || 0);
  return {
    photos,
    total,
    ...bounds,
    hasMore: bounds.offset + photos.length < total,
  };
}

export async function listFolders(): Promise<AlbumFolder[]> {
  const result = await database().collection(COLLECTIONS.folders).orderBy("createdAt", "desc").limit(100).get();
  return rows<AlbumFolder>(result).filter((folder) => !folder.deletedAt).sort((left, right) => {
    const leftOrder = Number.isFinite(left.sortOrder) ? Number(left.sortOrder) : null;
    const rightOrder = Number.isFinite(right.sortOrder) ? Number(right.sortOrder) : null;
    if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (leftOrder !== null) return -1;
    if (rightOrder !== null) return 1;
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

export async function findFolder(slug: string): Promise<AlbumFolder | null> {
  const folder = await findFolderIncludingDeleted(slug);
  return folder && !folder.deletedAt ? folder : null;
}

export async function findFolderIncludingDeleted(slug: string): Promise<AlbumFolder | null> {
  const result = await database().collection(COLLECTIONS.folders).where({ slug }).limit(1).get();
  return rows<AlbumFolder>(result)[0] || null;
}

export async function createFolderRecord(folder: AlbumFolder): Promise<void> {
  const existing = await findFolder(folder.slug);
  if (existing) throw new Error("已存在同名文件夹");
  await database().collection(COLLECTIONS.folders).doc(folder.id).set(folder);
}

export async function updateFolderVisibility(
  id: string,
  visibilityType: FolderVisibilityType,
  visibleUserIds: string[],
): Promise<void> {
  await database().collection(COLLECTIONS.folders).doc(id).update({
    visibilityType,
    visibleUserIds: visibilityType === "specific" ? visibleUserIds : [],
    passwordHash: "",
  });
}

export async function updateFolderName(id: string, name: string): Promise<void> {
  await database().collection(COLLECTIONS.folders).doc(id).update({ name });
}

export async function updateFolderSortOrders(folderIds: string[]): Promise<void> {
  await Promise.all(folderIds.map((id, sortOrder) => (
    database().collection(COLLECTIONS.folders).doc(id).update({ sortOrder })
  )));
}

export async function countActivePhotosInFolder(folderSlug: string): Promise<number> {
  const result = await database().collection(COLLECTIONS.photos).where(activePhotoFilter(folderSlug)).count();
  return Math.max(0, Number(result.total) || 0);
}

export async function countPhotosInFolder(folderSlug: string): Promise<number> {
  const result = await database().collection(COLLECTIONS.photos).where({ folderSlug }).count();
  return Math.max(0, Number(result.total) || 0);
}

export async function deleteFolderRecord(id: string, folderSlug: string, keepRecycleTombstone = false): Promise<void> {
  await database().collection(COLLECTIONS.uploadTokens).doc(folderSlug).remove();
  if (keepRecycleTombstone) {
    await database().collection(COLLECTIONS.folders).doc(id).update({ deletedAt: new Date().toISOString() });
  } else {
    await database().collection(COLLECTIONS.folders).doc(id).remove();
  }
}

export async function restoreDeletedFolderRecord(id: string): Promise<void> {
  await database().collection(COLLECTIONS.folders).doc(id).update({ deletedAt: "" });
}

export async function removeDeletedFolderIfEmpty(folderSlug: string): Promise<void> {
  const folder = await findFolderIncludingDeleted(folderSlug);
  if (!folder?.deletedAt || await countPhotosInFolder(folderSlug)) return;
  await database().collection(COLLECTIONS.folders).doc(folder.id).remove();
}

export async function listPhotoPage(options: {
  folderSlug?: string;
  excludedFolderSlugs?: string[];
  offset?: number;
  limit?: number;
} = {}): Promise<AlbumPhotoPage> {
  return queryPhotoPage(
    activePhotoFilter(options.folderSlug, options.excludedFolderSlugs),
    "createdAt",
    options.offset || 0,
    options.limit || 48,
  );
}

export async function listRecycledPhotoPage(options: {
  excludedFolderSlugs?: string[];
  offset?: number;
  limit?: number;
} = {}): Promise<AlbumPhotoPage> {
  return queryPhotoPage(
    recycledPhotoFilter(options.excludedFolderSlugs),
    "deletedAt",
    options.offset || 0,
    options.limit || 48,
  );
}

export async function countActivePhotosByFolder(): Promise<Record<string, number>> {
  const cloudDatabase = database();
  const aggregate = cloudDatabase.command.aggregate;
  const result = await cloudDatabase
    .collection(COLLECTIONS.photos)
    .aggregate()
    .match(activePhotoFilter())
    .group({ _id: "$folderSlug", total: aggregate.sum(1) })
    .end();
  const counts: Record<string, number> = {};
  for (const item of (result.data || []) as Array<{ _id?: unknown; total?: unknown }>) {
    if (typeof item._id === "string" && item._id) counts[item._id] = Math.max(0, Number(item.total) || 0);
  }
  return counts;
}

export async function countRecycledPhotos(excludedFolderSlugs: string[] = []): Promise<number> {
  const result = await database().collection(COLLECTIONS.photos).where(recycledPhotoFilter(excludedFolderSlugs)).count();
  return Math.max(0, Number(result.total) || 0);
}

export async function createPhotoRecord(photo: AlbumPhoto): Promise<void> {
  await database().collection(COLLECTIONS.photos).doc(photo.id).set(photo);
}

export async function findPhoto(id: string): Promise<AlbumPhoto | null> {
  const result = await database().collection(COLLECTIONS.photos).doc(id).get();
  return rows<AlbumPhoto>(result)[0] || null;
}

function operationFields(action: NonNullable<AlbumPhoto["lastAction"]>, actorName: string, at = new Date().toISOString()) {
  return { lastAction: action, lastActionBy: actorName.slice(0, 120), lastActionAt: at };
}

export async function renamePhotoRecord(id: string, name: string, actorName: string): Promise<void> {
  await database().collection(COLLECTIONS.photos).doc(id).update({ name, ...operationFields("rename", actorName) });
}

export async function movePhotoRecord(id: string, folderSlug: string, actorName: string): Promise<void> {
  await database().collection(COLLECTIONS.photos).doc(id).update({ folderSlug, ...operationFields("move", actorName) });
}

export async function recyclePhotoRecord(id: string, deletedAt: string, purgeAt: string, actorName: string): Promise<void> {
  await database().collection(COLLECTIONS.photos).doc(id).update({
    deletedAt,
    purgeAt,
    ...operationFields("recycle", actorName, deletedAt),
  });
}

export async function recycleAllActivePhotosInFolder(
  folderSlug: string,
  deletedAt: string,
  purgeAt: string,
  actorName: string,
): Promise<number> {
  let recycledCount = 0;
  while (true) {
    const result = await database()
      .collection(COLLECTIONS.photos)
      .where(activePhotoFilter(folderSlug))
      .limit(100)
      .get();
    const photos = rows<AlbumPhoto>(result);
    if (!photos.length) return recycledCount;
    await Promise.all(photos.map((photo) => recyclePhotoRecord(photo.id, deletedAt, purgeAt, actorName)));
    recycledCount += photos.length;
  }
}

export async function restorePhotoRecord(id: string, actorName: string): Promise<void> {
  await database().collection(COLLECTIONS.photos).doc(id).update({
    deletedAt: "",
    purgeAt: "",
    ...operationFields("restore", actorName),
  });
}

export async function deletePhotoRecord(id: string): Promise<void> {
  await database().collection(COLLECTIONS.photos).doc(id).remove();
}

export async function updatePhotoCoverFileId(id: string, coverFileId: string): Promise<void> {
  await database().collection(COLLECTIONS.photos).doc(id).update({ coverFileId });
}

export async function getUploadTokenRecord(folderSlug: string): Promise<UploadTokenRecord | null> {
  const result = await database().collection(COLLECTIONS.uploadTokens).doc(folderSlug).get();
  return rows<UploadTokenRecord>(result)[0] || null;
}

export async function setUploadTokenRecord(record: UploadTokenRecord): Promise<void> {
  await database().collection(COLLECTIONS.uploadTokens).doc(record.folderSlug).set(record);
}

export async function findUser(id: string): Promise<AlbumUser | null> {
  const result = await database().collection(COLLECTIONS.users).doc(id).get();
  return rows<AlbumUser>(result)[0] || null;
}

export async function findUserByAccountLabel(accountLabel: string): Promise<AlbumUser | null> {
  const result = await database().collection(COLLECTIONS.users).where({ accountLabel }).limit(1).get();
  return rows<AlbumUser>(result)[0] || null;
}

export async function saveUser(user: AlbumUser): Promise<void> {
  await database().collection(COLLECTIONS.users).doc(user.id).set(user);
}

export async function updateUserAccess(
  id: string,
  changes: Partial<Pick<AlbumUser, "role" | "permissions" | "status" | "title" | "updatedAt">>,
): Promise<void> {
  await database().collection(COLLECTIONS.users).doc(id).update(changes);
}

export async function listUsers(): Promise<AlbumUser[]> {
  const result = await database().collection(COLLECTIONS.users).orderBy("lastLoginAt", "desc").limit(200).get();
  return rows<AlbumUser>(result);
}

export async function createAuditLog(record: AlbumAuditLog): Promise<void> {
  await database().collection(COLLECTIONS.auditLogs).doc(record.id).set(record);
}

export async function listAuditLogs(limit = 200): Promise<AlbumAuditLog[]> {
  const safeLimit = Math.max(1, Math.min(300, Math.floor(limit)));
  const result = await database().collection(COLLECTIONS.auditLogs).orderBy("createdAt", "desc").limit(safeLimit).get();
  return rows<AlbumAuditLog>(result);
}

export function createObjectKey(folderSlug: string, filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  const extension = dotIndex > 0 ? filename.slice(dotIndex).toLowerCase() : "";
  const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const normalized = stem
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const nonce = crypto.randomUUID().slice(0, 8);
  return `albums/${folderSlug}/${stamp}-${nonce}-${normalized || "media"}${extension.replace(/[^a-z0-9.]/g, "")}`;
}

export async function uploadPhoto(objectKey: string, contents: Buffer): Promise<{ fileId: string; url: string }> {
  const cloudbase = getCloudBase();
  const uploaded = await cloudbase.uploadFile({ cloudPath: objectKey, fileContent: contents });
  if (!uploaded.fileID) throw new Error("腾讯云存储没有返回文件标识");
  const [resolved] = await resolvePhotoUrls([uploaded.fileID]);
  return { fileId: uploaded.fileID, url: resolved || uploaded.fileID };
}

export async function createDirectUpload(objectKey: string, mimeType: string) {
  const result = await getCloudBase().getUploadMetadata({ cloudPath: objectKey });
  const { url, token, authorization, fileId, cosFileId } = result.data;
  if (!url || !token || !authorization || !fileId || !cosFileId) {
    throw new Error("腾讯云存储没有返回完整的上传凭证");
  }
  return {
    url,
    fileId,
    headers: {
      Signature: authorization,
      authorization,
      "x-cos-security-token": token,
      "x-cos-meta-fileid": cosFileId,
      "Content-Type": mimeType,
      key: encodeURIComponent(objectKey),
    },
  };
}

export async function confirmUploadedFile(fileId: string, expectedSize: number): Promise<void> {
  const result = await getCloudBase().getFileInfo({ fileList: [{ fileID: fileId, maxAge: 60 }] });
  const info = result.fileList[0];
  if (!info || info.code !== "SUCCESS") throw new Error("腾讯云存储尚未确认上传文件");
  if (typeof info.size === "number" && info.size !== expectedSize) {
    throw new Error("上传文件大小校验失败");
  }
}

export async function deletePhotoFiles(fileIds: string[]): Promise<void> {
  const uniqueFileIds = [...new Set(fileIds.filter(Boolean))];
  for (let index = 0; index < uniqueFileIds.length; index += 50) {
    const result = await getCloudBase().deleteFile({ fileList: uniqueFileIds.slice(index, index + 50) });
    const failure = result.fileList?.find((item) => item.code !== "SUCCESS" && item.code !== "STORAGE_FILE_NONEXIST");
    if (failure) throw new Error(`腾讯云存储删除失败：${failure.code}`);
  }
}

export async function deletePhotoFile(fileId: string): Promise<void> {
  await deletePhotoFiles([fileId]);
}

export function mediaFileIds(photos: AlbumPhoto[]): string[] {
  return photos.flatMap((photo) => [photo.fileId, photo.coverFileId || ""]).filter(Boolean);
}

export async function purgeExpiredPhotos(now = Date.now()): Promise<number> {
  const cloudDatabase = database();
  const command = cloudDatabase.command;
  const result = await cloudDatabase
    .collection(COLLECTIONS.photos)
    .where({
      purgeAt: command.exists(true).and(command.neq("")).and(command.lte(new Date(now).toISOString())),
    })
    .orderBy("purgeAt", "asc")
    .limit(50)
    .get();
  const expired = rows<AlbumPhoto>(result);
  if (!expired.length) return 0;
  await deletePhotoFiles(mediaFileIds(expired));
  await Promise.all(expired.map((photo) => deletePhotoRecord(photo.id)));
  await Promise.all([...new Set(expired.map((photo) => photo.folderSlug))].map(removeDeletedFolderIfEmpty));
  return expired.length;
}

export async function resolvePhotoUrls(fileIds: string[], maxAge = 600): Promise<string[]> {
  if (!fileIds.length) return [];
  const cloudbase = getCloudBase();
  const urls = new Map<string, string>();
  for (let index = 0; index < fileIds.length; index += 50) {
    const batch = fileIds.slice(index, index + 50);
    const result = await cloudbase.getTempFileURL({
      fileList: batch.map((fileID) => ({ fileID, maxAge })),
    });
    for (const item of result.fileList || []) {
      if (item.fileID && item.tempFileURL) urls.set(item.fileID, item.tempFileURL);
    }
  }
  return fileIds.map((fileId) => urls.get(fileId) || fileId);
}
