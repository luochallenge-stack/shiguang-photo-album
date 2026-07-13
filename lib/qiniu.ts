import { env } from "cloudflare:workers";

type RuntimeEnv = {
  QINIU_ACCESS_KEY?: string;
  QINIU_SECRET_KEY?: string;
  QINIU_BUCKET?: string;
  QINIU_DOMAIN?: string;
  QINIU_UPLOAD_URL?: string;
};

export type QiniuConfig = {
  accessKey: string;
  secretKey: string;
  bucket: string;
  domain: string;
  uploadUrl: string;
};

function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export function qiniuIsConfigured(): boolean {
  const values = runtimeEnv();
  return Boolean(
    values.QINIU_ACCESS_KEY &&
      values.QINIU_SECRET_KEY &&
      values.QINIU_BUCKET &&
      values.QINIU_DOMAIN,
  );
}

export function getQiniuConfig(): QiniuConfig {
  const values = runtimeEnv();
  if (!qiniuIsConfigured()) {
    throw new Error("七牛存储尚未配置");
  }

  const rawDomain = values.QINIU_DOMAIN!.replace(/\/+$/, "");
  return {
    accessKey: values.QINIU_ACCESS_KEY!,
    secretKey: values.QINIU_SECRET_KEY!,
    bucket: values.QINIU_BUCKET!,
    domain: /^https?:\/\//.test(rawDomain) ? rawDomain : `https://${rawDomain}`,
    uploadUrl: values.QINIU_UPLOAD_URL || "https://upload.qiniup.com",
  };
}

function base64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function safeFileName(value: string): string {
  const dotIndex = value.lastIndexOf(".");
  const extension = dotIndex > 0 ? value.slice(dotIndex).toLowerCase() : "";
  const stem = dotIndex > 0 ? value.slice(0, dotIndex) : value;
  const normalized = stem
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${normalized || "photo"}${extension.replace(/[^a-z0-9.]/g, "")}`;
}

export function createObjectKey(folderSlug: string, filename: string): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const nonce = crypto.randomUUID().slice(0, 8);
  return `albums/${folderSlug}/${stamp}-${nonce}-${safeFileName(filename)}`;
}

export function publicObjectUrl(domain: string, objectKey: string): string {
  const encodedPath = objectKey.split("/").map(encodeURIComponent).join("/");
  return `${domain}/${encodedPath}`;
}

export async function createUploadToken(objectKey: string): Promise<{
  token: string;
  uploadUrl: string;
  publicUrl: string;
}> {
  const config = getQiniuConfig();
  const policy = {
    scope: `${config.bucket}:${objectKey}`,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    insertOnly: 1,
    returnBody:
      '{"key":"$(key)","hash":"$(etag)","size":$(fsize),"mimeType":"$(mimeType)"}',
  };
  const encodedPolicy = base64Url(encodeText(JSON.stringify(policy)));
  const key = await crypto.subtle.importKey(
    "raw",
    encodeText(config.secretKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encodeText(encodedPolicy));
  const encodedSign = base64Url(new Uint8Array(signature));

  return {
    token: `${config.accessKey}:${encodedSign}:${encodedPolicy}`,
    uploadUrl: config.uploadUrl,
    publicUrl: publicObjectUrl(config.domain, objectKey),
  };
}
