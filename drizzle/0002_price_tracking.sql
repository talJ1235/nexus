CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`source_id` text,
	`kind` text NOT NULL,
	`old_price` real,
	`new_price` real,
	`currency` text,
	`sent_at` integer,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alerts_item_idx` ON `alerts` (`item_id`);--> statement-breakpoint
CREATE INDEX `alerts_created_idx` ON `alerts` (`created_at`);--> statement-breakpoint
ALTER TABLE `items` ADD `target_price` real;--> statement-breakpoint
ALTER TABLE `items` ADD `target_currency` text;--> statement-breakpoint
ALTER TABLE `items` ADD `watch` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `check_fails` integer DEFAULT 0 NOT NULL;