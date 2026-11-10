CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`share_id` text,
	`file_id` text,
	`comment_id` text,
	`dedupe_key` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_dedupe_idx` ON `notifications` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `share_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`share_id` text NOT NULL,
	`file_id` text,
	`author_name` text,
	`body` text NOT NULL,
	`visitor_hash` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`share_id`) REFERENCES `shares`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `share_comments_share_id_idx` ON `share_comments` (`share_id`);--> statement-breakpoint
CREATE INDEX `share_comments_visitor_idx` ON `share_comments` (`share_id`,`visitor_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `share_events` (
	`id` text PRIMARY KEY NOT NULL,
	`share_id` text NOT NULL,
	`type` text NOT NULL,
	`file_id` text,
	`country` text,
	`visitor_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`share_id`) REFERENCES `shares`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `share_events_share_created_idx` ON `share_events` (`share_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `folders` ADD `kind` text DEFAULT 'folder' NOT NULL;--> statement-breakpoint
ALTER TABLE `shares` ADD `allow_comments` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `shares` ADD `message` text;--> statement-breakpoint
ALTER TABLE `user` ADD `is_anonymous` integer DEFAULT false;
--> statement-breakpoint
UPDATE `files` SET `expires_at` = `created_at` + 259200 WHERE `expires_at` IS NULL OR `expires_at` > `created_at` + 259200;
--> statement-breakpoint
UPDATE `shares` SET `expires_at` = `created_at` + 259200 WHERE `expires_at` > `created_at` + 259200;