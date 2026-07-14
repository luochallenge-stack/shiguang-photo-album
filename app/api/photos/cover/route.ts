import {
  createObjectKey,
  deletePhotoFile,
  findFolder,
  findPhoto,
  updatePhotoCoverFileId,
  uploadPhoto,
} from "../../../../lib/cloudbase";
import { canUploadMedia, canUserReadFolder } from "../../../../lib/access";
import { recordAudit } from "../../../../lib/audit";
import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";
import { isVideoMimeType, mediaInfo, mediaSizeError } from "../../../../lib/media";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!canUploadMedia(user)) return forbidden();
  try {
    const form = await request.formData();
    const file = form.get("file");
    const photoId = String(form.get("photoId") || "").trim();
    const requestedName = String(form.get("name") || "video-cover.jpg").trim().slice(0, 180);
    const media = file instanceof File ? mediaInfo(requestedName, file.type) : null;
    if (!(file instanceof File) || !photoId || !media || media.kind !== "image") {
      return Response.json({ error: "视频封面信息无效" }, { status: 400 });
    }
    const sizeError = mediaSizeError("image", file.size);
    if (sizeError) return Response.json({ error: sizeError }, { status: 413 });

    const photo = await findPhoto(photoId);
    if (!photo || photo.deletedAt) return Response.json({ error: "视频不存在" }, { status: 404 });
    const folder = await findFolder(photo.folderSlug);
    if (!folder || !canUserReadFolder(folder, user)) {
      return Response.json({ error: "视频不存在" }, { status: 404 });
    }
    if (!isVideoMimeType(photo.mimeType)) return Response.json({ error: "只有视频可以设置封面" }, { status: 400 });

    const objectKey = createObjectKey(photo.folderSlug, `${photo.id}-${requestedName}`);
    const uploaded = await uploadPhoto(objectKey, Buffer.from(await file.arrayBuffer()));
    await updatePhotoCoverFileId(photo.id, uploaded.fileId);
    if (photo.coverFileId && photo.coverFileId !== uploaded.fileId) {
      await deletePhotoFile(photo.coverFileId).catch((error) => console.error("Failed to delete previous cover", error));
    }
    await recordAudit(request, user, {
      action: "media.cover.set",
      resourceType: "video",
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { folderSlug: photo.folderSlug, coverSize: file.size },
    });
    return Response.json({ ok: true, coverFileId: uploaded.fileId, coverUrl: uploaded.url }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存视频封面失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
