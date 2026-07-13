import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (user.role !== "admin") return forbidden();
  return Response.json({ ok: true });
}
