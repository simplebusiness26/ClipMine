-- Brand hierarchy is scoped to a niche; existing account and post IDs remain unchanged.
CREATE TABLE brands (
 id TEXT PRIMARY KEY,
 niche_id TEXT NOT NULL REFERENCES niches(id),
 name TEXT NOT NULL,
 parent_brand_id TEXT REFERENCES brands(id),
 is_master INTEGER NOT NULL DEFAULT 0 CHECK(is_master IN (0,1)),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 created_at TEXT NOT NULL,
 archived_at TEXT,
 CHECK(parent_brand_id IS NULL OR is_master=0)
);
CREATE INDEX brands_niche_status ON brands(niche_id,status,parent_brand_id);
CREATE INDEX brands_archived ON brands(archived_at);
-- Every existing niche is given one initial master brand. No account tokens are changed.
INSERT INTO brands(id,niche_id,name,parent_brand_id,is_master,status,created_at) SELECT 'legacy-' || id,id,name,NULL,1,'active',created_at FROM niches;
ALTER TABLE accounts ADD COLUMN brand_id TEXT REFERENCES brands(id);
ALTER TABLE posts ADD COLUMN brand_id TEXT REFERENCES brands(id);
UPDATE accounts SET brand_id='legacy-' || niche_id;
UPDATE posts SET brand_id='legacy-' || niche_id;
CREATE INDEX accounts_brand_id ON accounts(brand_id);
CREATE INDEX posts_brand_id ON posts(brand_id);
