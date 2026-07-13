import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { folders, photos } from "../../../db/schema";

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const payload = (await request.json()) as {
      folderSlug?: string;
      objectKey?: string;
      name?: string;
      url?: string;
      size?: number;
      mimeType?: string;
      width?: number | null;
      height?: number | null;
    };
    const folderSlug = payload.folderSlug?.trim() || "";
    const objectKey = payload.objectKey?.trim() || "";
    if (
      !folderSlug ||
      !objectKey.startsWith(`albums/${folderSlug}/`) ||
      !payload.name ||
      !payload.url ||
      !payload.mimeType ||
      !Number.isFinite(payload.size)
    ) {
      return Response.json({ error: "图片信息无效" }, { status: 400 });
    }

    const db = getDb();
    const [folder] = await db
      .select({ slug: folders.slug })
      .from(folders)
      .where(eq(folders.slug, folderSlug))
      .limit(1);
    if (!folder) {
      return Response.json({ error: "目标文件夹不存在" }, { status: 404 });
    }

    const [photo] = await db
      .insert(photos)
      .values({
        id: crypto.randomUUID(),
        folderSlug,
        objectKey,
        name: payload.name.slice(0, 180),
        url: payload.url,
        size: Math.max(0, Math.round(payload.size || 0)),
        mimeType: payload.mimeType,
        width: payload.width || null,
        height: payload.height || null,
      })
      .returning();
    return Response.json({ photo }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存图片信息失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
