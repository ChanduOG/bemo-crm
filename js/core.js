/* BEMO-SOLUTIONS Operations OS — core: store, utilities, components, charts, overlays, shell, router. */
(function(){
const W = window;

/* ============ Utilities ============ */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const pd = d => { if(!d) return null; const [y,m,dd] = d.slice(0,10).split('-').map(Number); return new Date(Date.UTC(y,m-1,dd)); };
const iso = dt => dt.toISOString().slice(0,10);
const addDays = (d,n) => { const x = pd(d); x.setUTCDate(x.getUTCDate()+n); return iso(x); };
const days = (a,b) => Math.round((pd(b)-pd(a))/86400000);
const until = d => d ? days(TODAY, d) : null;
const fmtD = d => { if(!d) return '—'; const x=pd(d); return x.getUTCDate()+' '+MON[x.getUTCMonth()]+' '+x.getUTCFullYear(); };
const fmtDs = d => { if(!d) return '—'; const x=pd(d); return x.getUTCDate()+' '+MON[x.getUTCMonth()]; };
const fmtT = dt => dt && dt.length>10 ? dt.slice(11,16) : '';
const fmtDT = dt => dt ? fmtDs(dt)+(fmtT(dt)?', '+fmtT(dt):'') : '—';
const fmtM = m => { const [y,mm]=m.split('-'); return MON[+mm-1]+' '+y.slice(2); };
const rel = dt => {
  if(!dt) return '—'; const n = days(dt.slice(0,10), TODAY);
  if(n===0) return fmtT(dt) ? 'Today '+fmtT(dt) : 'Today';
  if(n===1) return 'Yesterday'; if(n>1 && n<7) return n+'d ago'; if(n<0 && n>-7) return 'in '+(-n)+'d';
  return fmtDs(dt);
};
const dueTxt = d => { if(!d) return '—'; const n=until(d); if(n===0) return 'Today'; if(n===1) return 'Tomorrow'; if(n===-1) return 'Yesterday'; if(n<0) return (-n)+'d overdue'; if(n<7) return 'in '+n+'d'; return fmtDs(d); };
const nowStamp = () => { const t=new Date(); return TODAY+'T'+String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0'); };
const fmtN = n => Math.round(n).toLocaleString('en-ZA');
const fmtR = (n, dec) => 'R ' + (dec ? Number(n).toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2}) : Math.round(n).toLocaleString('en-ZA'));
const fmtRk = n => { const a=Math.abs(n); if(a>=1e6) return 'R '+(n/1e6).toFixed(a>=1e7?1:2).replace(/\.?0+$/,'')+'m'; if(a>=1e3) return 'R '+Math.round(n/1e3)+'k'; return 'R '+Math.round(n); };
const pct = (a,b) => b ? Math.round(a/b*100) : 0;
const sum = (arr, f) => arr.reduce((s,x)=>s+(f?f(x):x),0);
const uniq = a => Array.from(new Set(a));
const initials = n => n.replace(/^Dr\s+/,'').split(/\s+/).filter(Boolean).map(s=>s[0]).slice(0,2).join('').toUpperCase();
const ID_BASE = {'C-':1000,'E-':5000,'D-':6000,'A-':7000,'Q-':3100,'INV-':4100,'P-':2400,'T-':8000};
const nextId = (prefix, arr) => prefix + (Math.max(ID_BASE[prefix]||0, ...arr.map(x => +String(x.id).replace(/\D/g,'') || 0)) + 1);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

/* ============ Icons (Lucide data, rendered inline) ============ */
const ICON_CACHE = {};
function ic(name, size=16, cls=''){
  name = name || 'layers';
  const key = name+'|'+size+'|'+cls; if(ICON_CACHE[key]) return ICON_CACHE[key];
  const pas = name.split('-').map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join('');
  let inner = '';
  const L = W.lucide && (W.lucide.icons || W.lucide);
  const node = L && L[pas];
  if(node){
    const kids = (Array.isArray(node) && node[0]==='svg') ? node[2] : node;
    if(Array.isArray(kids)) inner = kids.map(k => '<'+k[0]+' '+Object.entries(k[1]||{}).map(([a,v])=>a+'="'+v+'"').join(' ')+'/>').join('');
  } else { inner = '<circle cx="12" cy="12" r="4"/>'; }
  return ICON_CACHE[key] = `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
const LOGO = (s=18) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64" role="img" aria-label="BEMO-SOLUTIONS"><rect width="64" height="64" rx="16" fill="#0B1220"/><path d="M20 15V49M20 15H31A8.5 8.5 0 0 1 31 32H20M20 32H33.5A8.5 8.5 0 0 1 33.5 49H20" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="49" cy="15" r="4.25" fill="#20C7D9"/></svg>`;

/* ============ Store ============ */
const KEY = 'ikusasa-os-live';
let DB; let STORAGE_OK = true;
/* Never discards stored records: older saves are upgraded by adding any missing collections. */
function upgrade(d){ const seed = makeSeed(); Object.keys(seed).forEach(k=>{ if(d[k]===undefined) d[k]=seed[k]; }); Object.keys(seed.settings).forEach(k=>{ if(d.settings[k]===undefined) d.settings[k]=seed.settings[k]; else if(typeof seed.settings[k]==='object') Object.keys(seed.settings[k]).forEach(j=>{ if(d.settings[k][j]===undefined) d.settings[k][j]=seed.settings[k][j]; }); }); d.v = SEED_VERSION; return d; }
function load(){
  if(W.CLOUD_DB){ DB = upgrade(W.CLOUD_DB); W.CLOUD_DB = null; return; }   // cloud mode: data comes from Supabase
  try { const s = localStorage.getItem(KEY); if(s){ const d = JSON.parse(s); if(d && typeof d==='object'){ DB = upgrade(d); return; } } } catch(e){ STORAGE_OK = false; }
  DB = makeSeed();
}
function saveNow(){ if(W.CLOUD_ON){ if(W.onDBSaved) W.onDBSaved(); return; } try { localStorage.setItem(KEY, JSON.stringify(DB)); STORAGE_OK = true; } catch(e){ if(STORAGE_OK) setTimeout(()=>toast('Could not save — browser storage is blocked or full. Export a backup now.','err'),0); STORAGE_OK = false; } }
const save = debounce(saveNow, 150);
window.addEventListener('beforeunload', saveNow);
function resetDB(){ DB = makeSeed(); saveNow(); }
function replaceDB(d){ DB = upgrade(d); saveNow(); }
const pref = { get(k,d){ try { const v = localStorage.getItem('ikl-'+k); return v===null ? d : JSON.parse(v); } catch(e){ return d; } }, set(k,v){ try { localStorage.setItem('ikl-'+k, JSON.stringify(v)); } catch(e){} } };

const get = {
  client: id => DB.clients.find(x=>x.id===id),
  user: id => DB.users.find(x=>x.id===id),
  project: id => DB.projects.find(x=>x.id===id),
  quote: id => DB.quotes.find(x=>x.id===id),
  invoice: id => DB.invoices.find(x=>x.id===id),
  task: id => DB.tasks.find(x=>x.id===id),
  enquiry: id => DB.enquiries.find(x=>x.id===id),
  disc: id => DB.discoveries.find(x=>x.id===id),
  conv: id => DB.conversations.find(x=>x.id===id),
  doc: id => DB.documents.find(x=>x.id===id),
  wf: id => DB.workflows.find(x=>x.id===id)
};
const me = () => get.user(DB.me);
const uname = id => (get.user(id)||{name: id ? 'Former member' : 'Unassigned'}).name;
/* Notifications can target one person (n.for); untargeted ones are for everyone */
const mine = n => !n.for || n.for===DB.me;

/* ============ Derived calculations ============ */
const calc = {
  quote(q){ const sub = sum(q.items, i=>i.qty*i.price); const vat = sub*q.vat; return {sub, vat, total: sub+vat}; },
  inv(i){
    const sub=i.subtotal, vat=sub*i.vat, total=sub+vat, received=sum(i.payments,p=>p.amount), outstanding=Math.max(0,total-received);
    let status;
    if(i.flag==='cancelled') status='Cancelled'; else if(i.flag==='draft') status='Draft';
    else if(received >= total-0.5) status='Paid'; else if(received>0) status='Partially paid';
    else if(i.due < TODAY) status='Overdue'; else status='Issued';
    const overdue = !['Paid','Cancelled','Draft'].includes(status) && i.due < TODAY;
    return {sub, vat, total, received, outstanding: (status==='Cancelled'||status==='Draft')?0:outstanding, status, overdue, daysOver: overdue ? days(i.due, TODAY) : 0};
  },
  progress(p){
    if(p.status==='Completed') return 100;
    const w = {'Done':1,'In review':.85,'In progress':.45,'Blocked':.3,'Not started':0};
    return p.workstreams.length ? Math.round(sum(p.workstreams, s=>w[s.status]||0)/p.workstreams.length*100) : 0;
  },
  payStatus(p){
    const inv = DB.invoices.filter(i=>i.projectId===p.id && i.flag!=='cancelled');
    if(p.status==='Awaiting authorization' && !inv.some(i=>calc.inv(i).status==='Paid')) return {t:'Deposit pending', tone:'amber'};
    if(!inv.length) return {t:'Not invoiced', tone:'gray'};
    const st = inv.map(i=>calc.inv(i));
    if(st.some(s=>s.overdue)) return {t:'Overdue', tone:'red'};
    if(st.every(s=>s.status==='Paid')) return {t:'Paid to date', tone:'green'};
    if(st.some(s=>s.status==='Draft') && st.filter(s=>s.status!=='Draft').every(s=>s.status==='Paid')) return {t:'Paid to date', tone:'green'};
    return {t:'Invoice outstanding', tone:'blue'};
  },
  load(u){
    const open = DB.tasks.filter(t=>t.assignee===u.id && t.status!=='Done');
    const overdue = open.filter(t=>t.due && t.due<TODAY);
    const done = DB.tasks.filter(t=>t.assignee===u.id && t.status==='Done').length;
    const projects = DB.projects.filter(p=>!['Completed','On hold'].includes(p.status) && (p.team.includes(u.id)||p.pm===u.id||p.tech===u.id));
    return {open: open.length, overdue: overdue.length, done, projects: projects.length, util: pct(u.alloc, u.capacity), hours: sum(open,t=>t.est||0)};
  },
  ltv(c){ return sum(DB.invoices.filter(i=>i.clientId===c.id), i=>sum(i.payments,p=>p.amount)/(1+i.vat)); },
  outstanding(c){ return sum(DB.invoices.filter(i=>i.clientId===c.id), i=>calc.inv(i).outstanding); },
  mrr(){ return sum(DB.retainers.filter(r=>!r.until || r.until>=TODAY), r=>r.monthly); },
  /* Monthly series computed from real records: last n months ending this month */
  monthly(n=12){
    const out=[]; const t=pd(TODAY);
    for(let i=n-1;i>=0;i--){ const d=new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth()-i, 1)); out.push(iso(d).slice(0,7)); }
    return out.map(m=>{
      const pays = DB.invoices.flatMap(i=>i.payments.filter(p=>p.date.startsWith(m)).map(p=>({p,i})));
      return {m,
        revenue: sum(pays, x=>x.p.amount/(1+x.i.vat)),
        collected: sum(pays, x=>x.p.amount),
        costs: sum(DB.expenses.filter(x=>x.date.startsWith(m)), x=>x.amount),
        quoted: sum(DB.quotes.filter(q=>(q.sent||q.created||'').startsWith(m)), q=>calc.quote(q).sub),
        accepted: sum(DB.quotes.filter(q=>q.status==='Accepted' && (q.accepted||'').startsWith(m)), q=>calc.quote(q).sub),
        enquiries: DB.enquiries.filter(e=>e.received.startsWith(m)).length,
        mrr: sum(DB.retainers.filter(r=>r.since.slice(0,7)<=m && (!r.until || r.until.slice(0,7)>=m)), r=>r.monthly)
      };
    });
  },
  funnel(){
    const order = s => STATUS.client.indexOf(s);
    const cl = DB.clients;
    const paidIds = new Set(DB.invoices.filter(i=>i.payments.length).map(i=>i.clientId));
    const accIds = new Set(DB.quotes.filter(q=>q.status==='Accepted').map(q=>q.clientId));
    return [
      {label:'Enquiries', value:DB.enquiries.filter(e=>e.status!=='Archived').length, go:'inbox'},
      {label:'Qualified leads', value:cl.filter(c=>c.status!=='Lost / archived' && order(c.status)>=order('Contacted')).length + cl.filter(c=>c.status==='Lost / archived').length, go:'crm'},
      {label:'Discovery held', value:new Set(DB.discoveries.filter(d=>d.status==='Completed').map(d=>d.clientId)).size, go:'discovery'},
      {label:'Quoted', value:new Set(DB.quotes.filter(q=>q.status!=='Draft').map(q=>q.clientId)).size, go:'quotes'},
      {label:'Accepted', value:accIds.size},
      {label:'Paid', value:paidIds.size, go:'invoices'}
    ];
  }
};

