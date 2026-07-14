import { currentUser, unauthenticated } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";
import { canUserReadFolder } from "../../../lib/access";
import { findFolder, findPhoto } from "../../../lib/cloudbase";

const ALLOWED_ACTIONS = new Set(["media.view", "media.download", "media.share"]);

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
    const resourceId = typeof body.resourceId === "string" ? body.resourceId.trim() : "";
    const photo = resourceId ? await findPhoto(resourceId) : null;
    const folder = photo ? await findFolder(photo.folderSlug) : null;
    if (!photo || !folder || !canUserReadFolder(folder, user)) {
      return Response.json({ error: "文件不存在" }, { status: 404 });
    }
    await recordAudit(request, user, {
      action,
      resourceType: "media",
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { folderSlug: photo.folderSlug },
    });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "记录访问日志失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
