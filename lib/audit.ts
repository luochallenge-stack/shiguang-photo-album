import { createAuditLog, type AlbumUser } from "./cloudbase";

type AuditInput = {
  action: string;
  resourceType?: string;
  resourceId?: string;
  resourceName?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

const encoder = new TextEncoder();

function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

async function addressHash(request: Request): Promise<string> {
  const secret = process.env.ALBUM_SESSION_SECRET || process.env.ALBUM_ADMIN_KEY || "album";
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${secret}:${clientAddress(request)}`));
  return Buffer.from(digest).toString("hex").slice(0, 20);
}

function cleanMetadata(
  metadata: AuditInput["metadata"] = {},
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined)
      .slice(0, 20)
      .map(([key, value]) => [key.slice(0, 60), typeof value === "string" ? value.slice(0, 300) : value]),
  ) as Record<string, string | number | boolean | null>;
}

export async function recordAudit(request: Request, user: AlbumUser, input: AuditInput): Promise<void> {
  const url = new URL(request.url);
  await createAuditLog({
    id: crypto.randomUUID(),
    userId: user.id,
    userName: user.displayName,
    provider: user.provider,
    action: input.action,
    resourceType: input.resourceType || "album",
    resourceId: (input.resourceId || "").slice(0, 180),
    resourceName: (input.resourceName || "").slice(0, 180),
    method: request.method,
    path: `${url.pathname}${url.search}`.slice(0, 500),
    ipHash: await addressHash(request),
    userAgent: (request.headers.get("user-agent") || "unknown").slice(0, 300),
    metadata: cleanMetadata(input.metadata),
    createdAt: new Date().toISOString(),
  });
}
