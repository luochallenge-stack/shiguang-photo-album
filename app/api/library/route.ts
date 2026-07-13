import {
  cloudBaseIsConfigured,
  listFolders,
  listPhotos,
  listRecycledPhotos,
  purgeExpiredPhotos,
  resolvePhotoUrls,
} from "../../../lib/cloudbase";
import { canReadFolder } from "../../../lib/access";
import { currentUser, forbidden, isMiniProgramRequest, unauthenticated } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";

const MINI_PROGRAM_PAGE_SIZE = 24;

function thumbnailUrl(url: string, mimeType: string): string {
  if (!mimeType.startsWith("image/") || !url.startsWith("http")) return "";
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}imageMogr2/thumbnail/640x640/format/webp/anima-format/webp/rquality/76`;
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  try {
    const url = new URL(request.url);
    const selectedFolder = url.searchParams.get("folder")?.trim();
    const recycleBin = url.searchParams.get("recycle") === "1";
    if (recycleBin && user.role !== "admin") return forbidden();
    await purgeExpiredPhotos().catch((error) => console.error("Failed to purge recycled photos", error));
    const paginated = isMiniProgramRequest(request) || url.searchParams.has("limit");
    const requestedLimit = Number(url.searchParams.get("limit"));
    const limit = paginated
      ? Math.max(
          1,
          Math.min(
            48,
            Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : MINI_PROGRAM_PAGE_SIZE,
          ),
        )
      : 300;
    const requestedOffset = Number(url.searchParams.get("offset"));
    const offset = paginated && Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
    const [folderRows, allPhotos, recycledPhotos] = await Promise.all([listFolders(), listPhotos(), listRecycledPhotos()]);
    const selectedFolderRow = selectedFolder ? folderRows.find((folder) => folder.slug === selectedFolder) : undefined;
    const folderLocked = Boolean(
      selectedFolderRow?.passwordHash && !(await canReadFolder(request, selectedFolderRow, user)),
    );
    const lockedSlugs = new Set(folderRows.filter((folder) => Boolean(folder.passwordHash)).map((folder) => folder.slug));
    const visiblePhotoRows = recycleBin
      ? recycledPhotos
      : selectedFolder
        ? (folderLocked ? [] : allPhotos.filter((photo) => photo.folderSlug === selectedFolder))
        : allPhotos.filter((photo) => !lockedSlugs.has(photo.folderSlug));
    const photoRows = paginated ? visiblePhotoRows.slice(offset, offset + limit) : visiblePhotoRows;
    const counts = new Map<string, number>();
    for (const photo of allPhotos) counts.set(photo.folderSlug, (counts.get(photo.folderSlug) || 0) + 1);
    const resolvedUrls = await resolvePhotoUrls(photoRows.map((photo) => photo.fileId));

    await recordAudit(request, user, {
      action: recycleBin ? "recycle.view" : "album.view",
      resourceType: recycleBin ? "recycle-bin" : selectedFolder ? "folder" : "album",
      resourceId: selectedFolderRow?.id || "",
      resourceName: recycleBin ? "回收站" : selectedFolderRow?.name || "全部影像",
      metadata: { folderSlug: recycleBin ? "recycle" : selectedFolder || "all", locked: folderLocked },
    });

    return Response.json({
      folders: folderRows.map((folder) => ({
        id: folder.id,
        name: folder.name,
        slug: folder.slug,
        createdAt: folder.createdAt,
        locked: Boolean(folder.passwordHash),
        photoCount: folder.passwordHash ? 0 : counts.get(folder.slug) || 0,
      })),
      photos: photoRows.map((photo, index) => {
        const resolvedUrl = resolvedUrls[index] || photo.url;
        return { ...photo, url: resolvedUrl, thumbnailUrl: thumbnailUrl(resolvedUrl, photo.mimeType) };
      }),
      total: visiblePhotoRows.length,
      nextOffset: offset + photoRows.length,
      hasMore: offset + photoRows.length < visiblePhotoRows.length,
      recycleCount: recycledPhotos.length,
      recycleBin,
      storageConfigured: cloudBaseIsConfigured(),
      folderLocked,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取相册失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
