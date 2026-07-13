CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folders_slug_unique` ON `folders` (`slug`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_slug` text NOT NULL,
	`object_key` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`folder_slug`) REFERENCES `folders`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photos_object_key_unique` ON `photos` (`object_key`);--> statement-breakpoint
CREATE INDEX `photos_folder_created_idx` ON `photos` (`folder_slug`,`created_at`);