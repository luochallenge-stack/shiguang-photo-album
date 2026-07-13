import {
  canWriteFolder,
  createMediaUploadTicket,
  readMediaUploadTicket,
  unauthorized,
} from "../../../../lib/access";
import {
  confirmUploadedFile,
  createDirectUpload,
  createObjectKey,
  createPhotoRecord,
  findFolder,
  resolvePhotoUrls,
  type AlbumPhoto,
} from "../../../../lib/cloudbase";
import { mediaInfo, mediaSizeError } from "../../../../lib/media";

function dimension(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 100_000 ? number : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      folderSlug?: unknown;
      uploadToken?: unknown;
      name?: unknown;
      size?: unknown;
      mimeType?: unknown;
      width?: unknown;
      height?: unknown;
    };
    const folderSlug = typeof body.folderSlug === "string" ? body.folderSlug.trim() : "";
    const uploadToken = typeof body.uploadToken === "string" ? body.uploadToken : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 180) : "";
    const size = Number(body.size);
    const providedMimeType = typeof body.mimeType === "string" ? body.mimeType : "";
    const media = mediaInfo(name, providedMimeType);
    if (!folderSlug || !name || !Number.isSafeInteger(size) || !media) {
      return Response.json({ error: "图片或视频信息无效" }, { status: 400 });
    }
    const sizeError = mediaSizeError(media.kind, size);
    if (sizeError) return Response.json({ error: sizeError }, { status: 413 });
    if (!(await canWriteFolder(request, folderSlug, uploadToken))) return unauthorized();
    if (!(await findFolder(folderSlug))) return Response.json({ error: "目标文件夹不存在" }, { status: 404 });

    const objectKey = createObjectKey(folderSlug, name);
    const directUpload = await createDirectUpload(objectKey, media.mimeType);
    const ticket = await createMediaUploadTicket({
      id: crypto.randomUUID(),
      folderSlug,
      objectKey,
      fileId: directUpload.fileId,
      name,
      size,
      mimeType: media.mimeType,
      width: dimension(body.width),
      height: dimension(body.height),
    });
    return Response.json({
      upload: {
        url: directUpload.url,
        headers: directUpload.headers,
        ticket,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成上传凭证失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { ticket?: unknown; uploadToken?: unknown };
    const ticket = typeof body.ticket === "string" ? await readMediaUploadTicket(body.ticket) : null;
    const uploadToken = typeof body.uploadToken === "string" ? body.uploadToken : "";
    if (!ticket) return Response.json({ error: "上传凭证无效或已过期" }, { status: 400 });
    if (!(await canWriteFolder(request, ticket.folderSlug, uploadToken))) return unauthorized();
    if (!(await findFolder(ticket.folderSlug))) return Response.json({ error: "目标文件夹不存在" }, { status: 404 });
    const media = mediaInfo(ticket.name, ticket.mimeType);
    if (!media || mediaSizeError(media.kind, ticket.size)) {
      return Response.json({ error: "上传文件校验失败" }, { status: 400 });
    }

    await confirmUploadedFile(ticket.fileId, ticket.size);
    const photo: AlbumPhoto = {
      id: ticket.id,
      folderSlug: ticket.folderSlug,
      objectKey: ticket.objectKey,
      fileId: ticket.fileId,
      name: ticket.name,
      url: ticket.fileId,
      size: ticket.size,
      mimeType: ticket.mimeType,
      width: ticket.width,
      height: ticket.height,
      createdAt: new Date().toISOString(),
    };
    await createPhotoRecord(photo);
    const [url] = await resolvePhotoUrls([photo.fileId]);
    return Response.json({ photo: { ...photo, url: url || photo.url } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "登记上传文件失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
