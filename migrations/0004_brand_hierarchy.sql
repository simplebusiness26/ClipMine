CREATE TABLE brands (
  id TEXT PRIMARY KEY NOT NULL,
  niche_id TEXT NOT NULL REFERENCES niches(id),
  parent_id TEXT,
  name TEXT NOT NULL COLLATE NOCASE,
  auto_instagram INTEGER NOT NULL DEFAULT 0 CHECK(auto_instagram IN (0,1)),
  UNIQUE(niche_id,id),
  UNIQUE(niche_id,name),
  FOREIGN KEY(niche_id,parent_id) REFERENCES brands(niche_id,id),
  CHECK(parent_id IS NULL OR (parent_id<>id AND auto_instagram=0))
);
CREATE UNIQUE INDEX brands_one_master ON brands(niche_id) WHERE parent_id IS NULL;
ALTER TABLE accounts ADD COLUMN brand_id TEXT REFERENCES brands(id);
ALTER TABLE posts ADD COLUMN brand_id TEXT REFERENCES brands(id);
INSERT INTO brands(id,niche_id,name)
SELECT lower(hex(randomblob(16))),id,trim(master_name)
FROM niches WHERE trim(master_name)<>'';
INSERT OR IGNORE INTO brands(id,niche_id,parent_id,name)
SELECT lower(hex(randomblob(16))),n.id,b.id,trim(groups.value)
FROM niches n JOIN brands b ON b.niche_id=n.id AND b.parent_id IS NULL
JOIN json_each(n.source_groups_json) groups
WHERE groups.type='text' AND trim(groups.value)<>'';
UPDATE accounts SET brand_id=(
  SELECT b.id FROM brands b WHERE b.niche_id=accounts.niche_id AND (
    (b.parent_id IS NULL AND accounts.routing_group='master')
    OR (b.parent_id IS NOT NULL AND b.name=trim(substr(accounts.routing_group,8))
        AND substr(accounts.routing_group,1,7)='source:')
  )
) WHERE routing_group<>'';
