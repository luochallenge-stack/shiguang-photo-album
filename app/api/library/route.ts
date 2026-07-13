import { desc, eq, sql } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { folders, photos } from "../../../db/schema";
import { qiniuIsConfigured } from "../../../lib/qiniu";

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const selectedFolder = url.searchParams.get("folder")?.trim();
    const db = getDb();
    const folderRows = await db
      .select({
        id: folders.id,
        name: folders.name,
        slug: folders.slug,
        createdAt: folders.createdAt,
        photoCount: sql<number>`count(${photos.id})`,
      })
      .from(folders)
      .leftJoin(photos, eq(folders.slug, photos.folderSlug))
      .groupBy(folders.id)
      .orderBy(desc(folders.createdAt));

    const photoRows = selectedFolder
      ? await db
          .select()
          .from(photos)
          .where(eq(photos.folderSlug, selectedFolder))
          .orderBy(desc(photos.createdAt))
      : await db.select().from(photos).orderBy(desc(photos.createdAt)).limit(300);

    return Response.json({
      folders: folderRows,
      photos: photoRows,
      storageConfigured: qiniuIsConfigured(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取相册失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
