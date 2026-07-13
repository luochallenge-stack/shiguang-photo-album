import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds the finished photo and video album surface", async () => {
  const [page, client, layout, accessControl, libraryRoute, uploadRoute, media] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/album-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/access.ts", import.meta.url), "utf8"),
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
  assert.match(client, /管理相册/);
  assert.match(client, /api\/folders\/share/);
  assert.match(client, /重命名\{mediaLabel\(editingPhoto\)\}/);
  assert.match(client, /删除\{mediaLabel\(deletingPhoto\)\}/);
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
  const [client, cloudbase, uploadRoute, exampleEnv] = await Promise.all([
    readFile(new URL("../app/album-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/cloudbase.ts", import.meta.url), "utf8"),
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
});
