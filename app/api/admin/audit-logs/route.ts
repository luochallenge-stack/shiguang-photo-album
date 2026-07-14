import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { listAuditLogs } from "../../../../lib/cloudbase";
import { isSuperAdmin } from "../../../../lib/access";

export async function GET(request: Request) {
  const actor = await currentUser(request);
  if (!actor) return unauthenticated();
  if (!isSuperAdmin(actor)) return forbidden();
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") || 200);
  const logs = await listAuditLogs(requestedLimit);
  await recordAudit(request, actor, { action: "admin.logs.view", resourceType: "audit-log" });
  return Response.json({ logs });
}
