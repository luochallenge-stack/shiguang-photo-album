import { isSuperAdmin } from "../../../../../lib/access";
import { currentUser, forbidden, unauthenticated } from "../../../../../lib/auth";
import { listHlsBackfillCandidates, runHlsBackfill, safeHlsBackfillLimit } from "../../../../../lib/hls-backfill";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!isSuperAdmin(user)) return forbidden();
  try {
    const body = (await request.json().catch(() => ({}))) as { limit?: unknown; includeFailed?: unknown };
    const limit = safeHlsBackfillLimit(body.limit);
    const includeFailed = body.includeFailed === true;
    return Response.json(await runHlsBackfill(request, user, { limit, includeFailed }));
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
  const limit = safeHlsBackfillLimit(params.get("limit"));
  if (params.get("run") === "1") {
    try {
      return Response.json(await runHlsBackfill(request, user, { limit, includeFailed: params.get("includeFailed") === "1" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "启动 HLS 补跑失败";
      return Response.json({ error: message }, { status: 500 });
    }
  }
  return Response.json(await listHlsBackfillCandidates(limit));
}
