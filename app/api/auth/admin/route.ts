import { createBootstrapAdmin, createSessionCookie, publicUser } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { key?: unknown };
    const key = typeof body.key === "string" ? body.key.trim() : "";
    const user = await createBootstrapAdmin(key);
    if (!user) return Response.json({ error: "管理口令错误" }, { status: 401 });
    await recordAudit(request, user, {
      action: "auth.login",
      resourceType: "user",
      resourceId: user.id,
      resourceName: user.displayName,
      metadata: { provider: "admin" },
    });
    return Response.json({ user: publicUser(user) }, {
      headers: { "set-cookie": await createSessionCookie(request, user.id) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "管理员登录失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
