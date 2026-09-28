CREATE TABLE `grants` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `grants_member_idx` ON `grants` (`member_id`);--> statement-breakpoint
CREATE INDEX `grants_collection_idx` ON `grants` (`collection_id`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`collection_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `invites_token_idx` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invites_collection_idx` ON `invites` (`collection_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
ALTER TABLE `items` ADD `added_by_member_id` text;--> statement-breakpoint
ALTER TABLE `items` ADD `added_by_name` text;