import { isAdminRequest, unauthorized } from "../../../../lib/access";

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  return Response.json({ ok: true });
}
