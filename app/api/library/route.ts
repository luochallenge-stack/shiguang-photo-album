import {
  cloudBaseIsConfigured,
  countActivePhotosByFolder,
  countRecycledPhotos,
  listFolders,
  listPhotoPage,
  listRecycledPhotoPage,
  purgeExpiredPhotos,
  resolvePhotoUrls,
} from "../../../lib/cloudbase";
import {
  canManageFolderVisibility,
  canDeleteMedia,
  canReadAlbum,
  canUserReadFolder,
  folderVisibilityType,
} from "../../../lib/access";
import { currentUser, forbidden, isMiniProgramRequest, unauthenticated } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";

const MINI_PROGRAM_PAGE_SIZE = 24;
const WEB_PAGE_SIZE = 48;

function thumbnailUrl(url: string, mimeType: string): string {
  if (!mimeType.startsWith("image/") || !url.startsWith("http")) return "";
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}imageMogr2/thumbnail/640x640/format/webp/anima-format/webp/rquality/76`;
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!canReadAlbum(user)) return forbidden();
  try {
    const url = new URL(request.url);
    const selectedFolder = url.searchParams.get("folder")?.trim();
    const recycleBin = url.searchParams.get("recycle") === "1";
    if (recycleBin && !canDeleteMedia(user)) return forbidden();
    await purgeExpiredPhotos().catch((error) => console.error("Failed to purge recycled photos", error));
    const requestedLimit = Number(url.searchParams.get("limit"));
    const defaultLimit = isMiniProgramRequest(request) ? MINI_PROGRAM_PAGE_SIZE : WEB_PAGE_SIZE;
    const limit = Math.max(
      1,
      Math.min(48, Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : defaultLimit),
    );
    const requestedOffset = Number(url.searchParams.get("offset"));
    const offset = Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
    const folderRows = await listFolders();
    const visibleFolderRows = folderRows.filter((folder) => canUserReadFolder(folder, user));
    const visibleFolderSlugs = new Set(visibleFolderRows.map((folder) => folder.slug));
    const hiddenFolderSlugs = folderRows
      .filter((folder) => !visibleFolderSlugs.has(folder.slug))
      .map((folder) => folder.slug);
    const selectedFolderRow = selectedFolder
      ? visibleFolderRows.find((folder) => folder.slug === selectedFolder)
      : undefined;
    if (selectedFolder && !selectedFolderRow) {
      return Response.json({ error: "文件夹不存在" }, { status: 404 });
    }
    const [page, counts, standaloneRecycleCount] = await Promise.all([
      recycleBin
        ? listRecycledPhotoPage({ excludedFolderSlugs: hiddenFolderSlugs, offset, limit })
        : listPhotoPage({
            folderSlug: selectedFolder,
            excludedFolderSlugs: selectedFolder ? [] : hiddenFolderSlugs,
            offset,
            limit,
          }),
      countActivePhotosByFolder(),
      recycleBin ? Promise.resolve<number | null>(null) : countRecycledPhotos(hiddenFolderSlugs),
    ]);
    const photoRows = page.photos;
    const recycleCount = standaloneRecycleCount ?? page.total;
    const resolvedUrls = await resolvePhotoUrls(photoRows.map((photo) => photo.fileId));
    const coverRows = photoRows.filter((photo) => Boolean(photo.coverFileId));
    const resolvedCoverUrls = await resolvePhotoUrls(coverRows.map((photo) => photo.coverFileId || ""));
    const coverUrls = new Map(coverRows.map((photo, index) => [photo.id, resolvedCoverUrls[index] || ""]));

    await recordAudit(request, user, {
      action: recycleBin ? "recycle.view" : "album.view",
      resourceType: recycleBin ? "recycle-bin" : selectedFolder ? "folder" : "album",
      resourceId: selectedFolderRow?.id || "",
      resourceName: recycleBin ? "回收站" : selectedFolderRow?.name || "全部影像",
      metadata: { folderSlug: recycleBin ? "recycle" : selectedFolder || "all" },
    });

    return Response.json({
      folders: visibleFolderRows.map((folder) => {
        const canManageVisibility = canManageFolderVisibility(folder, user);
        const visibilityType = folderVisibilityType(folder);
        return {
          id: folder.id,
          name: folder.name,
          slug: folder.slug,
          createdAt: folder.createdAt,
          sortOrder: folder.sortOrder,
          creatorUserId: canManageVisibility ? folder.creatorUserId || "" : "",
          visibilityType,
          visibleUserIds: canManageVisibility && visibilityType === "specific" ? folder.visibleUserIds || [] : [],
          canManageVisibility,
          photoCount: counts[folder.slug] || 0,
        };
      }),
      photos: photoRows.map((photo, index) => {
        const resolvedUrl = resolvedUrls[index] || photo.url;
        const coverUrl = coverUrls.get(photo.id) || "";
        return {
          ...photo,
          url: resolvedUrl,
          coverUrl,
          thumbnailUrl: coverUrl
            ? coverUrl
            : thumbnailUrl(resolvedUrl, photo.mimeType),
        };
      }),
      total: page.total,
      nextOffset: offset + photoRows.length,
      hasMore: page.hasMore,
      recycleCount,
      recycleBin,
      storageConfigured: cloudBaseIsConfigured(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取相册失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
