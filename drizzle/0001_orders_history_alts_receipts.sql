CREATE TABLE `alt_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`chosen_item_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`url` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text,
	`size` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attachments_item_idx` ON `attachments` (`item_id`);--> statement-breakpoint
CREATE TABLE `price_points` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`item_id` text NOT NULL,
	`price` real NOT NULL,
	`currency` text NOT NULL,
	`recorded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `price_points_source_idx` ON `price_points` (`source_id`);--> statement-breakpoint
CREATE INDEX `price_points_item_idx` ON `price_points` (`item_id`);--> statement-breakpoint
ALTER TABLE `items` ADD `ordered_at` integer;--> statement-breakpoint
ALTER TABLE `items` ADD `tracking_number` text;--> statement-breakpoint
ALTER TABLE `items` ADD `carrier` text;--> statement-breakpoint
ALTER TABLE `items` ADD `eta` integer;--> statement-breakpoint
ALTER TABLE `items` ADD `alt_group_id` text;--> statement-breakpoint
CREATE INDEX `items_alt_idx` ON `items` (`alt_group_id`);--> statement-breakpoint
INSERT INTO `price_points` (`id`, `source_id`, `item_id`, `price`, `currency`, `recorded_at`) SELECT 'pp0_' || `id`, `id`, `item_id`, `price`, `currency`, COALESCE(`fetched_at`, `created_at`) FROM `sources` WHERE `price` IS NOT NULL;
