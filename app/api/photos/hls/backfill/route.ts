import { isSuperAdmin } from "../../../../../lib/access";
import { recordAudit } from "../../../../../lib/audit";
import { currentUser, forbidden, unauthenticated } from "../../../../../lib/auth";
import { listActiveVideosForHlsBackfill } from "../../../../../lib/cloudbase";
import { startPhotoHlsTranscode } from "../../../../../lib/hls-transcode-job";

export const runtime = "nodejs";

function safeLimit(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, 5) : 2;
}

async function runBackfill(request: Request, user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, options: { limit: number; includeFailed: boolean }) {
  const videos = await listActiveVideosForHlsBackfill(options.limit, options.includeFailed);
  for (const video of videos) startPhotoHlsTranscode(video.id);
  await recordAudit(request, user, {
    action: "video.hls.backfill",
    resourceType: "video",
    resourceId: "",
    resourceName: "历史视频 HLS 补跑",
    metadata: { startedCount: videos.length, limit: options.limit, includeFailed: options.includeFailed },
  });
  return Response.json({
    ok: true,
    startedCount: videos.length,
    videos: videos.map((video) => ({
      id: video.id,
      name: video.name,
      folderSlug: video.folderSlug,
      hlsStatus: video.hlsStatus || "",
    })),
  });
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!isSuperAdmin(user)) return forbidden();
  try {
    const body = (await request.json().catch(() => ({}))) as { limit?: unknown; includeFailed?: unknown };
    const limit = safeLimit(body.limit);
    const includeFailed = body.includeFailed === true;
    return runBackfill(request, user, { limit, includeFailed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "启动 HLS 补跑失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!isSuperAdmin(user)) return forbidden();
  const params = new URL(request.url).searchParams;
  const limit = safeLimit(params.get("limit"));
  if (params.get("run") === "1") {
    try {
      return runBackfill(request, user, { limit, includeFailed: params.get("includeFailed") === "1" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "启动 HLS 补跑失败";
      return Response.json({ error: message }, { status: 500 });
    }
  }
  const videos = await listActiveVideosForHlsBackfill(limit, true);
  return Response.json({
    pendingCount: videos.length,
    videos: videos.map((video) => ({
      id: video.id,
      name: video.name,
      folderSlug: video.folderSlug,
      hlsStatus: video.hlsStatus || "",
      hlsError: video.hlsError || "",
    })),
  });
}
