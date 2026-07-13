import { currentUser, forbidden, publicUser, unauthenticated } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import {
  findUser,
  listUsers,
  updateUserAccess,
  type AlbumUserRole,
  type AlbumUserStatus,
} from "../../../../lib/cloudbase";

export async function GET(request: Request) {
  const actor = await currentUser(request);
  if (!actor) return unauthenticated();
  if (actor.role !== "admin") return forbidden();
  const users = await listUsers();
  await recordAudit(request, actor, { action: "admin.users.view", resourceType: "user-list" });
  return Response.json({ users: users.map(publicUser) });
}

export async function PATCH(request: Request) {
  const actor = await currentUser(request);
  if (!actor) return unauthenticated();
  if (actor.role !== "admin") return forbidden();
  try {
    const body = (await request.json()) as { userId?: unknown; role?: unknown; status?: unknown };
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const role: AlbumUserRole | undefined = body.role === "admin" || body.role === "member" ? body.role : undefined;
    const status: AlbumUserStatus | undefined = body.status === "active" || body.status === "disabled" ? body.status : undefined;
    if (!userId || (!role && !status)) return Response.json({ error: "用户权限参数无效" }, { status: 400 });
    if (actor.id === userId && (role === "member" || status === "disabled")) {
      return Response.json({ error: "不能降级或停用当前登录的管理员" }, { status: 400 });
    }
    const target = await findUser(userId);
    if (!target) return Response.json({ error: "用户不存在" }, { status: 404 });
    await updateUserAccess(userId, { role, status, updatedAt: new Date().toISOString() });
    const updated = await findUser(userId);
    if (!updated) throw new Error("更新用户后无法读取记录");
    await recordAudit(request, actor, {
      action: "user.access.update",
      resourceType: "user",
      resourceId: target.id,
      resourceName: target.displayName,
      metadata: {
        previousRole: target.role,
        previousStatus: target.status,
        role: updated.role,
        status: updated.status,
      },
    });
    return Response.json({ user: publicUser(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新用户权限失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