/* ============ Status tones ============ */
const TONE = {
  'New enquiry':'blue','Contact pending':'amber','Contacted':'cyan','Discovery scheduled':'cyan','Discovery completed':'cyan','Assessment in progress':'cyan','Quote preparation':'blue','Quote sent':'blue','Awaiting decision':'amber','Accepted':'green','Payment pending':'amber','Active client':'green','Project completed':'gray','Ongoing partnership':'green','Lost / archived':'gray',
  'Draft':'gray','Internal review':'amber','Sent':'blue','Viewed':'cyan','Rejected':'red','Expired':'gray',
  'Issued':'blue','Partially paid':'amber','Paid':'green','Overdue':'red','Cancelled':'gray',
  'Awaiting authorization':'amber','Ready to start':'cyan','Planning':'blue','In progress':'cyan','In review':'blue','Awaiting client feedback':'amber','Blocked':'red','Testing':'blue','Deployment':'cyan','Handover':'cyan','Completed':'green','On hold':'gray',
  'Backlog':'gray','To do':'gray','Done':'green','Not started':'gray',
  'Unprocessed':'amber','New':'blue','Converted':'green','Archived':'gray',
  'Active':'green','Paused':'gray','Error':'red','Success':'green','Simulated':'amber','Not connected':'gray','Connected':'green','In setup':'amber','Ended':'gray','Planned':'blue','Scheduled':'blue','Failed':'red',
  'Available':'green','Busy':'amber','On leave':'gray','Open':'blue','Awaiting client':'amber','Low':'green','Medium':'amber','High':'red','Completed ':'green'
};
const CAT_COLOR = {'Website':'var(--c2)','Automation':'var(--c1)','AI system':'var(--c6)','Custom application':'var(--c4)','System integration':'var(--c3)','Hybrid':'var(--c5)'};
const CAT_ICON = {'Website':'globe','Automation':'workflow','AI system':'sparkles','Custom application':'app-window','System integration':'git-merge','Hybrid':'layers'};
const AV_COL = ['#0A7F8B','#3159BF','#2A7A55','#9C5068','#9A6610','#55626E','#3D6E8F','#7B6236','#2F6F73','#6A5A9A'];

