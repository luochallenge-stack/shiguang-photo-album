export function normalizeFolderName(value: string): string {
  return value
    .normalize("NFKC")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(" / ")
    .slice(0, 80);
}

export function folderSlug(value: string): string {
  const base = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "album"}-${crypto.randomUUID().slice(0, 6)}`;
}
