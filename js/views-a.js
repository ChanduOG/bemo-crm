/* Views A: Command Centre, CRM, Client workspace, Intake inbox, Discovery, AI Assistant */
(function(){

const KIC = {email:'mail',whatsapp:'message-circle',call:'phone',meeting:'video',note:'sticky-note',payment:'banknote',quote:'file-text',accepted:'badge-check',invoice:'receipt',enquiry:'inbox',task:'check-square',review:'eye',blocked:'x-octagon',status:'arrow-right-left',assessment:'compass',lost:'archive',error:'alert-octagon',message:'message-circle',project:'folder-kanban'};
const CH_LABEL = {email:'Email',whatsapp:'WhatsApp',call:'Call',meeting:'Meeting',note:'Internal note',web:'Website form',referral:'Referral',manual:'Manual'};
window.KIC = KIC; window.CH_LABEL = CH_LABEL;

/* ---------- Discovery question sets (shared with AI assistant) ---------- */
const DQ = {
  'Website':['What is the purpose of the website?','What pages are required?','Is there an existing website?','Is a CMS required?','Are there external integrations?','Who provides content?','What is the desired launch date?'],
  'Automation':['What process needs automation?','Which applications are currently used?','How does the current process work?','Where does information originate?','Where must information go?','Are APIs available?','What happens when an automation fails?','What security requirements exist?','Who will maintain the system?'],
  'AI system':['What should the AI accomplish?','What information can it access?','Which users will interact with it?','What should it never do?','What level of human approval is required?','What accuracy and safety requirements exist?'],
  'Custom application':['Who are the users and what are their roles?','What are the core workflows the app must support?','Which existing systems must it connect to?','Web, mobile or both?','What data must be stored and for how long?','What does success look like in 6 months?'],
  'System integration':['Which systems must be connected?','Which records sync, and in which direction?','Which system is the source of truth?','Are APIs available and documented?','How often must data sync?','Who resolves sync conflicts?']
};
DQ['Hybrid'] = DQ['Website'].slice(0,4).concat(DQ['Automation'].slice(0,5));
window.DQ = DQ;

/* ---------- Helpers ---------- */
A.goFilter = d => { UI.f[d.fk] = d.fv; if(d.vk) setv(d.vk, d.vv); go(d.to); };
const isActiveClient = c => ['Active client','Ongoing partnership','Payment pending','Accepted'].includes(c.status);
function clientTimeline(cid){
  const items = [];
  DB.activity.filter(a=>a.clientId===cid && !['payment','email','whatsapp','call','meeting','message'].includes(a.kind)).forEach(a=>items.push({at:a.at, kind:a.kind, title:a.text, user:a.user, link:a.link}));
  DB.conversations.filter(c=>c.clientId===cid).forEach(c=>c.messages.forEach(m=>items.push({at:m.at, kind:c.channel, title:`${CH_LABEL[c.channel]} · ${esc(c.subject)}`, sub:m.from, body:m.body, conv:c.id})));
  DB.notes.filter(n=>n.clientId===cid).forEach(n=>items.push({at:n.at, kind:'note', title:'Note added', user:n.by, body:n.text}));
  DB.invoices.filter(i=>i.clientId===cid).forEach(i=>i.payments.forEach(p=>items.push({at:p.date+'T12:00', kind:'payment', title:`Payment received <b>${fmtR(p.amount,true)}</b> · ${i.id}`, sub:p.method+' · ref '+p.ref})));
  return items.sort((a,b)=>b.at.localeCompare(a.at));
}
window.clientTimeline = clientTimeline;
function tlItem(it){
  return `<div class="tl-i"><span class="tl-ic">${ic(KIC[it.kind]||'circle-dot',13)}</span><div class="tl-b"><div class="row between" style="align-items:flex-start"><div class="t" style="min-width:0">${it.title}</div><span class="muted xs nowrap">${fmtDT(it.at)}</span></div>${it.user||it.sub?`<div class="s">${it.user?esc((get.user(it.user)||{name:'Automation'}).name):''}${it.user&&it.sub?' · ':''}${it.sub?esc(it.sub):''}</div>`:''}${it.body?`<div class="body">${esc(it.body.length>360?it.body.slice(0,360)+'…':it.body)}</div>`:''}${it.conv?`<button class="btn ghost xs mt-8" data-a="openConv" data-id="${it.conv}">${ic('messages-square',12)}Open conversation</button>`:''}${it.link&&!it.conv?`<a class="btn ghost xs mt-8" href="#${it.link}">${ic('arrow-up-right',12)}Open</a>`:''}</div></div>`;
}
window.tlItem = tlItem;
function feedItem(a){ const u = get.user(a.user); return `<div class="feed-i" ${a.link?`data-go="${a.link}" style="cursor:pointer"`:''}>${a.user==='sys'?`<span class="av sm" style="background:var(--surface-3);color:var(--fg-2)">${ic(KIC[a.kind]||'zap',11)}</span>`:av(a.user,'sm')}<div class="grow" style="min-width:0"><div class="txt">${u?`<b>${esc(u.name.split(' ')[0])}</b> · `:''}${a.text}</div><div class="when">${rel(a.at)}</div></div></div>`; }
window.feedItem = feedItem;

/* ===================== COMMAND CENTRE ===================== */
Views.home = () => {
  const u = me();
  const clients = DB.clients, enq = DB.enquiries, projects = DB.projects;
  const activeClients = clients.filter(isActiveClient).length;
  const MONTH = TODAY.slice(0,7), YEAR = TODAY.slice(0,4), MONTH_NAME = ['January','February','March','April','May','June','July','August','September','October','November','December'][+MONTH.slice(5)-1];
  const newEnq = enq.filter(e=>e.received.startsWith(MONTH)).length;
  const series = calc.monthly(12);
  const activeProjects = projects.filter(p=>!['Completed','On hold'].includes(p.status));
  const completed = projects.filter(p=>p.status==='Completed').length;
  const qAwait = DB.quotes.filter(q=>['Sent','Viewed'].includes(q.status));
  const invs = DB.invoices.map(i=>({i, c:calc.inv(i)}));
  const outstanding = sum(invs, x=>x.c.outstanding);
  const overdueInv = invs.filter(x=>x.c.overdue);
  const ytd = series.filter(m=>m.m.startsWith(YEAR));
  const thisM = series[series.length-1], lastM = series[series.length-2];
  const isEmpty = !clients.length && !enq.length && !projects.length && !DB.quotes.length;
  const revYTD = sum(ytd, m=>m.revenue);
  const mrr = calc.mrr();
  const pipeline = sum(DB.quotes.filter(q=>['Draft','Internal review','Sent','Viewed'].includes(q.status)), q=>calc.quote(q).sub);
  const overdueTasks = DB.tasks.filter(t=>t.status!=='Done' && t.due && t.due<TODAY);
  const uncontacted = enq.filter(e=>e.status==='Unprocessed'||e.status==='New');
  const blocked = projects.filter(p=>p.status==='Blocked');
  const review = projects.flatMap(p=>p.workstreams.filter(w=>w.status==='In review').map(w=>({p,w})));
  const wfErr = DB.workflows.filter(w=>w.status==='Error');
  const rev = series.map(m=>m.revenue);

  const attn = [
    {n:uncontacted.length, t:`${uncontacted.length} enquiries have not been contacted`, s:`${enq.filter(e=>e.status==='Unprocessed').length} not yet processed · oldest ${rel(uncontacted.map(e=>e.received).sort()[0])}`, tone:'amber', a:`data-a="goFilter" data-to="inbox" data-fk="inbox" data-fv="action"`},
    {n:qAwait.length, t:`${qAwait.length} quotes are awaiting responses`, s:`${fmtR(sum(qAwait,q=>calc.quote(q).sub))} ex VAT in play`, tone:'blue', a:`data-a="goFilter" data-to="quotes" data-fk="quotes" data-fv="awaiting"`},
    {n:overdueInv.length, t:`${overdueInv.length} invoices are overdue`, s:`${fmtR(sum(overdueInv,x=>x.c.outstanding))} outstanding`, tone:'red', a:`data-a="goFilter" data-to="invoices" data-fk="inv" data-fv="Overdue"`},
    {n:blocked.length, t:`${blocked.length} project${blocked.length===1?' is':'s are'} blocked by missing client information`, s:blocked.map(p=>p.name).join(', ')||'None', tone:'red', a: blocked.length===1?`data-go="project-${blocked[0].id}"`:`data-a="goFilter" data-to="projects" data-fk="proj" data-fv="Blocked"`},
    {n:review.length, t:`${review.length} deliverables require approval`, s:review.slice(0,2).map(x=>x.w.name).join(', ')+(review.length>2?'…':''), tone:'cyan', a:`data-a="reviewQueue"`},
    {n:overdueTasks.length, t:`${overdueTasks.length} tasks are overdue`, s:`Across ${uniq(overdueTasks.map(t=>t.assignee)).length} people`, tone:'amber', a:`data-a="goFilter" data-to="tasks" data-fk="taskq" data-fv="overdue"`}
  ].filter(x=>x.n>0);

  const range = uv('homeRange','12');
  const mons = series.slice(-(+range));
  const revDelta = lastM.revenue ? Math.round((thisM.revenue-lastM.revenue)/lastM.revenue*100) : null;
  const kpis = [
    {l:'Active clients', v:activeClients, d:`${clients.length} in CRM`, icon:'building-2', go:'crm'},
    {l:'New enquiries', v:newEnq, d:`${MONTH_NAME} · ${uncontacted.length} awaiting contact`, tone:uncontacted.length?'warn':'', icon:'inbox', go:'inbox'},
    {l:'Active projects', v:activeProjects.length, d:`${blocked.length} blocked`, tone: blocked.length?'down':'', icon:'folder-kanban', go:'projects'},
    {l:'Projects completed', v:projects.filter(p=>p.status==='Completed' && (p.completed||'').startsWith(YEAR)).length, d:`${YEAR} to date`, icon:'check-circle-2', go:'projects'},
    {l:'Quotes awaiting reply', v:qAwait.length, d:fmtR(sum(qAwait,q=>calc.quote(q).sub))+' ex VAT', icon:'file-text', go:'quotes'},
    {l:'Outstanding payments', v:fmtRk(outstanding), d:`${overdueInv.length} overdue · ${fmtRk(sum(overdueInv,x=>x.c.outstanding))}`, tone:overdueInv.length?'down':'', icon:'hourglass', go:'invoices'},
    {l:'Revenue received', v:fmtRk(revYTD), d:`${YEAR} to date · ex VAT${revDelta!==null?` · ${revDelta>=0?'+':''}${revDelta}% vs last month`:''}`, tone:revDelta!==null&&revDelta<0?'down':'up', icon:'banknote', go:'finance', sp:rev.some(v=>v)?spark(rev.slice(-8)):''},
    {l:'Monthly recurring', v:fmtR(mrr), d:`${DB.retainers.filter(r=>!r.until||r.until>=TODAY).length} active retainers`, icon:'repeat', go:'finance'},
    {l:'Pipeline value', v:fmtRk(pipeline), d:'Open quotes, ex VAT', icon:'target', go:'quotes'},
    {l:'Overdue tasks', v:overdueTasks.length, d:'Needs re-planning', tone:overdueTasks.length?'warn':'', icon:'clock', go:'tasks'}
  ];

  const funnel = calc.funnel();
  const srcCounts = uniq(clients.map(c=>c.source||'Other')).map(s=>({k:s, v:clients.filter(c=>(c.source||'Other')===s).length})).sort((a,b)=>b.v-a.v);
  const noData = (msg, icon='bar-chart-3') => empty(icon, 'No data yet', msg);
  const hasMoney = mons.some(m=>m.revenue||m.costs);
  const cats = STATUS.categories.map((c)=>({label:c, value:projects.filter(p=>p.category===c).length, color:CAT_COLOR[c]})).filter(x=>x.value);
  const svc = STATUS.categories.map(c=>({label:c, value:sum(projects.filter(p=>p.category===c),p=>p.budget), color:CAT_COLOR[c]})).filter(x=>x.value).sort((a,b)=>b.value-a.value);
  const team = DB.users.filter(x=>x.dept!=='Leadership').map(x=>({x, l:calc.load(x)})).sort((a,b)=>b.l.util-a.l.util).slice(0,8);
  const m6 = series.slice(-6);
  const dows = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const todayTxt = dows[pd(TODAY).getUTCDay()]+', '+fmtD(TODAY);
  const steps = [
    ['Company details on quotes and invoices', !!(DB.settings.company.vatNo||DB.settings.company.address), 'a', 'goAdminCompany'],
    ['Add your team members', DB.users.length>1, 'a', 'inviteUser'],
    ['Add your first client', clients.length>0, 'a', 'newClient'],
    ['Log an enquiry in the inbox', enq.length>0, 'a', 'newEnquiry'],
    ['Create a quote', DB.quotes.length>0, 'a', 'newQuote'],
    ['Start a project', projects.length>0, 'a', 'newProject']
  ];
  const showSteps = steps.some(s=>!s[1]) && !pref.get('hideSetup', false);
  const pays = DB.invoices.flatMap(i=>i.payments.map(p=>({...p, inv:i}))).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4);
  const acc = DB.quotes.filter(q=>q.status==='Accepted' && q.accepted).sort((a,b)=>b.accepted.localeCompare(a.accepted)).slice(0,3);
  const hr = new Date().getHours(); const greet = hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';

  const html = `<div class="page">
    ${pageHead(`${greet}, ${esc(u.name.split(' ')[0])}`, `${todayTxt} · Here is the state of the business today.`, `<button class="btn" data-go="inbox">${ic('inbox',14)}Open inbox</button><button class="btn" data-go="analytics">${ic('bar-chart-3',14)}Reports</button>`)}
    ${showSteps?`<div class="card" style="margin-bottom:16px;border-color:var(--accent-line)"><div class="card-h"><h3 class="row">${ic('rocket',15)} Get set up</h3><div class="row"><span class="hint">${steps.filter(s=>s[1]).length} of ${steps.length} done</span><button class="btn ghost xs" data-a="hideSetup">Hide</button></div></div><div class="card-b"><div class="grid g3" style="gap:8px">${steps.map(([t,done,,a])=>`<button class="attn" style="text-align:left" ${done?'':`data-a="${a}"`}><span style="color:var(--${done?'green':'fg-4'})">${ic(done?'check-circle-2':'circle',18)}</span><span class="grow t" style="${done?'color:var(--fg-3);text-decoration:line-through':''}">${t}</span>${done?'':ic('chevron-right',15,'muted')}</button>`).join('')}</div></div></div>`:''}
    <div class="kpis">${kpis.map(kpiCell).join('')}</div>
    <div class="grid g-12 mt-16">
      ${card(`${ic('alert-circle',15)} Needs your attention`, `<div class="col" style="gap:8px">${attn.map(x=>`<div class="attn" ${x.a} role="button" tabindex="0"><span class="bar" style="background:var(--${x.tone==='cyan'?'accent':x.tone})"></span><span class="n">${x.n}</span><div class="grow"><div class="t">${x.t.replace(/^\d+\s/,'')}</div><div class="s trunc">${esc(x.s)}</div></div>${ic('chevron-right',15,'muted')}</div>`).join('') || empty('check-circle-2','All clear','Nothing needs your attention right now.')}</div>`, {hint:`${attn.length} items`})}
      ${card('Revenue over time', hasMoney?`<div class="legend" style="margin-bottom:8px"><span><i style="background:var(--c1)"></i>Revenue received</span><span><i style="background:var(--c5)"></i>Expenses</span></div>${chArea({labels:mons.map(m=>fmtM(m.m)), series:[{name:'Revenue',values:mons.map(m=>m.revenue),color:'var(--c1)'},{name:'Expenses',values:mons.map(m=>m.costs),color:'var(--c5)'}], h:248})}`:noData('Revenue appears here once you record payments against invoices.','banknote'), {act:segc('homeRange',[['6','6M'],['12','12M']],range), hint:'Ex VAT'})}
    </div>
    <div class="grid g3 mt-16">
      ${card('Enquiry conversion', funnel[0].value?chFunnel(funnel):noData('Log enquiries to see how they convert into paying clients.','filter'), {hint:'All time'})}
      ${card('Quoted vs payments received', m6.some(m=>m.quoted||m.collected)?`<div class="legend" style="margin-bottom:8px"><span><i style="background:var(--c2)"></i>Quoted</span><span><i style="background:var(--c3)"></i>Collected</span></div>${chBars({labels:m6.map(m=>fmtM(m.m).slice(0,3)), series:[{name:'Quoted',values:m6.map(m=>m.quoted),color:'var(--c2)'},{name:'Collected',values:m6.map(m=>m.collected),color:'var(--c3)'}], h:200, w:480})}`:noData('Sent quotes and received payments are compared here.'), {hint:'Last 6 months'})}
      ${card('Revenue by service', svc.length?chDonut({items:svc, center:{v:fmtRk(sum(svc,s=>s.value)), l:'contracted'}}):noData('Project budgets are grouped by service type.','pie-chart'), {hint:'Project value'})}
    </div>
    <div class="grid g3 mt-16">
      ${card('Project delivery progress', activeProjects.length?`<div class="col" style="gap:12px">${activeProjects.filter(p=>p.status!=='Awaiting authorization').sort((a,b)=>a.target.localeCompare(b.target)).slice(0,7).map(p=>`<div data-go="project-${p.id}" style="cursor:pointer"><div class="row between"><span class="trunc strong" style="font-size:12.5px">${esc(p.name)}</span>${badge(p.status)}</div><div class="row mt-8" style="gap:10px">${prog(calc.progress(p), p.status==='Blocked'?'red':'')}<span class="muted xs nowrap">due ${fmtDs(p.target)}</span></div></div>`).join('')}</div>`:noData('Active projects and their progress appear here.','folder-kanban'), {act:`<a class="btn ghost xs" href="#projects">All projects</a>`})}
      ${card('Team workload', team.length?chHBar({items:team.map(t=>({label:t.x.name.split(' ')[0]+' '+(t.x.name.split(' ').slice(-1)[0][0]||'')+'.', value:t.l.util, color:t.l.util>100?'var(--red)':t.l.util>90?'var(--amber)':'var(--c1)', marker:100, tip:`${t.x.name}\n${t.x.alloc}h of ${t.x.capacity}h allocated\n${t.l.open} open tasks`, go:'team-'+t.x.id})), fmt:v=>v+'%', max:125}):noData('Add team members and their weekly allocation.','users'), {hint:'Allocated vs capacity', act:`<a class="btn ghost xs" href="#team">Team</a>`})}
      <div class="stack">
        ${card('Lead sources', srcCounts.length?chHBar({items:srcCounts.map((s,i)=>({label:s.k, value:pct(s.v,clients.length), color:i===0?'var(--c1)':'var(--c5)', tip:`${s.k}: ${s.v} client${s.v===1?'':'s'}`})), fmt:v=>v+'%'}):noData('Where your clients come from.','share-2'), {hint:'Share of clients'})}
        ${card('Projects by type', cats.length?chDonut({items:cats, fmt:v=>v, center:{v:projects.length, l:'projects'}}):noData('Projects grouped by category.','layers'))}
      </div>
    </div>
    <div class="grid g3 mt-16">
      ${card('Recent enquiries', `<div class="list">${DB.enquiries.slice().sort((a,b)=>b.received.localeCompare(a.received)).slice(0,6).map(e=>`<div class="li" data-go="inbox-${e.id}">${srcIcon(e.channel)}<div class="grow"><div class="t">${esc(e.company)}</div><div class="s">${esc(e.from)} · ${e.ai&&e.status!=='Unprocessed'?esc(e.ai.cls):'Not yet classified'}</div></div><div class="col" style="gap:3px;align-items:flex-end">${badge(e.status)}<span class="muted xs">${rel(e.received)}</span></div></div>`).join('') || empty('inbox','No enquiries yet','',`<button class="btn sm" data-a="newEnquiry">${ic('plus',13)}Log enquiry</button>`)}</div>`, {flush:true, act:`<a class="btn ghost xs" href="#inbox">Inbox</a>`})}
      ${card('Recent activity', `<div>${DB.activity.slice(0,8).map(feedItem).join('') || empty('activity','No activity yet','Everything your team does is recorded here.')}</div>`, {flush:true, act:`<a class="btn ghost xs" href="#notifications">All activity</a>`})}
      ${card('Payments & accepted quotes', `<div class="list">${pays.map(p=>`<div class="li" data-go="invoices-${p.inv.id}"><span class="src" style="background:var(--green-soft);color:var(--green)">${ic('banknote',13)}</span><div class="grow"><div class="t">${fmtR(p.amount,true)}</div><div class="s">${esc(get.client(p.inv.clientId).name)} · ${p.inv.id}</div></div><span class="muted xs">${fmtDs(p.date)}</span></div>`).join('')}${acc.map(q=>`<div class="li" data-go="quote-${q.id}"><span class="src" style="background:var(--accent-soft);color:var(--accent-2)">${ic('badge-check',13)}</span><div class="grow"><div class="t">${q.id} accepted · ${fmtRk(calc.quote(q).sub)}</div><div class="s">${esc(get.client(q.clientId).name)}</div></div><span class="muted xs">${fmtDs(q.accepted)}</span></div>`).join('')}${!pays.length&&!acc.length?empty('banknote','Nothing yet','Payments and accepted quotes appear here.'):''}</div>`, {flush:true})}
    </div>
  </div>`;
  return {html, crumbs:[['Command Centre']], title:'Command Centre'};
};
A.hideSetup = () => { pref.set('hideSetup', true); rerender(); };
A.goAdminCompany = () => { setv('adm','company'); go('admin'); };
const people = () => DB.users.map(u=>[u.id,u.name]);
window.people = people;

A.reviewQueue = () => {
  drawer({title:'Deliverables awaiting approval', render:()=>{
    const items = DB.projects.flatMap(p=>p.workstreams.filter(w=>w.status==='In review').map(w=>({p,w})));
    if(!items.length) return empty('check-circle-2','Nothing to approve','All submitted deliverables have been reviewed.');
    return `<div class="callout cyan" style="margin-bottom:14px">${ic('shield-check',16)}<span>Approving marks the workstream as Done and records you as the approver. Approvals are always a human decision.</span></div><div class="col gap-12">${items.map(({p,w})=>`<div class="card"><div class="card-b"><div class="row between"><div><div class="strong">${esc(w.name)}</div><div class="muted small">${esc(p.name)} · ${esc(get.client(p.clientId).name)}</div></div>${badge('In review')}</div><div class="row mt-12 wrap" style="gap:14px"><span class="small">${who(w.owner,'owner')}</span><span class="small">${who(w.reviewer,'reviewer')}</span><span class="small muted">Due ${fmtD(w.due)}</span></div>${w.deliverables.length?`<div class="row wrap mt-12">${w.deliverables.map(d=>`<span class="tag">${ic('package',12)}${esc(d)}</span>`).join('')}</div>`:''}${w.notes?`<p class="small sub mt-12">${esc(w.notes)}</p>`:''}<div class="row mt-12"><button class="btn acc sm" data-a="approveWs" data-p="${p.id}" data-w="${w.id}">${ic('check',14)}Approve</button><button class="btn sm" data-a="returnWs" data-p="${p.id}" data-w="${w.id}">Request changes</button><a class="btn ghost sm" href="#project-${p.id}">Open project</a></div></div></div>`).join('')}</div>`;
  }});
};
A.approveWs = d => { const p=get.project(d.p), w=p.workstreams.find(x=>x.id===d.w); w.status='Done'; w.reviewed=true; log(`Approved deliverable <b>${esc(w.name)}</b> on ${esc(p.name)}`, p.clientId, 'project-'+p.id, 'review'); commit(`Approved: ${w.name}`); };
A.returnWs = d => { const p=get.project(d.p), w=p.workstreams.find(x=>x.id===d.w); w.status='In progress'; w.returned=(w.returned||0)+1; w.notes = (w.notes?w.notes+' ':'')+`Changes requested by ${me().name.split(' ')[0]} on ${fmtDs(TODAY)}.`; log(`Requested changes on <b>${esc(w.name)}</b>`, p.clientId, 'project-'+p.id, 'review'); commit('Returned for changes'); };

/* ===================== CRM ===================== */
function crmRows(){
  const q = (UI.q.crm||'').toLowerCase(), st = UI.f.crmStatus||'', ow = UI.f.crmOwner||'', ind = UI.f.crmInd||'';
  return DB.clients.filter(c => (!q || [c.name,c.contact,c.email,c.id,c.location,c.industry].join(' ').toLowerCase().includes(q)) && (!st || c.status===st) && (!ow || c.owner===ow) && (!ind || c.industry===ind));
}
Views.crm = () => {
  const view = uv('crm','table'); const rows = crmRows();
  const ltv = sum(DB.clients, c=>calc.ltv(c));
  const toolbar = `<div class="toolbar">${searchBox('crm','Search clients, contacts, IDs…')}
    <select class="sel sm" data-ch="filt" data-key="crmStatus" aria-label="Status">${opts(STATUS.client, UI.f.crmStatus, {blank:'All statuses'})}</select>
    <select class="sel sm" data-ch="filt" data-key="crmOwner" aria-label="Owner">${userOpts(UI.f.crmOwner,'All owners')}</select>
    <select class="sel sm" data-ch="filt" data-key="crmInd" aria-label="Industry">${opts(uniq(DB.clients.map(c=>c.industry)).sort(), UI.f.crmInd, {blank:'All industries'})}</select>
    ${(UI.q.crm||UI.f.crmStatus||UI.f.crmOwner||UI.f.crmInd)?`<button class="btn ghost sm" data-a="clearCrm">${ic('x',13)}Clear</button>`:''}
    <span class="spacer"></span><span class="muted small">${rows.length} of ${DB.clients.length}</span></div>`;
  let body = '';
  if(view==='table') body = card(null, table({key:'crm', rows, go:c=>'client-'+c.id, cols:[
    {k:'name', l:'Company', r:c=>`<div class="row">${coIc(c)}<div style="min-width:0"><div class="cell-t">${esc(c.name)}</div><div class="cell-s mono">${c.id}</div></div></div>`},
    {k:'contact', l:'Primary contact', r:c=>`<div>${esc(c.contact)}</div><div class="cell-s">${esc(c.email)}</div>`},
    {k:'status', l:'Status', r:c=>badge(c.status), sv:c=>STATUS.client.indexOf(c.status)},
    {k:'owner', l:'Owner', r:c=>who(c.owner), sv:c=>uname(c.owner)},
    {k:'assistant', l:'Assistant', r:c=>who(c.assistant), sv:c=>(get.user(c.assistant)||{}).name||''},
    {k:'industry', l:'Industry'},
    {k:'location', l:'Location'},
    {k:'source', l:'Source'},
    {k:'lastEvent', l:'Last action', r:c=>c.lastEvent?`<div class="trunc" style="max-width:220px">${c.lastEvent.text}</div><div class="cell-s">${esc(uname(c.lastEvent.by))} · ${rel(c.lastEvent.at)}</div>`:'<span class="muted">—</span>', sv:c=>(c.lastEvent||{}).at||''},
    {k:'lastContact', l:'Last contact', r:c=>`<span class="muted">${c.lastContact?rel(c.lastContact):'Never'}</span>`},
    {k:'nextFollowUp', l:'Next follow-up', r:c=>c.nextFollowUp?`<span class="${until(c.nextFollowUp)<=0?'warn':''}">${dueTxt(c.nextFollowUp)}</span>`:'<span class="muted">—</span>', sv:c=>c.nextFollowUp||'9'},
    {k:'ltv', l:'Lifetime value', cls:'r', r:c=>`<span class="num">${fmtR(calc.ltv(c))}</span>`, sv:c=>calc.ltv(c)}
  ]}), {flush:true});
  if(view==='kanban'){
    body = `<div class="kb">${STATUS.client.map(s=>{ const cs = rows.filter(c=>c.status===s); return `<div class="kc" data-drop="${esc(s)}" data-kind="client"><div class="kc-h">${badge(s,null,'nodot')}<span class="ct">${cs.length}</span></div><div class="kc-b">${cs.map(c=>`<div class="kcard" draggable="true" data-drag="${c.id}" data-kind="client" data-go="client-${c.id}"><div class="row between"><span class="mono xs muted">${c.id}</span>${av(c.owner,'sm')}</div><div class="kcard-t">${esc(c.name)}</div>${c.lastEvent?`<div class="xs muted" style="margin:-2px 0 6px;line-height:1.4">${c.lastEvent.text} · <b>${esc(uname(c.lastEvent.by).split(' ')[0])}</b> · ${rel(c.lastEvent.at)}</div>`:''}<div class="kcard-m"><span class="trunc">${esc(c.contact)}</span><span class="nowrap">${c.nextFollowUp?ic('calendar',11)+' '+dueTxt(c.nextFollowUp):''}</span></div></div>`).join('') || `<div class="kc-empty">Drop clients here</div>`}</div></div>`; }).join('')}</div>`;
  }
  if(view==='companies'){
    body = `<div class="grid g3">${rows.map(c=>{ const pr = DB.projects.filter(p=>p.clientId===c.id && p.status!=='Completed'); return `<div class="card" data-go="client-${c.id}" style="cursor:pointer"><div class="card-b col gap-12"><div class="row">${coIc(c,'lg')}<div class="grow"><div class="strong trunc">${esc(c.name)}</div><div class="muted small">${esc(c.industry)} · ${esc(c.size)} staff</div></div>${badge(c.status)}</div><div class="kv" style="grid-template-columns:96px 1fr"><dt>Location</dt><dd>${esc(c.location)}</dd><dt>Website</dt><dd>${esc(c.website)}</dd><dt>Owner</dt><dd>${who(c.owner)}</dd><dt>Projects</dt><dd>${pr.length?pr.map(p=>esc(p.name)).join(', '):'<span class="muted">None active</span>'}</dd></div><div class="row between" style="border-top:1px solid var(--line);padding-top:10px"><span class="muted small">Lifetime value</span><b class="num">${fmtR(calc.ltv(c))}</b></div></div></div>`; }).join('')}</div>`;
  }
  if(view==='contacts'){
    const contacts = rows.flatMap(c=>[{c, n:c.contact, t:c.title, e:c.email, p:c.phone, w:c.whatsapp, primary:true}].concat(c.contacts.map(x=>({c, n:x.name, t:x.title, e:x.email, p:x.phone, w:'—', primary:false}))));
    body = card(null, table({key:'contacts', rows:contacts, go:x=>'client-'+x.c.id, cols:[
      {k:'n', l:'Name', r:x=>`<div class="row"><span class="av sm" style="background:var(--surface-3);color:var(--fg-2)">${initials(x.n)}</span><span class="cell-t">${esc(x.n)}</span>${x.primary?'<span class="tag">Primary</span>':''}</div>`},
      {k:'t', l:'Title'}, {k:'c', l:'Company', r:x=>esc(x.c.name), sv:x=>x.c.name},
      {k:'e', l:'Email', r:x=>`<span class="mono xs">${esc(x.e)}</span>`}, {k:'p', l:'Phone', r:x=>`<span class="num">${esc(x.p)}</span>`}, {k:'w', l:'WhatsApp', r:x=>`<span class="num">${esc(x.w)}</span>`}
    ]}), {flush:true});
  }
  if(view==='activity'){
    const ids = new Set(rows.map(c=>c.id));
    const items = DB.clients.filter(c=>ids.has(c.id)).flatMap(c=>clientTimeline(c.id).map(i=>({...i, c}))).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,40);
    body = card(null, `<div class="tl">${items.map(it=>tlItem({...it, title:`<a href="#client-${it.c.id}" class="strong">${esc(it.c.name)}</a> · ${it.title}`})).join('')}</div>`);
  }
  const html = `<div class="page full">
    ${pageHead('Clients & CRM', `${DB.clients.length} clients · ${DB.clients.filter(isActiveClient).length} active · ${fmtR(ltv)} lifetime value collected`, `<button class="btn" data-a="importClients">${ic('upload',14)}Import CSV</button><button class="btn pri" data-a="newClient">${ic('plus',14)}New client</button>`)}
    <div class="row between wrap" style="margin-bottom:12px">${segc('crm',[['table','Table','table'],['kanban','Pipeline','kanban'],['companies','Companies','building-2'],['contacts','Contacts','contact'],['activity','Activity','activity']],view)}${view==='kanban'?'<span class="muted small">Drag a card to change relationship status</span>':''}</div>
    ${toolbar}<div class="tabpane">${body}</div></div>`;
  return {html, crumbs:[['Clients & CRM']], title:'Clients'};
};
A.clearCrm = () => { UI.q.crm=''; UI.f.crmStatus=''; UI.f.crmOwner=''; UI.f.crmInd=''; rerender(); };

