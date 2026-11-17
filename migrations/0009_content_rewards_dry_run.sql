ALTER TABLE publications ADD COLUMN content_rewards_dry_run_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publications ADD COLUMN content_rewards_dry_run_retry_at TEXT;
ALTER TABLE publications ADD COLUMN content_rewards_dry_run_dispatched_at TEXT;
