import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds the authenticated photo and video album surface", async () => {
  const [page, client, login, layout, accessControl, auth, libraryRoute, uploadRoute, media] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/album-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login-screen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/access.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/library/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/upload/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/media.ts", import.meta.url), "utf8"),
    access(new URL("../.next/standalone/server.js", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
  ]);
  assert.match(layout, /伞兵训练营的时光集/);
  assert.match(layout, /照片与视频影像集/);
  assert.match(page, /force-dynamic/);
  assert.match(client, /伞兵训练营的时光集/);
  assert.match(client, /腾讯云 CloudBase/);
  assert.match(client, /api\/folders/);
  assert.match(client, /权限与日志/);
  assert.match(client, /访问与操作日志/);
  assert.match(login, /创建账号/);
  assert.match(login, /注册并进入/);
  assert.match(login, /管理员口令入口/);
  assert.match(page, /userFromSessionToken/);
  assert.match(auth, /HttpOnly; SameSite=Lax/);
  assert.match(auth, /PBKDF2/);
  assert.match(auth, /status: "active"/);
  assert.doesNotMatch(auth + login, /open\.weixin|graph\.qq|微信登录|QQ 登录/);
  assert.match(client, /api\/folders\/share/);
  assert.match(client, /api\/folders\/name/);
  assert.match(client, /重命名文件夹/);
  assert.match(client, /canManageFolders &&/);
  assert.match(client, /重命名\{mediaLabel\(editingPhoto\)\}/);
  assert.match(client, /移入回收站/);
  assert.match(client, /VisibilityFields/);
  assert.match(client, /所有人可见/);
  assert.match(client, /管理者可见/);
  assert.match(client, /某些人可见/);
  assert.doesNotMatch(client, /文件夹密码|api\/folders\/unlock|folderLocked/);
  assert.match(accessControl, /folderVisibilityType/);
  assert.match(accessControl, /canUserReadFolder/);
  assert.match(accessControl, /canManageFolderVisibility/);
  assert.match(accessControl, /createMediaUploadTicket/);
  assert.match(libraryRoute, /hiddenFolderSlugs/);
  assert.match(libraryRoute, /visibleFolderRows/);
  assert.doesNotMatch(libraryRoute, /folderLocked|lockedSlugs/);
  assert.doesNotMatch(libraryRoute, /\.\.\.folder/);
  assert.match(uploadRoute, /createDirectUpload/);
  assert.match(uploadRoute, /confirmUploadedFile/);
  assert.match(media, /MAX_VIDEO_BYTES = 500 \* 1024 \* 1024/);
  assert.match(media, /video\/quicktime/);
  assert.match(client, /api\/photos\/upload/);
  assert.match(client, /LEGACY_ALBUM_HOST/);
  assert.match(client, /PUBLIC_ALBUM_ORIGIN/);
  assert.match(client, /window\.location\.replace/);
  assert.match(client, /videoPosterUrl/);
  assert.match(client, /poster=\{videoPosterUrl\(preview\) \|\| undefined\}/);
  assert.match(client, /preload="metadata"/);
  assert.match(client, /HlsVideo/);
  assert.match(client, /import\("hls\.js"\)/);
  assert.doesNotMatch(client, /<video src=\{photo\.url\} muted playsInline preload="metadata"/);
  assert.doesNotMatch(page + client + layout, /codex-preview|Your site is taking shape/);
});

