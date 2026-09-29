CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