/* ---------- Client workspace ---------- */
Views.client = id => {
  const c = get.client(id); if(!c) return {html:`<div class="page">${empty('search-x','Client not found','It may have been removed.')}</div>`};
  const tab = uv('ctab','overview');
  const conv = DB.conversations.filter(x=>x.clientId===id);
  const disc = DB.discoveries.filter(x=>x.clientId===id);
  const quotes = DB.quotes.filter(x=>x.clientId===id);
  const invs = DB.invoices.filter(x=>x.clientId===id);
  const projs = DB.projects.filter(x=>x.clientId===id);
  const docs = DB.documents.filter(x=>x.clientId===id);
  const notes = DB.notes.filter(x=>x.clientId===id);
  const tl = clientTimeline(id);
  const outstanding = calc.outstanding(c), ltv = calc.ltv(c);
  const ret = DB.retainers.find(r=>r.clientId===id);
  const tabs = [['overview','Overview'],['activity','Activity',tl.length],['conversations','Conversations',conv.length],['discovery','Discovery',disc.length],['assessments','Assessments'],['quotes','Quotes',quotes.length],['invoices','Invoices & payments',invs.length],['projects','Projects',projs.length],['notes','Notes',notes.length]];
  let body='';
  if(tab==='overview'){
    const openQ = quotes.filter(q=>['Draft','Internal review','Sent','Viewed'].includes(q.status));
    const actP = projs.filter(p=>p.status!=='Completed');
    const lastConv = conv.flatMap(x=>x.messages.map(m=>({x,m}))).sort((a,b)=>b.m.at.localeCompare(a.m.at))[0];
    const upcoming = [];
    if(c.nextFollowUp) upcoming.push({d:c.nextFollowUp, t:'Follow-up with '+c.contact, i:'phone-forwarded', who:c.assistant});
    disc.filter(x=>x.status==='Scheduled').forEach(x=>upcoming.push({d:x.date.slice(0,10), t:'Discovery call ('+fmtT(x.date)+')', i:'phone-call', who:x.assistant, go:'discovery-'+x.id}));
    DB.tasks.filter(t=>t.status!=='Done' && (t.clientId===id || (get.project(t.projectId)||{}).clientId===id)).forEach(t=>upcoming.push({d:t.due, t:t.title, i:'check-square', who:t.assignee, go:'tasks-'+t.id}));
    projs.forEach(p=>(p.milestones||[]).filter(m=>!m.done && m.date>=TODAY).forEach(m=>upcoming.push({d:m.date, t:m.name+' · '+p.name, i:'flag', go:'project-'+p.id})));
    upcoming.sort((a,b)=>a.d.localeCompare(b.d));
    const pms = uniq(projs.flatMap(p=>[p.pm,p.tech]));
    body = `<div class="grid g-21"><div class="stack">
      ${card('Relationship stage', `<div class="stepper">${IES.map(s=>`<div class="step ${s.n<c.ies?'done':s.n===c.ies?'cur':''}"><div class="n">${s.n<c.ies?'✓ ':''}0${s.n}</div><div class="t">${s.name}</div><div class="s">${s.n===c.ies?'Current':s.n<c.ies?'Complete':''}</div></div>`).join('')}</div><div class="row mt-12 wrap"><span class="muted small">CRM status</span>${badge(c.status)}<span class="muted small">· BEMO-SOLUTIONS Evolution System™ phase ${c.ies} of 7</span><a class="btn ghost xs" href="#assess-${c.id}" style="margin-left:auto">Open assessment ${ic('arrow-right',12)}</a></div>`)}
      ${card('Client information', `<div class="grid g2" style="gap:12px 28px"><dl class="kv"><dt>Client ID</dt><dd class="mono">${c.id}</dd><dt>Primary contact</dt><dd>${esc(c.contact)}<div class="muted small">${esc(c.title)}</div></dd><dt>Email</dt><dd class="mono small">${esc(c.email)}</dd><dt>Phone</dt><dd class="num">${esc(c.phone)}</dd><dt>WhatsApp</dt><dd class="num">${esc(c.whatsapp)}</dd><dt>Website</dt><dd>${esc(c.website)}</dd></dl><dl class="kv"><dt>Industry</dt><dd>${esc(c.industry)}</dd><dt>Company size</dt><dd>${esc(c.size)} staff</dd><dt>Location</dt><dd>${esc(c.location)}</dd><dt>Lead source</dt><dd>${esc(c.source)}</dd><dt>Client since</dt><dd>${fmtD(c.created)}</dd><dt>Last contact</dt><dd>${c.lastContact?fmtD(c.lastContact):'Never'}</dd></dl></div>${c.notes?`<div class="callout mt-16">${ic('info',15)}<span>${esc(c.notes)}</span></div>`:''}`, {act:`<button class="btn ghost xs" data-a="editClient" data-id="${c.id}">${ic('pen-line',12)}Edit</button>`})}
      <div class="grid g2">
        ${card('Open opportunities', openQ.length?`<div class="list">${openQ.map(q=>`<div class="li" data-go="quote-${q.id}"><span class="src web">${ic('file-text',13)}</span><div class="grow"><div class="t">${esc(q.title)}</div><div class="s">${q.id} · v${q.version}</div></div><div class="col" style="gap:3px;align-items:flex-end"><b class="num small">${fmtR(calc.quote(q).sub)}</b>${badge(q.status)}</div></div>`).join('')}</div>`:empty('file-plus','No open quotes','Create a quote when scope is confirmed.',`<button class="btn sm" data-a="newQuote" data-client="${c.id}">${ic('plus',13)}New quote</button>`), {flush:true})}
        ${card('Active projects', actP.length?`<div class="list">${actP.map(p=>`<div class="li" data-go="project-${p.id}"><span class="src" style="background:var(--surface-3);color:${CAT_COLOR[p.category]}">${ic(CAT_ICON[p.category],13)}</span><div class="grow"><div class="t">${esc(p.name)}</div><div class="row" style="gap:8px">${prog(calc.progress(p))}</div></div>${badge(p.status)}</div>`).join('')}</div>`:empty('folder-kanban','No active projects','Projects appear here once a quote is accepted.'), {flush:true})}
      </div>
      ${card('Latest communication', lastConv?`<div class="row" style="align-items:flex-start;gap:12px">${srcIcon(lastConv.x.channel)}<div class="grow"><div class="row between"><b>${esc(lastConv.x.subject)}</b><span class="muted xs">${fmtDT(lastConv.m.at)}</span></div><div class="muted small">${esc(lastConv.m.from)}</div><p class="sub mt-8" style="white-space:pre-line;line-height:1.55">${esc(lastConv.m.body.slice(0,280))}${lastConv.m.body.length>280?'…':''}</p><button class="btn sm mt-12" data-a="openConv" data-id="${lastConv.x.id}">${ic('messages-square',13)}Open thread</button></div></div>`:empty('message-square','No conversations yet',''), {act:`<button class="btn ghost xs" data-a="compose" data-client="${c.id}">${ic('send',12)}New message</button>`})}
    </div><div class="stack">
      ${card('Assigned team', `<div class="col gap-12">${[['Client owner',c.owner],['Assigned assistant',c.assistant]].map(([l,u])=>`<div class="row between"><span class="muted small">${l}</span>${who(u)}</div>`).join('')}${pms.length?`<div class="row between"><span class="muted small">Delivery</span>${avs(pms,6)}</div>`:''}<div class="row between"><span class="muted small">Client contact</span><span>${esc(c.contact)}</span></div></div>`, {act:`<button class="btn ghost xs" data-a="assignClient" data-id="${c.id}">${ic('user-cog',12)}Reassign</button>`})}
      ${card('Commercial summary', `<div class="kv2" style="grid-template-columns:1fr 1fr"><div><div class="k">Lifetime value</div><div class="v num">${fmtR(ltv)}</div></div><div><div class="k">Outstanding</div><div class="v num ${outstanding?'warn':''}">${fmtR(outstanding,true)}</div></div><div><div class="k">Accepted quotes</div><div class="v num">${fmtR(sum(quotes.filter(q=>q.status==='Accepted'),q=>calc.quote(q).sub))}</div></div><div><div class="k">Retainer</div><div class="v num">${ret?fmtR(ret.monthly)+'/mo':'—'}</div></div></div>${invs.some(i=>calc.inv(i).overdue)?`<div class="callout red mt-12">${ic('alert-triangle',15)}<span>${invs.filter(i=>calc.inv(i).overdue).map(i=>i.id+' is '+calc.inv(i).daysOver+' days overdue').join('; ')}</span></div>`:''}`)}
      ${card('Upcoming activities', upcoming.length?`<div class="list">${upcoming.slice(0,7).map(x=>`<div class="li" ${x.go?`data-go="${x.go}"`:''}><span class="src manual">${ic(x.i,13)}</span><div class="grow"><div class="t" style="white-space:normal;font-size:12.5px">${esc(x.t)}</div><div class="s ${until(x.d)<0?'down':''}">${dueTxt(x.d)}</div></div>${x.who?av(x.who,'sm'):''}</div>`).join('')}</div>`:empty('calendar','Nothing scheduled',''), {flush:true, act:`<button class="btn ghost xs" data-a="newTask" data-client="${c.id}">${ic('plus',12)}Task</button>`})}
    </div></div>`;
  }
  if(tab==='activity'){
    const f = UI.f.ctl||'';
    const kinds = [['','All'],['email','Email'],['whatsapp','WhatsApp'],['call','Calls'],['meeting','Meetings'],['note','Notes'],['payment','Payments'],['quote','Quotes']];
    const items = tl.filter(i=>!f || i.kind===f || (f==='quote' && ['quote','accepted'].includes(i.kind)));
    body = `<div class="toolbar">${kinds.map(([v,l])=>`<button class="fchip ${f===v?'on':''}" data-a="fchip" data-key="ctl" data-v="${v}">${l}</button>`).join('')}<span class="spacer"></span><button class="btn sm" data-a="logActivity" data-client="${c.id}">${ic('plus',13)}Log activity</button></div>${card(null, items.length?`<div class="tl">${items.map(tlItem).join('')}</div>`:empty('activity','No activity of this type',''))}`;
  }
  if(tab==='conversations'){
    body = `<div class="toolbar"><span class="spacer"></span><button class="btn sm" data-a="compose" data-client="${c.id}">${ic('send',13)}New message</button></div>` + card(null, conv.length?`<div class="list">${conv.map(x=>{ const l = x.messages[x.messages.length-1]; return `<div class="li" data-a="openConv" data-id="${x.id}">${srcIcon(x.channel)}<div class="grow"><div class="t">${esc(x.subject)}</div><div class="s">${esc(l.from)}: ${esc(l.body.replace(/\n/g,' ').slice(0,110))}</div></div><div class="col" style="gap:3px;align-items:flex-end">${badge(x.followUp, x.followUp==='Overdue'?'red':x.followUp==='Done'?'green':x.followUp==='Awaiting client'?'amber':'blue')}<span class="muted xs">${rel(l.at)}</span></div></div>`; }).join('')}</div>`:empty('messages-square','No conversations','Start one with New message.'), {flush:true});
  }
  if(tab==='discovery'){
    body = `<div class="toolbar"><span class="spacer"></span><button class="btn sm" data-a="scheduleDiscovery" data-client="${c.id}">${ic('calendar-plus',13)}Schedule discovery</button></div>` + (disc.length?`<div class="grid g2">${disc.map(d=>`<div class="card" data-go="discovery-${d.id}" style="cursor:pointer"><div class="card-b col gap-12"><div class="row between"><span class="mono xs muted">${d.id}</span>${badge(d.status)}</div><div class="strong">${catTag(d.category)} <span style="margin-left:6px">${fmtDT(d.date)}</span></div><p class="sub small">${esc(d.summary)}</p><div class="row between"><span class="small">${who(d.assistant)}</span><span class="muted xs">${d.confirmed.length} confirmed · ${d.unanswered.length} open</span></div></div></div>`).join('')}</div>`:card(null, empty('phone-call','No discovery records','Schedule a discovery call to capture requirements.')));
  }
  if(tab==='assessments'){
    const a = DB.assessments.find(x=>x.clientId===id);
    body = card('BEMO-SOLUTIONS Evolution System™', `<div class="stepper">${IES.map(s=>`<div class="step ${s.n<c.ies?'done':s.n===c.ies?'cur':''}"><div class="n">0${s.n}</div><div class="t">${s.name}</div><div class="s">${esc(s.desc)}</div></div>`).join('')}</div>`) + `<div class="mt-16">${a?card(`Assessment ${a.id}`, `<div class="grid g-21"><div><p class="sub" style="line-height:1.6">${esc(a.overview)}</p><div class="section-t">Recommended solution</div><p style="line-height:1.6">${esc(a.solution)}</p></div><div class="col" style="align-items:center">${gauge(a.readiness)}<div class="row"><span class="muted small">Complexity</span>${badge(a.complexity)}</div></div></div>`, {act:`<a class="btn sm" href="#assess-${c.id}">Open workspace ${ic('arrow-right',13)}</a>`}):card(null, empty('compass','No assessment yet','Start an assessment once discovery is complete.',`<button class="btn sm" data-a="startAssessment" data-client="${c.id}">${ic('plus',13)}Start assessment</button>`))}</div>`;
  }
  if(tab==='quotes'){
    body = `<div class="toolbar"><span class="spacer"></span><button class="btn sm" data-a="newQuote" data-client="${c.id}">${ic('plus',13)}New quote</button></div>` + card(null, table({key:'cq', rows:quotes, go:q=>'quote-'+q.id, emptyMsg:empty('file-text','No quotes',''), cols:[{k:'id',l:'Quote',r:q=>`<span class="mono">${q.id}</span>`},{k:'title',l:'Title',r:q=>`<span class="cell-t">${esc(q.title)}</span>`},{k:'type',l:'Type'},{k:'version',l:'Version',r:q=>'v'+q.version},{k:'status',l:'Status',r:q=>badge(q.status)},{k:'sent',l:'Sent',r:q=>fmtD(q.sent)},{k:'tot',l:'Total incl. VAT',cls:'r',r:q=>`<span class="num">${fmtR(calc.quote(q).total)}</span>`,sv:q=>calc.quote(q).total}]}), {flush:true});
  }
  if(tab==='invoices'){
    const tot = sum(invs,i=>calc.inv(i).total), rec = sum(invs,i=>calc.inv(i).received);
    body = `<div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">${kpiCell({l:'Invoiced (incl. VAT)',v:fmtR(tot)})}${kpiCell({l:'Received',v:fmtR(rec,true),tone:'up'})}${kpiCell({l:'Outstanding',v:fmtR(outstanding,true),tone:outstanding?'down':''})}</div>` + card(null, table({key:'ci', rows:invs, act:i=>`data-a="openInvoice" data-id="${i.id}"`, emptyMsg:empty('receipt','No invoices',''), cols:invCols()}), {flush:true});
  }
  if(tab==='projects'){
    body = projs.length?`<div class="grid g2">${projs.map(projCard).join('')}</div>`:card(null, empty('folder-kanban','No projects','',`<button class="btn sm" data-a="newProject" data-client="${c.id}">${ic('plus',13)}New project</button>`));
  }
  if(tab==='documents'){
    body = `<div class="toolbar"><span class="spacer"></span><button class="btn sm" data-a="uploadDoc" data-client="${c.id}">${ic('upload',13)}Upload</button></div>` + card(null, docTable(docs, 'cdocs'), {flush:true});
  }
  if(tab==='notes'){
    body = card('Add note', `<textarea class="ta" id="note-text" placeholder="Write a note about ${esc(c.name)}… (visible to the team)"></textarea><div class="row mt-8" style="justify-content:flex-end"><button class="btn pri sm" data-a="addNote" data-client="${c.id}">${ic('plus',13)}Add note</button></div>`) + `<div class="mt-16">${card(null, notes.length?`<div class="tl">${notes.slice().sort((a,b)=>b.at.localeCompare(a.at)).map(n=>tlItem({at:n.at, kind:'note', title:`Note${window.can&&can('delete_data')?` <button class="btn ghost xs" data-a="delNote" data-id="${n.id}">${ic('trash-2',11)}Delete</button>`:''}`, user:n.by, body:n.text})).join('')}</div>`:empty('sticky-note','No notes yet','Notes are shared with everyone on the account.'))}</div>`;
  }
  const html = `<div class="page">
    <div class="dh"><div class="dh-l">${coIc(c,'lg')}<div style="min-width:0"><h1>${esc(c.name)}</h1><div class="meta"><span class="mono">${c.id}</span><span>${esc(c.industry)}</span><span>${ic('map-pin',12)} ${esc(c.location)}</span><span>${ic('user',12)} ${esc(c.contact)}</span></div></div></div>
      <div class="ph-act"><select class="sel sm" data-ch="clientStatus" data-id="${c.id}" aria-label="Relationship status">${opts(STATUS.client, c.status)}</select><button class="btn sm" data-a="logActivity" data-client="${c.id}">${ic('plus',13)}Log activity</button><button class="btn sm" data-a="newQuote" data-client="${c.id}">${ic('file-text',13)}Quote</button><button class="btn sm" data-a="newReminder" data-kind="client" data-client="${c.id}">${ic('alarm-clock',13)}Reminder</button>${window.can&&can('delete_data')?`<button class="ib sm" data-a="delClient" data-id="${c.id}" data-tip="Delete client and all their records" aria-label="Delete client">${ic('trash-2',15)}</button>`:''}</div></div>
    ${tabsc('ctab', tabs, tab)}<div class="tabpane">${body}</div></div>`;
  return {html, crumbs:[['Clients & CRM','crm'],[c.name]], title:c.name};
};
function invCols(){ return [
  {k:'id',l:'Invoice',r:i=>`<span class="mono">${i.id}</span>`},
  {k:'clientId',l:'Client',r:i=>`<span class="cell-t">${esc(get.client(i.clientId).name)}</span>`,sv:i=>get.client(i.clientId).name},
  {k:'desc',l:'Description',r:i=>`<span class="trunc" style="max-width:260px;display:inline-block;vertical-align:middle">${esc(i.desc)}</span>`},
  {k:'quoteId',l:'Quote',r:i=>i.quoteId?`<a class="mono small" href="#quote-${i.quoteId}">${i.quoteId}</a>`:'<span class="muted">—</span>'},
  {k:'issued',l:'Issued',r:i=>fmtD(i.issued)},
  {k:'due',l:'Due',r:i=>{ const c=calc.inv(i); return `<span class="${c.overdue?'down':''}">${fmtD(i.due)}${c.overdue?` · ${c.daysOver}d late`:''}</span>`; }},
  {k:'total',l:'Total',cls:'r',r:i=>`<span class="num">${fmtR(calc.inv(i).total,true)}</span>`,sv:i=>calc.inv(i).total},
  {k:'rec',l:'Received',cls:'r',r:i=>`<span class="num">${fmtR(calc.inv(i).received,true)}</span>`,sv:i=>calc.inv(i).received},
  {k:'out',l:'Outstanding',cls:'r',r:i=>{ const o=calc.inv(i).outstanding; return `<span class="num ${o?'strong':''}">${o?fmtR(o,true):'—'}</span>`; },sv:i=>calc.inv(i).outstanding},
  {k:'status',l:'Status',r:i=>{ const c=calc.inv(i); return badge(c.status)+(c.overdue&&c.status!=='Overdue'?' '+badge('Overdue'):''); },sv:i=>calc.inv(i).status}
]; }
window.invCols = invCols;
function projCard(p){ const c=get.client(p.clientId); const ps=calc.payStatus(p); return `<div class="card" data-go="project-${p.id}" style="cursor:pointer"><div class="card-b col gap-12"><div class="row between"><span class="row" style="gap:6px">${catTag(p.category)}<span class="mono xs muted">${p.id}</span></span>${badge(p.status)}</div><div><div class="strong">${esc(p.name)}</div><div class="muted small">${esc(c.name)}</div></div>${prog(calc.progress(p), p.status==='Blocked'?'red':'')}<div class="row between small"><span>${who(p.pm,'PM')}</span><span class="muted">${fmtDs(p.start)} → ${fmtDs(p.target)}</span></div><div class="row between small" style="border-top:1px solid var(--line);padding-top:10px"><span class="muted">Budget ${fmtR(p.budget)}</span>${badge(ps.t, ps.tone)}</div></div></div>`; }
window.projCard = projCard;

