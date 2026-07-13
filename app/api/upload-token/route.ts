import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../db";
import { folders } from "../../../db/schema";
import { createObjectKey, createUploadToken } from "../../../lib/qiniu";

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const payload = (await request.json()) as {
      folderSlug?: string;
      filename?: string;
      mimeType?: string;
    };
    const selectedFolder = payload.folderSlug?.trim() || "";
    const filename = payload.filename?.trim() || "";
    const imageExtension = /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(filename);
    if (!selectedFolder || !filename || (!IMAGE_TYPES.has(payload.mimeType || "") && !imageExtension)) {
      return Response.json({ error: "上传参数无效" }, { status: 400 });
    }

    const db = getDb();
    const [folder] = await db
      .select({ slug: folders.slug })
      .from(folders)
      .where(eq(folders.slug, selectedFolder))
      .limit(1);
    if (!folder) {
      return Response.json({ error: "目标文件夹不存在" }, { status: 404 });
    }

    const objectKey = createObjectKey(folder.slug, filename);
    const credentials = await createUploadToken(objectKey);
    return Response.json({ objectKey, ...credentials });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成上传凭证失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
