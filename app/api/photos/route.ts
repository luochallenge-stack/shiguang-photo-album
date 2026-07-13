import {
  createObjectKey,
  createPhotoRecord,
  deletePhotoFile,
  deletePhotoRecord,
  findFolder,
  findPhoto,
  renamePhotoRecord,
  uploadPhoto,
} from "../../../lib/cloudbase";
import { canWriteFolder, isAdminRequest, unauthorized } from "../../../lib/access";

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

export async function PATCH(request: Request) {
  try {
    if (!isAdminRequest(request)) return unauthorized();
    const body = (await request.json()) as { id?: unknown; name?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!id || !name) return Response.json({ error: "照片名称不能为空" }, { status: 400 });
    if (name.length > 180) return Response.json({ error: "照片名称不能超过 180 个字符" }, { status: 400 });

    const photo = await findPhoto(id);
    if (!photo) return Response.json({ error: "照片不存在" }, { status: 404 });
    await renamePhotoRecord(id, name);
    return Response.json({ photo: { ...photo, name } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重命名照片失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!isAdminRequest(request)) return unauthorized();
    const id = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!id) return Response.json({ error: "缺少照片标识" }, { status: 400 });

    const photo = await findPhoto(id);
    if (!photo) return Response.json({ error: "照片不存在" }, { status: 404 });
    await deletePhotoFile(photo.fileId);
    await deletePhotoRecord(id);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除照片失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
