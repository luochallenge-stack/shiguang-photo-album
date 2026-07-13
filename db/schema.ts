import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const photos = sqliteTable(
  "photos",
  {
    id: text("id").primaryKey(),
    folderSlug: text("folder_slug")
      .notNull()
      .references(() => folders.slug, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull().unique(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    size: integer("size").notNull(),
    mimeType: text("mime_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("photos_folder_created_idx").on(table.folderSlug, table.createdAt)],
);
