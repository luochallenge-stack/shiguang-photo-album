import {
  findFolder,
  findPhoto,
  movePhotoRecord,
  recyclePhotoRecord,
  type AlbumPhoto,
  type AlbumUser,
} from "../../../../lib/cloudbase";
import { canDeleteMedia, canEditMedia, canUserReadFolder } from "../../../../lib/access";
import { recordAudit } from "../../../../lib/audit";
import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";

const MAX_BATCH_SIZE = 100;
const RECYCLE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function photoIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter(Boolean))]
    .slice(0, MAX_BATCH_SIZE + 1);
}

async function batchPhotos(ids: string[]): Promise<AlbumPhoto[] | null> {
  const photos = await Promise.all(ids.map((id) => findPhoto(id)));
  return photos.some((photo) => !photo) ? null : photos as AlbumPhoto[];
}

async function photosAreVisible(photos: AlbumPhoto[], user: AlbumUser): Promise<boolean> {
  const folders = await Promise.all(
    [...new Set(photos.map((photo) => photo.folderSlug))].map((slug) => findFolder(slug)),
  );
  return folders.every((folder) => Boolean(folder && canUserReadFolder(folder, user)));
}

function validateIds(ids: string[]): Response | null {
  if (!ids.length) return Response.json({ error: "请至少选择一项影像" }, { status: 400 });
  if (ids.length > MAX_BATCH_SIZE) {
    return Response.json({ error: `单次最多处理 ${MAX_BATCH_SIZE} 项影像` }, { status: 400 });
  }
  return null;
}

export async function PATCH(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!canEditMedia(user)) return forbidden();
  try {
    const body = (await request.json()) as { ids?: unknown; targetFolderSlug?: unknown };
    const ids = photoIds(body.ids);
    const invalid = validateIds(ids);
    if (invalid) return invalid;
    const targetFolderSlug = typeof body.targetFolderSlug === "string" ? body.targetFolderSlug.trim() : "";
    if (!targetFolderSlug) return Response.json({ error: "请选择目标文件夹" }, { status: 400 });
    const targetFolder = await findFolder(targetFolderSlug);
    if (!targetFolder || !canUserReadFolder(targetFolder, user)) {
      return Response.json({ error: "目标文件夹不存在" }, { status: 404 });
    }

    const photos = await batchPhotos(ids);
    if (!photos) return Response.json({ error: "部分影像不存在，请刷新后重试" }, { status: 404 });
    if (!(await photosAreVisible(photos, user))) {
      return Response.json({ error: "部分影像不存在，请刷新后重试" }, { status: 404 });
    }
    if (photos.some((photo) => photo.deletedAt)) {
      return Response.json({ error: "回收站中的影像不能直接移动" }, { status: 400 });
    }
    const movedPhotos = photos.filter((photo) => photo.folderSlug !== targetFolderSlug);
    await Promise.all(movedPhotos.map((photo) => movePhotoRecord(photo.id, targetFolderSlug, user.displayName)));
    await Promise.all(movedPhotos.map((photo) => recordAudit(request, user, {
      action: "media.move.batch",
      resourceType: "media",
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { sourceFolderSlug: photo.folderSlug, targetFolderSlug },
    })));
    return Response.json({
      ok: true,
      movedIds: movedPhotos.map((photo) => photo.id),
      movedCount: movedPhotos.length,
      skippedCount: photos.length - movedPhotos.length,
      targetFolderSlug,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量移动影像失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!canDeleteMedia(user)) return forbidden();
  try {
    const body = (await request.json()) as { ids?: unknown };
    const ids = photoIds(body.ids);
    const invalid = validateIds(ids);
    if (invalid) return invalid;

    const photos = await batchPhotos(ids);
    if (!photos) return Response.json({ error: "部分影像不存在，请刷新后重试" }, { status: 404 });
    if (!(await photosAreVisible(photos, user))) {
      return Response.json({ error: "部分影像不存在，请刷新后重试" }, { status: 404 });
    }
    if (photos.some((photo) => photo.deletedAt)) {
      return Response.json({ error: "部分影像已经位于回收站" }, { status: 400 });
    }
    const deletedAt = new Date().toISOString();
    const purgeAt = new Date(Date.now() + RECYCLE_RETENTION_MS).toISOString();
    await Promise.all(photos.map((photo) => recyclePhotoRecord(photo.id, deletedAt, purgeAt, user.displayName)));
    await Promise.all(photos.map((photo) => recordAudit(request, user, {
      action: "media.recycle.batch",
      resourceType: "media",
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { folderSlug: photo.folderSlug, size: photo.size, purgeAt },
    })));
    return Response.json({ ok: true, recycledIds: ids, recycledCount: photos.length, purgeAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量移入回收站失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
