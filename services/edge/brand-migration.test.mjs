import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

test("brand migration reuses legacy accounts and preserves credentials, drafts and queued jobs", () => {
  const db = new DatabaseSync(":memory:");
  const apply = (migration) => db.exec(readFileSync(new URL("../../migrations/" + migration, import.meta.url), "utf8"));
  apply("0001_niches.sql");
  apply("0002_publishing.sql");
  apply("0003_master_accounts.sql");
  db.exec(`
    INSERT INTO users VALUES ('owner','owner@example.test','fixture','2026-10-01');
    INSERT INTO niches(id,user_id,name,created_at,master_name,source_groups_json)
    VALUES ('podcasts','owner','Podcasts','2026-10-01','Podclipcast','["War Clipcast","Football Clipcast"]'),
      ('cartoons','owner','Cartoons','2026-10-01','','[]');
    INSERT INTO accounts(id,niche_id,platform,display_name,provider_id,status,encrypted_tokens,routing_group)
    VALUES ('master','podcasts','instagram','Pod','verified-master','connected','sealed-master','master'),
      ('war','podcasts','instagram','War','verified-war','connected','sealed-war','source:War Clipcast'),
      ('cartoon','cartoons','youtube','Studio','verified-studio','connected','sealed-studio','');
    INSERT INTO posts(id,niche_id,status,delivery_status,created_at,updated_at,destinations_json)
    VALUES ('job','cartoons','scheduled','scheduled','2026-10-01','2026-10-01','["cartoon"]'),
      ('draft','podcasts','draft','draft','2026-10-01','2026-10-01','["master"]');
    INSERT INTO publications(id,post_id,account_id,status,updated_at)
    VALUES ('pub','job','cartoon','pending','2026-10-01');
  `);
  const beforePosts = db.prepare("SELECT id,niche_id,delivery_status,destinations_json FROM posts ORDER BY id").all();
  const beforeJobs = db.prepare("SELECT * FROM publications").all();
  const beforeAccounts = db.prepare("SELECT id,provider_id,encrypted_tokens,status FROM accounts ORDER BY id").all();
  apply("0004_brand_hierarchy.sql");
  const rows = db.prepare("SELECT a.id,b.name,b.parent_id,b.auto_instagram FROM accounts a LEFT JOIN brands b ON b.id=a.brand_id ORDER BY a.id").all();
  const master = db.prepare("SELECT * FROM brands WHERE parent_id IS NULL").get();
  assert.equal(master.name, "Podclipcast");
  assert.equal(rows.find((a) => a.id === "war").parent_id, master.id);
  assert.equal(rows.find((a) => a.id === "cartoon").name, null);
  assert.equal(master.auto_instagram, 0);
  assert.deepEqual(db.prepare("SELECT id,provider_id,encrypted_tokens,status FROM accounts ORDER BY id").all(), beforeAccounts);
  assert.deepEqual(db.prepare("SELECT id,niche_id,delivery_status,destinations_json FROM posts ORDER BY id").all(), beforePosts);
  assert.deepEqual(db.prepare("SELECT * FROM publications").all(), beforeJobs);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
