import { currentUser, unauthenticated } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";

const ALLOWED_ACTIONS = new Set(["media.view", "media.download"]);

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  try {
    const body = (await request.json()) as {
      action?: unknown;
      resourceId?: unknown;
      resourceName?: unknown;
      folderSlug?: unknown;
    };
    const action = typeof body.action === "string" ? body.action : "";
    if (!ALLOWED_ACTIONS.has(action)) return Response.json({ error: "无效的审计事件" }, { status: 400 });
    await recordAudit(request, user, {
      action,
      resourceType: "media",
      resourceId: typeof body.resourceId === "string" ? body.resourceId : "",
      resourceName: typeof body.resourceName === "string" ? body.resourceName : "",
      metadata: { folderSlug: typeof body.folderSlug === "string" ? body.folderSlug : "" },
    });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "记录访问日志失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
