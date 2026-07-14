import { canDeleteMedia, canUserReadFolder } from "../../../../lib/access";
import { recordAudit } from "../../../../lib/audit";
import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";
import { findFolder, findFolderIncludingDeleted, findPhoto, resolvePhotoUrls, type AlbumPhoto } from "../../../../lib/cloudbase";
import { createHlsPlaybackToken, verifyHlsPlaybackToken } from "../../../../lib/hls-token";
import { isVideoMimeType } from "../../../../lib/media";

export const runtime = "nodejs";

const HLS_TTL_MS = 2 * 60 * 60 * 1000;

async function accessError(request: Request, photo: AlbumPhoto, token: string): Promise<Response | null> {
  if (token && verifyHlsPlaybackToken(token, photo.id)) return null;
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  const folder = photo.deletedAt
    ? await findFolderIncludingDeleted(photo.folderSlug)
    : await findFolder(photo.folderSlug);
  if (!folder || !canUserReadFolder(folder, user)) return Response.json({ error: "视频不存在" }, { status: 404 });
  if (photo.deletedAt && !canDeleteMedia(user)) return forbidden();
  return null;
}

function hlsHeaders() {
  return {
    "content-type": "application/vnd.apple.mpegurl; charset=utf-8",
    "cache-control": "no-store",
  };
}

function playlistUrl(request: Request, photoId: string, rendition: string, token: string): string {
  const url = new URL(request.url);
  url.search = "";
  url.searchParams.set("id", photoId);
  url.searchParams.set("rendition", rendition);
  url.searchParams.set("token", token || createHlsPlaybackToken(photoId, HLS_TTL_MS));
  return url.toString();
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const id = requestUrl.searchParams.get("id")?.trim() || "";
    const renditionName = requestUrl.searchParams.get("rendition")?.trim() || "";
    const token = requestUrl.searchParams.get("token")?.trim() || "";
    if (!id) return Response.json({ error: "缺少视频标识" }, { status: 400 });

    const photo = await findPhoto(id);
    if (!photo || !isVideoMimeType(photo.mimeType) || photo.deletedAt || photo.hlsStatus !== "ready" || !photo.hlsRenditions?.length) {
      return Response.json({ error: "HLS 视频尚未就绪" }, { status: 404 });
    }
    const blocked = await accessError(request, photo, token);
    if (blocked) return blocked;

    if (!renditionName) {
      const playbackToken = token || createHlsPlaybackToken(photo.id, HLS_TTL_MS);
      const body = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        ...photo.hlsRenditions.flatMap((rendition) => [
          `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bandwidth},RESOLUTION=${rendition.width}x${rendition.height},NAME="${rendition.label}"`,
          playlistUrl(request, photo.id, rendition.name, playbackToken),
        ]),
        "",
      ].join("\n");
      if (!token) {
        const user = await currentUser(request);
        if (user) {
          await recordAudit(request, user, {
            action: "video.hls.play",
            resourceType: "video",
            resourceId: photo.id,
            resourceName: photo.name,
            metadata: { folderSlug: photo.folderSlug, renditions: photo.hlsRenditions.length },
          });
        }
      }
      return new Response(body, { headers: hlsHeaders() });
    }

    const rendition = photo.hlsRenditions.find((item) => item.name === renditionName);
    if (!rendition) return Response.json({ error: "清晰度不存在" }, { status: 404 });
    const segmentUrls = await resolvePhotoUrls(rendition.segments.map((segment) => segment.fileId), HLS_TTL_MS / 1000);
    const urlByName = new Map(rendition.segments.map((segment, index) => [segment.name, segmentUrls[index] || ""]));
    const body = rendition.playlist
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        return urlByName.get(trimmed) || line;
      })
      .join("\n");
    return new Response(body, { headers: hlsHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取 HLS 视频失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
