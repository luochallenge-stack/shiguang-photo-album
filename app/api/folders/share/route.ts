import { findFolder, setUploadTokenRecord } from "../../../../lib/cloudbase";
import { hashUploadToken } from "../../../../lib/access";
import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";

function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (user.role !== "admin") return forbidden();
  try {
    const payload = (await request.json()) as { folderSlug?: string };
    const folderSlug = payload.folderSlug?.trim() || "";
    const folder = await findFolder(folderSlug);
    if (!folder) return Response.json({ error: "目标文件夹不存在" }, { status: 404 });

    const uploadToken = createToken();
    const tokenHash = await hashUploadToken(uploadToken);
    await setUploadTokenRecord({ folderSlug, tokenHash, createdAt: new Date().toISOString() });
    await recordAudit(request, user, {
      action: "folder.share.create",
      resourceType: "folder",
      resourceId: folder.id,
      resourceName: folder.name,
      metadata: { folderSlug },
    });
    return Response.json({ uploadToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成上传链接失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
