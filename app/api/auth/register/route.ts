import {
  createSessionCookie,
  createSessionToken,
  isMiniProgramRequest,
  publicUser,
  registerLocalUser,
} from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown; displayName?: unknown };
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = typeof body.displayName === "string" ? body.displayName : "";
    const user = await registerLocalUser(username, password, displayName);
    const sessionToken = await createSessionToken(user.id);
    await recordAudit(request, user, {
      action: "auth.register",
      resourceType: "user",
      resourceId: user.id,
      resourceName: user.displayName,
    });
    return Response.json({
      user: publicUser(user),
      ...(isMiniProgramRequest(request) ? { sessionToken } : {}),
    }, {
      status: 201,
      headers: { "set-cookie": await createSessionCookie(request, user.id, sessionToken) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "注册失败";
    const status = message.includes("已经被注册") ? 409 : 400;
    return Response.json({ error: message }, { status });
  }
}
