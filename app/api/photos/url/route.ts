import { canDeleteMedia, canUserReadFolder } from "../../../../lib/access";
import { recordAudit } from "../../../../lib/audit";
import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";
import { findFolder, findFolderIncludingDeleted, findPhoto, resolvePhotoUrls } from "../../../../lib/cloudbase";
import { createHlsPlaybackToken } from "../../../../lib/hls-token";
import { orientedImageUrl } from "../../../../lib/image-url";
import { isDocumentMimeType, isVideoMimeType } from "../../../../lib/media";

const HLS_TTL_MS = 2 * 60 * 60 * 1000;

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
    const document = isDocumentMimeType(photo.mimeType);
    const [url] = await resolvePhotoUrls([photo.fileId], video ? 2 * 60 * 60 : 10 * 60);
    await recordAudit(request, user, {
      action: video ? "video.play" : document ? "document.open" : "image.preview",
      resourceType: video ? "video" : document ? "document" : "image",
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { folderSlug: photo.folderSlug },
    });
    const resolvedUrl = url || photo.url;
    const hlsUrl = video && photo.hlsStatus === "ready" && photo.hlsRenditions?.length
      ? `${new URL(request.url).origin}/api/photos/hls?id=${encodeURIComponent(photo.id)}&token=${encodeURIComponent(createHlsPlaybackToken(photo.id, HLS_TTL_MS))}`
      : "";
    return Response.json({
      url: resolvedUrl,
      hlsUrl,
      hlsStatus: video ? photo.hlsStatus || "" : "",
      displayUrl: video || document ? resolvedUrl : orientedImageUrl(resolvedUrl),
      mimeType: photo.mimeType,
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取文件链接失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
