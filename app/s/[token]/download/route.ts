import { mediaDownloadUrl, resolveMediaShare } from "../../../../lib/media-share";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await resolveMediaShare(token);
  if (!shared) return new Response("分享链接已失效", { status: 410 });
  return new Response(null, {
    status: 307,
    headers: {
      location: mediaDownloadUrl(shared.originalUrl, shared.photo.name),
      "cache-control": "private, no-store",
    },
  });
}
