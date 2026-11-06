import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const NICHE='ceddb381-8f58-4f64-8598-2437e3fb0c19';
export const QUERIES={
  niche:'SELECT id,name,user_id FROM niches WHERE id=?',
  media:'SELECT id,filename,size,mime,created_at FROM media WHERE niche_id=? ORDER BY created_at,id',
  accounts:'SELECT id,platform,display_name,provider_id,status,connection_kind FROM accounts WHERE niche_id=? ORDER BY id',
  posts:'SELECT * FROM posts WHERE niche_id=? ORDER BY created_at,id',
  publications:'SELECT p.id,p.post_id,p.account_id,p.status,p.provider_post_id,p.attempt,p.submission_started,p.lease_until,p.next_attempt_at,p.updated_at,p.error_code FROM publications p JOIN posts s ON s.id=p.post_id WHERE s.niche_id=? ORDER BY p.id',
};
const london=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
export function localParts(date){return Object.fromEntries(london.formatToParts(new Date(date)).map(p=>[p.type,p.value]));}
function day(date){const p=localParts(date);return `${p.year}-${p.month}-${p.day}`;}
export function slots(now,count=400){
  const out=[];
  for(let t=Math.floor((now+60000)/3600000)*3600000;t<now+180*86400000&&out.length<count;t+=3600000){
    if(t<=now+60000)continue;
    if([9,14,19].includes(Number(localParts(t).hour)))out.push(new Date(t).toISOString());
  }
  return out;
}
const jobs=(s,id)=>s.publications.filter(p=>p.post_id===id);
export function planQueue(s,now=Date.now()){
  if(s.niche.length!==1||s.niche[0].id!==NICHE||s.niche[0].name!=="Craig's Cartoons")throw Error('Unexpected niche');
  const selected=s.accounts.filter(a=>a.status==='connected'&&['facebook','instagram','youtube'].includes(a.platform));
  if(selected.length!==3||new Set(selected.map(a=>a.platform)).size!==3)throw Error('Expected three connected cartoon accounts');
  const expected={facebook:'1482923248227264',instagram:'17841447177484576',youtube:'UCjyHfNEWvdMel3BYaw140SQ'};
  if(selected.some(a=>a.provider_id!==expected[a.platform]))throw Error('Cartoon channel identity changed');
  const ids=selected.map(a=>a.id).sort(),counts=new Map(),taken=new Set();
  // Published, active and uncertain outcomes consume capacity; never retry them here.
  for(const pub of s.publications.filter(p=>p.status!=='pending'&&p.status!=='cancelled')){
    if(!ids.includes(pub.account_id))continue;
    const d=day(pub.updated_at),key=pub.account_id+'|'+d;
    counts.set(key,(counts.get(key)||0)+1);
  }
  const queue=s.posts.filter(p=>p.delivery_status==='scheduled'&&p.publish_mode==='direct').sort((a,b)=>a.scheduled_at.localeCompare(b.scheduled_at)||a.created_at.localeCompare(b.created_at));
  const plan=[],available=slots(now);let cursor=0;
  for(const p of queue){
    const pubs=jobs(s,p.id),dest=JSON.parse(p.destinations_json).sort();
    if(JSON.stringify(dest)!==JSON.stringify(ids)||pubs.length!==3||pubs.some(j=>!ids.includes(j.account_id)))throw Error('Unexpected scheduled destinations: '+p.id);
    if(pubs.some(j=>j.status!=='pending'||j.attempt!==0||j.submission_started||j.lease_until||j.provider_post_id||Date.parse(j.next_attempt_at)<=now+300000)||Date.parse(p.scheduled_at)<=now+300000)throw Error('Scheduled job started or too close to due time: '+p.id);
    const duplicates=pubs.filter(j=>s.publications.some(other=>other.account_id===j.account_id&&other.post_id!==p.id&&s.posts.find(x=>x.id===other.post_id)?.media_id===p.media_id&&other.status!=='cancelled'));
    if(duplicates.length){
      // Only cancel a complete duplicate whose three destinations already have receipts.
      if(duplicates.length!==3||pubs.some(j=>!s.publications.some(o=>o.account_id===j.account_id&&o.post_id!==p.id&&s.posts.find(x=>x.id===o.post_id)?.media_id===p.media_id&&o.status==='published')))throw Error('Partial/uncertain duplicate needs review: '+p.id);
      plan.push({id:p.id,action:'duplicate',due:p.scheduled_at,title:p.title});continue;
    }
    let due;
    while(cursor<available.length){
      const candidate=available[cursor++],d=day(candidate);
      if(ids.some(id=>(counts.get(id+'|'+d)||0)>=3)||taken.has(candidate))continue;
      due=candidate;break;
    }
    if(!due)throw Error('No remaining capacity');
    taken.add(due);for(const id of ids){const key=id+'|'+day(due);counts.set(key,(counts.get(key)||0)+1);}
    plan.push({id:p.id,action:'reschedule',due,title:p.title});
  }
  if(!plan.length)throw Error('No unstarted queue found');
  return plan;
}

