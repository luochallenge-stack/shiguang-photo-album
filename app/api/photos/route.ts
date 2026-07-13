import { createObjectKey, createPhotoRecord, findFolder, uploadPhoto } from "../../../lib/cloudbase";
import { canWriteFolder, unauthorized } from "../../../lib/access";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const folderSlug = String(form.get("folderSlug") || "").trim();
    const uploadToken = String(form.get("uploadToken") || "");
    const mimeType = file instanceof File ? file.type : "";
    const imageExtension = file instanceof File && /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name);
    if (!(file instanceof File) || !folderSlug || (!IMAGE_TYPES.has(mimeType) && !imageExtension)) {
      return Response.json({ error: "图片信息无效" }, { status: 400 });
    }
    if (file.size > 50 * 1024 * 1024) return Response.json({ error: "单张图片不能超过 50 MB" }, { status: 413 });
    if (!(await canWriteFolder(request, folderSlug, uploadToken))) return unauthorized();

    const folder = await findFolder(folderSlug);
    if (!folder) {
      return Response.json({ error: "目标文件夹不存在" }, { status: 404 });
    }

    const objectKey = createObjectKey(folderSlug, file.name);
    const uploaded = await uploadPhoto(objectKey, Buffer.from(await file.arrayBuffer()));
    const photo = {
      id: crypto.randomUUID(),
      folderSlug,
      objectKey,
      fileId: uploaded.fileId,
      name: file.name.slice(0, 180),
      url: uploaded.url,
      size: file.size,
      mimeType: mimeType || "application/octet-stream",
      width: Number(form.get("width")) || null,
      height: Number(form.get("height")) || null,
      createdAt: new Date().toISOString(),
    };
    await createPhotoRecord(photo);
    return Response.json({ photo }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存图片信息失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
