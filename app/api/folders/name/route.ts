import { findFolder, updateFolderName } from "../../../../lib/cloudbase";
import { canUserReadFolder } from "../../../../lib/access";
import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { normalizeFolderName } from "../../../../lib/validation";

export async function PATCH(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (user.role !== "admin") return forbidden();
  try {
    const body = (await request.json()) as { folderSlug?: unknown; name?: unknown };
    const folderSlug = typeof body.folderSlug === "string" ? body.folderSlug.trim() : "";
    const name = normalizeFolderName(typeof body.name === "string" ? body.name : "");
    if (!folderSlug || !name) return Response.json({ error: "文件夹名称不能为空" }, { status: 400 });

    const folder = await findFolder(folderSlug);
    if (!folder || !canUserReadFolder(folder, user)) {
      return Response.json({ error: "文件夹不存在" }, { status: 404 });
    }
    if (folder.name === name) return Response.json({ folder: { ...folder, name } });

    await updateFolderName(folder.id, name);
    await recordAudit(request, user, {
      action: "folder.rename",
      resourceType: "folder",
      resourceId: folder.id,
      resourceName: name,
      metadata: { folderSlug, previousName: folder.name },
    });
    return Response.json({ folder: { ...folder, name } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重命名文件夹失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
