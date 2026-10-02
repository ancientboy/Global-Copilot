DROP INDEX `idx_practice_record_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_practice_record_key` ON `practice_records` (`user_id`,`kind`,`id`);