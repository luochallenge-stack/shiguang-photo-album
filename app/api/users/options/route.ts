import { canManageFolders, canManageFolderVisibility } from "../../../../lib/access";
import { currentUser, forbidden, publicUser, unauthenticated } from "../../../../lib/auth";
import { findFolder, listUsers } from "../../../../lib/cloudbase";

export async function GET(request: Request) {
  const actor = await currentUser(request);
  if (!actor) return unauthenticated();
  if (!canManageFolders(actor)) {
    const folderSlug = new URL(request.url).searchParams.get("folder")?.trim() || "";
    const folder = folderSlug ? await findFolder(folderSlug) : null;
    if (!folder || !canManageFolderVisibility(folder, actor)) return forbidden();
  }
  const users = (await listUsers())
    .filter((user) => user.status === "active")
    .map(publicUser)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
  return Response.json({ users });
}
