import cloudbaseSdk from "@cloudbase/node-sdk";

export type AlbumFolder = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
};

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
    const { _id: _ignored, ...value } = record as T & { _id?: string };
    return value as T;
  });
}

export async function listFolders(): Promise<AlbumFolder[]> {
  const result = await database().collection(COLLECTIONS.folders).orderBy("createdAt", "desc").limit(100).get();
  return rows<AlbumFolder>(result);
}

export async function findFolder(slug: string): Promise<AlbumFolder | null> {
  const result = await database().collection(COLLECTIONS.folders).where({ slug }).limit(1).get();
  return rows<AlbumFolder>(result)[0] || null;
}

export async function createFolderRecord(folder: AlbumFolder): Promise<void> {
  const existing = await findFolder(folder.slug);
  if (existing) throw new Error("已存在同名文件夹");
  await database().collection(COLLECTIONS.folders).doc(folder.id).set(folder);
}

export async function listPhotos(folderSlug?: string): Promise<AlbumPhoto[]> {
  const collection = database().collection(COLLECTIONS.photos);
  const query = folderSlug ? collection.where({ folderSlug }) : collection;
  const result = await query.orderBy("createdAt", "desc").limit(300).get();
  return rows<AlbumPhoto>(result);
}

export async function createPhotoRecord(photo: AlbumPhoto): Promise<void> {
  await database().collection(COLLECTIONS.photos).doc(photo.id).set(photo);
}

export async function getUploadTokenRecord(folderSlug: string): Promise<UploadTokenRecord | null> {
  const result = await database().collection(COLLECTIONS.uploadTokens).doc(folderSlug).get();
  return rows<UploadTokenRecord>(result)[0] || null;
}

export async function setUploadTokenRecord(record: UploadTokenRecord): Promise<void> {
  await database().collection(COLLECTIONS.uploadTokens).doc(record.folderSlug).set(record);
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
  return `albums/${folderSlug}/${stamp}-${nonce}-${normalized || "photo"}${extension.replace(/[^a-z0-9.]/g, "")}`;
}

export async function uploadPhoto(objectKey: string, contents: Buffer): Promise<{ fileId: string; url: string }> {
  const cloudbase = getCloudBase();
  const uploaded = await cloudbase.uploadFile({ cloudPath: objectKey, fileContent: contents });
  if (!uploaded.fileID) throw new Error("腾讯云存储没有返回文件标识");
  const [resolved] = await resolvePhotoUrls([uploaded.fileID]);
  return { fileId: uploaded.fileID, url: resolved || uploaded.fileID };
}

export async function resolvePhotoUrls(fileIds: string[]): Promise<string[]> {
  if (!fileIds.length) return [];
  const cloudbase = getCloudBase();
  const urls = new Map<string, string>();
  for (let index = 0; index < fileIds.length; index += 50) {
    const batch = fileIds.slice(index, index + 50);
    const result = await cloudbase.getTempFileURL({
      fileList: batch.map((fileID) => ({ fileID, maxAge: 7200 })),
    });
    for (const item of result.fileList || []) {
      if (item.fileID && item.tempFileURL) urls.set(item.fileID, item.tempFileURL);
    }
  }
  return fileIds.map((fileId) => urls.get(fileId) || fileId);
}
