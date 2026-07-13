import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds the finished photo album surface", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    access(new URL("../.next/standalone/server.js", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
  ]);
  assert.match(layout, /拾光册 - 私人影像空间/);
  assert.match(layout, /og\.png/);
  assert.match(page, /拾光册/);
  assert.match(page, /腾讯云 CloudBase/);
  assert.match(page, /api\/folders/);
  assert.match(page, /管理相册/);
  assert.match(page, /api\/folders\/share/);
  assert.match(page, /重命名照片/);
  assert.match(page, /删除照片/);
  assert.doesNotMatch(page + layout, /codex-preview|Your site is taking shape/);
});

test("keeps CloudBase credentials server-side", async () => {
  const [page, cloudbase, exampleEnv] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/cloudbase.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(page, /api\/photos/);
  assert.doesNotMatch(page, /CLOUDBASE_APIKEY/);
  assert.match(cloudbase, /CLOUDBASE_ENV_ID/);
  assert.match(cloudbase, /deleteFile/);
  assert.match(exampleEnv, /CLOUDBASE_APIKEY/);
  assert.match(exampleEnv, /ALBUM_ADMIN_KEY/);
});