/* ============ Components ============ */
const badge = (t, tone, cls='') => `<span class="b ${tone||TONE[t]||'gray'} ${cls}">${esc(t)}</span>`;
const prio = p => `<span class="prio p-${(p||'').toLowerCase()}"><i><b></b><b></b><b></b></i>${esc(p)}</span>`;
function av(uid, size=''){
  const u = get.user(uid); if(!u) return `<span class="av ${size}" style="background:var(--fg-4)">${uid==='sys'?ic('zap',12):'?'}</span>`;
  const col = AV_COL[(+u.id.slice(1))%AV_COL.length];
  const st = size==='lg'||size==='xl' ? `<span class="st" style="background:var(--${u.status==='Available'?'green':u.status==='Busy'?'amber':'fg-4'})"></span>` : '';
  return `<span class="av ${size}" style="background:${col}" data-tip="${esc(u.name)} · ${esc(u.role)}">${initials(u.name)}${st}</span>`;
}
const avs = (ids, max=4) => `<span class="avs">${ids.slice(0,max).map(i=>av(i,'sm')).join('')}${ids.length>max?`<span class="av sm" style="background:var(--surface-3);color:var(--fg-2)">+${ids.length-max}</span>`:''}</span>`;
const who = (uid, sub) => { const u=get.user(uid); if(!u) return uid==='sys' ? `<span class="who">${av('sys','sm')}<span class="muted">Automation</span></span>` : '<span class="muted">Unassigned</span>'; return `<span class="who">${av(uid,'sm')}<span class="trunc">${esc(u.name)}</span>${sub?`<span class="muted small">${esc(sub)}</span>`:''}</span>`; };
const coIc = (c, size='') => { const col = AV_COL[(+String(c.id).replace(/\D/g,''))%AV_COL.length]; return `<span class="co-ic ${size}" style="color:${col}">${initials(c.name)}</span>`; };
const clientLink = id => { const c=get.client(id); return c ? `<a href="#client-${c.id}" class="cell-t">${esc(c.name)}</a>` : '<span class="muted">New contact</span>'; };
const prog = (v, tone) => `<div class="pg-row"><div class="pg ${tone||(v>=100?'green':'')}"><i style="width:${Math.min(100,v)}%"></i></div><span class="num">${v}%</span></div>`;
const empty = (icon, title, text, action='') => `<div class="empty"><div class="ei">${ic(icon,20)}</div><b>${esc(title)}</b><p>${text||''}</p>${action}</div>`;
const card = (title, body, {act='', hint='', flush=false, cls='', id=''}={}) => `<section class="card ${cls}" ${id?`id="${id}"`:''}>${title!==null?`<div class="card-h"><div class="row" style="min-width:0"><h3>${title}</h3>${hint?`<span class="hint">${hint}</span>`:''}</div><div class="row">${act}</div></div>`:''}<div class="card-b ${flush?'flush':''}">${body}</div></section>`;
const pageHead = (title, sub, actions='') => `<div class="ph"><div><h1>${title}</h1>${sub?`<p class="ph-sub">${sub}</p>`:''}</div><div class="ph-act">${actions}</div></div>`;
const srcIcon = ch => `<span class="src ${ch}" data-tip="${({email:'Email',whatsapp:'WhatsApp',web:'Website form',referral:'Referral',manual:'Manual entry',call:'Call',meeting:'Meeting',note:'Internal note'})[ch]||ch}">${ic(({email:'mail',whatsapp:'message-circle',web:'globe',referral:'handshake',manual:'pen-line',call:'phone',meeting:'video',note:'sticky-note'})[ch]||'circle',13)}</span>`;
const aiTag = (t='AI suggestion') => `<span class="ai-tag">${ic('sparkles',11)}${t}</span>`;
const verTag = (t='Verified record') => `<span class="ver-tag">${ic('shield-check',11)}${t}</span>`;
const simTag = (t='Simulated') => `<span class="sim-tag">${ic('flask-conical',11)}${t}</span>`;
const catTag = c => `<span class="tag">${ic(CAT_ICON[c]||'circle',12)}${esc(c)}</span>`;
function opts(list, val, {blank}={}){ return (blank!==undefined?`<option value="">${esc(blank)}</option>`:'') + list.map(o => { const [v,l] = Array.isArray(o)?o:[o,o]; return `<option value="${esc(v)}" ${String(v)===String(val??'')?'selected':''}>${esc(l)}</option>`; }).join(''); }
const userOpts = (val, blank) => opts(DB.users.map(u=>[u.id,u.name]), val, {blank});
const clientOpts = (val, blank) => opts(DB.clients.filter(c=>c.status!=='Lost / archived').map(c=>[c.id,c.name]), val, {blank});
const field = (label, ctl, cls='') => `<div class="field ${cls}"><label>${label}</label>${ctl}</div>`;
const segc = (key, items, cur, act='seg') => `<div class="seg" role="tablist">${items.map(([v,l,i])=>`<button class="${v===cur?'on':''}" data-a="${act}" data-key="${key}" data-v="${v}" role="tab" aria-selected="${v===cur}">${i?ic(i,14):''}${l}</button>`).join('')}</div>`;
const tabsc = (key, items, cur) => `<div class="tabs" role="tablist">${items.map(([v,l,ct])=>`<button class="tab ${v===cur?'on':''}" data-a="seg" data-key="${key}" data-v="${v}" role="tab" aria-selected="${v===cur}">${l}${ct!==undefined&&ct!==null?`<span class="ct">${ct}</span>`:''}</button>`).join('')}</div>`;
const searchBox = (key, ph) => `<div class="inp-wrap">${ic('search',14)}<input class="inp" id="q-${key}" placeholder="${ph}" value="${esc(UI.q[key]||'')}" data-in="q" data-key="${key}" autocomplete="off"></div>`;
const kpiCell = ({l, v, d, tone, go, icon, sp}) => `<div class="kpi" ${go?`data-go="${go}"`:''}><div class="kpi-l">${icon?ic(icon,13):''}${l}</div><div class="kpi-v">${v}</div>${d?`<div class="kpi-d ${tone||''}">${d}</div>`:''}${sp?`<div class="spk">${sp}</div>`:''}</div>`;

/* Data table with sorting */
function table({key, cols, rows, go, act, emptyMsg, foot}){
  const s = UI.sort[key] || {};
  let data = rows.slice();
  if(s.col){ const c = cols.find(c=>c.k===s.col); if(c){ const sv = c.sv || (r=>r[c.k]); data.sort((a,b)=>{ const x=sv(a), y=sv(b); return (x>y?1:x<y?-1:0)*s.dir; }); } }
  if(!data.length) return emptyMsg || empty('search-x','No matching records','Try clearing filters or search.');
  return `<div class="tw"><table class="tbl"><thead><tr>${cols.map(c=>`<th class="${c.sort!==false?'sortable':''} ${s.col===c.k?'sorted':''} ${c.cls||''}" ${c.sort!==false?`data-a="sort" data-key="${key}" data-col="${c.k}"`:''} ${c.w?`style="width:${c.w}"`:''}>${c.l}${c.sort!==false?`<span class="si">${s.col===c.k?(s.dir>0?'↑':'↓'):'↕'}</span>`:''}</th>`).join('')}</tr></thead><tbody>${data.map(r=>`<tr ${go?`data-go="${go(r)}"`:''} ${act?act(r):''}>${cols.map(c=>`<td class="${c.cls||''}">${c.r?c.r(r):esc(r[c.k])}</td>`).join('')}</tr>`).join('')}</tbody>${foot?`<tfoot><tr>${foot}</tr></tfoot>`:''}</table></div>`;
}

