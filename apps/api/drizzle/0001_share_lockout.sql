ALTER TABLE `shares` ADD `failed_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `shares` ADD `locked_until` integer;