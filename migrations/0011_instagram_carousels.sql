-- Add optional content formats without changing existing posts or scheduled publications.
-- Legacy posts default to auto and retain the original media_id behaviour.
ALTER TABLE posts ADD COLUMN post_kind TEXT NOT NULL DEFAULT 'auto'
  CHECK(post_kind IN ('auto','carousel'));
ALTER TABLE posts ADD COLUMN media_ids_json TEXT NOT NULL DEFAULT '[]';
