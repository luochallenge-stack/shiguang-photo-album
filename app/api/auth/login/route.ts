import { authenticateLocalUser, createSessionCookie, publicUser } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = await authenticateLocalUser(username, password);
    await recordAudit(request, user, {
      action: "auth.login",
      resourceType: "user",
      resourceId: user.id,
      resourceName: user.displayName,
      metadata: { provider: "local" },
    });
    return Response.json({ user: publicUser(user) }, {
      headers: { "set-cookie": await createSessionCookie(request, user.id) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    const status = message.includes("停用") ? 403 : 401;
    return Response.json({ error: message }, { status });
  }
}
