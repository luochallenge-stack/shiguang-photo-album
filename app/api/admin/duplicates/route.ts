import { isSuperAdmin } from "../../../../lib/access";
import { recordAudit } from "../../../../lib/audit";
import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";
import {
  findPhoto,
  listActivePhotosForDedup,
  listFolders,
  recyclePhotoRecord,
  resolvePhotoUrls,
  updatePhotoContentHash,
  type AlbumPhoto,
} from "../../../../lib/cloudbase";
import { normalizeContentHash, sha256Hex } from "../../../../lib/content-hash";

const RECYCLE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SCAN_PHOTOS = 1000;

type DuplicatePhotoSummary = Pick<AlbumPhoto, "id" | "folderSlug" | "name" | "size" | "createdAt" | "contentHash"> & {
  folderName: string;
};

type DuplicateGroup = {
  contentHash: string;
  keepPhotoId: string;
  duplicateIds: string[];
  duplicateCount: number;
  reclaimableBytes: number;
  photos: DuplicatePhotoSummary[];
};

function summarize(photo: AlbumPhoto, folderNames: Map<string, string>): DuplicatePhotoSummary {
  return {
    id: photo.id,
    folderSlug: photo.folderSlug,
    folderName: folderNames.get(photo.folderSlug) || photo.folderSlug,
    name: photo.name,
    size: photo.size,
    createdAt: photo.createdAt,
    contentHash: photo.contentHash,
  };
}

async function contentHashFor(photo: AlbumPhoto): Promise<string> {
  const currentHash = normalizeContentHash(photo.contentHash);
  if (currentHash) return currentHash;
  const [url] = await resolvePhotoUrls([photo.fileId], 10 * 60);
  const response = await fetch(url || photo.url);
  if (!response.ok) throw new Error(`读取图片失败 (${response.status})`);
  const hash = await sha256Hex(await response.arrayBuffer());
  await updatePhotoContentHash(photo.id, hash);
  return hash;
}

async function scanDuplicateGroups(): Promise<{ groups: DuplicateGroup[]; scannedCount: number; hashedCount: number }> {
  const [folders, photos] = await Promise.all([listFolders(), listActivePhotosForDedup(MAX_SCAN_PHOTOS)]);
  const folderNames = new Map(folders.map((folder) => [folder.slug, folder.name]));
  let hashedCount = 0;
  const hydrated: AlbumPhoto[] = [];
  for (const photo of photos) {
    try {
      const contentHash = await contentHashFor(photo);
      if (!photo.contentHash) hashedCount += 1;
      hydrated.push({ ...photo, contentHash });
    } catch (error) {
      console.error("Failed to hash image for dedupe", photo.id, error);
    }
  }
  const groupsByHash = new Map<string, AlbumPhoto[]>();
  for (const photo of hydrated) {
    const hash = normalizeContentHash(photo.contentHash);
    if (!hash) continue;
    groupsByHash.set(hash, [...(groupsByHash.get(hash) || []), photo]);
  }
  const groups = [...groupsByHash.entries()]
    .map(([contentHash, groupPhotos]) => {
      const photosInGroup = groupPhotos.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      const duplicates = photosInGroup.slice(1);
      return {
        contentHash,
        keepPhotoId: photosInGroup[0].id,
        duplicateIds: duplicates.map((photo) => photo.id),
        duplicateCount: duplicates.length,
        reclaimableBytes: duplicates.reduce((sum, photo) => sum + photo.size, 0),
        photos: photosInGroup.map((photo) => summarize(photo, folderNames)),
      };
    })
    .filter((group) => group.duplicateCount > 0)
    .sort((left, right) => right.reclaimableBytes - left.reclaimableBytes);
  return { groups, scannedCount: photos.length, hashedCount };
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!isSuperAdmin(user)) return forbidden();
  try {
    const result = await scanDuplicateGroups();
    await recordAudit(request, user, {
      action: "media.dedupe.scan",
      resourceType: "image",
      metadata: {
        scannedCount: result.scannedCount,
        duplicateGroupCount: result.groups.length,
        hashedCount: result.hashedCount,
      },
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "扫描重复图片失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!isSuperAdmin(user)) return forbidden();
  try {
    const body = (await request.json()) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim()))].slice(0, 200)
      : [];
    if (!ids.length) return Response.json({ error: "请选择要移入回收站的重复图片" }, { status: 400 });
    const photos = (await Promise.all(ids.map((id) => findPhoto(id))))
      .filter((photo): photo is AlbumPhoto => Boolean(photo && !photo.deletedAt && photo.mimeType.startsWith("image/")));
    const deletedAt = new Date().toISOString();
    const purgeAt = new Date(Date.now() + RECYCLE_RETENTION_MS).toISOString();
    await Promise.all(photos.map((photo) => recyclePhotoRecord(photo.id, deletedAt, purgeAt, user.displayName)));
    await recordAudit(request, user, {
      action: "media.dedupe.recycle",
      resourceType: "image",
      metadata: {
        requestedCount: ids.length,
        recycledCount: photos.length,
        reclaimableBytes: photos.reduce((sum, photo) => sum + photo.size, 0),
        purgeAt,
      },
    });
    return Response.json({ ok: true, recycledCount: photos.length, purgeAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "移入回收站失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