export function snapshotSQL(){return `SELECT json_object('posts',(SELECT json_group_array(json(row)) FROM (SELECT json_array(id,updated_at,delivery_status,scheduled_at,title,caption,destinations_json,overrides_json,options_json,media_id) row FROM posts WHERE niche_id=? ORDER BY id)),'publications',(SELECT json_group_array(json(row)) FROM (SELECT json_array(p.id,p.post_id,p.account_id,p.status,p.provider_post_id,p.attempt,p.submission_started,p.lease_until,p.next_attempt_at,p.updated_at) row FROM publications p JOIN posts s ON s.id=p.post_id WHERE s.niche_id=? ORDER BY p.id)),'accounts',(SELECT json_group_array(json(row)) FROM (SELECT json_array(id,platform,provider_id,status) row FROM accounts WHERE niche_id=? ORDER BY id)),'media',(SELECT json_group_array(json(row)) FROM (SELECT json_array(id,filename,size) row FROM media WHERE niche_id=? ORDER BY id))) AS snapshot`;}

export function statements(plan,snapshot,stamp=new Date().toISOString(),name='cartoon_queue_'+randomUUID().replaceAll('-','')){
  if(!/^cartoon_queue_[a-z0-9_]+$/.test(name))throw Error('Invalid trigger name');
  const literal=x=>"'"+String(x).replaceAll("'","''")+"'";
  // A single UPDATE and its trigger make post/calendar/job/audit changes atomic.
  // The MATERIALIZED target reads the complete snapshot once, before any row changes.
  const trigger=`CREATE TRIGGER ${name} AFTER UPDATE ON posts WHEN NEW.updated_at=${literal(stamp)} AND NEW.niche_id=${literal(NICHE)} BEGIN
    SELECT CASE WHEN OLD.delivery_status!='scheduled' OR OLD.publish_mode!='direct' OR (SELECT count(*) FROM publications WHERE post_id=OLD.id)!=3 OR EXISTS(SELECT 1 FROM publications WHERE post_id=OLD.id AND (status!='pending' OR attempt!=0 OR submission_started!=0 OR lease_until IS NOT NULL OR provider_post_id IS NOT NULL OR next_attempt_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 minutes'))) THEN RAISE(ABORT,'Queue changed or publication started') END;
    UPDATE publications SET next_attempt_at=NEW.scheduled_at,status=CASE WHEN NEW.delivery_status='cancelled' THEN 'cancelled' ELSE status END,updated_at=NEW.updated_at WHERE post_id=NEW.id;
    INSERT INTO audit_events(id,user_id,niche_id,action,resource_id,created_at) SELECT lower(hex(randomblob(16))),user_id,NEW.niche_id,CASE WHEN NEW.delivery_status='cancelled' THEN 'post.duplicate_suppressed' ELSE 'post.rescheduled' END,NEW.id,NEW.updated_at FROM niches WHERE id=NEW.niche_id;
  END`;
  const update=`WITH target AS MATERIALIZED (SELECT json_extract(value,'$.id') id,json_extract(value,'$.due') due,json_extract(value,'$.action') action FROM json_each(?) WHERE (${snapshotSQL()})=?)
    UPDATE posts SET scheduled_at=(SELECT due FROM target WHERE target.id=posts.id),delivery_status=CASE WHEN (SELECT action FROM target WHERE target.id=posts.id)='duplicate' THEN 'cancelled' ELSE delivery_status END,status=CASE WHEN (SELECT action FROM target WHERE target.id=posts.id)='duplicate' THEN 'cancelled' ELSE status END,updated_at=? WHERE id IN(SELECT id FROM target) AND niche_id=? RETURNING id,scheduled_at,delivery_status`;
  return {trigger,update,params:[JSON.stringify(plan),NICHE,NICHE,NICHE,NICHE,snapshot,stamp,NICHE],drop:`DROP TRIGGER IF EXISTS ${name}`};
}

