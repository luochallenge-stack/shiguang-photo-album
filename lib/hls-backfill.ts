import { recordAudit } from "./audit";
import { listActiveVideosForHlsBackfill, type AlbumUser } from "./cloudbase";
import { startPhotoHlsTranscode } from "./hls-transcode-job";

export function safeHlsBackfillLimit(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, 5) : 2;
}

export async function listHlsBackfillCandidates(limit: number) {
  const videos = await listActiveVideosForHlsBackfill(limit, true);
  return {
    pendingCount: videos.length,
    videos: videos.map((video) => ({
      id: video.id,
      name: video.name,
      folderSlug: video.folderSlug,
      hlsStatus: video.hlsStatus || "",
      hlsError: video.hlsError || "",
    })),
  };
}

export async function runHlsBackfill(
  request: Request,
  user: AlbumUser,
  options: { limit: number; includeFailed: boolean },
) {
  const videos = await listActiveVideosForHlsBackfill(options.limit, options.includeFailed);
  for (const video of videos) startPhotoHlsTranscode(video.id);
  await recordAudit(request, user, {
    action: "video.hls.backfill",
    resourceType: "video",
    resourceId: "",
    resourceName: "历史视频 HLS 补跑",
    metadata: { startedCount: videos.length, limit: options.limit, includeFailed: options.includeFailed },
  });
  return {
    ok: true,
    startedCount: videos.length,
    videos: videos.map((video) => ({
      id: video.id,
      name: video.name,
      folderSlug: video.folderSlug,
      hlsStatus: video.hlsStatus || "",
    })),
  };
}
