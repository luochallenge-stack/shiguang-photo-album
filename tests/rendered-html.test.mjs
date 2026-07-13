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
  assert.match(client, /用户与日志/);
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
  assert.match(client, /重命名\{mediaLabel\(editingPhoto\)\}/);
  assert.match(client, /移入回收站/);
  assert.match(client, /这个文件夹已加密/);
  assert.match(client, /设置密码/);
  assert.match(client, /api\/folders\/unlock/);
  assert.match(accessControl, /PBKDF2/);
  assert.match(accessControl, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(accessControl, /createMediaUploadTicket/);
  assert.match(libraryRoute, /folderLocked/);
  assert.match(libraryRoute, /lockedSlugs/);
  assert.doesNotMatch(libraryRoute, /\.\.\.folder/);
  assert.match(uploadRoute, /createDirectUpload/);
  assert.match(uploadRoute, /confirmUploadedFile/);
  assert.match(media, /MAX_VIDEO_BYTES = 500 \* 1024 \* 1024/);
  assert.match(media, /video\/quicktime/);
  assert.match(client, /api\/photos\/upload/);
  assert.match(client, /LEGACY_ALBUM_HOST/);
  assert.match(client, /PUBLIC_ALBUM_ORIGIN/);
  assert.match(client, /window\.location\.replace/);
  assert.match(client, /<video src=\{preview\.url\} controls autoPlay playsInline/);
  assert.doesNotMatch(page + client + layout, /codex-preview|Your site is taking shape/);
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
  assert.match(styles, /\.preview-canvas img \{ max-width: 70vw; max-height: 70vh; \}/);
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
  assert.match(cloudbase, /listRecycledPhotos/);
  assert.match(miniLibrary, /toggleEditMode/);
  assert.match(miniLibrary, /restoreSelectedMedia/);
  assert.match(miniTemplate, /移入回收站/);
  assert.match(miniTemplate, /item\.operatorLabel/);
});

test("ships a native WeChat mini program with token authentication", async () => {
  const [projectText, app, api, login, library, viewer, viewerLogic, auth, accessControl, libraryRoute, mediaUrlRoute] = await Promise.all([
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
    access(new URL("../miniprogram/images/logo.png", import.meta.url)),
  ]);
  const project = JSON.parse(projectText);
  assert.equal(project.appid, "wx5c6f75fd860fb659");
  assert.match(app, /pages\/login\/login/);
  assert.match(app, /pages\/library\/library/);
  assert.match(api, /x-album-client/);
  assert.match(api, /Authorization: `Bearer/);
  assert.match(login, /api\/auth\/session/);
  assert.match(library, /api\/library/);
  assert.match(library, /api\/folders\/unlock/);
  assert.match(library, /wx\.chooseMedia/);
  assert.match(library, /api\.uploadImage/);
  assert.match(library, /onReachBottom/);
  assert.match(library, /MAX_UPLOAD_COUNT = 50/);
  assert.match(library, /PICKER_BATCH_SIZE = 9/);
  assert.match(library, /uploadSelectedImages/);
  assert.match(api, /wx\.uploadFile/);
  assert.match(viewer, /<video/);
  assert.match(viewerLogic, /api\/photos\/url/);
  assert.match(viewerLogic, /encodeURI\(url\)/);
  assert.match(viewerLogic, /handleVideoError/);
  assert.match(libraryRoute, /MINI_PROGRAM_PAGE_SIZE = 24/);
  assert.match(libraryRoute, /thumbnailUrl/);
  assert.match(libraryRoute, /hasMore/);
  assert.match(mediaUrlRoute, /2 \* 60 \* 60/);
  assert.match(mediaUrlRoute, /canReadFolder/);
  assert.match(auth, /authorization\.startsWith\("Bearer "\)/);
  assert.match(accessControl, /x-album-folder-token/);
});