export async function main(){
  const base='https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID;
  async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok||!j.success)throw Error('Scoped Cloudflare operation failed HTTP '+r.status+' '+JSON.stringify(j.errors?.map(e=>e.message)));return j.result;}
  const sub=await api('/workers/subdomain');if(sub.subdomain!=='ai-seo')throw Error('Wrong namespace');
  const db=(await api('/d1/database?per_page=100')).find(d=>d.name==='niches');if(!db||db.uuid==='2d15e48a-cd08-4910-9710-fcf4dac74e0d')throw Error('Wrong database');
  const query=async(sql,params=[])=>{const r=await api('/d1/database/'+db.uuid+'/query',{sql,params});if(r.some(x=>x.success===false))throw Error('Query failed');return r[0];};
  const snap=async()=> (await query(snapshotSQL(),[NICHE,NICHE,NICHE,NICHE])).results[0].snapshot;
  const before=await snap(),s={};
  for(const [key,sql]of Object.entries(QUERIES))s[key]=(await query(sql,[NICHE])).results;
  const plan=planQueue(s);
  fs.writeFileSync('cartoon-queue-before.json',JSON.stringify(s,null,2));
  console.log('QUEUE PLAN '+JSON.stringify(plan));
  await new Promise(resolve=>setTimeout(resolve,10000));
  if(await snap()!==before)throw Error('Queue is changing; no updates applied');
  if(process.env.CARTOON_QUEUE_APPLY!=='three-per-day-2026-11-06')return;
  const sql=statements(plan,before);
  await query(sql.trigger);
  let changed;
  try{changed=(await query(sql.update,sql.params)).results;}finally{await query(sql.drop);}
  if(changed.length!==plan.length)throw Error('Queue snapshot changed; no updates applied');
  const after={};for(const [key,sql]of Object.entries(QUERIES))after[key]=(await query(sql,[NICHE])).results;
  for(const row of plan){const p=after.posts.find(p=>p.id===row.id);if(p.scheduled_at!==row.due)throw Error('Post verification failed');for(const pub of jobs(after,row.id))if(pub.next_attempt_at!==row.due||pub.status!==(row.action==='duplicate'?'cancelled':'pending'))throw Error('Job verification failed');}
  // Metadata, media and every untargeted row must be byte-identical.
  if(JSON.stringify(s.media)!==JSON.stringify(after.media))throw Error('Media inventory changed');
  for(const p of s.posts){const a=after.posts.find(x=>x.id===p.id),target=plan.some(x=>x.id===p.id);for(const key of Object.keys(p))if(!(target&&['scheduled_at','updated_at','status','delivery_status'].includes(key))&&JSON.stringify(a[key])!==JSON.stringify(p[key]))throw Error('Unexpected post change '+key);}
  fs.writeFileSync('cartoon-queue-after.json',JSON.stringify(after,null,2));
  console.log('QUEUE VERIFIED '+JSON.stringify({media:after.media.length,rescheduled:plan.filter(p=>p.action==='reschedule').length,duplicates_suppressed:plan.filter(p=>p.action==='duplicate').length,publications:after.publications.length,next:plan.filter(p=>p.action==='reschedule').slice(0,3)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