/* ============ Charts (inline SVG / HTML) ============ */
function nice(max, n=4){ if(max<=0) return {max:n, step:1}; const raw=max/n, p=Math.pow(10,Math.floor(Math.log10(raw))); const m=[1,2,2.5,5,10].find(x=>x*p>=raw-1e-9); return {max:m*p*n, step:m*p}; }
function chArea({labels, series, h=220, fmt=fmtRk, w=640, area=true, yLabel}){
  const pl=48, pr=14, pt=14, pb=26, iw=w-pl-pr, ih=h-pt-pb;
  const mx = Math.max(...series.flatMap(s=>s.values)); const sc = nice(mx);
  const x = i => pl + (labels.length===1?iw/2: i*iw/(labels.length-1)); const y = v => pt + ih - v/sc.max*ih;
  let g='';
  for(let v=0; v<=sc.max+1e-9; v+=sc.step){ g+=`<line class="grid-l" x1="${pl}" x2="${w-pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl-8}" y="${y(v)+3.5}" text-anchor="end">${fmt(v)}</text>`; }
  const step = Math.ceil(labels.length/8);
  labels.forEach((l,i)=>{ if(i%step===0 || i===labels.length-1) g+=`<text x="${x(i)}" y="${h-8}" text-anchor="middle">${esc(l)}</text>`; });
  series.forEach((s,si)=>{
    const pts = s.values.map((v,i)=>[x(i),y(v)]);
    const d = pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
    if(area && si===0) g+=`<path class="area" d="${d} L${x(labels.length-1)} ${pt+ih} L${x(0)} ${pt+ih} Z" style="fill:${s.color};fill-opacity:.10"/>`;
    g+=`<path class="ln" d="${d}" style="fill:none;stroke:${s.color};stroke-width:${si===0?2:1.6};${s.dash?'stroke-dasharray:4 4;animation:none;':''}" stroke-linejoin="round" stroke-linecap="round"/>`;
    const lp = pts[pts.length-1]; g+=`<circle cx="${lp[0]}" cy="${lp[1]}" r="3.5" style="fill:${s.color};stroke:var(--surface);stroke-width:2"/>`;
  });
  const cw = iw/Math.max(1,labels.length-1);
  labels.forEach((l,i)=>{ const tip = l+'\n'+series.map(s=>s.name+': '+fmt(s.values[i])).join('\n'); g+=`<rect class="hov" x="${x(i)-cw/2}" y="${pt}" width="${cw}" height="${ih}" data-tip="${esc(tip)}"/>`; });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(series.map(s=>s.name).join(', '))} chart">${g}</svg>`;
}
function chBars({labels, series, h=220, fmt=fmtRk, w=640, stacked=false, act, hl}){
  const pl=48, pr=10, pt=14, pb=26, iw=w-pl-pr, ih=h-pt-pb;
  const mx = stacked ? Math.max(...labels.map((_,i)=>sum(series,s=>s.values[i]))) : Math.max(...series.flatMap(s=>s.values));
  const sc = nice(mx); const y = v => pt+ih-v/sc.max*ih;
  let g='';
  for(let v=0; v<=sc.max+1e-9; v+=sc.step){ g+=`<line class="grid-l" x1="${pl}" x2="${w-pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl-8}" y="${y(v)+3.5}" text-anchor="end">${fmt(v)}</text>`; }
  const gw = iw/labels.length, inner = gw*0.64, bw = stacked ? inner : inner/series.length;
  labels.forEach((l,i)=>{
    const gx = pl + i*gw + (gw-inner)/2; let acc=0;
    series.forEach((s,si)=>{
      const v = s.values[i]; const bh = Math.max(v>0?1.5:0, v/sc.max*ih);
      const bx = stacked ? gx : gx+si*bw; const by = stacked ? y(acc+v) : y(v); acc += v;
      const dim = hl!==undefined && hl!==i ? 'opacity:.35;' : '';
      g+=`<rect class="bar" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(2,bw-(stacked?0:2)).toFixed(1)}" height="${bh.toFixed(1)}" rx="2.5" style="fill:${s.color};${dim}animation-delay:${i*25}ms" data-tip="${esc(l+'\n'+s.name+': '+fmt(v))}" ${act?act(i,si):''}/>`;
    });
    g+=`<text x="${pl+i*gw+gw/2}" y="${h-8}" text-anchor="middle">${esc(l)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Bar chart">${g}</svg>`;
}
function chDonut({items, fmt=fmtRk, center, size=140, act}){
  const tot = sum(items,i=>i.value)||1; const r=54, c=2*Math.PI*r; let off=0;
  const segs = items.map((it,i)=>{ const len = it.value/tot*c; const s = `<circle class="donut-s" cx="70" cy="70" r="${r}" fill="none" style="stroke:${it.color};animation-delay:${i*60}ms" stroke-width="18" stroke-dasharray="${Math.max(0,len-1.5)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)" data-tip="${esc(it.label+'\n'+fmt(it.value)+' · '+pct(it.value,tot)+'%')}" ${act?act(i):''}/>`; off+=len; return s; }).join('');
  return `<div class="donut-wrap"><svg viewBox="0 0 140 140" class="chart" role="img" aria-label="Donut chart">${segs}${center?`<text x="70" y="68" text-anchor="middle" style="font-size:17px;font-weight:600;fill:var(--fg)">${center.v}</text><text x="70" y="85" text-anchor="middle" style="font-size:10px">${center.l}</text>`:''}</svg><div class="legend">${items.map((it,i)=>`<span ${act?act(i):''} style="${act?'cursor:pointer':''}"><span class="row gap-4" style="gap:7px"><i style="background:${it.color}"></i>${esc(it.label)}</span><b>${fmt(it.value)} <span class="muted" style="font-weight:400">${pct(it.value,tot)}%</span></b></span>`).join('')}</div></div>`;
}
function chHBar({items, fmt=fmtRk, max}){
  const mx = max || Math.max(...items.map(i=>Math.max(i.value, i.marker||0)),1);
  return `<div class="hb">${items.map((it,i)=>`<div class="hb-r" ${it.go?`data-go="${it.go}"`:''} ${it.act||''} data-tip="${esc(it.tip||it.label+': '+fmt(it.value))}"><span class="hb-l">${it.labelHtml||esc(it.label)}</span><span class="hb-t"><i class="hb-f" style="width:${Math.min(100,it.value/mx*100)}%;background:${it.color||'var(--c1)'};animation-delay:${i*40}ms"></i>${it.marker?`<span class="hb-m" style="left:${it.marker/mx*100}%"></span>`:''}</span><span class="hb-v">${it.valueHtml||fmt(it.value)}</span></div>`).join('')}</div>`;
}
function chFunnel(stages){
  const top = stages[0].value||1;
  return `<div class="funnel">${stages.map((s,i)=>`<div class="fn-r" ${s.go?`data-go="${s.go}" style="cursor:pointer"`:''} data-tip="${esc(s.label+': '+s.value+(i?'\n'+pct(s.value,stages[i-1].value)+'% of previous stage':''))}"><span class="sub trunc">${esc(s.label)}</span><span><span class="fn-b hb-f" style="width:${Math.max(6,s.value/top*100)}%;opacity:${1-i*0.11};animation-delay:${i*50}ms">${s.value}</span></span><span class="fn-c">${i?pct(s.value,stages[i-1].value)+'% conv.':'—'}</span></div>`).join('')}</div>`;
}
function spark(values, color='var(--c1)', w=76, h=26){
  const mx=Math.max(...values), mn=Math.min(...values), rg=(mx-mn)||1;
  const pts = values.map((v,i)=>[i*(w-4)/(values.length-1)+2, h-3-(v-mn)/rg*(h-6)]);
  const d = pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const lp = pts[pts.length-1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d} L${lp[0]} ${h} L2 ${h} Z" style="fill:${color};fill-opacity:.1"/><path d="${d}" style="fill:none;stroke:${color};stroke-width:1.5" stroke-linejoin="round"/><circle cx="${lp[0]}" cy="${lp[1]}" r="2.2" style="fill:${color}"/></svg>`;
}
function gauge(v, label='AI readiness'){
  const r=58, c=Math.PI*r, len=v/100*c; const col = v>=70?'var(--green)':v>=50?'var(--c1)':'var(--amber)';
  return `<svg class="gauge" viewBox="0 0 150 92" style="width:170px;max-width:100%"><path d="M17 80 A58 58 0 0 1 133 80" fill="none" style="stroke:var(--surface-3)" stroke-width="12" stroke-linecap="round"/><path d="M17 80 A58 58 0 0 1 133 80" fill="none" style="stroke:${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${len} ${c}"/><text x="75" y="70" text-anchor="middle" style="font-size:24px;font-weight:600;fill:var(--fg)">${v}</text><text x="75" y="88" text-anchor="middle" style="font-size:9.5px;fill:var(--fg-3)">${label} / 100</text></svg>`;
}

/* ============ Overlays ============ */
const STACK = [];
function openLayer(kind, o){
  const layer = $('#layer');
  const scrim = document.createElement('div'); scrim.className='scrim';
  const box = document.createElement('div'); box.className = (kind==='drawer'?'drawer ':'modal ')+(o.size||'');
  box.setAttribute('role','dialog'); box.setAttribute('aria-modal','true');
  const entry = {kind, box, scrim, o};
  scrim.addEventListener('click', ()=>closeLayer(entry));
  layer.append(scrim, box); STACK.push(entry);
  paintLayer(entry);
  setTimeout(()=>{ const f = box.querySelector('[autofocus], .modal-b input:not([type=checkbox]), .modal-b textarea, .modal-b select'); if(f && kind==='modal') f.focus(); }, 30);
  return entry;
}
function paintLayer(e){
  const o = e.o; const title = typeof o.title==='function'?o.title():o.title; const body = typeof o.render==='function'?o.render():o.body; const foot = typeof o.foot==='function'?o.foot():o.foot;
  const scroll = e.box.querySelector('.modal-b')?.scrollTop||0;
  e.box.innerHTML = `<div class="modal-h"><div class="row grow" style="min-width:0"><h2 class="trunc">${title}</h2>${o.badge||''}</div><div class="row">${o.headAct||''}<button class="ib sm" data-a="closeTop" aria-label="Close">${ic('x',16)}</button></div></div><div class="modal-b">${body}</div>${foot?`<div class="modal-f">${foot}</div>`:''}`;
  const mb = e.box.querySelector('.modal-b'); if(mb) mb.scrollTop = scroll;
}
function closeLayer(e){ const i = STACK.indexOf(e); if(i<0) return; STACK.splice(i,1); e.box.remove(); e.scrim.remove(); e.o.onClose && e.o.onClose(); }
const closeTop = () => { const e = STACK[STACK.length-1]; if(e) closeLayer(e); };
const closeAll = () => { while(STACK.length) closeTop(); };
const modal = o => openLayer('modal', o);
const drawer = o => openLayer('drawer', o);
const refreshLayers = () => STACK.forEach(e => { if(typeof e.o.render==='function') paintLayer(e); });
function confirmBox({title, text, ok='Confirm', danger, onOk}){
  const e = modal({title, size:'sm', body:`<p class="sub" style="line-height:1.55">${text}</p>`, foot:`<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn ${danger?'danger':'pri'}" data-a="confirmOk">${ok}</button>`});
  e.onOk = onOk;
}
let POP = null;
function popover(anchor, html, {align='right', w}={}){
  closePop();
  const r = anchor.getBoundingClientRect();
  const p = document.createElement('div'); p.className='pop'; p.innerHTML = html; if(w) p.style.width = w+'px';
  document.body.append(p);
  const pw = p.offsetWidth, vw = window.innerWidth;
  let left = align==='right' ? r.right - pw : r.left; left = Math.max(8, Math.min(left, vw - pw - 8));
  p.style.left = left+'px'; p.style.top = (r.bottom+6)+'px';
  const maxH = window.innerHeight - r.bottom - 20; p.style.maxHeight = maxH+'px'; p.style.overflowY='auto';
  POP = {el:p, anchor};
}
function closePop(){ if(POP){ POP.el.remove(); POP=null; } }
function toast(msg, kind='ok'){
  const t = document.createElement('div'); t.className='toast '+(kind==='err'?'err':'');
  t.innerHTML = ic(kind==='err'?'alert-triangle':kind==='info'?'info':'check-circle-2',16)+`<span>${msg}</span>`;
  $('#toasts').append(t);
  setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(), 220); }, 3200);
}

