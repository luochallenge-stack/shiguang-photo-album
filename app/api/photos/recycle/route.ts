import {
  deletePhotoFiles,
  deletePhotoRecord,
  findFolder,
  findPhoto,
  mediaFileIds,
  restorePhotoRecord,
  type AlbumPhoto,
} from "../../../../lib/cloudbase";
import { recordAudit } from "../../../../lib/audit";
import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";

const MAX_BATCH_SIZE = 100;

function photoIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter(Boolean))]
    .slice(0, MAX_BATCH_SIZE + 1);
}

async function recycledPhotos(ids: string[]): Promise<AlbumPhoto[] | null> {
  const photos = await Promise.all(ids.map((id) => findPhoto(id)));
  if (photos.some((photo) => !photo || !photo.deletedAt)) return null;
  return photos as AlbumPhoto[];
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
  if (user.role !== "admin") return forbidden();
  try {
    const body = (await request.json()) as { ids?: unknown };
    const ids = photoIds(body.ids);
    const invalid = validateIds(ids);
    if (invalid) return invalid;
    const photos = await recycledPhotos(ids);
    if (!photos) return Response.json({ error: "部分影像不在回收站，请刷新后重试" }, { status: 404 });
    const folders = await Promise.all([...new Set(photos.map((photo) => photo.folderSlug))].map((slug) => findFolder(slug)));
    if (folders.some((folder) => !folder)) return Response.json({ error: "原文件夹不存在，暂时无法恢复" }, { status: 409 });

    await Promise.all(photos.map((photo) => restorePhotoRecord(photo.id, user.displayName)));
    await Promise.all(photos.map((photo) => recordAudit(request, user, {
      action: "media.restore.batch",
      resourceType: "media",
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { folderSlug: photo.folderSlug },
    })));
    return Response.json({ ok: true, restoredIds: ids, restoredCount: photos.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量恢复影像失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (user.role !== "admin") return forbidden();
  try {
    const body = (await request.json()) as { ids?: unknown };
    const ids = photoIds(body.ids);
    const invalid = validateIds(ids);
    if (invalid) return invalid;
    const photos = await recycledPhotos(ids);
    if (!photos) return Response.json({ error: "部分影像不在回收站，请刷新后重试" }, { status: 404 });

    await deletePhotoFiles(mediaFileIds(photos));
    await Promise.all(photos.map((photo) => deletePhotoRecord(photo.id)));
    await Promise.all(photos.map((photo) => recordAudit(request, user, {
      action: "media.purge.batch",
      resourceType: "media",
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { folderSlug: photo.folderSlug, size: photo.size },
    })));
    return Response.json({ ok: true, purgedIds: ids, purgedCount: photos.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "永久删除影像失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
