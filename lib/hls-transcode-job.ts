import {
  deletePhotoFiles,
  findPhoto,
  mediaFileIds,
  resolvePhotoUrls,
  updatePhotoHlsFailed,
  updatePhotoHlsProcessing,
  updatePhotoHlsReady,
  uploadPhoto,
} from "./cloudbase";
import { isVideoMimeType } from "./media";
import { transcodeVideoToHls } from "./video-hls";

const activeJobs = new Set<string>();

function hlsBaseObjectKey(photoId: string, folderSlug: string): string {
  return `albums/${folderSlug}/hls/${photoId}`;
}

export async function transcodePhotoToHls(photoId: string): Promise<"started" | "skipped"> {
  if (activeJobs.has(photoId)) return "skipped";
  activeJobs.add(photoId);
  try {
    const photo = await findPhoto(photoId);
    if (!photo || !isVideoMimeType(photo.mimeType) || photo.deletedAt) return "skipped";
    if (photo.hlsStatus === "processing") return "skipped";
    if (photo.hlsStatus === "ready" && photo.hlsRenditions?.length) return "skipped";
    await updatePhotoHlsProcessing(photo.id);
    const [sourceUrl] = await resolvePhotoUrls([photo.fileId], 2 * 60 * 60);
    if (!sourceUrl) throw new Error("无法获取源视频临时地址");
    try {
      const renditions = await transcodeVideoToHls(sourceUrl, hlsBaseObjectKey(photo.id, photo.folderSlug), uploadPhoto);
      if (!renditions.length) throw new Error("没有生成可用的 HLS 清晰度");
      await updatePhotoHlsReady(photo.id, renditions);
      return "started";
    } catch (error) {
      await updatePhotoHlsFailed(photo.id, error instanceof Error ? error.message : "HLS 转码失败");
      throw error;
    }
  } finally {
    activeJobs.delete(photoId);
  }
}

export function startPhotoHlsTranscode(photoId: string): void {
  void transcodePhotoToHls(photoId).catch((error) => {
    console.error("HLS transcode failed", photoId, error);
  });
}

export async function cleanupPhotoHlsFiles(photoId: string): Promise<void> {
  const photo = await findPhoto(photoId);
  if (!photo?.hlsRenditions?.length) return;
  await deletePhotoFiles(mediaFileIds([{ ...photo, fileId: "", coverFileId: "" }]));
}
