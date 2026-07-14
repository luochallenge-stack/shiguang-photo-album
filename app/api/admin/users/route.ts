import { currentUser, forbidden, publicUser, unauthenticated } from "../../../../lib/auth";
import {
  canAssignUserTitles,
  effectiveUserPermissions,
  isSuperAdmin,
} from "../../../../lib/access";
import { recordAudit } from "../../../../lib/audit";
import {
  findUser,
  listUsers,
  updateUserAccess,
  type AlbumUser,
  type AlbumUserPermissions,
  type AlbumUserStatus,
} from "../../../../lib/cloudbase";

const PERMISSION_KEYS: Array<keyof AlbumUserPermissions> = [
  "read",
  "upload",
  "edit",
  "delete",
  "manageFolders",
  "assignTitles",
];

function parsedPermissions(value: unknown): AlbumUserPermissions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (PERMISSION_KEYS.some((key) => typeof record[key] !== "boolean")) return null;
  return Object.fromEntries(PERMISSION_KEYS.map((key) => [key, record[key]])) as AlbumUserPermissions;
}

function visibleUser(user: AlbumUser, actor: AlbumUser) {
  const result = publicUser(user);
  if (isSuperAdmin(actor)) return result;
  return {
    id: result.id,
    accountLabel: result.accountLabel,
    displayName: result.displayName,
    title: result.title,
    avatarUrl: result.avatarUrl,
  };
}

export async function GET(request: Request) {
  const actor = await currentUser(request);
  if (!actor) return unauthenticated();
  if (!isSuperAdmin(actor) && !canAssignUserTitles(actor)) return forbidden();
  const users = await listUsers();
  await recordAudit(request, actor, { action: "admin.users.view", resourceType: "user-list" });
  return Response.json({ users: users.map((user) => visibleUser(user, actor)) });
}

export async function PATCH(request: Request) {
  const actor = await currentUser(request);
  if (!actor) return unauthenticated();
  try {
    const body = (await request.json()) as {
      userId?: unknown;
      permissions?: unknown;
      status?: unknown;
      title?: unknown;
    };
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const hasPermissions = Object.prototype.hasOwnProperty.call(body, "permissions");
    const permissions = hasPermissions ? parsedPermissions(body.permissions) : undefined;
    const status: AlbumUserStatus | undefined = body.status === "active" || body.status === "disabled" ? body.status : undefined;
    const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
    if (hasPermissions && !permissions) return Response.json({ error: "权限开关参数无效" }, { status: 400 });
    if ((hasPermissions || status) && !isSuperAdmin(actor)) {
      return Response.json({ error: "只有阿里山清茶可以管理人员权限" }, { status: 403 });
    }
    if (hasTitle && typeof body.title !== "string") return Response.json({ error: "称号格式无效" }, { status: 400 });
    if (hasTitle && !canAssignUserTitles(actor)) {
      return Response.json({ error: "当前账号没有赋予称号权限" }, { status: 403 });
    }
    const title = hasTitle ? (body.title as string).trim() : undefined;
    if (title && Array.from(title).length > 20) return Response.json({ error: "称号不能超过 20 个字符" }, { status: 400 });
    if (!userId || (!hasPermissions && !status && !hasTitle)) {
      return Response.json({ error: "用户权限参数无效" }, { status: 400 });
    }
    const target = await findUser(userId);
    if (!target) return Response.json({ error: "用户不存在" }, { status: 404 });
    if (isSuperAdmin(target) && (hasPermissions || status)) {
      return Response.json({ error: "阿里山清茶是超级管理员，始终拥有全部权限" }, { status: 400 });
    }
    await updateUserAccess(userId, {
      ...(permissions ? { permissions } : {}),
      ...(status ? { status } : {}),
      ...(hasTitle ? { title: title || "" } : {}),
      updatedAt: new Date().toISOString(),
    });
    const updated = await findUser(userId);
    if (!updated) throw new Error("更新用户后无法读取记录");
    await recordAudit(request, actor, {
      action: "user.access.update",
      resourceType: "user",
      resourceId: target.id,
      resourceName: target.displayName,
      metadata: {
        previousStatus: target.status,
        previousTitle: target.title || "",
        previousPermissions: JSON.stringify(effectiveUserPermissions(target)),
        status: updated.status,
        title: updated.title || "",
        permissions: JSON.stringify(effectiveUserPermissions(updated)),
      },
    });
    return Response.json({ user: visibleUser(updated, actor) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新用户权限失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
