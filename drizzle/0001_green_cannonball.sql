CREATE TABLE `practice_records` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_practice_owner_kind` ON `practice_records` (`user_id`,`kind`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_practice_record_key` ON `practice_records` (`user_id`,`kind`,`id`);