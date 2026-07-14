import { createHmac, timingSafeEqual } from "node:crypto";

type HlsTokenPayload = {
  photoId: string;
  expiresAt: number;
};

function secret(): string {
  return process.env.ALBUM_SESSION_SECRET || process.env.ALBUM_ADMIN_KEY || "local-dev-album-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createHlsPlaybackToken(photoId: string, ttlMs: number): string {
  const payload = Buffer.from(JSON.stringify({ photoId, expiresAt: Date.now() + ttlMs } satisfies HlsTokenPayload)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyHlsPlaybackToken(token: string, photoId: string): boolean {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<HlsTokenPayload>;
    return data.photoId === photoId && Number(data.expiresAt) > Date.now();
  } catch {
    return false;
  }
}
