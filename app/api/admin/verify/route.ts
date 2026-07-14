import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";
import { canManageFolders } from "../../../../lib/access";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (!canManageFolders(user)) return forbidden();
  return Response.json({ ok: true });
}
