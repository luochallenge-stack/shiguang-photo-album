import { cloudBaseIsConfigured, listFolders, listPhotos, resolvePhotoUrls } from "../../../lib/cloudbase";
import { canReadFolder } from "../../../lib/access";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const selectedFolder = url.searchParams.get("folder")?.trim();
    const [folderRows, allPhotos] = await Promise.all([listFolders(), listPhotos()]);
    const selectedFolderRow = selectedFolder ? folderRows.find((folder) => folder.slug === selectedFolder) : undefined;
    const folderLocked = Boolean(
      selectedFolderRow?.passwordHash && !(await canReadFolder(request, selectedFolderRow)),
    );
    const lockedSlugs = new Set(folderRows.filter((folder) => Boolean(folder.passwordHash)).map((folder) => folder.slug));
    const photoRows = selectedFolder
      ? (folderLocked ? [] : allPhotos.filter((photo) => photo.folderSlug === selectedFolder))
      : allPhotos.filter((photo) => !lockedSlugs.has(photo.folderSlug));
    const counts = new Map<string, number>();
    for (const photo of allPhotos) counts.set(photo.folderSlug, (counts.get(photo.folderSlug) || 0) + 1);
    const resolvedUrls = await resolvePhotoUrls(photoRows.map((photo) => photo.fileId));

    return Response.json({
      folders: folderRows.map((folder) => ({
        id: folder.id,
        name: folder.name,
        slug: folder.slug,
        createdAt: folder.createdAt,
        locked: Boolean(folder.passwordHash),
        photoCount: folder.passwordHash ? 0 : counts.get(folder.slug) || 0,
      })),
      photos: photoRows.map((photo, index) => ({ ...photo, url: resolvedUrls[index] || photo.url })),
      storageConfigured: cloudBaseIsConfigured(),
      folderLocked,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取相册失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
