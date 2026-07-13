import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let schemaReady: Promise<void> | null = null;

export function ensureSchema() {
  if (!env.DB) {
    throw new Error("相册数据库尚未配置");
  }
  if (!schemaReady) {
    schemaReady = env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS folders (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS photos (
          id TEXT PRIMARY KEY NOT NULL,
          folder_slug TEXT NOT NULL,
          object_key TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          size INTEGER NOT NULL,
          mime_type TEXT NOT NULL,
          width INTEGER,
          height INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (folder_slug) REFERENCES folders(slug) ON DELETE CASCADE
        )
      `),
      env.DB.prepare(
        "CREATE INDEX IF NOT EXISTS photos_folder_created_idx ON photos(folder_slug, created_at)",
      ),
    ]).then(() => undefined);
  }
  return schemaReady;
}

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}