A.clientStatus = (v, d) => { const c = get.client(d.id); const from=c.status; c.status=v; log(`Status changed from ${esc(from)} to <b>${esc(v)}</b>`, c.id, 'client-'+c.id, 'status'); commit(`${c.name} → ${v}`); };
A.addNote = d => { const t = val('note-text'); if(!t) return toast('Write something first','err'); DB.notes.push({id:nextId('NT-',DB.notes), clientId:d.client, by:DB.me, at:nowStamp(), text:t}); log('Added a note', d.client, 'client-'+d.client, 'note'); commit('Note added'); };
A.assignClient = d => { const c=get.client(d.id); modal({title:'Reassign '+esc(c.name), size:'sm', body:`<div class="col gap-12">${field('Client owner',`<select class="sel" id="as-owner">${userOpts(c.owner)}</select>`)}${field('Assigned assistant',`<select class="sel" id="as-asst">${opts(people(), c.assistant)}</select>`)}</div>`, foot:`<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="saveAssign" data-id="${c.id}">Save</button>`}); };
A.saveAssign = d => { const c=get.client(d.id); c.owner=val('as-owner'); c.assistant=val('as-asst'); log(`Reassigned to ${esc(uname(c.owner))} (owner) and ${esc(uname(c.assistant))} (assistant)`, c.id, 'client-'+c.id, 'status'); closeTop(); commit('Team updated'); };

