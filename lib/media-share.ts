import {
  deleteMediaShareRecord,
  findFolder,
  findMediaShareRecord,
  findPhoto,
  resolvePhotoUrls,
  type AlbumMediaShare,
  type AlbumPhoto,
} from "./cloudbase";
import { orientedImageUrl } from "./image-url";

export type ResolvedMediaShare = {
  record: AlbumMediaShare;
  photo: AlbumPhoto;
  originalUrl: string;
  displayUrl: string;
};

export async function resolveMediaShare(token: string): Promise<ResolvedMediaShare | null> {
  const record = await findMediaShareRecord(token);
  if (!record) return null;
  if (Date.parse(record.expiresAt) <= Date.now()) {
    await deleteMediaShareRecord(record.id).catch(() => {});
    return null;
  }
  const photo = await findPhoto(record.photoId);
  if (!photo || photo.deletedAt || !photo.mimeType.startsWith("image/") || !(await findFolder(photo.folderSlug))) {
    return null;
  }
  const [resolvedUrl] = await resolvePhotoUrls([photo.fileId], 10 * 60);
  const originalUrl = resolvedUrl || photo.url;
  return {
    record,
    photo,
    originalUrl,
    displayUrl: orientedImageUrl(originalUrl),
  };
}

export function mediaDownloadUrl(url: string, filename: string): string {
  const separator = url.includes("?") ? "&" : "?";
  const safeName = filename.replace(/[\r\n"\\]/g, "-");
  const disposition = encodeURIComponent(`attachment; filename="${safeName}"`);
  return `${url}${separator}response-content-disposition=${disposition}`;
}