test("supports non-blocking HLS transcode for weak-network video playback", async () => {
  const [packageJson, client, uploadRoute, multipartRoute, urlRoute, hlsRoute, transcodeRoute, backfillRoute, hlsJob, videoHls, hlsToken, cloudbase, miniViewer] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/album-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/upload/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/url/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/hls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/hls/transcode/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/hls/backfill/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/hls-transcode-job.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/video-hls.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/hls-token.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/cloudbase.ts", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/viewer/viewer.js", import.meta.url), "utf8"),
  ]);
  assert.match(packageJson, /"hls\.js"/);
  assert.match(cloudbase, /hlsStatus/);
  assert.match(cloudbase, /hlsRenditions/);
  assert.match(cloudbase, /updatePhotoHlsReady/);
  assert.match(cloudbase, /rendition\.segments\.map/);
  assert.match(cloudbase, /listActiveVideosForHlsBackfill/);
  assert.match(uploadRoute, /startPhotoHlsTranscode\(photo\.id\)/);
  assert.match(multipartRoute, /startPhotoHlsTranscode\(photo\.id\)/);
  assert.match(urlRoute, /hlsUrl/);
  assert.match(urlRoute, /createHlsPlaybackToken/);
  assert.match(hlsRoute, /application\/vnd\.apple\.mpegurl/);
  assert.match(hlsRoute, /#EXT-X-STREAM-INF/);
  assert.match(hlsRoute, /verifyHlsPlaybackToken/);
  assert.match(transcodeRoute, /transcodePhotoToHls/);
  assert.match(transcodeRoute, /video\.hls\.transcode/);
  assert.match(backfillRoute, /isSuperAdmin/);
  assert.match(backfillRoute, /Math\.min\(number, 5\)/);
  assert.match(backfillRoute, /video\.hls\.backfill/);
  assert.match(backfillRoute, /startPhotoHlsTranscode\(video\.id\)/);
  assert.match(hlsJob, /transcodeVideoToHls/);
  assert.match(hlsJob, /updatePhotoHlsProcessing/);
  assert.match(videoHls, /ffprobe/);
  assert.match(videoHls, /-hls_playlist_type/);
  assert.match(videoHls, /360p/);
  assert.match(videoHls, /720p/);
  assert.match(hlsToken, /createHlsPlaybackToken/);
  assert.match(client, /hlsUrl/);
  assert.match(client, /Hls\.isSupported/);
  assert.match(miniViewer, /hlsUrl \|\| url/);
});

