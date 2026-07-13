import {
  authenticateLocalUser,
  createSessionCookie,
  createSessionToken,
  isMiniProgramRequest,
  publicUser,
} from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = await authenticateLocalUser(username, password);
    const sessionToken = await createSessionToken(user.id);
    await recordAudit(request, user, {
      action: "auth.login",
      resourceType: "user",
      resourceId: user.id,
      resourceName: user.displayName,
      metadata: { provider: "local" },
    });
    return Response.json({
      user: publicUser(user),
      ...(isMiniProgramRequest(request) ? { sessionToken } : {}),
    }, {
      headers: { "set-cookie": await createSessionCookie(request, user.id, sessionToken) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    const status = message.includes("停用") ? 403 : 401;
    return Response.json({ error: message }, { status });
  }
}
