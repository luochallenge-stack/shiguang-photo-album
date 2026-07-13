import { listFolders, updateFolderSortOrders } from "../../../../lib/cloudbase";
import { currentUser, forbidden, unauthenticated } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";

function folderSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((slug): slug is string => typeof slug === "string")
    .map((slug) => slug.trim())
    .filter(Boolean)
    .slice(0, 101);
}

export async function PATCH(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthenticated();
  if (user.role !== "admin") return forbidden();
  try {
    const body = (await request.json()) as { folderSlugs?: unknown };
    const slugs = folderSlugs(body.folderSlugs);
    if (!slugs.length || slugs.length > 100 || new Set(slugs).size !== slugs.length) {
      return Response.json({ error: "文件夹顺序无效" }, { status: 400 });
    }

    const folders = await listFolders();
    const folderBySlug = new Map(folders.map((folder) => [folder.slug, folder]));
    if (slugs.length !== folders.length || slugs.some((slug) => !folderBySlug.has(slug))) {
      return Response.json({ error: "文件夹列表已经变化，请刷新后重试" }, { status: 409 });
    }

    await updateFolderSortOrders(slugs.map((slug) => folderBySlug.get(slug)!.id));
    await recordAudit(request, user, {
      action: "folder.reorder",
      resourceType: "folder-list",
      resourceId: "album-folders",
      resourceName: "文件目录",
      metadata: { folderCount: slugs.length, order: slugs.join(",") },
    });
    return Response.json({ ok: true, folderSlugs: slugs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存文件夹顺序失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
