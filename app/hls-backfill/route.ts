import { isSuperAdmin } from "../../lib/access";
import { currentUser, forbidden, unauthenticated } from "../../lib/auth";
import { listHlsBackfillCandidates, runHlsBackfill, safeHlsBackfillLimit } from "../../lib/hls-backfill";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!isSuperAdmin(user)) return forbidden();

  const params = new URL(request.url).searchParams;
  const limit = safeHlsBackfillLimit(params.get("limit"));
  try {
    const payload = params.get("run") === "1"
      ? await runHlsBackfill(request, user, { limit, includeFailed: params.get("includeFailed") === "1" })
      : await listHlsBackfillCandidates(limit);
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "HLS 补跑失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
