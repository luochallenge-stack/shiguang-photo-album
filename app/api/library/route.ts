import { cloudBaseIsConfigured, listFolders, listPhotos, resolvePhotoUrls } from "../../../lib/cloudbase";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const selectedFolder = url.searchParams.get("folder")?.trim();
    const [folderRows, allPhotos] = await Promise.all([listFolders(), listPhotos()]);
    const photoRows = selectedFolder
      ? allPhotos.filter((photo) => photo.folderSlug === selectedFolder)
      : allPhotos;
    const counts = new Map<string, number>();
    for (const photo of allPhotos) counts.set(photo.folderSlug, (counts.get(photo.folderSlug) || 0) + 1);
    const resolvedUrls = await resolvePhotoUrls(photoRows.map((photo) => photo.fileId));

    return Response.json({
      folders: folderRows.map((folder) => ({ ...folder, photoCount: counts.get(folder.slug) || 0 })),
      photos: photoRows.map((photo, index) => ({ ...photo, url: resolvedUrls[index] || photo.url })),
      storageConfigured: cloudBaseIsConfigured(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取相册失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
