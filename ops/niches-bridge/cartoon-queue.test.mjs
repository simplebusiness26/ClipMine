import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {NICHE,planQueue,slots,snapshotSQL,statements,QUERIES} from './cartoon-queue.mjs';
const now=Date.parse('2026-11-06T01:15:00Z');
function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const f of ['0001_niches.sql','0002_publishing.sql'])db.exec(fs.readFileSync(new URL('../../migrations/'+f,import.meta.url),'utf8'));
 db.prepare('INSERT INTO users VALUES (?,?,?,?)').run('user','test@example.test','unused','2026-11-01');
 db.prepare('INSERT INTO niches(id,user_id,name,created_at) VALUES (?,?,?,?)').run(NICHE,'user',"Craig's Cartoons",'2026-11-01');
 const providers={facebook:'1482923248227264',instagram:'17841447177484576',youtube:'UCjyHfNEWvdMel3BYaw140SQ'};
 for(const [id,provider]of Object.entries(providers))db.prepare('INSERT INTO accounts(id,niche_id,platform,display_name,provider_id,status) VALUES (?,?,?,?,?,?)').run(id,NICHE,id,id,provider,'connected');
 function add(id,status,due,media=id){
 if(!db.prepare('SELECT id FROM media WHERE id=?').get(media))db.prepare('INSERT INTO media(id,niche_id,object_key,filename,mime,size,created_at) VALUES (?,?,?,?,?,?,?)').run(media,NICHE,media,media+'.mp4','video/mp4',100,'2026-11-01');
 db.prepare('INSERT INTO posts(id,niche_id,media_id,title,caption,destinations_json,overrides_json,status,scheduled_at,created_at,updated_at,delivery_status,publish_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,NICHE,media,id,'Original caption #Unique',JSON.stringify(Object.keys(providers)),JSON.stringify({youtube:{title:'Original platform title'}}),'draft',due,'2026-11-01','2026-11-06T00:55:00.000Z',status,'direct');
 for(const account of Object.keys(providers))db.prepare('INSERT INTO publications(id,post_id,account_id,status,updated_at,next_attempt_at,attempt,submission_started,provider_post_id) VALUES (?,?,?,?,?,?,?,?,?)').run(id+account,id,account,status==='published'?'published':'pending','2026-11-06T00:55:00.000Z',due,status==='published'?3:0,status==='published'?1:0,status==='published'?'receipt-'+id:null);
 }
 add('done','published',null);
 for(let i=0;i<47;i++)add('queued'+i,'scheduled',new Date(Date.parse('2026-11-06T08:00:00Z')+i*3600000).toISOString());
 return {db,add,read:()=>Object.fromEntries(Object.entries(QUERIES).map(([k,q])=>[k,db.prepare(q).all(NICHE)])),snapshot:()=>db.prepare(snapshotSQL()).get(NICHE,NICHE,NICHE,NICHE).snapshot};
}
test('UK capacity includes posts published today and preserves chronological order',()=>{
 const f=fixture(),p=planQueue(f.read(),now);
 assert.deepEqual(p.slice(0,3).map(x=>x.due),['2026-11-06T09:00:00.000Z','2026-11-06T14:00:00.000Z','2026-11-07T09:00:00.000Z']);
 assert.equal(p.length,47);assert.equal(p[0].id,'queued0');
});
test('UK daylight saving slots remain at local hours',()=>{
 assert.equal(slots(Date.parse('2027-03-28T01:01:00Z'))[0],'2027-03-28T08:00:00.000Z');
 assert.equal(slots(Date.parse('2027-10-31T01:01:00Z'))[0],'2027-10-31T09:00:00.000Z');
});
test('only fully published duplicate jobs are suppressed',()=>{
 const f=fixture();f.add('duplicate','scheduled','2026-11-08T08:00:00.000Z','done');
 assert.equal(planQueue(f.read(),now).find(x=>x.id==='duplicate').action,'duplicate');
 f.db.prepare("UPDATE publications SET status='needs_review' WHERE id=?").run('doneyoutube');
 assert.throws(()=>planQueue(f.read(),now),/Partial\/uncertain/);
});
test('single statement updates every post and job atomically, keeping metadata and IDs',()=>{
 const f=fixture(), current=Date.now();
 for(let i=0;i<47;i++){
  const due=new Date(current+(i+2)*3600000).toISOString();
  f.db.prepare('UPDATE posts SET scheduled_at=? WHERE id=?').run(due,'queued'+i);
  f.db.prepare('UPDATE publications SET next_attempt_at=? WHERE post_id=?').run(due,'queued'+i);
 }
 const before=f.read(),plan=planQueue(before,current),sql=statements(plan,f.snapshot(),new Date(current).toISOString(),'cartoon_queue_test');
 f.db.exec(sql.trigger);const changed=f.db.prepare(sql.update).all(...sql.params);assert.equal(changed.length,47);
 const after=f.read();assert.equal(after.publications.length,before.publications.length);
 for(const row of plan){const a=after.posts.find(x=>x.id===row.id),b=before.posts.find(x=>x.id===row.id);assert.equal(a.caption,b.caption);assert.equal(a.overrides_json,b.overrides_json);assert.equal(a.scheduled_at,row.due);assert.ok(after.publications.filter(x=>x.post_id===row.id).every(x=>x.next_attempt_at===row.due));}
 assert.deepEqual(after.posts.find(x=>x.id==='done'),before.posts.find(x=>x.id==='done'));
 f.db.exec(sql.drop);
});
test('concurrent metadata, new jobs or claimed publications invalidate the entire snapshot',()=>{
 for(const change of ["UPDATE posts SET caption='changed' WHERE id='queued2'","UPDATE publications SET lease_until='2026-11-06T02:00:00Z' WHERE id='queued3facebook'","UPDATE publications SET submission_started=1 WHERE id='queued4youtube'"]){
 const f=fixture(),plan=planQueue(f.read(),now),sql=statements(plan,f.snapshot(),'2026-11-06T01:20:00.000Z','cartoon_queue_test');
 f.db.exec(sql.trigger);f.db.exec(change);assert.equal(f.db.prepare(sql.update).all(...sql.params).length,0);assert.equal(f.read().posts.find(p=>p.id==='queued0').scheduled_at,'2026-11-06T08:00:00.000Z');
 }
});
test('active submissions cannot be planned',()=>{const f=fixture();f.db.exec("UPDATE publications SET attempt=1 WHERE id='queued3youtube'");assert.throws(()=>planQueue(f.read(),now),/started/);});
