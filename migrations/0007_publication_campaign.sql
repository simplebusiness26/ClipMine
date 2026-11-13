ALTER TABLE posts ADD COLUMN campaign_deadline_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE publications ADD COLUMN public_url TEXT;
ALTER TABLE publications ADD COLUMN published_at TEXT;
ALTER TABLE publications ADD COLUMN campaign_submitted_at TEXT;
ALTER TABLE publications ADD COLUMN permalink_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publications ADD COLUMN permalink_next_attempt_at TEXT;
