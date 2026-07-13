import { ensureSchema, getDb } from "../../../db";
import { folders } from "../../../db/schema";
import { folderSlug, normalizeFolderName } from "../../../lib/validation";

export async function POST(request: Request) {
  try {
    await ensureSchema();
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
    const db = getDb();
    const [created] = await db.insert(folders).values(folder).returning();
    return Response.json({ folder: { ...created, photoCount: 0 } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建文件夹失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
