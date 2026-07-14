import {
  countPhotosInFolder,
  createFolderRecord,
  deleteFolderRecord,
  findFolder,
  listUsers,
  updateFolderVisibility,
  type FolderVisibilityType,
} from "../../../lib/cloudbase";
import { folderSlug, normalizeFolderName } from "../../../lib/validation";
import { canManageFolders, canManageFolderVisibility, canUserReadFolder, folderVisibilityType } from "../../../lib/access";
import { currentUser, forbidden, unauthenticated } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";

function visibilityType(value: unknown): FolderVisibilityType | null {
  return value === "all" || value === "admins" || value === "specific" ? value : null;
}

function userIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter(Boolean))]
    .slice(0, 201);
}

async function validatedVisibleUserIds(
  type: FolderVisibilityType,
  value: unknown,
  creatorUserId: string,
): Promise<string[] | Response> {
  if (type !== "specific") return [];
  const ids = userIds(value);
  if (!ids.length || ids.length > 200) {
    return Response.json({ error: "请至少选择一位可见用户" }, { status: 400 });
  }
  const activeIds = new Set((await listUsers()).filter((user) => user.status === "active").map((user) => user.id));
  if (creatorUserId && activeIds.has(creatorUserId) && !ids.includes(creatorUserId)) {
    return Response.json({ error: "指定用户范围必须包含文件夹创建者" }, { status: 400 });
  }
  if (ids.some((id) => !activeIds.has(id))) {
    return Response.json({ error: "可见用户列表包含无效或已停用账号" }, { status: 400 });
  }
  return ids;
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!canManageFolders(user)) return forbidden();
  try {
    const payload = (await request.json()) as {
      name?: string;
      visibilityType?: unknown;
      visibleUserIds?: unknown;
    };
    const name = normalizeFolderName(payload.name || "");
    if (!name) {
      return Response.json({ error: "请输入文件夹名称" }, { status: 400 });
    }
    const visibleType = visibilityType(payload.visibilityType);
    if (!visibleType) return Response.json({ error: "请选择文件夹可见范围" }, { status: 400 });
    const selectedUserIds = await validatedVisibleUserIds(visibleType, payload.visibleUserIds, user.id);
    if (selectedUserIds instanceof Response) return selectedUserIds;

    const folder = {
      id: crypto.randomUUID(),
      name,
      slug: folderSlug(name),
      creatorUserId: user.id,
      visibilityType: visibleType,
      visibleUserIds: selectedUserIds,
    };
    const created = { ...folder, createdAt: new Date().toISOString() };
    await createFolderRecord(created);
    await recordAudit(request, user, {
      action: "folder.create",
      resourceType: "folder",
      resourceId: created.id,
      resourceName: created.name,
      metadata: { folderSlug: created.slug, visibilityType: visibleType },
    });
    return Response.json({
      folder: { ...created, photoCount: 0, canManageVisibility: true },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建文件夹失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  try {
    const payload = (await request.json()) as {
      folderSlug?: unknown;
      visibilityType?: unknown;
      visibleUserIds?: unknown;
    };
    const slug = typeof payload.folderSlug === "string" ? payload.folderSlug.trim() : "";
    if (!slug) return Response.json({ error: "缺少文件夹标识" }, { status: 400 });
    const visibleType = visibilityType(payload.visibilityType);
    if (!visibleType) return Response.json({ error: "请选择文件夹可见范围" }, { status: 400 });
    const folder = await findFolder(slug);
    if (!folder) return Response.json({ error: "文件夹不存在" }, { status: 404 });
    if (!canManageFolderVisibility(folder, user)) return forbidden();
    const selectedUserIds = await validatedVisibleUserIds(
      visibleType,
      payload.visibleUserIds,
      folder.creatorUserId || "",
    );
    if (selectedUserIds instanceof Response) return selectedUserIds;
    const previousVisibilityType = folderVisibilityType(folder);
    await updateFolderVisibility(folder.id, visibleType, selectedUserIds);
    await recordAudit(request, user, {
      action: "folder.visibility.update",
      resourceType: "folder",
      resourceId: folder.id,
      resourceName: folder.name,
      metadata: {
        folderSlug: folder.slug,
        previousVisibilityType,
        visibilityType: visibleType,
        visibleUserCount: selectedUserIds.length,
      },
    });
    return Response.json({ ok: true, visibilityType: visibleType, visibleUserIds: selectedUserIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "设置文件夹可见范围失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!canManageFolders(user)) return forbidden();
  try {
    const slug = new URL(request.url).searchParams.get("folder")?.trim() || "";
    if (!slug) return Response.json({ error: "缺少文件夹标识" }, { status: 400 });
    const folder = await findFolder(slug);
    if (!folder || !canUserReadFolder(folder, user)) {
      return Response.json({ error: "文件夹不存在" }, { status: 404 });
    }
    const photoCount = await countPhotosInFolder(folder.slug);
    if (photoCount > 0) {
      return Response.json({
        error: `文件夹中仍有 ${photoCount} 项影像（包含回收站），请先移动或永久删除后再删除文件夹`,
      }, { status: 409 });
    }
    await deleteFolderRecord(folder.id, folder.slug);
    await recordAudit(request, user, {
      action: "folder.delete",
      resourceType: "folder",
      resourceId: folder.id,
      resourceName: folder.name,
      metadata: { folderSlug: folder.slug },
    });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除文件夹失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
