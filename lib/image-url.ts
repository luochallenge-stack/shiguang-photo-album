function imageMogr2Url(url: string, operations: string): string {
  if (!url.startsWith("http")) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}imageMogr2/${operations}`;
}

export function orientedImageUrl(url: string): string {
  return imageMogr2Url(url, "auto-orient/ignore-error/1");
}

export function imageThumbnailUrl(url: string): string {
  return imageMogr2Url(
    url,
    "auto-orient/thumbnail/640x640/format/webp/anima-format/webp/rquality/76/ignore-error/1",
  );
}
