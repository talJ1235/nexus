CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'owner' NOT NULL,
	`kind` text DEFAULT 'list' NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text DEFAULT 'amber' NOT NULL,
	`budget` real,
	`budget_currency` text DEFAULT 'ILS' NOT NULL,
	`share_token` text,
	`archived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `collections_share_idx` ON `collections` (`share_token`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'owner' NOT NULL,
	`collection_id` text,
	`title` text NOT NULL,
	`brand` text,
	`image_url` text,
	`category` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'to_buy' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`chosen_source_id` text,
	`purchased_at` integer,
	`purchased_price` real,
	`purchased_currency` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `items_collection_idx` ON `items` (`collection_id`);--> statement-breakpoint
CREATE INDEX `items_status_idx` ON `items` (`status`);--> statement-breakpoint
CREATE TABLE `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`store` text NOT NULL,
	`store_key` text NOT NULL,
	`price` real,
	`currency` text DEFAULT 'ILS' NOT NULL,
	`shipping` real,
	`availability` text,
	`raw_title` text,
	`extract_method` text,
	`fetched_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sources_item_idx` ON `sources` (`item_id`);--> statement-breakpoint
CREATE INDEX `sources_norm_idx` ON `sources` (`normalized_url`);