test("keeps CloudBase credentials server-side", async () => {
  const [client, cloudbase, auth, uploadRoute, exampleEnv] = await Promise.all([
    readFile(new URL("../app/album-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/cloudbase.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/upload/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(client, /api\/photos/);
  assert.doesNotMatch(client, /CLOUDBASE_APIKEY/);
  assert.match(cloudbase, /CLOUDBASE_ENV_ID/);
  assert.match(cloudbase, /deleteFile/);
  assert.match(cloudbase, /getUploadMetadata/);
  assert.doesNotMatch(client + uploadRoute, /CLOUDBASE_APIKEY/);
  assert.match(exampleEnv, /CLOUDBASE_APIKEY/);
  assert.match(exampleEnv, /ALBUM_ADMIN_KEY/);
  assert.doesNotMatch(client, /ALBUM_SESSION_SECRET/);
  assert.doesNotMatch(auth + exampleEnv, /WECHAT_APP_SECRET|QQ_APP_KEY/);
});

test("limits desktop image previews to 70 percent of the viewport", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /@media \(min-width: 681px\)/);
  assert.match(styles, /\.preview-canvas img, \.preview-canvas video \{ max-width: 70vw; max-height: 70vh; \}/);
  assert.match(styles, /\.video-cover/);
  assert.match(styles, /\.photo-preview video \{[^}]*object-fit: contain/);
});

test("creates 24-hour public image links without exposing album sessions", async () => {
  const [shareRoute, sharePage, imageRoute, downloadRoute, mediaShare, cloudbase, miniLibrary] = await Promise.all([
    readFile(new URL("../app/api/photos/share/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/s/[token]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/s/[token]/image/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/s/[token]/download/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/media-share.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/cloudbase.ts", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/library/library.js", import.meta.url), "utf8"),
  ]);
  assert.match(shareRoute, /24 \* 60 \* 60 \* 1000/);
  assert.match(shareRoute, /DEFAULT_PUBLIC_ORIGIN/);
  assert.match(shareRoute, /0\.0\.0\.0/);
  assert.match(shareRoute, /createMediaShareRecord/);
  assert.match(shareRoute, /canUserReadFolder/);
  assert.match(shareRoute, /media\.share\.link\.create/);
  assert.match(cloudbase, /album_media_shares/);
  assert.match(cloudbase, /mediaShareTokenHash/);
  assert.match(mediaShare, /Date\.parse\(record\.expiresAt\) <= Date\.now\(\)/);
  assert.match(mediaShare, /photo\.deletedAt/);
  assert.match(mediaShare, /redirectSafeUrl/);
  assert.match(sharePage, /24 小时内有效/);
  assert.match(sharePage, /查看大图/);
  assert.match(sharePage, /public-share-image-link/);
  assert.match(imageRoute, /shared\.displayUrl/);
  assert.match(imageRoute, /redirectSafeUrl/);
  assert.match(downloadRoute, /mediaDownloadUrl/);
  assert.match(downloadRoute, /redirectSafeUrl/);
  assert.doesNotMatch(sharePage + imageRoute + downloadRoute, /currentUser|ALBUM_SESSION_SECRET/);
  assert.match(miniLibrary, /createMediaShareLink/);
  assert.match(miniLibrary, /wx\.setClipboardData/);
});

test("supports dual-client batch editing with a seven-day recycle bin", async () => {
  const [client, styles, libraryRoute, batchRoute, recycleRoute, cloudbase, miniLibrary, miniTemplate] = await Promise.all([
    readFile(new URL("../app/album-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/library/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/batch/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/recycle/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/cloudbase.ts", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/library/library.js", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/library/library.wxml", import.meta.url), "utf8"),
  ]);
  assert.match(client, /editMode/);
  assert.match(client, /\/api\/photos\/batch/);
  assert.match(client, /\/api\/photos\/recycle/);
  assert.match(client, /operationLabel/);
  assert.match(styles, /\.batch-toolbar/);
  assert.match(batchRoute, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(batchRoute, /recyclePhotoRecord/);
  assert.match(recycleRoute, /restorePhotoRecord/);
  assert.match(recycleRoute, /deletePhotoFiles/);
  assert.match(libraryRoute, /purgeExpiredPhotos/);
  assert.match(libraryRoute, /recycleCount/);
  assert.match(cloudbase, /lastActionBy/);
  assert.match(cloudbase, /listRecycledPhotoPage/);
  assert.match(miniLibrary, /toggleEditMode/);
  assert.match(miniLibrary, /restoreSelectedMedia/);
  assert.match(miniTemplate, /移入回收站/);
  assert.match(miniTemplate, /item\.operatorLabel/);
});

test("paginates CloudBase media queries by album for both clients", async () => {
  const [cloudbase, libraryRoute, client, miniLibrary] = await Promise.all([
    readFile(new URL("../lib/cloudbase.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/library/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/album-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/library/library.js", import.meta.url), "utf8"),
  ]);
  assert.match(cloudbase, /listPhotoPage/);
  assert.match(cloudbase, /skip\(bounds\.offset\)/);
  assert.match(cloudbase, /countActivePhotosByFolder/);
  assert.match(cloudbase, /aggregate\(\)/);
  assert.match(cloudbase, /purgeAt: command\.exists/);
  assert.match(libraryRoute, /folderSlug: selectedFolder/);
  assert.match(libraryRoute, /excludedFolderSlugs/);
  assert.match(libraryRoute, /listRecycledPhotoPage\(\{ excludedFolderSlugs: hiddenFolderSlugs, offset, limit \}\)/);
  assert.match(client, /WEB_PAGE_SIZE = 48/);
  assert.match(client, /加载更多/);
  assert.match(miniLibrary, /PAGE_SIZE = 24/);
  assert.match(miniLibrary, /onReachBottom/);
});

test("ships a native WeChat mini program with token authentication", async () => {
  const [projectText, app, api, login, library, viewer, viewerLogic, auth, accessControl, libraryRoute, mediaUrlRoute, libraryTemplate, permissionsPage, permissionsTemplate, folderOrderRoute, folderNameRoute, coverRoute, generateCoverRoute, videoCover, dockerfile, cloudbase] = await Promise.all([
    readFile(new URL("../miniprogram/project.config.json", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/app.json", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/utils/api.js", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/login/login.js", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/library/library.js", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/viewer/viewer.wxml", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/viewer/viewer.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/access.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/library/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/url/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/library/library.wxml", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/permissions/permissions.js", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/permissions/permissions.wxml", import.meta.url), "utf8"),
    readFile(new URL("../app/api/folders/order/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/folders/name/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/cover/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/cover/generate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/video-cover.ts", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../lib/cloudbase.ts", import.meta.url), "utf8"),
    access(new URL("../miniprogram/images/logo.png", import.meta.url)),
  ]);
  const project = JSON.parse(projectText);
  assert.equal(project.appid, "wx5c6f75fd860fb659");
  assert.match(app, /pages\/login\/login/);
  assert.match(app, /pages\/library\/library/);
  assert.match(app, /pages\/permissions\/permissions/);
  assert.match(api, /x-album-client/);
  assert.match(api, /Authorization: `Bearer/);
  assert.match(login, /api\/auth\/session/);
  assert.match(library, /api\/library/);
  assert.match(library, /api\.request\("\/api\/folders"/);
  assert.match(library, /createFolder/);
  assert.match(library, /moveFolderOrder/);
  assert.match(library, /\/api\/folders\/order/);
  assert.match(libraryTemplate, /folder-menu-panel/);
  assert.match(libraryTemplate, /create-folder-menu-button/);
  assert.match(libraryTemplate, /menu-line/);
  assert.match(library, /openPermissionsPage/);
  assert.match(permissionsPage, /accountLabel === "alishan-tea"/);
  assert.match(permissionsPage, /authorized: false/);
  assert.match(permissionsPage, /api\.request\("\/api\/admin\/users"\)/);
  assert.match(permissionsTemplate, /用户权限/);
  assert.match(folderOrderRoute, /updateFolderSortOrders/);
  assert.match(folderNameRoute, /updateFolderName/);
  assert.match(cloudbase, /sortOrder/);
  assert.match(library, /openFolderActions/);
  assert.match(library, /saveFolderVisibility/);
  assert.match(library, /loadVisibilityUsers/);
  assert.doesNotMatch(library, /saveFolderPassword|removeFolderPassword|unlockFolder/);
  assert.match(library, /\/api\/folders\/name/);
  assert.match(library, /openMediaActions/);
  assert.match(library, /createMediaShareLink/);
  assert.match(library, /复制24小时查看链接/);
  assert.match(library, /wx\.downloadFile/);
  assert.doesNotMatch(library, /shareOriginalImage|shareOriginalFile/);
  assert.doesNotMatch(library, /wx\.showShareImageMenu|wx\.shareFileMessage/);
  assert.match(library, /\/api\/photos\/share/);
  assert.match(library, /method: "PATCH"/);
  assert.match(libraryTemplate, /folder-manage-button/);
  assert.match(libraryTemplate, /media-more/);
  assert.match(libraryTemplate, /folderVisibilityOpen/);
  assert.match(libraryTemplate, /某些人可见/);
  assert.match(library, /wx\.chooseMedia/);
  assert.match(library, /mediaType: \["image", "video"\]/);
  assert.match(library, /MAX_VIDEO_BYTES = 500/);
  assert.match(library, /api\.uploadMedia/);
  assert.match(library, /thumbTempFilePath/);
  assert.match(library, /api\.uploadVideoCover/);
  assert.match(api, /\/api\/photos\/cover/);
  assert.match(api, /generateVideoCover/);
  assert.match(coverRoute, /updatePhotoCoverFileId/);
  assert.match(generateCoverRoute, /extractVideoCoverFromUrl/);
  assert.match(videoCover, /spawn\("ffmpeg"/);
  assert.match(dockerfile, /apk add --no-cache ffmpeg/);
  assert.match(libraryRoute, /coverUrls/);
  assert.match(libraryRoute, /\? coverUrl/);
  assert.match(cloudbase, /coverFileId/);
  assert.match(cloudbase, /mediaFileIds/);
  assert.match(library, /onReachBottom/);
  assert.match(library, /MAX_UPLOAD_COUNT = 50/);
  assert.match(library, /PICKER_BATCH_SIZE = 9/);
  assert.match(library, /uploadSelectedMedia/);
  assert.match(api, /wx\.uploadFile/);
  assert.match(viewer, /<video/);
  assert.match(viewer, /poster="\{\{media\.thumbnailUrl \|\| media\.coverUrl \|\| media\.previewUrl \|\| ''\}\}"/);
  assert.match(viewer, /<swiper/);
  assert.match(viewer, /src="\{\{item\.displayUrl \|\| item\.viewerUrl \|\| item\.previewUrl \|\| item\.url\}\}"/);
  assert.match(viewer, /mode="aspectFit"/);
  assert.match(viewer, /bindchange="handleImageSwiperChange"/);
  assert.match(viewer, /show-menu-by-longpress="\{\{true\}\}"/);
  assert.match(viewer, /binderror="handleImageError"/);
  assert.match(viewer, /wx:if="\{\{mode !== 'image'\}\}" class="video-copy"/);
  assert.doesNotMatch(viewer, /长按可保存或转发/);
  assert.match(viewer, /closeImage/);
  assert.match(viewer, /object-fit="contain"/);
  assert.match(viewerLogic, /api\/photos\/url/);
  assert.match(viewerLogic, /albumViewerPhotos/);
  assert.match(viewerLogic, /mode: "image"/);
  assert.match(viewerLogic, /handleImageSwiperChange/);
  assert.match(viewerLogic, /normalizeImagePhotos/);
  assert.match(viewerLogic, /displayUrl/);
  assert.match(viewerLogic, /prefetchAdjacentImages/);
  assert.match(viewerLogic, /warmImageCache/);
  assert.match(viewerLogic, /imagePrefetching/);
  assert.match(viewerLogic, /imageFailedSources/);
  assert.match(viewerLogic, /encodeURI\(result\.displayUrl/);
  assert.match(viewerLogic, /encodeURI\(playbackUrl\)/);
  assert.match(viewerLogic, /handleVideoError/);
  assert.match(libraryRoute, /MINI_PROGRAM_PAGE_SIZE = 24/);
  assert.match(libraryRoute, /thumbnailUrl/);
  assert.match(libraryRoute, /hasMore/);
  assert.match(mediaUrlRoute, /2 \* 60 \* 60/);
  assert.match(mediaUrlRoute, /canUserReadFolder/);
  assert.match(auth, /authorization\.startsWith\("Bearer "\)/);
  assert.doesNotMatch(accessControl + api + library, /x-album-folder-token/);
});

test("supports exact image dedupe and document uploads", async () => {
  const [client, uploadRoute, multipartRoute, duplicatesRoute, cloudbase, media, miniLibrary, miniTemplate, urlRoute] = await Promise.all([
    readFile(new URL("../app/album-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/upload/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/duplicates/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/cloudbase.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/media.ts", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/library/library.js", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/library/library.wxml", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/url/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(media, /MediaKind = "image" \| "video" \| "document"/);
  assert.match(media, /application\/pdf/);
  assert.match(media, /application\/msword/);
  assert.match(media, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(media, /MAX_DOCUMENT_BYTES = 500 \* 1024 \* 1024/);
  assert.match(media, /单个文档不能超过 500 MB/);
  assert.match(client, /fileContentHash/);
  assert.match(client, /上传文档/);
  assert.match(client, /DOCUMENT_FOLDER_SLUG/);
  assert.match(client, /isDocumentMimeType/);
  assert.match(uploadRoute, /contentHash/);
  assert.match(uploadRoute, /findActivePhotoByContentHash/);
  assert.match(uploadRoute, /media\.dedupe\.skip/);
  assert.match(uploadRoute, /ensureDocumentFolder/);
  assert.match(multipartRoute, /sha256Hex/);
  assert.match(multipartRoute, /duplicate: true/);
  assert.match(duplicatesRoute, /media\.dedupe\.scan/);
  assert.match(duplicatesRoute, /media\.dedupe\.recycle/);
  assert.match(cloudbase, /DOCUMENT_FOLDER_SLUG = "documents"/);
  assert.match(cloudbase, /ensureDocumentFolder/);
  assert.match(cloudbase, /updatePhotoContentHash/);
  assert.match(miniLibrary, /wx\.chooseFile/);
  assert.match(miniLibrary, /chooseMessageFile/);
  assert.match(miniLibrary, /chooseDocument/);
  assert.match(miniLibrary, /chooseLocalDocument/);
  assert.match(miniLibrary, /chooseMessageDocument/);
  assert.match(miniLibrary, /文档不能超过 500 MB/);
  assert.match(miniLibrary, /uploadDocuments/);
  assert.match(miniLibrary, /wx\.openDocument/);
  assert.match(miniTemplate, /document-upload-button/);
  assert.match(urlRoute, /document\.open/);
  assert.match(urlRoute, /video \|\| document \? resolvedUrl : orientedImageUrl/);
});

test("enforces identity-based folder visibility across backend entry points", async () => {
  const [accessControl, cloudbase, folderRoute, libraryRoute, photoRoute, batchRoute, recycleRoute, urlRoute, auditRoute, logsRoute, usersRoute, client, miniLibrary] = await Promise.all([
    readFile(new URL("../lib/access.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/cloudbase.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/folders/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/library/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/batch/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/recycle/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/url/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/audit/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/audit-logs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/users/options/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/album-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/library/library.js", import.meta.url), "utf8"),
  ]);
  assert.match(cloudbase, /visibilityType\?: FolderVisibilityType/);
  assert.match(cloudbase, /visibleUserIds\?: string\[\]/);
  assert.match(cloudbase, /creatorUserId\?: string/);
  assert.match(accessControl, /folder\.passwordHash \? "admins" : "all"/);
  assert.match(accessControl, /folder\.visibleUserIds\.includes\(user\.id\)/);
  assert.match(accessControl, /folder\.creatorUserId === user\.id/);
  assert.match(accessControl, /isSuperAdmin/);
  assert.match(folderRoute, /validatedVisibleUserIds/);
  assert.match(folderRoute, /canManageFolderVisibility/);
  assert.match(folderRoute, /folder\.visibility\.update/);
  assert.match(folderRoute, /export async function DELETE/);
  assert.match(folderRoute, /countActivePhotosInFolder/);
  assert.match(folderRoute, /countPhotosInFolder/);
  assert.match(folderRoute, /recycleAllActivePhotosInFolder/);
  assert.match(folderRoute, /requiresConfirmation/);
  assert.match(folderRoute, /media\.recycle\.folder/);
  assert.match(folderRoute, /folder\.delete/);
  assert.match(cloudbase, /deleteFolderRecord/);
  assert.match(cloudbase, /findFolderIncludingDeleted/);
  assert.match(cloudbase, /restoreDeletedFolderRecord/);
  assert.match(libraryRoute, /previewUrl/);
  assert.match(libraryRoute, /imageThumbnailUrl/);
  assert.match(urlRoute, /displayUrl/);
  assert.match(urlRoute, /orientedImageUrl/);
  assert.match(client, /deleteFolder/);
  assert.match(client, /folderDeleteStep/);
  assert.match(miniLibrary, /confirmDeleteFolder/);
  assert.match(miniLibrary, /再次确认删除/);
  assert.match(libraryRoute, /folders: visibleFolderRows\.map/);
  assert.match(libraryRoute, /countRecycledPhotos\(hiddenFolderSlugs\)/);
  for (const route of [photoRoute, batchRoute, recycleRoute, urlRoute, auditRoute]) {
    assert.match(route, /canUserReadFolder/);
  }
  assert.match(auditRoute, /media\.share/);
  assert.match(logsRoute, /isSuperAdmin/);
  assert.match(usersRoute, /status === "active"/);
  assert.match(client, /canManageVisibility/);
  assert.match(miniLibrary, /canManageVisibility/);
  assert.doesNotMatch(client + miniLibrary, /文件夹密码|解锁文件夹/);
});

test("supports titles and granular permissions on both clients", async () => {
  const [cloudbase, auth, accessControl, usersRoute, photoRoute, batchRoute, folderRoute, client, styles, miniLibrary, miniTemplate, miniPermissions, miniPermissionsTemplate, miniStyles] = await Promise.all([
    readFile(new URL("../lib/cloudbase.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/access.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/batch/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/folders/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/album-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/library/library.js", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/library/library.wxml", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/permissions/permissions.js", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/permissions/permissions.wxml", import.meta.url), "utf8"),
    readFile(new URL("../miniprogram/pages/permissions/permissions.wxss", import.meta.url), "utf8"),
  ]);
  assert.match(cloudbase, /AlbumUserPermissions/);
  assert.match(cloudbase, /manageFolders: boolean/);
  assert.match(cloudbase, /assignTitles: boolean/);
  assert.match(cloudbase, /title\?: string/);
  assert.match(auth, /accountLabel === "alishan-tea" \? "伞兵指挥官"/);
  assert.match(auth, /effectiveUserPermissions/);
  assert.match(accessControl, /accountLabel === "alishan-tea"/);
  assert.match(accessControl, /effectiveUserPermissions/);
  assert.match(accessControl, /canUploadMedia/);
  assert.match(accessControl, /canEditMedia/);
  assert.match(accessControl, /canDeleteMedia/);
  assert.match(accessControl, /canManageFolders/);
  assert.match(accessControl, /canAssignUserTitles/);
  assert.match(usersRoute, /只有阿里山清茶可以管理人员权限/);
  assert.match(usersRoute, /阿里山清茶是超级管理员，始终拥有全部权限/);
  assert.match(usersRoute, /avatarUrl: result\.avatarUrl/);
  assert.match(photoRoute, /canEditMedia/);
  assert.match(photoRoute, /canDeleteMedia/);
  assert.match(batchRoute, /canEditMedia/);
  assert.match(batchRoute, /canDeleteMedia/);
  assert.match(folderRoute, /canManageFolders/);
  assert.match(client, /PERMISSION_OPTIONS/);
  assert.match(client, /可上传用户/);
  assert.match(client, /canAssignTitles/);
  assert.match(client, /权限开关/);
  assert.match(miniLibrary, /PERMISSION_OPTIONS/);
  assert.match(miniLibrary, /canManagePermissions/);
  assert.match(miniLibrary, /canAssignTitles/);
  assert.match(miniTemplate, /openPermissionsPage/);
  assert.match(miniPermissions, /PERMISSION_OPTIONS/);
  assert.match(miniPermissions, /togglePermission/);
  assert.match(miniPermissions, /superAdmin/);
  assert.match(miniPermissionsTemplate, /permission\.description/);
  assert.match(miniTemplate, /member-title/);
  assert.match(styles, /\.shimmer-title/);
  assert.match(miniStyles, /@keyframes title-glow/);
});
