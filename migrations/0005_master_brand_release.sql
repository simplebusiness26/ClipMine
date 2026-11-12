-- Preserve the existing brand schema, account IDs, social credentials and publishing queue.
-- Multiple standalone brands are now allowed; only one active master per niche.
ALTER TABLE brands ADD COLUMN is_master INTEGER NOT NULL DEFAULT 0 CHECK(is_master IN (0,1));
ALTER TABLE brands ADD COLUMN archived_at TEXT;
UPDATE brands SET is_master=1 WHERE parent_id IS NULL;
DROP INDEX brands_one_master;
CREATE UNIQUE INDEX brands_one_active_master ON brands(niche_id) WHERE is_master=1 AND archived_at IS NULL;
CREATE INDEX brands_archive_lookup ON brands(niche_id,archived_at,parent_id);