/* ============ UI state & routing ============ */
const UI = { v:{}, q:{}, f:{}, sort:{}, sel:{}, lastDrop:null };
const uv = (k, d) => (UI.v[k] === undefined ? (UI.v[k] = ['ctab','ptab','calM'].includes(k) ? d : pref.get('v-'+k, d)) : UI.v[k]);
const setv = (k, v, persist=true) => { UI.v[k]=v; if(persist) pref.set('v-'+k, v); };
const Views = {};
const A = {};
let ROUTE = {page:'home', id:null};
let AFTER = [];
const after = fn => AFTER.push(fn);

function parseRoute(){
  const h = decodeURIComponent(location.hash.slice(1)) || 'home';
  const i = h.indexOf('-');
  return i<0 ? {page:h, id:null} : {page:h.slice(0,i), id:h.slice(i+1)};
}
function go(hash){ closePop(); if(location.hash.slice(1)===hash){ render(true); } else { location.hash = hash; } }
function render(isNav){
  const r = parseRoute(); const routeChanged = isNav || r.page!==ROUTE.page || r.id!==ROUTE.id; if(r.id!==ROUTE.id || r.page!==ROUTE.page){ delete UI.v.ctab; delete UI.v.ptab; } ROUTE = r;
  const main = $('#main');
  if(!DB.setupDone || !me()){ $('#app').classList.add('setup'); main.innerHTML = Views.setup(); $('#sb').innerHTML=''; $('#top').innerHTML=''; document.title='Set up · BEMO-SOLUTIONS Operations OS'; return; }
  $('#app').classList.remove('setup');
  const V = Views[r.page] || Views.home;
  const ae = document.activeElement; const fid = ae && ae.id && main.contains(ae) ? ae.id : null; const selS = fid && ae.selectionStart;
  const st = main.scrollTop;
  AFTER = [];
  let out;
  try { out = V(r.id) || {}; } catch(err){ console.error(err); out = {html:`<div class="page">${empty('alert-triangle','This view failed to load',esc(err.message))}</div>`}; }
  main.innerHTML = out.html || '';
  renderShell(out.crumbs || [], r.page);
  if(routeChanged){
    main.scrollTop = 0; main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
    clearTimeout(render._t); render._t = setTimeout(()=>main.classList.remove('enter'), 900);
    if(window.innerWidth<=860) $('#app').classList.remove('mnav');
    document.title = (out.title ? out.title+' · ' : '') + 'BEMO-SOLUTIONS Operations OS';
  } else main.scrollTop = st;
  if(fid){ const el = document.getElementById(fid); if(el){ el.focus(); try{ if(selS!=null) el.setSelectionRange(selS, selS); }catch(e){} } }
  AFTER.forEach(fn=>{ try{ fn(); }catch(e){ console.error(e); } });
  refreshLayers();
}
const rerender = () => render(false);
function commit(msg, kind){ save(); rerender(); renderShellCounts(); if(msg) toast(msg, kind); }
function log(text, clientId, link, kind, user){ DB.activity.unshift({at:nowStamp(), user:user||DB.me, text, clientId:clientId||null, link:link||null, kind:kind||'note'}); audit(text.replace(/<[^>]+>/g,''), link||''); }
function audit(action, target){ DB.audit.unshift({at:nowStamp(), user:DB.me, action, target:target||'', ip:'this browser'}); if(DB.audit.length>2000) DB.audit.length=2000; }
function notify(type, text, link, forUser){ DB.notifications.unshift({id:nextId('N-', DB.notifications), type, text, at:nowStamp(), read:false, link, for:forUser||null}); if(DB.notifications.length>1500) DB.notifications.length=1500; }

