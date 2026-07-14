import {
  createObjectKey,
  findFolder,
  findPhoto,
  resolvePhotoUrls,
  updatePhotoCoverFileId,
  uploadPhoto,
} from "../../../../../lib/cloudbase";
import { canUserReadFolder } from "../../../../../lib/access";
import { recordAudit } from "../../../../../lib/audit";
import { currentUser, forbidden, unauthenticated } from "../../../../../lib/auth";
import { isVideoMimeType } from "../../../../../lib/media";
import { extractVideoCoverFromUrl } from "../../../../../lib/video-cover";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (user.role !== "admin") return forbidden();
  try {
    const body = (await request.json()) as { photoId?: unknown };
    const photoId = typeof body.photoId === "string" ? body.photoId.trim() : "";
    if (!photoId) return Response.json({ error: "缺少视频标识" }, { status: 400 });

    const photo = await findPhoto(photoId);
    if (!photo || photo.deletedAt) return Response.json({ error: "视频不存在" }, { status: 404 });
    const folder = await findFolder(photo.folderSlug);
    if (!folder || !canUserReadFolder(folder, user)) {
      return Response.json({ error: "视频不存在" }, { status: 404 });
    }
    if (!isVideoMimeType(photo.mimeType)) return Response.json({ error: "只有视频可以生成封面" }, { status: 400 });
    if (photo.coverFileId) {
      const [coverUrl] = await resolvePhotoUrls([photo.coverFileId]);
      return Response.json({ ok: true, coverFileId: photo.coverFileId, coverUrl });
    }

    const [videoUrl] = await resolvePhotoUrls([photo.fileId], 15 * 60);
    if (!videoUrl) return Response.json({ error: "无法读取视频文件" }, { status: 404 });
    const cover = await extractVideoCoverFromUrl(videoUrl);
    const uploaded = await uploadPhoto(createObjectKey(photo.folderSlug, `${photo.id}-cover.jpg`), cover);
    await updatePhotoCoverFileId(photo.id, uploaded.fileId);
    await recordAudit(request, user, {
      action: "media.cover.generate",
      resourceType: "video",
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { folderSlug: photo.folderSlug, coverSize: cover.length },
    });
    return Response.json({ ok: true, coverFileId: uploaded.fileId, coverUrl: uploaded.url }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成视频封面失败";
    console.error("Failed to backfill video cover", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
