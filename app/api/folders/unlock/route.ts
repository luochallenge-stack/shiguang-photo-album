import { createFolderAccessCookie, verifyFolderPassword } from "../../../../lib/access";
import { findFolder } from "../../../../lib/cloudbase";

type Attempt = { count: number; resetAt: number };

const attempts = new Map<string, Attempt>();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 8;

function attemptKey(request: Request, folderSlug: string): string {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return `${address}:${folderSlug}`;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { folderSlug?: unknown; password?: unknown };
    const folderSlug = typeof payload.folderSlug === "string" ? payload.folderSlug.trim() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    if (!folderSlug || !password) return Response.json({ error: "请输入文件夹密码" }, { status: 400 });

    const key = attemptKey(request, folderSlug);
    const now = Date.now();
    const current = attempts.get(key);
    const attempt = current && current.resetAt > now ? current : { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
    if (attempt.count >= ATTEMPT_LIMIT) {
      return Response.json({ error: "尝试次数过多，请稍后再试" }, { status: 429 });
    }

    const folder = await findFolder(folderSlug);
    if (!folder?.passwordHash || !(await verifyFolderPassword(password, folder.passwordHash))) {
      attempts.set(key, { ...attempt, count: attempt.count + 1 });
      return Response.json({ error: "文件夹密码错误" }, { status: 401 });
    }

    attempts.delete(key);
    return Response.json({ ok: true }, {
      headers: { "set-cookie": await createFolderAccessCookie(folder) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "解锁文件夹失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
