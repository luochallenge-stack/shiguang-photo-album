import { currentUser, unauthenticated } from "../../../../lib/auth";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  return Response.json({ error: "文件夹密码功能已停用，请使用账号权限访问" }, { status: 410 });
}