/* ============ Shell ============ */
const NAV = [
  {g:'Workspace', items:[['home','Command Centre','layout-dashboard'],['inbox','Intake Inbox','inbox','inbox'],['reminders','Reminders','alarm-clock','rem'],['calendar','Team calendar','calendar-days','cal'],['notifications','Notifications','bell','notif']]},
  {g:'Clients', items:[['crm','Clients & CRM','users'],['discovery','Discovery','phone-call'],['assess','Assessments','compass']]},
  {g:'Commercial', items:[['quotes','Quotes','file-text','quotes'],['invoices','Invoices & Payments','receipt','inv'],['finance','Finance','wallet']]},
  {g:'Delivery', items:[['projects','Projects','folder-kanban'],['tasks','Tasks','list-checks','tasks'],['team','Team','contact']]},
  {g:'Operations', items:[['comms','Communications','messages-square'],['analytics','Analytics','bar-chart-3']]}
];
const ALIAS = {client:'crm', quote:'quotes', project:'projects', admin:'admin'};
function counts(){
  return {
    inbox: DB.enquiries.filter(e=>e.status==='Unprocessed'||e.status==='New').length,
    notif: DB.notifications.filter(n=>!n.read && mine(n)).length,
    quotes: DB.quotes.filter(q=>['Sent','Viewed'].includes(q.status)).length,
    inv: DB.invoices.filter(i=>calc.inv(i).overdue).length,
    tasks: DB.tasks.filter(t=>t.assignee===DB.me && t.status!=='Done').length,
    int: DB.workflows.filter(w=>w.status==='Error').length,
    ...(W.opsCounts ? W.opsCounts() : {})
  };
}
function renderShell(crumbs, page){
  const active = ALIAS[page] || page; const c = counts(); const u = me();
  $('#sb').innerHTML = `
    <div class="sb-ws" data-a="wsMenu" role="button" tabindex="0" aria-label="Switch workspace"><span class="logo">${LOGO(18)}</span><div class="sb-ws-t"><b>BEMO-SOLUTIONS</b><span>Operations OS</span></div>${ic('chevrons-up-down',14,'muted')}</div>
    <nav class="sb-nav">${NAV.map(g=>({g:g.g, items:g.items.filter(([id])=>!W.navAllowed || W.navAllowed(id))})).filter(g=>g.items.length).map(g=>`<div class="sb-g"><div class="sb-gl">${g.g}</div>${g.items.map(([id,l,i,ck])=>{ if(id==='home' && W.homeLabel) l = W.homeLabel(); const n = ck?c[ck]:0; return `<a href="#${id}" class="sb-l ${active===id?'on':''}" data-tip-side="r" ${document.getElementById('app').classList.contains('collapsed')?`data-tip="${l}"`:''}>${ic(i,16)}<span>${l}</span>${n?`<span class="ct ${ck==='inbox'||ck==='notif'?'hot':''}" data-ct="${ck}">${n}</span>`:''}</a>`; }).join('')}</div>`).join('')}
      ${!W.navAllowed || W.navAllowed('admin') ? `<div class="sb-g"><div class="sb-gl">System</div><a href="#admin" class="sb-l ${active==='admin'?'on':''}">${ic('settings',16)}<span>Administration</span></a></div>` : ''}
    </nav>
    <div class="sb-foot">${av(u.id)}<div class="sb-foot-t"><b>${esc(u.name)}</b><span>${esc(u.role)} · ${esc(u.sysRole||'')}</span></div><button class="ib sm desk-only" data-a="toggleSb" aria-label="Collapse sidebar" data-tip="Collapse sidebar">${ic('panel-left',15)}</button></div>`;
  const cr = crumbs.length ? crumbs : [['Command Centre']];
  $('#top').innerHTML = `
    <button class="ib mobile-only" data-a="mnav" aria-label="Open navigation">${ic('menu',18)}</button>
    <nav class="crumbs grow" aria-label="Breadcrumb">${cr.map((x,i)=>{ const last=i===cr.length-1; const cls = (!last && i>0)?'cr-mid':''; return (i?`<span class="sep ${cls}">/</span>`:'') + (last?`<b>${esc(x[0])}</b>`:`<a class="${cls}" href="#${x[1]}">${esc(x[0])}</a>`); }).join('')}</nav>
    <span class="demo-pill desk-only" style="color:var(--fg-3);background:var(--surface-3);cursor:pointer" data-a="go" data-to="admin" data-tip="Records are stored in this browser only. Export a backup regularly from Administration → Data management.">${ic('hard-drive',12)}Saved in this browser</span>
    <button class="search-btn" data-a="cmdk" aria-label="Search">${ic('search',14)}<span class="lbl grow" style="text-align:left">Search clients, projects, quotes…</span><span class="kbd desk-only">Ctrl K</span></button>
    <button class="btn pri sm" data-a="createMenu">${ic('plus',14)}<span class="desk-only">Create</span></button>
    <button class="ib" data-a="theme" aria-label="Toggle theme" data-tip="Switch light / dark">${ic(isDark()?'sun':'moon',17)}</button>
    <button class="ib" data-a="notifPop" aria-label="Notifications">${ic('bell',17)}${c.notif?`<span class="dot-badge">${c.notif}</span>`:''}</button>
    <button class="ib" data-a="profileMenu" aria-label="Profile" style="width:auto;padding:0 2px">${av(u.id)}</button>`;
}
function renderShellCounts(){ if(!DB.setupDone || !me()) return; renderShell(lastCrumbs(), ROUTE.page); }
function lastCrumbs(){ const t = $$('#top .crumbs a, #top .crumbs b').map(x=>[x.textContent, (x.getAttribute('href')||'').slice(1)]); return t; }
const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); if(t) return t==='dark'; return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches; };

/* ============ Global event delegation ============ */
document.addEventListener('click', e => {
  if(POP && !POP.el.contains(e.target) && !POP.anchor.contains(e.target)) closePop();
  const a = e.target.closest('[data-a]');
  if(a && !a.hasAttribute('disabled')){
    const fn = A[a.dataset.a];
    if(fn){ e.preventDefault(); e.stopPropagation(); fn(a.dataset, a, e); return; }
    console.warn('Missing action', a.dataset.a);
  }
  const g = e.target.closest('[data-go]');
  if(g && !e.target.closest('a,button,select,input,textarea,label')){ closeAllIfNav(g.dataset.go); go(g.dataset.go); return; }
  const l = e.target.closest('a[href^="#"]');
  if(l && STACK.length){ closeAll(); }
  if(l && POP) closePop();
});
function closeAllIfNav(){ if(STACK.length) closeAll(); }
document.addEventListener('change', e => { const el = e.target.closest('[data-ch]'); if(el && A[el.dataset.ch]) A[el.dataset.ch](el.type==='checkbox'?el.checked:el.value, el.dataset, el); });
document.addEventListener('input', e => { const el = e.target.closest('[data-in]'); if(el && A[el.dataset.in]) A[el.dataset.in](el.value, el.dataset, el); });
document.addEventListener('keydown', e => {
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); A.cmdk(); return; }
  if(e.key==='Escape'){ if(POP) closePop(); else if(STACK.length) closeTop(); else $('#app').classList.remove('mnav'); }
  if(e.key==='Enter' && e.target.matches('[role=button][data-a]')) e.target.click();
});
// Tooltips
const tip = () => $('#tip');
document.addEventListener('mouseover', e => { const t = e.target.closest('[data-tip]'); if(!t){ tip().classList.remove('on'); return; } tip().textContent = t.getAttribute('data-tip'); tip().classList.add('on'); });
document.addEventListener('mousemove', e => { const tp = tip(); if(!tp.classList.contains('on')) return; const w = tp.offsetWidth, h = tp.offsetHeight; let x = e.clientX+14, y = e.clientY+14; if(x+w>innerWidth-8) x = e.clientX-w-12; if(y+h>innerHeight-8) y = e.clientY-h-12; tp.style.left=x+'px'; tp.style.top=y+'px'; });
document.addEventListener('scroll', ()=>tip().classList.remove('on'), true);
// Drag & drop (Kanban)
let DRAG = null;
document.addEventListener('dragstart', e => { const c = e.target.closest && e.target.closest('[data-drag]'); if(!c) return; DRAG = {id:c.dataset.drag, kind:c.dataset.kind}; e.dataTransfer.effectAllowed='move'; try{ e.dataTransfer.setData('text/plain', DRAG.id); }catch(_){} requestAnimationFrame(()=>c.classList.add('dragging')); tip().classList.remove('on'); });
document.addEventListener('dragend', e => { $$('.dragging').forEach(x=>x.classList.remove('dragging')); $$('.kc.over').forEach(x=>x.classList.remove('over')); DRAG=null; });
document.addEventListener('dragover', e => { const col = e.target.closest && e.target.closest('[data-drop]'); if(!col || !DRAG || col.dataset.kind!==DRAG.kind) return; e.preventDefault(); e.dataTransfer.dropEffect='move'; $$('.kc.over').forEach(x=>{ if(x!==col) x.classList.remove('over'); }); col.classList.add('over'); });
document.addEventListener('drop', e => { const col = e.target.closest && e.target.closest('[data-drop]'); if(!col || !DRAG) return; e.preventDefault(); const d = DRAG; DRAG=null; col.classList.remove('over'); A.dropCard(d.kind, d.id, col.dataset.drop); });

