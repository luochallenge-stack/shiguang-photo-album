import { clearSessionCookie, currentUser, publicUser, unauthenticated } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  return Response.json({ user: publicUser(user) });
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (user) {
    await recordAudit(request, user, {
      action: "auth.logout",
      resourceType: "user",
      resourceId: user.id,
      resourceName: user.displayName,
    });
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionCookie(request) } });
}
