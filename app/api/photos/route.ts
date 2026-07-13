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
import { canWriteFolder, unauthorized } from "../../../lib/access";
import { currentUser, forbidden, unauthenticated } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";
import { isVideoMimeType, mediaInfo, mediaSizeError } from "../../../lib/media";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  try {
    const form = await request.formData();
    const file = form.get("file");
    const folderSlug = String(form.get("folderSlug") || "").trim();
    const uploadToken = String(form.get("uploadToken") || "");
    const media = file instanceof File ? mediaInfo(file.name, file.type) : null;
    if (!(file instanceof File) || !folderSlug || !media) {
      return Response.json({ error: "图片或视频信息无效" }, { status: 400 });
    }
    const sizeError = mediaSizeError(media.kind, file.size);
    if (sizeError) return Response.json({ error: sizeError }, { status: 413 });
    if (!(await canWriteFolder(request, folderSlug, uploadToken, user))) return unauthorized();

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
      mimeType: media.mimeType,
      width: Number(form.get("width")) || null,
      height: Number(form.get("height")) || null,
      createdAt: new Date().toISOString(),
    };
    await createPhotoRecord(photo);
    await recordAudit(request, user, {
      action: "media.upload",
      resourceType: media.kind,
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { folderSlug, size: photo.size, mimeType: photo.mimeType },
    });
    return Response.json({ photo }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存图片或视频信息失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (user.role !== "admin") return forbidden();
  try {
    const body = (await request.json()) as { id?: unknown; name?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!id || !name) return Response.json({ error: "文件名称不能为空" }, { status: 400 });
    if (name.length > 180) return Response.json({ error: "文件名称不能超过 180 个字符" }, { status: 400 });

    const photo = await findPhoto(id);
    if (!photo) return Response.json({ error: "文件不存在" }, { status: 404 });
    await renamePhotoRecord(id, name);
    await recordAudit(request, user, {
      action: "media.rename",
      resourceType: isVideoMimeType(photo.mimeType) ? "video" : "image",
      resourceId: photo.id,
      resourceName: name,
      metadata: { previousName: photo.name, folderSlug: photo.folderSlug },
    });
    return Response.json({ photo: { ...photo, name } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重命名文件失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (user.role !== "admin") return forbidden();
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!id) return Response.json({ error: "缺少文件标识" }, { status: 400 });

    const photo = await findPhoto(id);
    if (!photo) return Response.json({ error: "文件不存在" }, { status: 404 });
    await deletePhotoFile(photo.fileId);
    await deletePhotoRecord(id);
    await recordAudit(request, user, {
      action: "media.delete",
      resourceType: isVideoMimeType(photo.mimeType) ? "video" : "image",
      resourceId: photo.id,
      resourceName: photo.name,
      metadata: { folderSlug: photo.folderSlug, size: photo.size },
    });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除文件失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