/* ============ Shared actions ============ */
A.closeTop = () => closeTop();
A.confirmOk = () => { const e = STACK[STACK.length-1]; const fn = e && e.onOk; closeTop(); fn && fn(); };
A.seg = d => { setv(d.key, d.v, !['ctab','ptab','calM'].includes(d.key)); rerender(); };
A.sort = d => { const s = UI.sort[d.key] || {}; UI.sort[d.key] = s.col===d.col ? {col:d.col, dir:-s.dir} : {col:d.col, dir:1}; rerender(); };
A.q = (v, d) => { UI.q[d.key] = v; rerender(); };
A.filt = (v, d) => { UI.f[d.key] = v; rerender(); };
A.fchip = d => { UI.f[d.key] = UI.f[d.key]===d.v ? '' : d.v; rerender(); };
A.go = d => go(d.to);
A.toggleSb = () => { const app=$('#app'); app.classList.toggle('collapsed'); pref.set('sb', app.classList.contains('collapsed')); rerender(); };
A.mnav = () => $('#app').classList.toggle('mnav');
A.theme = () => { const next = isDark() ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); pref.set('theme', next); renderShellCounts(); toast(next==='dark'?'Dark theme on':'Light theme on','info'); };
A.setTheme = d => { if(d.v==='system'){ document.documentElement.removeAttribute('data-theme'); pref.set('theme', null); } else { document.documentElement.setAttribute('data-theme', d.v); pref.set('theme', d.v); } rerender(); renderShellCounts(); };
A.wsMenu = (d, el) => popover(el, `<div class="menu"><div class="mh">Workspace</div><button data-a="closePop">${`<span class="logo" style="width:22px;height:22px;border-radius:6px">${LOGO(13)}</span>`}<span class="grow"><b style="font-weight:500">${esc(DB.settings.company.name)}</b><br><span class="muted xs">Operations · ${DB.users.length} member${DB.users.length===1?'':'s'}</span></span>${ic('check',14)}</button><div class="sep"></div><button data-a="go" data-to="admin">${ic('settings',14)}Workspace settings</button></div>`, {align:'left', w:250});
A.closePop = () => closePop();
A.demoNote = d => { closePop(); toast(d.msg || 'Demonstration only — this will connect to a live service in production.', 'info'); };
A.profileMenu = (d, el) => { const u = me(); popover(el, `<div class="menu"><div style="padding:8px 9px 6px" class="row">${av(u.id,'lg')}<div><b>${esc(u.name)}</b><div class="muted small">${esc(u.email)}</div><div class="muted xs">${esc(u.role)} · ${esc(u.sysRole)}</div></div></div><div class="sep"></div><button data-a="go" data-to="team">${ic('user',14)}My profile & workload</button><button data-a="go" data-to="tasks">${ic('list-checks',14)}My tasks</button><button data-a="theme">${ic(isDark()?'sun':'moon',14)}${isDark()?'Light theme':'Dark theme'}</button><button data-a="go" data-to="admin">${ic('settings',14)}Administration</button>${DB.users.length>1?`<div class="sep"></div><div class="mh">Working as</div>${DB.users.filter(x=>x.id!==u.id).slice(0,8).map(x=>`<button data-a="switchUser" data-id="${x.id}">${av(x.id,'sm')}${esc(x.name)}</button>`).join('')}`:''}</div>`, {w:260}); };
A.switchUser = d => { DB.me = d.id; save(); closePop(); renderShellCounts(); rerender(); toast('Now working as '+get.user(d.id).name); };
A.createMenu = (d, el) => popover(el, `<div class="menu"><div class="mh">Create</div><button data-a="newClient">${ic('building-2',14)}Client</button><button data-a="newEnquiry">${ic('inbox',14)}Enquiry</button><button data-a="newQuote">${ic('file-text',14)}Quote</button><button data-a="newProject">${ic('folder-kanban',14)}Project</button><button data-a="newTask">${ic('check-square',14)}Task</button><button data-a="newReminder">${ic('alarm-clock',14)}Reminder</button><button data-a="newInvoice">${ic('receipt',14)}Invoice</button><div class="sep"></div><button data-a="recordPaymentPick">${ic('banknote',14)}Record payment</button><button data-a="compose">${ic('send',14)}Message</button></div>`, {w:220});
A.notifPop = (d, el) => {
  const list = DB.notifications.filter(mine).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,8);
  popover(el, `<div style="width:380px;max-width:calc(100vw - 16px)"><div class="card-h"><h3>Notifications</h3><button class="btn ghost xs" data-a="readAll">Mark all read</button></div><div class="list">${list.map(n=>notifRow(n)).join('')}</div><div style="padding:8px;border-top:1px solid var(--line)"><button class="btn sm" style="width:100%" data-a="go" data-to="notifications">View all notifications</button></div></div>`);
};
const NICON = {reminder:['alarm-clock','amber'],pool:['hand','cyan'],enquiry:['inbox','blue'],error:['alert-octagon','red'],task:['check-square','cyan'],overdue:['clock','red'],blocked:['x-octagon','red'],review:['eye','blue'],deadline:['calendar-clock','amber'],payment:['banknote','green'],message:['message-circle','cyan'],accepted:['badge-check','green']};
function notifRow(n){ const [i,t] = NICON[n.type]||['bell','gray']; return `<div class="li" data-a="openNotif" data-id="${n.id}" style="${n.read?'':'background:var(--accent-soft)'}"><span class="src" style="background:var(--${t==='gray'?'slate':t==='cyan'?'accent':t}-soft);color:var(--${t==='cyan'?'accent-2':t==='gray'?'slate':t})">${ic(i,13)}</span><div class="grow"><div class="t" style="white-space:normal;font-weight:${n.read?400:500}">${esc(n.text)}</div><div class="s">${rel(n.at)}</div></div>${n.read?'':'<span style="width:7px;height:7px;border-radius:50%;background:var(--accent);flex:none"></span>'}</div>`; }
A.openNotif = d => { const n = DB.notifications.find(x=>x.id===d.id); if(n){ n.read=true; save(); closePop(); if(n.link) go(n.link); else rerender(); renderShellCounts(); } };
A.readAll = () => { DB.notifications.filter(mine).forEach(n=>n.read=true); save(); closePop(); rerender(); renderShellCounts(); toast('All notifications marked as read'); };

// Kanban drop routing
A.dropCard = (kind, id, status) => {
  let rec, label;
  if(kind==='task'){ rec = get.task(id); label = rec && rec.title; }
  if(kind==='client'){ rec = get.client(id); label = rec && rec.name; }
  if(kind==='project'){ rec = get.project(id); label = rec && rec.name; }
  if(!rec || rec.status===status) return;
  const from = rec.status; rec.status = status; UI.lastDrop = id;
  if(kind==='project' && status==='Completed') rec.completed = TODAY;
  log(`Moved <b>${esc(label)}</b> from ${esc(from)} to ${esc(status)}`, kind==='client'?rec.id:kind==='project'?rec.clientId:(get.project(rec.projectId)||{}).clientId, kind==='client'?'client-'+id:kind==='project'?'project-'+id:'tasks', 'status');
  commit(`${label} → ${status}`);
  after(()=>{ const c = document.querySelector(`[data-drag="${id}"]`); c && c.classList.add('dropped'); });
  setTimeout(()=>{ const c = document.querySelector(`[data-drag="${id}"]`); c && c.classList.add('dropped'); }, 10);
};

