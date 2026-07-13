import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds the finished photo album surface", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
  ]);
  assert.match(layout, /拾光册 - 私人影像空间/);
  assert.match(layout, /og\.png/);
  assert.match(page, /拾光册/);
  assert.match(page, /七牛 Kodo/);
  assert.match(page, /api\/folders/);
  assert.doesNotMatch(page + layout, /codex-preview|Your site is taking shape/);
});

test("keeps Qiniu secrets server-side", async () => {
  const [page, qiniu, exampleEnv] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/qiniu.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(page, /api\/upload-token/);
  assert.doesNotMatch(page, /QINIU_ACCESS_KEY|QINIU_SECRET_KEY/);
  assert.match(qiniu, /QINIU_SECRET_KEY/);
  assert.match(exampleEnv, /QINIU_BUCKET/);
});
