export type MediaKind = "image" | "video";

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

const MIME_KINDS = new Map<string, MediaKind>([
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
  ["image/gif", "image"],
  ["image/heic", "image"],
  ["image/heif", "image"],
  ["video/mp4", "video"],
  ["video/quicktime", "video"],
  ["video/x-m4v", "video"],
  ["video/webm", "video"],
  ["video/mpeg", "video"],
]);

const EXTENSION_TYPES = new Map<string, string>([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["heic", "image/heic"],
  ["heif", "image/heif"],
  ["mp4", "video/mp4"],
  ["mov", "video/quicktime"],
  ["m4v", "video/x-m4v"],
  ["webm", "video/webm"],
  ["mpeg", "video/mpeg"],
  ["mpg", "video/mpeg"],
]);

export function mediaInfo(name: string, providedMimeType: string): { kind: MediaKind; mimeType: string } | null {
  const normalizedMimeType = providedMimeType.toLowerCase().split(";")[0].trim();
  const extension = name.split(".").pop()?.toLowerCase() || "";
  const inferredMimeType = EXTENSION_TYPES.get(extension) || "";
  const mimeType = MIME_KINDS.has(normalizedMimeType) ? normalizedMimeType : inferredMimeType;
  const kind = MIME_KINDS.get(mimeType);
  return kind ? { kind, mimeType } : null;
}

export function mediaSizeError(kind: MediaKind, size: number): string | null {
  const limit = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size <= 0) return "文件内容为空";
  if (size > limit) return kind === "video" ? "单个视频不能超过 500 MB" : "单张图片不能超过 50 MB";
  return null;
}

export function isVideoMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("video/");
}
