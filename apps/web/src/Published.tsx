import { useEffect, useState } from "react";
import { call, mediaPath } from "./niches-api";

type Publication = {id:string; post_id:string; niche_id:string; niche_name:string; brand_name:string|null; account_id:string; display_name:string; platform:string; title:string; caption:string; media_id:string|null; media_mime:string|null; campaign_url:string|null; campaign_deadline_minutes:number; campaign_submitted_at:string|null; published_at:string|null; public_url:string|null; status:string; updated_at:string; error:string|null};
export default function Published({nicheId}:{nicheId?:string}) {
  const [rows,setRows]=useState<Publication[]>([]),[error,setError]=useState(""),[clock,setClock]=useState(Date.now()),[offset,setOffset]=useState(0),[filter,setFilter]=useState("all"),[platform,setPlatform]=useState("all"),[query,setQuery]=useState("");
  async function load() { try { const result=await call<{server_time:string;publications:Publication[]}>("/api/publications"); setRows(result.publications); setOffset(Date.parse(result.server_time)-Date.now()); setError(""); } catch(e) { setError((e as Error).message); } }
  useEffect(()=>{void load(); const t=setInterval(()=>void load(),30000); const c=setInterval(()=>setClock(Date.now()),1000); return ()=>{clearInterval(t);clearInterval(c);};},[]);
  const remaining=(p:Publication)=>p.platform==='instagram' && p.published_at ? Date.parse(p.published_at)+p.campaign_deadline_minutes*60000-(clock+offset) : null;
  const visible=rows.filter(p=>!nicheId||p.niche_id===nicheId).filter(p=>platform==='all'||p.platform===platform).filter(p=>`${p.niche_name} ${p.brand_name||''} ${p.display_name} ${p.title} ${p.caption} ${p.campaign_url||''}`.toLowerCase().includes(query.toLowerCase())).filter(p=>filter==='all'||(filter==='submitted'&&!!p.campaign_submitted_at)||(filter==='awaiting'&&!!p.campaign_url&&!p.campaign_submitted_at&&(remaining(p)===null||remaining(p)!>0))||(filter==='overdue'&&!!p.campaign_url&&!p.campaign_submitted_at&&remaining(p)!==null&&remaining(p)!<=0));
  return <section className="n-panel"><h1>Published</h1><p>Publication results for each account.</p>
    {error&&<p className="n-error" role="alert">{error}</p>}
    <label>Search niches, brands, accounts and campaigns <input value={query} onChange={e=>setQuery(e.target.value)} /></label>
    <label>Platform <select value={platform} onChange={e=>setPlatform(e.target.value)}><option value="all">All</option>{['instagram','facebook','youtube','tiktok'].map(p=><option key={p}>{p}</option>)}</select></label>
    <label>Submission <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All</option><option value="awaiting">Awaiting submission</option><option value="submitted">Submitted</option><option value="overdue">Overdue</option></select></label>
    {visible.map(p=>{const left=remaining(p); return <article className="n-post-row" key={p.id} style={{display:'block'}}>
      <h3>{p.title || 'Untitled'} · {p.display_name}</h3><p>{p.niche_name} · {p.brand_name||'No brand'} · {p.platform} · {p.status.replaceAll('_',' ')}</p>
      <p>{p.published_at ? new Date(p.published_at).toLocaleString() : 'Publication time unavailable'}</p>
      {p.media_id&&(p.media_mime?.startsWith('image/')?<img alt="Post preview" style={{maxWidth:'160px'}} src={mediaPath(p.niche_id,p.media_id)} />:<video controls preload="none" style={{maxWidth:'160px'}} src={mediaPath(p.niche_id,p.media_id)} />)}
      <p>{p.caption}</p>{p.error&&<p role="alert">{p.error}</p>}
      {p.public_url?<p><a href={p.public_url} target="_blank" rel="noreferrer">View post</a>{' '}<button onClick={()=>void navigator.clipboard.writeText(p.public_url!)}>Copy public URL</button></p>:<p>Public URL unavailable or still being retrieved.</p>}
      <details><summary>Edit campaign</summary><form onSubmit={async e=>{e.preventDefault();const data=new FormData(e.currentTarget);try{await call(`/api/niches/${p.niche_id}/publications/${p.id}/campaign`,'PATCH',{campaign_url:String(data.get('campaign_url')||''),deadline_minutes:Number(data.get('deadline_minutes'))});await load();}catch(err){setError((err as Error).message);}}}><label>Campaign URL <input type="url" name="campaign_url" defaultValue={p.campaign_url||''}/></label><label>Deadline in minutes <input type="number" name="deadline_minutes" min="1" max="10080" defaultValue={p.campaign_deadline_minutes}/></label><button>Save campaign</button></form></details>
      {p.campaign_url&&<><p><a href={p.campaign_url} target="_blank" rel="noreferrer">Open campaign</a></p>
        <label><input type="checkbox" checked={!!p.campaign_submitted_at} disabled={p.status!=='published'} onChange={async e=>{try{await call(`/api/niches/${p.niche_id}/publications/${p.id}/campaign`,'PATCH',{submitted:e.target.checked});await load();}catch(err){setError((err as Error).message);}}}/> Submitted to Content Rewards</label>
        {p.campaign_submitted_at?<p>Submitted {new Date(p.campaign_submitted_at).toLocaleString()}</p>:left===null?<p>Countdown unavailable: publication time not confirmed.</p>:<p role={left<300000?'alert':undefined}>{left<=0?'Submission overdue':`Time left: ${Math.floor(left/60000)}:${String(Math.floor(left/1000)%60).padStart(2,'0')}`}</p>}
      </>}
    </article>})}{!visible.length&&<p>No matching publication records.</p>}
  </section>;
}
