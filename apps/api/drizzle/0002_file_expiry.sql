ALTER TABLE `files` ADD `expires_at` integer;--> statement-breakpoint
CREATE INDEX `files_expires_at_idx` ON `files` (`expires_at`);