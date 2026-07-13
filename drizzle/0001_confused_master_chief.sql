CREATE TABLE `folder_upload_tokens` (
	`folder_slug` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`folder_slug`) REFERENCES `folders`(`slug`) ON UPDATE no action ON DELETE cascade
);
