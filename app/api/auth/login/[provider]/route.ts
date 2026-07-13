import { createOAuthStart, type SocialProvider } from "../../../../../lib/auth";

function socialProvider(value: string): SocialProvider | null {
  return value === "wechat" || value === "qq" ? value : null;
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    const provider = socialProvider((await context.params).provider);
    if (!provider) return Response.json({ error: "不支持这个登录平台" }, { status: 404 });
    const url = new URL(request.url);
    const result = await createOAuthStart(request, provider, url.searchParams.get("returnTo"));
    return new Response(null, {
      status: 302,
      headers: { location: result.authorizationUrl, "set-cookie": result.cookie },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "发起第三方登录失败";
    return Response.json({ error: message }, { status: 400 });
  }
}
