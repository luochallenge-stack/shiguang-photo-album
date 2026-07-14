import { canDeleteMedia, canUserReadFolder } from "../../../../lib/access";
import { recordAudit } from "../../../../lib/audit";
import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";
import { findFolder, findFolderIncludingDeleted, findPhoto, resolvePhotoUrls } from "../../../../lib/cloudbase";
import { orientedImageUrl } from "../../../../lib/image-url";
import { isVideoMimeType } from "../../../../lib/media";

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!id) return Response.json({ error: "缺少文件标识" }, { status: 400 });

    const photo = await findPhoto(id);
    if (!photo) return Response.json({ error: "文件不存在" }, { status: 404 });
    const folder = photo.deletedAt
      ? await findFolderIncludingDeleted(photo.folderSlug)
      : await findFolder(photo.folderSlug);
    if (!folder || !canUserReadFolder(folder, user)) {
      return Response.json({ error: "文件不存在" }, { status: 404 });
    }
    if (photo.deletedAt && !canDeleteMedia(user)) return forbidden();

    const video = isVideoMimeType(photo.mimeType);
    const [url] = await resolvePhotoUrls([photo.fileId], video ? 2 * 60 * 60 : 10 * 60);
    await recordAudit(request, user, {
      action: video ? "video.play" : "image.preview",
      resourceType: video ? "video" : "image",
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { folderSlug: photo.folderSlug },
    });
    const resolvedUrl = url || photo.url;
    return Response.json({
      url: resolvedUrl,
      displayUrl: video ? resolvedUrl : orientedImageUrl(resolvedUrl),
      mimeType: photo.mimeType,
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取文件链接失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
