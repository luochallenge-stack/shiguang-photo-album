import {
  clearOAuthCookie,
  completeOAuth,
  createSessionCookie,
  type SocialProvider,
} from "../../../../../lib/auth";
import { recordAudit } from "../../../../../lib/audit";

function socialProvider(value: string): SocialProvider | null {
  return value === "wechat" || value === "qq" ? value : null;
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const provider = socialProvider((await context.params).provider);
  if (!provider) return Response.json({ error: "不支持这个登录平台" }, { status: 404 });
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !state) return Response.redirect(new URL("/?loginError=cancelled", request.url), 302);
  try {
    const result = await completeOAuth(request, provider, code, state);
    await recordAudit(request, result.user, {
      action: "auth.login",
      resourceType: "user",
      resourceId: result.user.id,
      resourceName: result.user.displayName,
      metadata: { provider },
    });
    const headers = new Headers();
    headers.append("set-cookie", await createSessionCookie(request, result.user.id));
    headers.append("set-cookie", clearOAuthCookie(request));
    headers.set("location", new URL(result.returnTo, request.url).toString());
    return new Response(null, { status: 302, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "第三方登录失败";
    const failed = new URL("/", request.url);
    failed.searchParams.set("loginError", message);
    return new Response(null, {
      status: 302,
      headers: { location: failed.toString(), "set-cookie": clearOAuthCookie(request) },
    });
  }
}
