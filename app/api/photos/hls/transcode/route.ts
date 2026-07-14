import { canUploadMedia, canUserReadFolder } from "../../../../../lib/access";
import { recordAudit } from "../../../../../lib/audit";
import { currentUser, forbidden, unauthenticated } from "../../../../../lib/auth";
import { findFolder, findPhoto } from "../../../../../lib/cloudbase";
import { transcodePhotoToHls } from "../../../../../lib/hls-transcode-job";
import { isVideoMimeType } from "../../../../../lib/media";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!canUploadMedia(user)) return forbidden();
  try {
    const body = (await request.json()) as { photoId?: unknown };
    const photoId = typeof body.photoId === "string" ? body.photoId.trim() : "";
    if (!photoId) return Response.json({ error: "缺少视频标识" }, { status: 400 });

    const photo = await findPhoto(photoId);
    if (!photo || photo.deletedAt) return Response.json({ error: "视频不存在" }, { status: 404 });
    const folder = await findFolder(photo.folderSlug);
    if (!folder || !canUserReadFolder(folder, user)) return Response.json({ error: "视频不存在" }, { status: 404 });
    if (!isVideoMimeType(photo.mimeType)) return Response.json({ error: "只有视频可以转码 HLS" }, { status: 400 });

    const status = await transcodePhotoToHls(photo.id);
    await recordAudit(request, user, {
      action: "video.hls.transcode",
      resourceType: "video",
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { folderSlug: photo.folderSlug, status },
    });
    return Response.json({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HLS 转码失败";
    console.error("Failed to transcode HLS", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