/* ============ Command palette ============ */
A.cmdk = () => {
  closePop(); closeAll();
  const scrim = document.createElement('div'); scrim.className='scrim';
  const box = document.createElement('div'); box.className='modal cmdk';
  box.innerHTML = `<div class="cmdk-in">${ic('search',18,'muted')}<input id="cmdk-q" placeholder="Search clients, projects, quotes, invoices, tasks or jump to…" autocomplete="off" aria-label="Search"><span class="kbd">Esc</span></div><div class="cmdk-r" id="cmdk-r"></div><div class="modal-f" style="justify-content:space-between"><span class="muted xs">${ic('corner-down-left',12)} open · ↑↓ navigate</span><span class="muted xs">Searches records in this browser</span></div>`;
  const entry = {kind:'modal', box, scrim, o:{}}; scrim.addEventListener('click', ()=>closeLayer(entry));
  $('#layer').append(scrim, box); STACK.push(entry);
  const inp = $('#cmdk-q', box); let sel = 0, items = [];
  const pages = NAV.flatMap(g=>g.items).filter(([id])=>!W.navAllowed || W.navAllowed(id)).map(([id,l,i])=>({g:'Go to', t:l, s:'', i, go:id})).concat([{g:'Go to', t:'Administration', i:'settings', go:'admin'}]);
  const actions = [['New client','newClient','building-2'],['New enquiry','newEnquiry','inbox'],['New quote','newQuote','file-text'],['New project','newProject','folder-kanban'],['New task','newTask','check-square'],['New reminder','newReminder','alarm-clock'],['New invoice','newInvoice','receipt'],['Record payment','recordPaymentPick','banknote'],['Toggle theme','theme','sun-moon']].map(([t,a,i])=>({g:'Actions', t, i, a}));
  function search(q){
    q = q.trim().toLowerCase(); const m = s => String(s||'').toLowerCase().includes(q);
    if(!q) return pages.slice(0,6).concat(actions.slice(0,5)).concat(DB.clients.slice(0,4).map(c=>({g:'Recent clients', t:c.name, s:c.status, i:'building-2', go:'client-'+c.id})));
    const r = [];
    DB.clients.filter(c=>m(c.name)||m(c.contact)||m(c.id)||m(c.industry)).forEach(c=>r.push({g:'Clients', t:c.name, s:c.contact+' · '+c.status, i:'building-2', go:'client-'+c.id}));
    DB.projects.filter(p=>m(p.name)||m(p.id)||m(get.client(p.clientId).name)).forEach(p=>r.push({g:'Projects', t:p.name, s:p.id+' · '+get.client(p.clientId).name, i:'folder-kanban', go:'project-'+p.id}));
    DB.quotes.filter(x=>m(x.title)||m(x.id)).forEach(x=>r.push({g:'Quotes', t:x.id+' · '+x.title, s:x.status, i:'file-text', go:'quote-'+x.id}));
    DB.invoices.filter(x=>m(x.id)||m(x.desc)).forEach(x=>r.push({g:'Invoices', t:x.id+' · '+x.desc, s:calc.inv(x).status, i:'receipt', go:'invoices-'+x.id}));
    DB.tasks.filter(x=>m(x.title)||m(x.id)).forEach(x=>r.push({g:'Tasks', t:x.title, s:x.id+' · '+x.status, i:'check-square', go:'tasks-'+x.id}));
    DB.enquiries.filter(x=>m(x.from)||m(x.company)||m(x.body)).forEach(x=>r.push({g:'Enquiries', t:x.from+' — '+x.company, s:x.status, i:'inbox', go:'inbox-'+x.id}));
    DB.users.filter(u=>m(u.name)||m(u.role)).forEach(u=>r.push({g:'People', t:u.name, s:u.role, i:'user', go:'team-'+u.id}));
    pages.filter(p=>m(p.t)).forEach(p=>r.push(p)); actions.filter(p=>m(p.t)).forEach(p=>r.push(p));
    return r.slice(0,40);
  }
  function paint(){
    items = search(inp.value); sel = Math.min(sel, Math.max(0,items.length-1)); let g='', h='';
    items.forEach((it,i)=>{ if(it.g!==g){ g=it.g; h+=`<div class="cmdk-g">${g}</div>`; } h+=`<div class="cmdk-i ${i===sel?'on':''}" data-i="${i}">${ic(it.i||'circle',15,'muted')}<span class="t trunc">${esc(it.t)}</span><span class="s trunc">${esc(it.s||'')}</span></div>`; });
    $('#cmdk-r', box).innerHTML = h || empty('search-x','No results','Try a client name, project ID or quote number.');
    const on = $('.cmdk-i.on', box); on && on.scrollIntoView({block:'nearest'});
  }
  function pick(i){ const it = items[i]; if(!it) return; closeLayer(entry); if(it.go) go(it.go); else if(it.a) A[it.a]({}, document.body); }
  inp.addEventListener('input', ()=>{ sel=0; paint(); });
  inp.addEventListener('keydown', e=>{ if(e.key==='ArrowDown'){ sel=Math.min(items.length-1, sel+1); paint(); e.preventDefault(); } else if(e.key==='ArrowUp'){ sel=Math.max(0, sel-1); paint(); e.preventDefault(); } else if(e.key==='Enter'){ pick(sel); e.preventDefault(); } });
  $('#cmdk-r', box).addEventListener('click', e=>{ const it = e.target.closest('.cmdk-i'); if(it) pick(+it.dataset.i); });
  $('#cmdk-r', box).addEventListener('mousemove', e=>{ const it = e.target.closest('.cmdk-i'); if(it && +it.dataset.i!==sel){ sel=+it.dataset.i; $$('.cmdk-i', box).forEach(x=>x.classList.toggle('on', +x.dataset.i===sel)); } });
  paint(); setTimeout(()=>inp.focus(), 20);
};

/* ============ Form helpers ============ */
const val = id => { const el = document.getElementById(id); return el ? (el.type==='checkbox' ? el.checked : el.value.trim()) : ''; };
function requireFields(pairs){ for(const [id,label] of pairs){ const el=document.getElementById(id); if(!el || !el.value.trim()){ el && el.focus(); el && (el.style.borderColor='var(--red)'); toast(label+' is required', 'err'); return false; } } return true; }

/* ============ Boot ============ */
function start(){
  load();
  const th = pref.get('theme', null); if(th) document.documentElement.setAttribute('data-theme', th);
  if(pref.get('sb', false) && window.innerWidth>860) $('#app').classList.add('collapsed');
  window.addEventListener('hashchange', ()=>{ closeAll(); render(true); });
  if(window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', ()=>renderShellCounts());
  render(true);
}

W.App = {start};
Object.assign(W, {uname, mine, NAV, $, $$, esc, ic, LOGO, MON, DOW, pd, iso, addDays, days, until, fmtD, fmtDs, fmtT, fmtDT, fmtM, rel, dueTxt, nowStamp, fmtN, fmtR, fmtRk, pct, sum, uniq, initials, nextId, debounce,
  get, me, calc, TONE, CAT_COLOR, CAT_ICON, badge, prio, av, avs, who, coIc, clientLink, prog, empty, card, pageHead, srcIcon, aiTag, verTag, simTag, catTag, opts, userOpts, clientOpts, field, segc, tabsc, searchBox, kpiCell, table,
  chArea, chBars, chDonut, chHBar, chFunnel, spark, gauge, modal, drawer, closeTop, closeAll, confirmBox, popover, closePop, toast, refreshLayers, STACK,
  UI, uv, setv, Views, A, go, render, rerender, commit, log, notify, after, val, requireFields, save, resetDB, replaceDB, saveNow, audit, pref, notifRow, renderShellCounts});
Object.defineProperty(W, 'DB', {get(){ return DB; }});
Object.defineProperty(W, 'ROUTE', {get(){ return ROUTE; }});
})();