function clientForm(c){
  c = c || {};
  return `<div class="form-grid">
    ${field('Company name *',`<input class="inp" id="cf-name" value="${esc(c.name||'')}" placeholder="e.g. Lourens & Partners Accounting">`,'span2')}
    ${field('Primary contact *',`<input class="inp" id="cf-contact" value="${esc(c.contact||'')}">`)}
    ${field('Job title',`<input class="inp" id="cf-title" value="${esc(c.title||'')}">`)}
    ${field('Email',`<input class="inp" id="cf-email" type="email" value="${esc(c.email||'')}">`)}
    ${field('Phone',`<input class="inp" id="cf-phone" value="${esc(c.phone||'')}" placeholder="+27 …">`)}
    ${field('WhatsApp',`<input class="inp" id="cf-wa" value="${esc(c.whatsapp||'')}">`)}
    ${field('Website',`<input class="inp" id="cf-web" value="${esc(c.website||'')}">`)}
    ${field('Industry',`<input class="inp" id="cf-ind" value="${esc(c.industry||'')}" list="ind-list"><datalist id="ind-list">${uniq(DB.clients.map(x=>x.industry)).map(i=>`<option value="${esc(i)}">`).join('')}</datalist>`)}
    ${field('Company size',`<select class="sel" id="cf-size">${opts(['1–10','10–25','25–50','50–100','100–200','200–500','500+'], c.size||'10–25')}</select>`)}
    ${field('Location',`<input class="inp" id="cf-loc" value="${esc(c.location||'')}">`)}
    ${field('Lead source',`<select class="sel" id="cf-src">${opts(['Referral','Website form','WhatsApp','Email','LinkedIn','Event','Manual'], c.source||'Referral')}</select>`)}
    ${field('Client owner',`<select class="sel" id="cf-owner">${userOpts(c.owner||DB.me)}</select>`)}
    ${field('Assigned assistant',`<select class="sel" id="cf-asst">${opts(people(), c.assistant||DB.me)}</select>`)}
    ${field('Relationship status',`<select class="sel" id="cf-status">${opts(STATUS.client, c.status||'New enquiry')}</select>`)}
    ${field('Next follow-up',`<input class="inp" type="date" id="cf-next" value="${c.nextFollowUp||addDays(TODAY,1)}">`)}
    ${field('Notes',`<textarea class="ta" id="cf-notes">${esc(c.notes||'')}</textarea>`,'span2')}
  </div>`;
}
function readClientForm(c){ Object.assign(c, {name:val('cf-name'), contact:val('cf-contact'), title:val('cf-title'), email:val('cf-email'), phone:val('cf-phone'), whatsapp:val('cf-wa'), website:val('cf-web')||'—', industry:val('cf-ind')||'Other', size:val('cf-size'), location:val('cf-loc')||'—', source:val('cf-src'), owner:val('cf-owner'), assistant:val('cf-asst'), status:val('cf-status'), nextFollowUp:val('cf-next')||null, notes:val('cf-notes')}); return c; }
A.newClient = () => { closePop(); modal({title:'New client', size:'lg', body:clientForm(), foot:`<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="saveClient">${ic('check',14)}Create client</button>`}); };
A.saveClient = () => {
  if(!requireFields([['cf-name','Company name'],['cf-contact','Primary contact']])) return;
  const c = readClientForm({id:nextId('C-',DB.clients), created:TODAY, lastContact:null, contacts:[], ies:1});
  DB.clients.push(c); log(`Created client <b>${esc(c.name)}</b>`, c.id, 'client-'+c.id, 'status'); closeTop(); save(); go('client-'+c.id); toast(`${c.name} created`);
};
A.editClient = d => { const c=get.client(d.id); modal({title:'Edit '+esc(c.name), size:'lg', body:clientForm(c), foot:`<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="updateClient" data-id="${c.id}">Save changes</button>`}); };
A.updateClient = d => { if(!requireFields([['cf-name','Company name'],['cf-contact','Primary contact']])) return; const c=get.client(d.id); readClientForm(c); log('Updated client details', c.id, 'client-'+c.id, 'status'); closeTop(); commit('Client updated'); };
A.logActivity = d => { closePop(); modal({title:'Log activity', body:`<div class="form-grid">${field('Client',`<select class="sel" id="la-client">${clientOpts(d.client)}</select>`)}${field('Type',`<select class="sel" id="la-type">${opts([['call','Call'],['meeting','Meeting'],['email','Email'],['whatsapp','WhatsApp'],['note','Internal note']],'call')}</select>`)}${field('Subject *',`<input class="inp" id="la-subj" placeholder="e.g. Follow-up call about quote">`,'span2')}${field('Summary',`<textarea class="ta" id="la-body" placeholder="What was discussed? Decisions, next steps…"></textarea>`,'span2')}${field('Next follow-up',`<input class="inp" type="date" id="la-next" value="${addDays(TODAY,3)}">`)}</div>`, foot:`<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="saveActivity">Log activity</button>`}); };
A.saveActivity = () => {
  if(!requireFields([['la-subj','Subject']])) return;
  const cid = val('la-client'), type = val('la-type'), c = get.client(cid);
  DB.conversations.unshift({id:nextId('CV-',DB.conversations), clientId:cid, channel:type, subject:val('la-subj'), participants:[me().name, c.contact], assigned:DB.me, projectId:null, followUp: val('la-next')?'Scheduled':'Done', messages:[{from:me().name, at:nowStamp(), body:val('la-body')||val('la-subj'), attachments:[]}]});
  c.lastContact = TODAY; if(val('la-next')) c.nextFollowUp = val('la-next');
  closeTop(); commit('Activity logged');
};

