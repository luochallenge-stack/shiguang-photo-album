import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { folderUploadTokens, folders } from "../../../../db/schema";
import { hashUploadToken, isAdminRequest, unauthorized } from "../../../../lib/access";

function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    if (!isAdminRequest(request)) return unauthorized();
    const payload = (await request.json()) as { folderSlug?: string };
    const folderSlug = payload.folderSlug?.trim() || "";
    const db = getDb();
    const [folder] = await db
      .select({ slug: folders.slug })
      .from(folders)
      .where(eq(folders.slug, folderSlug))
      .limit(1);
    if (!folder) return Response.json({ error: "目标文件夹不存在" }, { status: 404 });

    const uploadToken = createToken();
    const tokenHash = await hashUploadToken(uploadToken);
    await db
      .insert(folderUploadTokens)
      .values({ folderSlug, tokenHash })
      .onConflictDoUpdate({
        target: folderUploadTokens.folderSlug,
        set: { tokenHash, createdAt: new Date().toISOString() },
      });
    return Response.json({ uploadToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成上传链接失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
