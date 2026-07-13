import { createFolderRecord, findFolder, updateFolderPasswordHash } from "../../../lib/cloudbase";
import { folderSlug, normalizeFolderName } from "../../../lib/validation";
import { hashFolderPassword, isAdminRequest, unauthorized } from "../../../lib/access";

export async function POST(request: Request) {
  try {
    if (!isAdminRequest(request)) return unauthorized();
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
    return Response.json({ folder: { ...created, locked: false, photoCount: 0 } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建文件夹失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!isAdminRequest(request)) return unauthorized();
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
    return Response.json({ ok: true, locked: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "设置文件夹密码失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!isAdminRequest(request)) return unauthorized();
    const slug = new URL(request.url).searchParams.get("folderSlug")?.trim() || "";
    if (!slug) return Response.json({ error: "缺少文件夹标识" }, { status: 400 });
    const folder = await findFolder(slug);
    if (!folder) return Response.json({ error: "文件夹不存在" }, { status: 404 });
    await updateFolderPasswordHash(folder.id, "");
    return Response.json({ ok: true, locked: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "移除文件夹密码失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
