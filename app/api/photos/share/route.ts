import { canUserReadFolder } from "../../../../lib/access";
import { recordAudit } from "../../../../lib/audit";
import { currentUser, unauthenticated } from "../../../../lib/auth";
import { createMediaShareRecord, findFolder, findPhoto } from "../../../../lib/cloudbase";

const SHARE_TTL_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  try {
    const payload = (await request.json()) as { photoId?: unknown };
    const photoId = typeof payload.photoId === "string" ? payload.photoId.trim() : "";
    const photo = photoId ? await findPhoto(photoId) : null;
    if (!photo || photo.deletedAt || !photo.mimeType.startsWith("image/")) {
      return Response.json({ error: "图片不存在" }, { status: 404 });
    }
    const folder = await findFolder(photo.folderSlug);
    if (!folder || !canUserReadFolder(folder, user)) {
      return Response.json({ error: "图片不存在" }, { status: 404 });
    }
    const expiresAt = new Date(Date.now() + SHARE_TTL_MS).toISOString();
    const { token } = await createMediaShareRecord(photo.id, user.id, expiresAt);
    const origin = (process.env.ALBUM_PUBLIC_ORIGIN || new URL(request.url).origin).replace(/\/$/, "");
    const shareUrl = `${origin}/s/${token}`;
    await recordAudit(request, user, {
      action: "media.share.link.create",
      resourceType: "image",
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { folderSlug: photo.folderSlug, expiresAt },
    });
    return Response.json({ url: shareUrl, expiresAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成分享链接失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