/* ===================== INTAKE INBOX ===================== */
const PIPE = ['Message received','Identifying sender','Checking CRM for existing client','Creating lead or attaching to client','Extracting key information','Identifying requested service','Generating enquiry summary','Creating follow-up task','Assigning assistant','Placing in sales pipeline'];
function inboxRows(){
  const f = UI.f.inbox || 'all'; const q=(UI.q.inbox||'').toLowerCase();
  return DB.enquiries.filter(e=>{
    if(q && ![e.from,e.company,e.body,e.subject].join(' ').toLowerCase().includes(q)) return false;
    if(f==='all') return e.status!=='Archived';
    if(f==='action') return e.status==='Unprocessed'||e.status==='New';
    if(['email','whatsapp','web','referral','manual'].includes(f)) return e.channel===f;
    return e.status===f;
  }).sort((a,b)=>b.received.localeCompare(a.received));
}
Views.inbox = id => {
  const rows = inboxRows();
  const e = get.enquiry(id) || rows[0];
  if(e && !e.read){ e.read = true; save(); }
  const f = UI.f.inbox || 'all';
  const cnt = fn => DB.enquiries.filter(fn).length;
  const fl = (v,l,i,n) => `<div class="fl ${f===v?'on':''}" data-a="inboxF" data-v="${v}" role="button" tabindex="0">${ic(i,15)}<span class="grow">${l}</span><span class="ct">${n}</span></div>`;
  const rail = `<div class="ibx-f"><div class="eyebrow" style="padding:4px 9px 6px">Views</div>${fl('all','All open','inbox',cnt(x=>x.status!=='Archived'))}${fl('action','Needs action','alert-circle',cnt(x=>x.status==='Unprocessed'||x.status==='New'))}${fl('Unprocessed','Unprocessed','sparkles',cnt(x=>x.status==='Unprocessed'))}
    <div class="eyebrow" style="padding:14px 9px 6px">Channels</div>${fl('email','Email','mail',cnt(x=>x.channel==='email'))}${fl('whatsapp','WhatsApp','message-circle',cnt(x=>x.channel==='whatsapp'))}${fl('web','Website forms','globe',cnt(x=>x.channel==='web'))}${fl('referral','Referrals','handshake',cnt(x=>x.channel==='referral'))}${fl('manual','Manual','pen-line',cnt(x=>x.channel==='manual'))}
    <div class="eyebrow" style="padding:14px 9px 6px">Status</div>${fl('Contacted','Contacted','phone',cnt(x=>x.status==='Contacted'))}${fl('Converted','Converted','check-circle-2',cnt(x=>x.status==='Converted'))}${fl('Archived','Archived','archive',cnt(x=>x.status==='Archived'))}
    <div class="callout" style="margin:16px 4px 0;font-size:11.5px">${ic('info',14)}<span>Email, WhatsApp and website forms are not connected yet. Log each enquiry with <b>New enquiry</b>; once n8n is connected they will arrive here automatically.</span></div></div>`;
  const list = `<div class="ibx-l"><div style="padding:10px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--surface);z-index:1">${searchBox('inbox','Search enquiries…')}</div>${rows.map(x=>`<div class="ibx-m ${e&&x.id===e.id?'on':''} ${x.read?'':'unread'}" data-go="inbox-${x.id}">${srcIcon(x.channel)}<div class="grow" style="min-width:0"><div class="row between"><span class="nm">${esc(x.from)}</span><span class="tm">${rel(x.received)}</span></div><div class="small trunc" style="color:var(--fg-2)">${esc(x.company)}</div><div class="pv">${esc(x.body)}</div><div class="row mt-8" style="gap:6px">${badge(x.status)}${x.status!=='Unprocessed'&&x.ai?`<span class="tag">${esc(x.ai.cls)}</span>`:''}${x.assistant?`<span style="margin-left:auto">${av(x.assistant,'sm')}</span>`:''}</div></div></div>`).join('') || empty('inbox','No enquiries here','Nothing matches this view.')}</div>`;
  const detail = `<div class="ibx-d">${e?enquiryDetail(e):empty('inbox','Select an enquiry','')}</div>`;
  const html = `<div class="page full">${pageHead('Intake Inbox', 'Every enquiry from email, WhatsApp, website forms, referrals and manual entry — classified, matched and routed.', `<button class="btn pri" data-a="newEnquiry">${ic('plus',14)}New enquiry</button>`)}<div class="ibx">${rail}${list}${detail}</div></div>`;
  return {html, crumbs:[['Intake Inbox','inbox']].concat(e?[[e.company]]:[]), title:'Inbox'};
};
function enquiryDetail(e){
  const c = get.client(e.clientId); const proc = UI.proc && UI.proc.id===e.id ? UI.proc : null;
  const processed = e.status!=='Unprocessed';
  const ai = e.ai || {};
  const task = DB.tasks.find(t=>t.enquiryId===e.id);
  let aiPanel;
  if(proc){
    aiPanel = `<div class="ai-box"><div class="card-h"><h3 class="row">${ic('sparkles',15)} Processing enquiry</h3><span class="muted xs">Rule-based · no AI provider connected</span></div><div class="card-b"><div class="pipeline">${PIPE.map((s,i)=>`<div class="pl-s ${i<proc.step?'ok':i===proc.step?'run':''}"><span class="pi">${i<proc.step?ic('check',11):''}</span>${s}${i===2&&i<proc.step?` — <b>${c?'match found: '+esc(c.name):'no match, new lead'}</b>`:''}</div>`).join('')}</div></div></div>`;
  } else if(!processed){
    aiPanel = `<div class="ai-box"><div class="card-h"><h3 class="row">${ic('sparkles',15)} AI intake</h3><span class="muted small">Not yet processed</span></div><div class="card-b col gap-12"><p class="sub small" style="line-height:1.55">The intake assistant will identify the sender, match or create the client, extract requirements, classify the service, summarise the enquiry, create a follow-up task and assign an assistant. You review every result.</p><div class="row"><button class="btn acc" data-a="processAI" data-id="${e.id}">${ic('sparkles',14)}Process enquiry</button><span class="muted xs">Keyword-based classification until an AI provider is connected</span></div></div></div>`;
  } else {
    aiPanel = `<div class="ai-box"><div class="card-h"><h3 class="row">${ic('sparkles',15)} AI classification</h3>${aiTag('Needs human review')}</div><div class="card-b col gap-12">
      <div class="kv2"><div><div class="k">Service category</div><div class="v">${catTag(ai.cls)}</div></div><div><div class="k">Confidence</div><div class="v num">${Math.round((ai.conf||0)*100)}%</div></div><div><div class="k">Urgency</div><div class="v">${badge(ai.urgency, ai.urgency==='High'?'red':ai.urgency==='Medium'?'amber':'gray')}</div></div><div><div class="k">Budget signal</div><div class="v">${esc(ai.budget)}</div></div></div>
      <div><div class="eyebrow" style="margin-bottom:6px">Summary</div><p style="line-height:1.55">${esc(ai.summary)}</p></div>
      <div class="grid g2"><div><div class="eyebrow" style="margin-bottom:6px">Extracted requirements</div><ul class="bul">${(ai.req||[]).map(r=>`<li>${ic('check',13,'muted')}${esc(r)}</li>`).join('')||'<li class="muted">None detected</li>'}</ul></div><div><div class="eyebrow" style="margin-bottom:6px">Systems mentioned</div><div class="row wrap">${(ai.systems||[]).map(s=>`<span class="tag">${ic('box',12)}${esc(s)}</span>`).join('')||'<span class="muted small">None</span>'}</div><div class="eyebrow" style="margin:12px 0 6px">Suggested service</div><div>${esc(ai.service)}</div></div></div>
      <div class="row wrap" style="border-top:1px dashed var(--accent-line);padding-top:12px;gap:8px">${e.status!=='Archived'?`<button class="btn sm pri" data-a="startDiscovery" data-id="${e.id}">${ic('phone-call',13)}Start discovery</button><button class="btn sm" data-a="markContacted" data-id="${e.id}">${ic('check',13)}Mark contacted</button><button class="btn sm" data-a="reclassify" data-id="${e.id}">${ic('tag',13)}Correct classification</button>`:''}<button class="btn sm" data-a="compose" data-client="${e.clientId||''}" data-to="${esc(e.email||e.phone)}" data-subject="Re: ${esc(e.subject)}">${ic('reply',13)}Reply</button></div></div></div>`;
  }
  return `<div style="padding:18px 20px" class="col gap-16">
    <div class="row between wrap" style="align-items:flex-start"><div class="row" style="align-items:flex-start;gap:12px"><span class="av lg" style="background:var(--surface-3);color:var(--fg-2)">${initials(e.from)}</span><div><h2 style="font-size:16px">${esc(e.from)}</h2><div class="muted small">${esc(e.company)}${e.email?' · '+esc(e.email):''}${e.phone?' · '+esc(e.phone):''}</div><div class="row mt-8" style="gap:6px">${srcIcon(e.channel)}<span class="small sub">${CH_LABEL[e.channel]} · ${fmtDT(e.received)}</span>${badge(e.status)}</div></div></div>
      <div class="row"><label class="muted small" for="as-${e.id}">Assistant</label><select class="sel sm" id="as-${e.id}" data-ch="assignEnq" data-id="${e.id}">${opts(people(), e.assistant, {blank:'Unassigned'})}</select>${e.status!=='Archived'?`<button class="ib sm" data-a="archiveEnq" data-id="${e.id}" data-tip="Archive">${ic('archive',15)}</button>`:''}${window.can&&can('delete_data')?`<button class="ib sm" data-a="delEnquiry" data-id="${e.id}" data-tip="Delete enquiry" aria-label="Delete enquiry">${ic('trash-2',15)}</button>`:''}</div></div>
    <div class="callout ${c?'cyan':''}">${ic(c?'link':'user-plus',15)}<span>${c?`Matched to existing client <a href="#client-${c.id}" class="strong">${esc(c.name)}</a> (${c.id}) · ${esc(c.status)}`:processed?'No CRM match.':'Sender not yet matched — processing will check the CRM.'}</span></div>
    <div><div class="eyebrow" style="margin-bottom:6px">${esc(e.subject)}</div><div class="msg">${esc(e.body)}</div></div>
    ${aiPanel}
    ${task?`<div class="card"><div class="card-h"><h3>Follow-up task</h3>${badge(task.status)}</div><div class="card-b row between"><div><div class="strong">${esc(task.title)}</div><div class="muted small">Due ${dueTxt(task.due)}</div></div>${who(task.assignee)}</div></div>`:''}
  </div>`;
}
A.inboxF = d => { UI.f.inbox = d.v; const r = inboxRows(); go(r[0]?'inbox-'+r[0].id:'inbox'); };
A.assignEnq = (v, d) => { const e = get.enquiry(d.id); e.assistant = v||null; if(v){ log(`Assigned enquiry from ${esc(e.company)} to ${esc(uname(v))}`, e.clientId, 'inbox-'+e.id, 'enquiry'); notify('task', `Enquiry from ${e.company} assigned to ${uname(v)}`, 'inbox-'+e.id); } commit(v?'Assistant assigned':'Unassigned'); };
A.archiveEnq = d => { const e = get.enquiry(d.id); e.status='Archived'; commit('Enquiry archived'); };
A.markContacted = d => { const e = get.enquiry(d.id); e.status='Contacted'; const c=get.client(e.clientId); if(c){ c.lastContact=TODAY; if(['New enquiry','Contact pending'].includes(c.status)) c.status='Contacted'; } const t = DB.tasks.find(t=>t.enquiryId===e.id); if(t) t.status='Done'; log(`Contacted <b>${esc(e.from)}</b> (${esc(e.company)})`, e.clientId, 'inbox-'+e.id, 'call'); commit('Marked as contacted'); };
A.reclassify = d => { const e = get.enquiry(d.id); modal({title:'Correct AI classification', size:'sm', body:`<div class="col gap-12"><div class="callout">${ic('info',15)}<span>Your correction is saved on the record and used to improve future classification.</span></div>${field('Service category',`<select class="sel" id="rc-cls">${opts(STATUS.categories.concat(['Not a lead']), e.ai.cls)}</select>`)}${field('Urgency',`<select class="sel" id="rc-urg">${opts(['High','Medium','Low'], e.ai.urgency)}</select>`)}</div>`, foot:`<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="saveReclass" data-id="${e.id}">Save</button>`}); };
A.saveReclass = d => { const e=get.enquiry(d.id); e.ai.cls=val('rc-cls'); e.ai.urgency=val('rc-urg'); e.ai.conf=1; closeTop(); commit('Classification corrected by '+me().name.split(' ')[0]); };
A.processAI = d => {
  const e = get.enquiry(d.id); if(!e || (UI.proc && UI.proc.id===e.id)) return;
  UI.proc = {id:e.id, step:0}; rerender();
  const tick = setInterval(()=>{
    if(!UI.proc){ clearInterval(tick); return; }
    UI.proc.step++;
    if(UI.proc.step===3 && !e.clientId && e.ai.match==='existing'){ /* nothing */ }
    if(UI.proc.step>=PIPE.length){ clearInterval(tick); finishProcess(e); return; }
    if(ROUTE.page==='inbox') rerender();
  }, 340);
};
function finishProcess(e){
  UI.proc = null;
  const ai = e.ai || classify(e.body); e.ai = ai;
  let c = get.client(e.clientId);
  if(!c){
    c = {id:nextId('C-',DB.clients), name:e.company, contact:e.from, title:'', email:e.email||'', phone:e.phone||'', whatsapp:e.channel==='whatsapp'?e.phone:'', industry:ai.industry||'Unclassified', size:'—', location:'—', website:'—', source:({email:'Email',whatsapp:'WhatsApp',web:'Website form',referral:'Referral',manual:'Manual'})[e.channel], owner:DB.me, assistant:null, status:'New enquiry', ies:1, created:TODAY, lastContact:null, nextFollowUp:TODAY, notes:ai.summary, contacts:[]};
    DB.clients.push(c); e.clientId = c.id;
  }
  /* Routing: 'pool' puts the lead up for grabs (any sales rep claims it); 'auto' gives it to the least-loaded rep */
  const avail = DB.users.filter(u=>u.status!=='On leave'); const reps = avail.filter(u=>u.sysRole==='Sales'); const cs = avail.filter(u=>u.dept==='Client Success');
  const pool = (reps.length?reps:cs.length?cs:avail.length?avail:DB.users).slice().sort((a,b)=>calc.load(a).open-calc.load(b).open);
  const routing = DB.settings.workflow.enquiryRouting || 'pool';
  const asst = c.assistant || (routing==='auto' ? pool[0].id : null); if(asst){ c.assistant = asst; } e.assistant = asst;
  if(c.status==='New enquiry') c.status='Contact pending';
  c.nextFollowUp = TODAY;
  const t = {id:nextId('T-',DB.tasks), title:`Contact ${e.from} (${e.company})`, projectId:'', workstream:'Client follow-up', assignee:asst, pool:asst?null:'Sales', created:nowStamp(), reviewer:c.owner, priority:ai.urgency==='High'?'High':'Medium', status:'To do', start:TODAY, due:TODAY, est:1, description:`AI summary: ${ai.summary}`, deps:[], attachments:[], comments:[], clientId:c.id, enquiryId:e.id};
  DB.tasks.push(t);
  e.status = 'New';
  log(`New enquiry from <b>${esc(e.from)}</b> — ${esc(ai.cls)}, ${asst?'assigned to '+esc(uname(asst)):'placed in the sales pool to claim'}`, c.id, 'inbox-'+e.id, 'enquiry', 'sys');
  if(asst) notify('task', `New enquiry from ${e.company} assigned to you`, 'tasks-'+t.id, asst);
  else if(window.notifyPool) window.notifyPool(t);
  commit(asst ? `Processed — ${ai.cls}. Task assigned to ${uname(asst).split(' ')[0]}` : `Processed — ${ai.cls}. In the sales pool, waiting to be claimed`);
}
function classify(text){
  const t = text.toLowerCase();
  const score = {'Website':/(website|web site|pages|landing|seo|wordpress)/g, 'Automation':/(automat|invoice|reminder|workflow|manual|chase|capture|whatsapp)/g, 'AI system':/(\bai\b|assistant|chatbot|receptionist|predict|gpt|intelligen)/g, 'Custom application':/(app\b|application|portal|platform|loyalty)/g, 'System integration':/(integrat|sync|erp|crm|connect|api)/g};
  let best='Automation', bs=0; Object.entries(score).forEach(([k,re])=>{ const n=(t.match(re)||[]).length; if(n>bs){ bs=n; best=k; } });
  const sys = ['Xero','Sage','Pastel','Microsoft 365','Outlook','Gmail','HubSpot','WhatsApp','SharePoint','Excel','WordPress','Shopify','SAP','GoodX','Salesforce','QuickBooks'].filter(s=>t.includes(s.toLowerCase()));
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(s=>s.trim()).filter(s=>s.length>18 && /(want|need|would like|automate|build|help|must|should|looking)/i.test(s)).slice(0,4);
  return {cls:best, conf:Math.min(0.95, 0.6+bs*0.08), service:best+' engagement', req:sentences.length?sentences:['Clarify requirements on first call'], systems:sys, urgency:/(urgent|asap|immediately|this week)/.test(t)?'High':'Medium', budget:(text.match(/R\s?[\d\s,.]+k?/i)||['Not stated'])[0], summary:`${best} enquiry. ${sentences[0]||text.slice(0,140)}`, match:'new'};
}
window.classify = classify;
A.startDiscovery = d => {
  const e = get.enquiry(d.id); const c = get.client(e.clientId);
  let disc = DB.discoveries.find(x=>x.enquiryId===e.id);
  if(!disc){
    disc = {id:nextId('D-',DB.discoveries), clientId:c.id, enquiryId:e.id, date:addDays(TODAY,2)+'T10:00', assistant:e.assistant||c.assistant||DB.me, category:DQ[e.ai.cls]?e.ai.cls:'Automation', status:'Scheduled', summary:e.ai.summary, confirmed:[], unanswered:DQ[DQ[e.ai.cls]?e.ai.cls:'Automation'].slice(), systems:(e.ai.systems||[]).slice(), integrations:[], risks:[], limitations:[], decisions:[], next:['Confirm call time with '+e.from], answers:{}, notes:'', transcript:[]};
    DB.discoveries.push(disc); c.status='Discovery scheduled'; e.status = 'Contacted';
    log(`Discovery call scheduled with ${esc(c.name)} for ${fmtD(disc.date)}`, c.id, 'discovery-'+disc.id, 'call');
  }
  save(); go('discovery-'+disc.id); toast('Discovery workspace ready');
};
A.newEnquiry = () => { closePop(); modal({title:'New enquiry', size:'lg', body:`<div class="callout" style="margin-bottom:14px">${ic('info',15)}<span>Use this for phone calls, walk-ins and referrals. The enquiry enters the inbox as unprocessed so the AI intake can classify it.</span></div><div class="form-grid">${field('Contact name *',`<input class="inp" id="ne-from">`)}${field('Company *',`<input class="inp" id="ne-co">`)}${field('Email',`<input class="inp" id="ne-email" type="email">`)}${field('Phone / WhatsApp',`<input class="inp" id="ne-phone">`)}${field('Channel',`<select class="sel" id="ne-ch">${opts([['manual','Manual / phone call'],['referral','Referral'],['email','Email'],['whatsapp','WhatsApp'],['web','Website form']],'manual')}</select>`)}${field('Existing client (optional)',`<select class="sel" id="ne-client">${clientOpts('', 'Not an existing client')}</select>`)}${field('Enquiry details *',`<textarea class="ta" id="ne-body" style="min-height:110px" placeholder="What does the client need? Systems, timelines, budget…"></textarea>`,'span2')}</div>`, foot:`<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="saveEnquiry">${ic('inbox',14)}Add to inbox</button>`}); };
A.saveEnquiry = () => {
  if(!requireFields([['ne-from','Contact name'],['ne-co','Company'],['ne-body','Enquiry details']])) return;
  const body = val('ne-body'); const cid = val('ne-client')||null;
  const e = {id:nextId('E-',DB.enquiries), channel:val('ne-ch'), from:val('ne-from'), company:cid?get.client(cid).name:val('ne-co'), email:val('ne-email'), phone:val('ne-phone'), clientId:cid, received:nowStamp(), subject:val('ne-ch')==='manual'?'Logged by '+me().name.split(' ')[0]:'Enquiry', body, status:'Unprocessed', assistant:null, read:true, ai:Object.assign(classify(body),{match:cid?'existing':'new'})};
  DB.enquiries.unshift(e); closeTop(); save(); go('inbox-'+e.id); if(DB.settings.workflow.autoClassify){ A.processAI({id:e.id}); } else toast('Enquiry added — ready to process');
};
/* CSV client import — first row must be a header. Recognised columns: name/company, contact, title, email, phone, whatsapp, industry, size, location, website, source, notes */
A.importClients = () => modal({title:'Import clients from CSV', body:`<p class="sub small" style="line-height:1.55;margin-bottom:12px">Export your existing client list (Excel, Google Sheets, another CRM) as CSV. The first row must contain column names. Recognised columns: <span class="mono xs">company, contact, title, email, phone, whatsapp, industry, size, location, website, source, notes</span>.</p><label class="col" style="border:1.5px dashed var(--line-2);border-radius:10px;padding:22px;align-items:center;gap:6px;cursor:pointer;text-align:center" for="ic-file">${ic('upload-cloud',26,'muted')}<b>Choose a CSV file</b><span class="muted small" id="ic-info">Nothing selected</span><input type="file" accept=".csv,text/csv" id="ic-file" style="display:none" data-ch="icFile"></label>`, foot:`<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="saveImport" id="ic-go" disabled>Import</button>`});
function parseCSV(t){ const rows=[]; let row=[], cur='', q=false; for(let i=0;i<t.length;i++){ const ch=t[i]; if(q){ if(ch==='"'){ if(t[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=ch; } else if(ch==='"') q=true; else if(ch===','||ch===';'){ row.push(cur); cur=''; } else if(ch==='\n'||ch==='\r'){ if(ch==='\r'&&t[i+1]==='\n') i++; row.push(cur); rows.push(row); row=[]; cur=''; } else cur+=ch; } if(cur||row.length){ row.push(cur); rows.push(row); } return rows.filter(r=>r.some(c=>c.trim())); }
let IMPORT = null;
A.icFile = (v, d, el) => { const f = el.files && el.files[0]; if(!f) return; const r = new FileReader(); r.onload = () => { const rows = parseCSV(String(r.result)); const head = (rows.shift()||[]).map(h=>h.trim().toLowerCase()); const col = names => head.findIndex(h=>names.some(n=>h===n||h.includes(n))); const map = {name:col(['company','organisation','organization','business','name']), contact:col(['contact','person','full name']), title:col(['title','position','role']), email:col(['email','e-mail']), phone:col(['phone','tel','mobile','cell']), whatsapp:col(['whatsapp']), industry:col(['industry','sector']), size:col(['size','employees']), location:col(['location','city','address']), website:col(['website','url','web']), source:col(['source','lead source']), notes:col(['notes','comment'])};
  if(map.name<0) { document.getElementById('ic-info').textContent='No company/name column found in the header row.'; return; }
  IMPORT = rows.map(r=>{ const g=k=>map[k]>=0?(r[map[k]]||'').trim():''; return {name:g('name'), contact:g('contact')||g('name'), title:g('title'), email:g('email'), phone:g('phone'), whatsapp:g('whatsapp'), industry:g('industry')||'Other', size:g('size')||'—', location:g('location')||'—', website:g('website')||'—', source:g('source')||'Import', notes:g('notes')}; }).filter(x=>x.name);
  const dup = IMPORT.filter(x=>DB.clients.some(c=>c.name.toLowerCase()===x.name.toLowerCase())).length;
  document.getElementById('ic-info').textContent = `${IMPORT.length} clients found${dup?` · ${dup} already exist and will be skipped`:''}`; document.getElementById('ic-go').disabled = !IMPORT.length; }; r.readAsText(f); };
A.saveImport = () => { if(!IMPORT) return; let n=0; IMPORT.forEach(x=>{ if(DB.clients.some(c=>c.name.toLowerCase()===x.name.toLowerCase())) return; DB.clients.push(Object.assign({id:nextId('C-',DB.clients), owner:DB.me, assistant:DB.me, status:'Contacted', ies:1, created:TODAY, lastContact:null, nextFollowUp:null, contacts:[]}, x)); n++; }); IMPORT=null; log(`Imported ${n} clients from CSV`, null, 'crm', 'status'); closeTop(); commit(`${n} clients imported`); };

/* Transcript / call-notes extraction (rule-based until an AI provider is connected) */
const KNOWN_SYSTEMS = ['Xero','Sage','Pastel','Microsoft 365','Outlook','Teams','Gmail','Google Workspace','Google Drive','HubSpot','Salesforce','Zoho','WhatsApp','SharePoint','Excel','WordPress','Shopify','WooCommerce','SAP','QuickBooks','Notion','Slack','Monday','Trello','Asana','Power BI','Dynamics','Odoo','Supabase','Airtable','Zapier','n8n','GoodX','Elixir','Property24','Private Property'];
function extractFromText(text){
  const sents = text.replace(/\r/g,'').split(/(?<=[.!?])\s+|\n+/).map(s=>s.replace(/^[A-Za-z .'-]{1,30}:\s*/,'').trim()).filter(s=>s.length>8);
  const req = uniq(sents.filter(s=>!/\?$/.test(s) && /\b(need|needs|want|wants|must|should|require|required|would like|has to|have to|looking for|expect)\b/i.test(s))).slice(0,12);
  const open = uniq(sents.filter(s=>/\?$/.test(s))).slice(0,10);
  const lc = text.toLowerCase(); const systems = KNOWN_SYSTEMS.filter(s=>lc.includes(s.toLowerCase()));
  const risks = uniq(sents.filter(s=>/\b(risk|concern|worried|problem|issue|deadline|urgent|security|privacy|popia|compliance|budget)\b/i.test(s))).slice(0,6);
  return {req, open, systems, risks, summary: sents.slice(0,3).join(' ')};
}
Views.discovery = id => {
  const list = DB.discoveries.slice().sort((a,b)=>(a.status==='Scheduled'?0:1)-(b.status==='Scheduled'?0:1) || b.date.localeCompare(a.date));
  const d = get.disc(id) || list[0];
  if(!d) return {html:`<div class="page">${pageHead('Discovery', 'Run structured discovery calls, capture requirements and hand clean briefs to delivery.', `<button class="btn pri" data-a="scheduleDiscovery">${ic('calendar-plus',14)}Schedule discovery</button>`)}${card(null, empty('phone-call','No discovery calls yet', DB.clients.length?'Schedule a discovery call with a client, or start one from an enquiry in the inbox.':'Add a client or log an enquiry first, then schedule a discovery call.', `<button class="btn pri sm" data-a="${DB.clients.length?'scheduleDiscovery':'newClient'}">${ic('plus',13)}${DB.clients.length?'Schedule discovery':'Add client'}</button>`))}</div>`, crumbs:[['Discovery']], title:'Discovery'};
  const html = `<div class="page full">${pageHead('Discovery', 'Run structured discovery calls, capture requirements and hand clean briefs to delivery.', `<button class="btn pri" data-a="scheduleDiscovery">${ic('calendar-plus',14)}Schedule discovery</button>`)}
    <div class="split"><div class="sublist">${list.map(x=>{ const c=get.client(x.clientId); return `<div class="li ${x.id===d.id?'on':''}" data-go="discovery-${x.id}">${coIc(c)}<div class="grow"><div class="t">${esc(c.name)}</div><div class="s">${esc(x.category)} · ${fmtDT(x.date)}</div></div>${badge(x.status)}</div>`; }).join('')}</div>
    <div class="tabpane">${discWorkspace(d)}</div></div></div>`;
  return {html, crumbs:[['Discovery','discovery'],[get.client(d.clientId).name]], title:'Discovery'};
};
function chipList(d, key, label, icon, tone){
  return `<div><div class="row between" style="margin-bottom:6px"><span class="eyebrow">${label}</span><span class="muted xs">${d[key].length}</span></div><div class="col" style="gap:5px">${d[key].map((x,i)=>`<div class="row" style="gap:7px;font-size:12.75px;align-items:flex-start">${ic(icon,13,tone||'muted')}<span class="grow" style="line-height:1.45">${esc(x)}</span><button class="ib sm" style="width:20px;height:20px" data-a="discDel" data-id="${d.id}" data-k="${key}" data-i="${i}" aria-label="Remove">${ic('x',12)}</button></div>`).join('')}<div class="row" style="gap:6px"><input class="inp sm grow" id="add-${key}" placeholder="Add…" data-enter="discAdd" data-id="${d.id}" data-k="${key}"><button class="btn xs" data-a="discAdd" data-id="${d.id}" data-k="${key}">${ic('plus',12)}</button></div></div></div>`;
}
function discWorkspace(d){
  const c = get.client(d.clientId); const e = d.enquiryId ? get.enquiry(d.enquiryId) : DB.enquiries.find(x=>x.clientId===c.id);
  const qs = DQ[d.category] || DQ.Automation; const answered = qs.filter((q,i)=>d.answers[i] && d.answers[i].trim()).length;
  const R = UI.rec && UI.rec.id===d.id ? UI.rec : null;
  const hist = DB.conversations.filter(x=>x.clientId===c.id && ['call','meeting'].includes(x.channel));
  const tasks = DB.tasks.filter(t=>t.clientId===c.id || (get.project(t.projectId)||{}).clientId===c.id).filter(t=>t.status!=='Done');
  const X = d.extract || null;
  const brief = [`${c.name} — ${c.industry}, ${c.size} staff, ${c.location}.`, e?`Enquired via ${CH_LABEL[e.channel]} on ${fmtD(e.received)}: “${e.body.replace(/\n+/g,' ').slice(0,150)}${e.body.length>150?'…':''}”`:'', d.systems.length?`Known systems: ${d.systems.join(', ')}.`:'', `Goal of this call: confirm scope, systems, constraints and decision process for a ${d.category.toLowerCase()} engagement.`, c.notes?`Watch-outs: ${c.notes}`:''].filter(Boolean);
  return `<div class="col gap-16">
    <div class="card"><div class="card-b"><div class="row between wrap" style="gap:12px"><div class="row" style="gap:12px">${coIc(c,'lg')}<div><div class="row"><a href="#client-${c.id}" class="strong" style="font-size:15px">${esc(c.name)}</a>${badge(d.status)}</div><div class="muted small">${d.id} · ${fmtDT(d.date)} · ${who(d.assistant)}</div></div></div>
      <div class="row wrap"><label class="muted small" for="dcat">Project category</label><select class="sel sm" id="dcat" data-ch="discCat" data-id="${d.id}">${opts(Object.keys(DQ), d.category)}</select>${d.status!=='Completed'?`<button class="btn sm acc" data-a="discComplete" data-id="${d.id}">${ic('check',13)}Mark completed</button>`:''}${window.can&&can('delete_data')?`<button class="ib sm" data-a="delDisc" data-id="${d.id}" data-tip="Delete this discovery record" aria-label="Delete discovery">${ic('trash-2',15)}</button>`:''}</div></div></div></div>
    <div class="grid g3">
      ${card('Original enquiry', e?`<div class="row" style="gap:8px;margin-bottom:8px">${srcIcon(e.channel)}<span class="small sub">${esc(e.from)} · ${fmtDT(e.received)}</span></div><p class="small" style="line-height:1.55;white-space:pre-line;max-height:150px;overflow:auto">${esc(e.body)}</p><a class="btn ghost xs mt-8" href="#inbox-${e.id}">Open in inbox</a>`:empty('inbox','No linked enquiry',''))}
      ${card('Client profile', `<dl class="kv" style="grid-template-columns:90px 1fr"><dt>Contact</dt><dd>${esc(c.contact)}<div class="muted xs">${esc(c.title)}</div></dd><dt>Phone</dt><dd class="num">${esc(c.phone)}</dd><dt>Industry</dt><dd>${esc(c.industry)}</dd><dt>Size</dt><dd>${esc(c.size)}</dd><dt>Status</dt><dd>${badge(c.status)}</dd><dt>Owner</dt><dd>${who(c.owner)}</dd></dl>`)}
      ${card('Call brief', `<ul class="bul">${brief.map(b=>`<li>${ic('dot',14,'muted')}<span>${esc(b)}</span></li>`).join('')}</ul>`, {act:aiTag('Generated')})}
    </div>
    ${card(`${ic('file-audio',15)} Call notes & transcript`, `<div class="callout" style="margin-bottom:12px">${ic('info',15)}<span>No telephony is connected, so calls are not recorded here. Paste a transcript (from Teams, Zoom, Google Meet or Otter) or type your call notes, then extract requirements. Every extracted item must be confirmed by you.</span></div>
      <div class="grid g2"><div>${field('Transcript or notes',`<textarea class="ta" id="dtr-${d.id}" style="min-height:220px" data-in="discField" data-id="${d.id}" data-k="transcriptText" placeholder="Paste the transcript or type notes from the call…">${esc(d.transcriptText||'')}</textarea>`)}<div class="row mt-8"><button class="btn acc sm" data-a="extractReq" data-id="${d.id}">${ic('wand-2',13)}Extract requirements</button><span class="muted xs">Keyword-based until an AI provider is connected</span></div></div>
      <div><div class="row between" style="margin-bottom:8px"><span class="eyebrow">Extracted — needs your confirmation</span>${aiTag('Suggestion')}</div>${X?`${X.summary?`<p style="line-height:1.55" class="small">${esc(X.summary)}</p>`:''}<div class="eyebrow" style="margin:12px 0 6px">Possible requirements</div><div class="col" style="gap:6px">${X.req.map(r=>{ const done = d.confirmed.includes(r); return `<div class="row" style="gap:8px;font-size:12.75px">${ic(done?'check-circle-2':'circle',14,done?'up':'muted')}<span class="grow">${esc(r)}</span>${done?'<span class="ver-tag">Confirmed</span>':`<button class="btn xs" data-a="acceptReq" data-id="${d.id}" data-r="${esc(r)}">Confirm</button>`}</div>`; }).join('')||'<p class="muted small">No requirement statements found. Phrases like “we need…”, “must…” or “would like…” are picked up.</p>'}</div>${X.open.length?`<div class="eyebrow" style="margin:12px 0 6px">Open questions</div><div class="row wrap">${X.open.map(o=>`<span class="tag">${ic('help-circle',12)}${esc(o)}</span>`).join('')}</div>`:''}${X.systems.length?`<div class="eyebrow" style="margin:12px 0 6px">Systems mentioned</div><div class="row wrap">${X.systems.map(o=>`<span class="tag">${ic('box',12)}${esc(o)}</span>`).join('')}</div>`:''}<button class="btn sm mt-12" data-a="acceptAllReq" data-id="${d.id}">${ic('check',13)}Confirm all & update record</button>`:'<p class="muted small">Extracted requirements, open questions and systems appear here.</p>'}</div></div>`)}
    <div class="grid g-32">
      ${card(`Discovery questions <span class="muted" style="font-weight:400">· ${esc(d.category)}</span>`, `<div class="row" style="margin-bottom:12px;gap:10px">${prog(pct(answered,qs.length))}<span class="muted small nowrap">${answered} of ${qs.length} answered</span></div><div class="col" style="gap:8px">${qs.map((q,i)=>{ const a=d.answers[i]||''; return `<div class="qa ${a.trim()?'done':''}"><div class="q">${ic(a.trim()?'check-circle-2':'circle',15,a.trim()?'up':'muted')}<span>${esc(q)}</span></div><input class="inp sm" id="dq-${d.id}-${i}" value="${esc(a)}" placeholder="Capture the client's answer…" data-in="discAns" data-id="${d.id}" data-i="${i}"></div>`; }).join('')}</div>`, {hint:'Changes with project category', act:`<button class="btn ghost xs" data-a="aiQuestions" data-id="${d.id}">${ic('sparkles',12)}Suggest follow-ups</button>`})}
      <div class="stack">
        ${card('Discovery record', `<div class="col gap-16">${field('Summary',`<textarea class="ta" id="dsum-${d.id}" data-in="discField" data-id="${d.id}" data-k="summary">${esc(d.summary)}</textarea>`)}${chipList(d,'confirmed','Confirmed requirements','check-circle-2','up')}${chipList(d,'unanswered','Unanswered questions','help-circle','warn')}${chipList(d,'systems','Existing systems','box')}${chipList(d,'integrations','Integrations','plug')}${chipList(d,'risks','Risks','alert-triangle','warn')}${chipList(d,'limitations','Limitations','ban')}${chipList(d,'decisions','Client decisions','gavel')}${chipList(d,'next','Next actions','arrow-right')}</div>`)}
      </div>
    </div>
    <div class="grid g3">
      ${card('Notes', `<textarea class="ta" id="dnotes-${d.id}" style="min-height:120px" data-in="discField" data-id="${d.id}" data-k="notes" placeholder="Free-form call notes…">${esc(d.notes)}</textarea><div class="muted xs mt-8">Saved automatically</div>`)}
      ${card('Call & meeting history', hist.length?`<div class="list">${hist.map(h=>`<div class="li" data-a="openConv" data-id="${h.id}">${srcIcon(h.channel)}<div class="grow"><div class="t">${esc(h.subject)}</div><div class="s">${fmtDT(h.messages[0].at)}</div></div></div>`).join('')}</div>`:empty('phone','No calls logged',''), {flush:true, act:`<button class="btn ghost xs" data-a="logActivity" data-client="${c.id}">${ic('plus',12)}Log</button>`})}
      ${card('Follow-up actions', tasks.length?`<div class="list">${tasks.slice(0,6).map(t=>`<div class="li" data-a="openTask" data-id="${t.id}"><span class="src manual">${ic('check-square',13)}</span><div class="grow"><div class="t">${esc(t.title)}</div><div class="s">${dueTxt(t.due)}</div></div>${av(t.assignee,'sm')}</div>`).join('')}</div>`:empty('check-square','No open follow-ups',''), {flush:true, act:`<button class="btn ghost xs" data-a="newTask" data-client="${c.id}">${ic('plus',12)}Task</button>`})}
    </div>
  </div>`;
}
A.extractReq = d => { const disc=get.disc(d.id); const t = val('dtr-'+d.id) || disc.transcriptText || ''; if(t.trim().length<20) return toast('Paste a transcript or notes first','err'); disc.transcriptText = t; disc.extract = extractFromText(t); commit('Requirements extracted — review and confirm'); };
A.acceptReq = d => { const disc=get.disc(d.id); if(!disc.confirmed.includes(d.r)) disc.confirmed.push(d.r); commit('Requirement confirmed'); };
A.acceptAllReq = d => { const disc=get.disc(d.id); const s=disc.extract; if(!s) return; s.req.forEach(r=>{ if(!disc.confirmed.includes(r)) disc.confirmed.push(r); }); s.open.forEach(o=>{ if(!disc.unanswered.includes(o)) disc.unanswered.push(o); }); s.systems.forEach(o=>{ if(!disc.systems.includes(o)) disc.systems.push(o); }); s.risks.forEach(o=>{ if(!disc.risks.includes(o)) disc.risks.push(o); }); if(!disc.summary && s.summary) disc.summary = s.summary; commit('Discovery record updated'); };
A.discAns = (v, d) => { const disc=get.disc(d.id); const was = !!(disc.answers[d.i]||'').trim(); disc.answers[d.i]=v; save(); const now = !!v.trim(); if(was!==now) rerender(); };
A.discField = (v, d) => { const disc=get.disc(d.id); disc[d.k]=v; save(); };
A.discCat = (v, d) => { const disc=get.disc(d.id); disc.category=v; disc.answers={}; commit('Question set switched to '+v); };
A.discAdd = d => { const inp=document.getElementById('add-'+d.k); const v=inp && inp.value.trim(); if(!v) return; get.disc(d.id)[d.k].push(v); commit(); setTimeout(()=>{ const i=document.getElementById('add-'+d.k); i && i.focus(); }, 0); };
A.discDel = d => { get.disc(d.id)[d.k].splice(+d.i,1); commit(); };
A.discComplete = d => { const disc=get.disc(d.id); disc.status='Completed'; const c=get.client(disc.clientId); if(STATUS.client.indexOf(c.status) < STATUS.client.indexOf('Discovery completed')) c.status='Discovery completed'; c.lastContact=TODAY; log(`Discovery completed with ${esc(c.name)}`, c.id, 'discovery-'+disc.id, 'call'); commit('Discovery marked complete'); };
A.aiQuestions = d => { const disc=get.disc(d.id); const extra = {'Website':['Do you need multilingual content?','Which analytics and tracking are required?','Are there accessibility requirements?'],'Automation':['What volume do you expect at peak?','Which steps must stay manual?','How should errors be reported?'],'AI system':['What sources are out of bounds?','How will answers be evaluated?','Who reviews flagged responses?']}[disc.category] || ['What does success look like in 3 months?','Who signs off the final scope?','Are there budget constraints?'];
  modal({title:'Suggested follow-up questions', size:'sm', badge:aiTag(), body:`<p class="sub small" style="margin-bottom:10px">Based on the ${esc(disc.category.toLowerCase())} question set and unanswered items. Add the ones you want to ask.</p><div class="col" style="gap:8px">${extra.map((q,i)=>`<label class="chk"><input type="checkbox" id="aq-${i}" checked>${esc(q)}</label>`).join('')}</div>`, foot:`<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="addAiQ" data-id="${d.id}" data-q="${esc(JSON.stringify(extra))}">Add to unanswered</button>`}); };
A.addAiQ = d => { const disc=get.disc(d.id); JSON.parse(d.q).forEach((q,i)=>{ if(val('aq-'+i) && !disc.unanswered.includes(q)) disc.unanswered.push(q); }); closeTop(); commit('Questions added'); };
A.scheduleDiscovery = d => { closePop(); modal({title:'Schedule discovery call', body:`<div class="form-grid">${field('Client',`<select class="sel" id="sd-client">${clientOpts(d.client)}</select>`,'span2')}${field('Date',`<input class="inp" type="date" id="sd-date" value="${addDays(TODAY,2)}">`)}${field('Time',`<input class="inp" type="time" id="sd-time" value="10:00">`)}${field('Assistant',`<select class="sel" id="sd-asst">${opts(people(),DB.me)}</select>`)}${field('Project category',`<select class="sel" id="sd-cat">${opts(Object.keys(DQ),'Automation')}</select>`)}</div><div class="callout mt-12">${ic('info',15)}<span>Calendar invites are not sent from the demo. In production this creates a Microsoft 365 event.</span></div>`, foot:`<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="saveDiscovery">Schedule</button>`}); };
A.saveDiscovery = () => { const cid=val('sd-client'), cat=val('sd-cat'); const c=get.client(cid); const disc = {id:nextId('D-',DB.discoveries), clientId:cid, enquiryId:null, date:val('sd-date')+'T'+val('sd-time'), assistant:val('sd-asst'), category:cat, status:'Scheduled', summary:'', confirmed:[], unanswered:DQ[cat].slice(), systems:[], integrations:[], risks:[], limitations:[], decisions:[], next:[], answers:{}, notes:'', transcript:[]}; DB.discoveries.push(disc); if(STATUS.client.indexOf(c.status)<STATUS.client.indexOf('Discovery scheduled')) c.status='Discovery scheduled'; log(`Discovery scheduled with ${esc(c.name)}`, cid, 'discovery-'+disc.id, 'call'); closeTop(); save(); go('discovery-'+disc.id); toast('Discovery scheduled'); };
// Enter key on chip inputs
document.addEventListener('keydown', e=>{ if(e.key==='Enter' && e.target.dataset && e.target.dataset.enter){ e.preventDefault(); A[e.target.dataset.enter](e.target.dataset); } });

/* AI Assistant removed. */
A.copyText = d => { try { navigator.clipboard.writeText(d.t).then(()=>toast('Copied to clipboard'), ()=>toast('Copy blocked — select the text instead','err')); } catch(e){ toast('Copy blocked — select the text instead','err'); } };

/* Used by js/website-sync.js to auto-process website leads */
window.finishProcess = finishProcess; window.classify = classify;

})();
