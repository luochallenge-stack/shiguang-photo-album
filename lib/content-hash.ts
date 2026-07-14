import { createHash } from "crypto";

export const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;

export async function sha256Hex(contents: Buffer | ArrayBuffer): Promise<string> {
  const source = Buffer.isBuffer(contents) ? contents : Buffer.from(new Uint8Array(contents));
  return createHash("sha256").update(source).digest("hex");
}

export function normalizeContentHash(value: unknown): string {
  const hash = typeof value === "string" ? value.trim().toLowerCase() : "";
  return CONTENT_HASH_PATTERN.test(hash) ? hash : "";
}
