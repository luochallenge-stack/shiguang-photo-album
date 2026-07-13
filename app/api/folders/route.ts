import { createFolderRecord, findFolder, updateFolderPasswordHash } from "../../../lib/cloudbase";
import { folderSlug, normalizeFolderName } from "../../../lib/validation";
import { hashFolderPassword } from "../../../lib/access";
import { currentUser, forbidden, unauthenticated } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (user.role !== "admin") return forbidden();
  try {
    const payload = (await request.json()) as { name?: string };
    const name = normalizeFolderName(payload.name || "");
    if (!name) {
      return Response.json({ error: "请输入文件夹名称" }, { status: 400 });
    }

    const folder = {
      id: crypto.randomUUID(),
      name,
      slug: folderSlug(name),
    };
    const created = { ...folder, createdAt: new Date().toISOString() };
    await createFolderRecord(created);
    await recordAudit(request, user, {
      action: "folder.create",
      resourceType: "folder",
      resourceId: created.id,
      resourceName: created.name,
      metadata: { folderSlug: created.slug },
    });
    return Response.json({ folder: { ...created, locked: false, photoCount: 0 } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建文件夹失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (user.role !== "admin") return forbidden();
  try {
    const payload = (await request.json()) as { folderSlug?: unknown; password?: unknown };
    const slug = typeof payload.folderSlug === "string" ? payload.folderSlug.trim() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    if (!slug) return Response.json({ error: "缺少文件夹标识" }, { status: 400 });
    if (password.length < 4 || password.length > 128) {
      return Response.json({ error: "文件夹密码需要 4 至 128 个字符" }, { status: 400 });
    }
    const folder = await findFolder(slug);
    if (!folder) return Response.json({ error: "文件夹不存在" }, { status: 404 });
    await updateFolderPasswordHash(folder.id, await hashFolderPassword(password));
    await recordAudit(request, user, {
      action: folder.passwordHash ? "folder.password.change" : "folder.password.set",
      resourceType: "folder",
      resourceId: folder.id,
      resourceName: folder.name,
      metadata: { folderSlug: folder.slug },
    });
    return Response.json({ ok: true, locked: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "设置文件夹密码失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (user.role !== "admin") return forbidden();
  try {
    const slug = new URL(request.url).searchParams.get("folderSlug")?.trim() || "";
    if (!slug) return Response.json({ error: "缺少文件夹标识" }, { status: 400 });
    const folder = await findFolder(slug);
    if (!folder) return Response.json({ error: "文件夹不存在" }, { status: 404 });
    await updateFolderPasswordHash(folder.id, "");
    await recordAudit(request, user, {
      action: "folder.password.remove",
      resourceType: "folder",
      resourceId: folder.id,
      resourceName: folder.name,
      metadata: { folderSlug: folder.slug },
    });
    return Response.json({ ok: true, locked: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "移除文件夹密码失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
