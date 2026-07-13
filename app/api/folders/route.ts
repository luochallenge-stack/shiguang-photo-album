import { createFolderRecord } from "../../../lib/cloudbase";
import { folderSlug, normalizeFolderName } from "../../../lib/validation";
import { isAdminRequest, unauthorized } from "../../../lib/access";

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
    return Response.json({ folder: { ...created, photoCount: 0 } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建文件夹失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
