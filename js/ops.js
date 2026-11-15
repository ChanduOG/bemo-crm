/* Operations layer (loads last):
   - Role-based portals: each person sees a home page and menu for their role (Owner/Admin, Team leader, Sales, Delivery, Finance, Read-only)
   - Task pool: tasks can be "up for grabs"; the first rep to claim one owns it. Team leaders can assign.
   - Reminders: manual and automatic (quote follow-ups, invoice chasing), repeating until the work is done,
     with in-app notifications to the owner, escalation to their team leader, and an optional daily email via n8n.
   - Pipeline automation: every action is stamped with who did it; client stages move on their own.
   - Sending quotes and invoices from the CRM (n8n email, or your own email app), printing / saving as PDF.
   - Deleting records (with everything linked to them), per record or in bulk. */
(function(){
const ws = () => window.WebsiteSync;
const live = () => !!(ws() && ws().connected && ws().connected());
const company = () => (DB.settings.company && DB.settings.company.name) || 'Our company';
const first = n => String(n||'').replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i,'').split(' ')[0] || 'there';
const isEmail = v => /^\S+@\S+\.\S+$/.test(String(v||'').trim());

/* ===================== Roles & portals ===================== */
const ROLE_PAGES = {
  'Team leader': ['home','inbox','reminders','calendar','notifications','crm','discovery','assess','quotes','invoices','projects','tasks','team','comms','analytics'],
  'Sales':       ['home','inbox','reminders','calendar','notifications','crm','discovery','quotes','invoices','tasks','comms'],
  'Delivery':    ['home','reminders','calendar','notifications','crm','projects','tasks','team','comms'],
  'Finance':     ['home','reminders','calendar','notifications','crm','quotes','invoices','finance','tasks','comms','analytics'],
  'Read-only':   ['home','calendar','notifications','crm','projects','analytics']
};
const role = () => (me()||{}).sysRole || 'Owner';
const isBoss = uid => { const u = uid ? get.user(uid) : me(); return !!u && ['Owner','Admin'].includes(u.sysRole); };
const isLeader = uid => { const u = uid ? get.user(uid) : me(); return !!u && (u.sysRole==='Team leader' || ['Owner','Admin'].includes(u.sysRole)); };
window.can = perm => { const r = role(); if(r==='Owner') return true; const P = DB.settings.perms || window.DEFAULT_PERMS || {}; return (P[r]||[]).includes(perm); };
window.navAllowed = id => { if(isBoss()) return true; if(id==='admin') return can('admin'); const l = ROLE_PAGES[role()]; return !l || l.includes(id); };
window.homeLabel = () => isBoss() ? 'Command Centre' : 'My portal';

/* The people a leader looks after: explicit "reports to", otherwise everyone below leader level */
function teamOf(uid){
  const u = get.user(uid); if(!u) return [];
  const direct = DB.users.filter(x=>x.leader===uid).map(x=>x.id);
  if(isBoss(uid)) return DB.users.filter(x=>x.id!==uid).map(x=>x.id);
  if(u.sysRole==='Team leader') return direct.length ? direct : DB.users.filter(x=>x.id!==uid && !x.leader && !['Owner','Admin','Team leader'].includes(x.sysRole)).map(x=>x.id);
  return [];
}
/* Who hears about this person's reminders: their team leader, else every team leader, else owner/admin */
function leadersOf(uid){
  const u = get.user(uid); if(!u) return [];
  if(u.leader && get.user(u.leader)) return [u.leader];
  const tl = DB.users.filter(x=>x.sysRole==='Team leader' && x.id!==uid);
  const list = tl.length ? tl : DB.users.filter(x=>['Owner','Admin'].includes(x.sysRole) && x.id!==uid);
  return list.map(x=>x.id);
}
const poolMembers = pool => { const m = DB.users.filter(u=>u.status!=='On leave' && (pool==='Anyone' ? u.sysRole!=='Read-only' : u.sysRole===pool)); return m.length ? m : DB.users.filter(u=>u.sysRole!=='Read-only'); };
const canClaim = (t, uid) => { uid = uid||DB.me; const u = get.user(uid); if(!u || t.assignee || t.status==='Done') return false; if(!t.pool || t.pool==='Anyone' || isLeader(uid)) return true; return u.sysRole===t.pool || !DB.users.some(x=>x.sysRole===t.pool); };
window.canClaim = canClaim;

/* ===================== Notifications to the right people ===================== */
window.notifyPool = t => {
  const sent = new Set();
  poolMembers(t.pool||'Anyone').forEach(u=>{ if(sent.has(u.id)) return; sent.add(u.id); notify('pool', `Up for grabs: ${t.title} — first to claim it owns it`, 'tasks-'+t.id, u.id); });
  DB.users.filter(u=>isLeader(u.id) && !sent.has(u.id)).forEach(u=>notify('pool', `New in the ${t.pool||'open'} pool: ${t.title}`, 'tasks-'+t.id, u.id));
};
const tellLeaders = (uid, text, link) => leadersOf(uid).forEach(l=>notify('task', text, link, l));

/* ===================== Task claiming & assigning ===================== */
A.claimTask = d => {
  const t = get.task(d.id); if(!t) return;
  if(t.assignee) return toast(`Already claimed by ${uname(t.assignee)}`, 'err');
  if(!canClaim(t)) return toast(`Only ${t.pool} can claim this task`, 'err');
  const from = t.pool; t.assignee = DB.me; t.pool = null; t.claimedAt = nowStamp(); t.claimedFrom = from||'pool'; if(t.status==='Backlog') t.status='To do';
  const e = t.enquiryId && get.enquiry(t.enquiryId); if(e) e.assistant = DB.me;
  const c = t.clientId && get.client(t.clientId);
  if(c){ c.assistant = DB.me; if(['New enquiry','Contact pending'].includes(c.status) || !get.user(c.owner)) c.owner = DB.me; }
  window.log(`Claimed <b>${esc(t.title)}</b>`, t.clientId || (get.project(t.projectId)||{}).clientId, 'tasks-'+t.id, 'task');
  tellLeaders(DB.me, `${uname(DB.me)} claimed “${t.title}”`, 'tasks-'+t.id);
  closePop(); commit('Claimed — it’s yours now');
};
A.poolAssign = (v, d) => {
  if(!v) return; const t = get.task(d.id); if(!t) return;
  if(!can('assign_tasks') && !isLeader()) { rerender(); return toast('Only team leaders can assign tasks', 'err'); }
  t.assignee = v; t.pool = null; t.assignedBy = DB.me; t.claimedAt = nowStamp();
  const c = t.clientId && get.client(t.clientId); if(c && ['New enquiry','Contact pending'].includes(c.status)){ c.assistant = v; c.owner = v; }
  const e = t.enquiryId && get.enquiry(t.enquiryId); if(e) e.assistant = v;
  window.log(`Assigned <b>${esc(t.title)}</b> to ${esc(uname(v))}`, t.clientId || (get.project(t.projectId)||{}).clientId, 'tasks-'+t.id, 'task');
  if(v!==DB.me) notify('task', `${uname(DB.me)} assigned you “${t.title}”`, 'tasks-'+t.id, v);
  commit(`Assigned to ${uname(v)}`);
};

/* ===================== Reminders ===================== */
const remLink = r => r.kind==='quote' ? 'quote-'+r.ref : r.kind==='invoice' ? 'invoices-'+r.ref : r.kind==='task' ? 'tasks-'+r.ref : r.clientId ? 'client-'+r.clientId : 'reminders';
const REM_IC = {quote:'file-text', invoice:'receipt', task:'check-square', client:'building-2', custom:'alarm-clock'};
function addReminder(o){ const r = Object.assign({id:nextId('R-', DB.reminders), status:'Open', created:nowStamp(), createdBy:DB.me, repeat:0, kind:'custom', history:[]}, o); DB.reminders.push(r); return r; }
window.addReminder = addReminder;
function resolvedWhy(r){
  if(r.kind==='quote'){ const q = get.quote(r.ref); if(!q) return 'quote deleted'; if(['Accepted','Rejected','Expired'].includes(q.status)) return 'quote '+q.status.toLowerCase(); }
  if(r.kind==='invoice'){ const i = get.invoice(r.ref); if(!i) return 'invoice deleted'; const s = calc.inv(i).status; if(['Paid','Cancelled'].includes(s)) return 'invoice '+s.toLowerCase(); }
  if(r.kind==='task'){ const t = get.task(r.ref); if(!t) return 'task deleted'; if(t.status==='Done') return 'task completed'; }
  if(r.clientId && !get.client(r.clientId)) return 'client deleted';
  return '';
}
/* Every sent quote and issued invoice gets a follow-up reminder automatically */
function autoReminders(){
  const W = DB.settings.workflow; let n = 0;
  DB.quotes.filter(q=>['Sent','Viewed'].includes(q.status) && !q.remSet).forEach(q=>{
    const c = get.client(q.clientId); const every = Math.max(1, +W.quoteFollowDays||3);
    addReminder({kind:'quote', ref:q.id, clientId:q.clientId, owner:get.user(q.sentBy)?q.sentBy:get.user(q.owner)?q.owner:DB.me, due:addDays(q.sent||TODAY, every), repeat:every, auto:true, title:`Follow up quote ${q.id} with ${c?c.contact+' ('+c.name+')':'the client'}`});
    q.remSet = true; n++;
  });
  DB.invoices.forEach(i=>{
    if(i.remSet) return; const s = calc.inv(i); if(['Draft','Cancelled','Paid'].includes(s.status)) return;
    const c = get.client(i.clientId); const before = Math.max(0, +W.invoiceRemindBefore||0); const every = Math.max(1, +W.invoiceRepeatDays||7);
    const fin = DB.users.find(u=>u.sysRole==='Finance');
    const due = addDays(i.due, -before) < TODAY ? TODAY : addDays(i.due, -before);
    addReminder({kind:'invoice', ref:i.id, clientId:i.clientId, owner:get.user(i.sentBy)?i.sentBy:fin?fin.id:get.user(i.createdBy)?i.createdBy:DB.me, due, repeat:every, auto:true, title:`Chase payment: ${i.id} · ${c?c.name:''} · due ${fmtD(i.due)}`});
    i.remSet = true; n++;
  });
  return n;
}
A.newReminder = d => {
  d = d||{}; closePop();
  let title = '', due = addDays(TODAY,1), repeat = 0;
  if(d.kind==='quote'){ const q = get.quote(d.ref); if(q){ title = `Follow up quote ${q.id} — ${q.title}`; repeat = +DB.settings.workflow.quoteFollowDays||3; due = addDays(TODAY, repeat); } }
  if(d.kind==='invoice'){ const i = get.invoice(d.ref); if(i){ title = `Chase payment: ${i.id} (${fmtR(calc.inv(i).outstanding,true)})`; repeat = +DB.settings.workflow.invoiceRepeatDays||7; due = i.due>TODAY ? i.due : TODAY; } }
  if(d.kind==='task'){ const t = get.task(d.ref); if(t){ title = `Check on: ${t.title}`; due = t.due && t.due>TODAY ? t.due : addDays(TODAY,1); } }
  if(d.kind==='client'){ const c = get.client(d.client); if(c) title = `Follow up with ${c.contact} (${c.name})`; }
  const owners = DB.users.map(u=>[u.id, u.name+(u.id===DB.me?' (me)':'')]);
  modal({title:'New reminder', body:`<div class="form-grid">${field('Remind about *',`<input class="inp" id="rm-title" value="${esc(title)}" placeholder="e.g. Call Thandi about the revised quote">`,'span2')}${field('Who gets reminded',`<select class="sel" id="rm-owner">${opts(owners, DB.me)}</select>`)}${field('Date *',`<input class="inp" type="date" id="rm-due" value="${due}">`)}${field('Repeat',`<select class="sel" id="rm-rep">${opts([['0','Once'],['1','Every day'],['2','Every 2 days'],['3','Every 3 days'],['7','Every week'],['14','Every 2 weeks'],['30','Every month']], String(repeat))}</select>`)}${field('Client',`<select class="sel" id="rm-client">${clientOpts(d.client||'', 'None')}</select>`)}${field('Note',`<textarea class="ta" id="rm-note" placeholder="Optional"></textarea>`,'span2')}</div><p class="muted xs mt-12">Repeating reminders keep coming back until you close them — or until the quote is decided, the invoice is paid or the task is done. If a reminder is ignored for ${DB.settings.workflow.escalateDays??1} day(s), the person’s team leader is told.</p>`,
    foot:`<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="saveReminder" data-kind="${esc(d.kind||'custom')}" data-ref="${esc(d.ref||'')}">${ic('alarm-clock',14)}Set reminder</button>`});
};
A.saveReminder = d => {
  if(!requireFields([['rm-title','What to be reminded about'],['rm-due','Date']])) return;
  const r = addReminder({title:val('rm-title'), owner:val('rm-owner'), due:val('rm-due'), repeat:+val('rm-rep')||0, clientId:val('rm-client')||null, note:val('rm-note'), kind:d.kind||'custom', ref:d.ref||null});
  if(r.owner!==DB.me) notify('reminder', `${uname(DB.me)} set you a reminder for ${fmtD(r.due)}: ${r.title}`, 'reminders', r.owner);
  window.log(`Reminder set for ${esc(uname(r.owner))} on ${fmtD(r.due)}: ${esc(r.title)}`, r.clientId, 'reminders', 'task');
  closeTop(); commit('Reminder set'); tick();
};
A.remDone = d => {
  const r = DB.reminders.find(x=>x.id===d.id); if(!r) return;
  if(r.repeat>0 && !resolvedWhy(r) && !d.close){
    r.history.push({at:nowStamp(), by:DB.me, note:'Followed up'}); r.due = addDays(TODAY, r.repeat); r.nudged = null; r.escalated = null;
    window.log(`Followed up: ${esc(r.title)} — next reminder ${fmtD(r.due)}`, r.clientId, remLink(r), 'task');
    return commit(`Logged. Next reminder ${dueTxt(r.due).toLowerCase()}`);
  }
  r.status = 'Done'; r.doneAt = nowStamp(); r.doneBy = DB.me;
  window.log(`Reminder done: ${esc(r.title)}`, r.clientId, remLink(r), 'task');
  closePop(); commit('Reminder closed');
};
A.remSnoozeMenu = (d, el) => popover(el, `<div class="menu"><div class="mh">Snooze until</div>${[[1,'Tomorrow'],[3,'In 3 days'],[7,'Next week']].map(([n,l])=>`<button data-a="remSnooze" data-id="${d.id}" data-n="${n}">${ic('clock',14)}${l}</button>`).join('')}<div class="sep"></div><button data-a="remDone" data-id="${d.id}" data-close="1">${ic('x-circle',14)}Close for good</button></div>`, {w:200});
A.remSnooze = d => { const r = DB.reminders.find(x=>x.id===d.id); if(!r) return; r.due = addDays(TODAY, +d.n); r.nudged = null; r.escalated = null; r.history.push({at:nowStamp(), by:DB.me, note:'Snoozed to '+r.due}); closePop(); commit('Snoozed to '+fmtD(r.due)); };
A.delReminder = d => { DB.reminders = DB.reminders.filter(x=>x.id!==d.id); commit('Reminder deleted'); };

function remRow(r, showOwner){
  const od = r.status==='Open' && r.due<TODAY, today = r.status==='Open' && r.due===TODAY;
  const c = r.clientId && get.client(r.clientId);
  return `<div class="li" style="align-items:flex-start"><span class="src" style="background:var(--${od?'red':today?'amber':'surface-3'}${od||today?'-soft':''});color:var(--${od?'red':today?'amber':'fg-2'})">${ic(REM_IC[r.kind]||'alarm-clock',13)}</span>
    <div class="grow" data-go="${remLink(r)}" style="cursor:pointer;min-width:0"><div class="t" style="white-space:normal">${esc(r.title)}</div><div class="s"><span class="${od?'down':today?'warn':''}">${r.status==='Done'?'Done '+rel(r.doneAt):dueTxt(r.due)}</span>${r.repeat?` · every ${r.repeat}d`:''}${r.auto?' · automatic':''}${c?' · '+esc(c.name):''}${showOwner?' · '+esc(uname(r.owner)):''}${r.autoClosed?' · closed: '+esc(r.autoClosed):''}</div>${r.note?`<div class="s" style="white-space:normal">${esc(r.note)}</div>`:''}</div>
    ${showOwner?av(r.owner,'sm'):''}
    ${r.status==='Open'?`<button class="btn xs acc" data-a="remDone" data-id="${r.id}" data-tip="${r.repeat?'I followed up — remind me again in '+r.repeat+' days':'Mark done'}">${ic('check',12)}${r.repeat?'Followed up':'Done'}</button><button class="ib sm" data-a="remSnoozeMenu" data-id="${r.id}" aria-label="Snooze">${ic('clock',14)}</button>`:''}
    ${r.owner===DB.me||isLeader()?`<button class="ib sm" data-a="delReminder" data-id="${r.id}" aria-label="Delete reminder">${ic('trash-2',14)}</button>`:''}</div>`;
}
window.remRow = remRow;

Views.reminders = () => {
  const lead = isLeader(); const tab = uv('remTab', 'mine');
  const scope = tab==='team' && lead ? teamOf(DB.me) : tab==='all' && isBoss() ? null : [DB.me];
  const list = DB.reminders.filter(r=>!scope || scope.includes(r.owner));
  const open = list.filter(r=>r.status==='Open').sort((a,b)=>a.due.localeCompare(b.due));
  const groups = [['Overdue', open.filter(r=>r.due<TODAY)], ['Today', open.filter(r=>r.due===TODAY)], ['Coming up', open.filter(r=>r.due>TODAY)], ['Done recently', list.filter(r=>r.status==='Done').sort((a,b)=>(b.doneAt||'').localeCompare(a.doneAt||'')).slice(0,15)]];
  const show = tab!=='mine';
  const tabs = [['mine','My reminders', DB.reminders.filter(r=>r.owner===DB.me && r.status==='Open').length]].concat(lead?[['team','My team', DB.reminders.filter(r=>teamOf(DB.me).includes(r.owner) && r.status==='Open').length]]:[]).concat(isBoss()?[['all','Everyone', DB.reminders.filter(r=>r.status==='Open').length]]:[]);
  const html = `<div class="page">${pageHead('Reminders', 'Nothing slips: quote follow-ups and payment chasing are created automatically, and team leaders are told when something is ignored.', `<button class="btn pri" data-a="newReminder">${ic('plus',14)}New reminder</button>`)}
    ${tabsc('remTab', tabs, tab)}
    <div class="col gap-16 mt-16">${groups.map(([g, rs])=>card(`${g} <span class="muted" style="font-weight:400">· ${rs.length}</span>`, rs.length?`<div class="list">${rs.map(r=>remRow(r, show)).join('')}</div>`:empty('check-circle-2', g==='Overdue'?'Nothing overdue':'Nothing here',''), {flush:true})).join('')}</div></div>`;
  return {html, crumbs:[['Reminders']], title:'Reminders'};
};

/* ===================== Engine: nudges, escalation, daily email ===================== */
let emailBusy = false;
function tick(){
  if(!DB || !DB.setupDone || !me()) return;
  if(!DB.settings.ops || !DB.settings.ops.digest || !DB.reminders) migrate();
  const now = new Date(); const td = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  if(td!==window.TODAY) window.TODAY = td; // keeps dates right if the CRM stays open overnight
  if(window.engineAllowed && !window.engineAllowed()) return; // online: only one open browser runs reminders and emails
  const S = DB.settings, W = S.workflow, ops = S.ops; const late = Math.max(0, +W.escalateDays||1); let changed = autoReminders() > 0;
  DB.reminders.forEach(r=>{ if(r.status==='Open'){ const why = resolvedWhy(r); if(why){ r.status='Done'; r.doneAt=nowStamp(); r.autoClosed=why; changed=true; } } });
  DB.reminders.filter(r=>r.status==='Open' && r.due<=TODAY).forEach(r=>{
    if(r.nudged!==TODAY){ notify('reminder', `${r.due<TODAY?'Overdue':'Due today'}: ${r.title}`, remLink(r), r.owner); r.nudged=TODAY; changed=true; }
    const n = days(r.due, TODAY);
    if(n>=late && r.escalated!==TODAY){ leadersOf(r.owner).forEach(l=>notify('overdue', `${uname(r.owner)} hasn’t actioned a reminder (${n}d late): ${r.title}`, 'reminders', l)); r.escalated=TODAY; changed=true; }
  });
  DB.tasks.filter(t=>t.assignee && t.status!=='Done' && t.due && t.due<=TODAY).forEach(t=>{
    if(t.nudged!==TODAY){ notify('task', `${t.due<TODAY?'Overdue':'Due today'}: ${t.title}`, 'tasks-'+t.id, t.assignee); t.nudged=TODAY; changed=true; }
    const n = days(t.due, TODAY);
    if(n>=late && t.escalated!==TODAY){ leadersOf(t.assignee).forEach(l=>notify('overdue', `${uname(t.assignee)}’s task is ${n}d overdue: ${t.title}`, 'tasks-'+t.id, l)); t.escalated=TODAY; changed=true; }
  });
  const hrs = Math.max(0, +W.poolEscalateHours||4);
  DB.tasks.filter(t=>!t.assignee && t.status!=='Done' && t.created).forEach(t=>{
    const age = (Date.now() - new Date(t.created).getTime())/36e5;
    if(age>=hrs && t.poolEscalated!==TODAY){ DB.users.filter(u=>isLeader(u.id)).forEach(u=>notify('pool', `Still unclaimed after ${Math.floor(age)}h: ${t.title}`, 'tasks-'+t.id, u.id)); t.poolEscalated=TODAY; changed=true; }
  });
  DB.users.filter(u=>isLeader(u.id)).forEach(L=>{
    if(ops.digest[L.id]===TODAY) return; const mem = teamOf(L.id); if(!mem.length) return;
    const due = DB.reminders.filter(r=>r.status==='Open' && r.due<=TODAY && mem.includes(r.owner)).length;
    const od = DB.tasks.filter(t=>t.status!=='Done' && t.due && t.due<TODAY && mem.includes(t.assignee)).length;
    if(due || od){ notify('reminder', `Your team today: ${due} reminder${due===1?'':'s'} due, ${od} overdue task${od===1?'':'s'}`, 'reminders', L.id); ops.digest[L.id]=TODAY; changed=true; }
  });
  if(changed){ save(); renderShellCounts(); if(!STACK.length && ['home','reminders','notifications','tasks'].includes(ROUTE.page)) rerender(); }
  emailDigests();
}
window.opsTick = tick;

function digestFor(u){
  const lines = [];
  const rem = DB.reminders.filter(r=>r.status==='Open' && r.owner===u.id && r.due<=TODAY).sort((a,b)=>a.due.localeCompare(b.due));
  const tasks = DB.tasks.filter(t=>t.assignee===u.id && t.status!=='Done' && t.due && t.due<=TODAY).sort((a,b)=>a.due.localeCompare(b.due));
  const pool = DB.tasks.filter(t=>!t.assignee && t.status!=='Done' && canClaim(t, u.id));
  if(rem.length) lines.push('REMINDERS', ...rem.map(r=>`- ${r.title} (${r.due<TODAY?days(r.due,TODAY)+' days overdue':'today'})`), '');
  if(tasks.length) lines.push('TASKS DUE', ...tasks.map(t=>`- ${t.title} (${t.due<TODAY?days(t.due,TODAY)+' days overdue':'due today'})`), '');
  if(pool.length) lines.push('UP FOR GRABS (first to claim it owns it)', ...pool.slice(0,15).map(t=>`- ${t.title}`), '');
  if(isLeader(u.id)){
    const rows = teamOf(u.id).map(id=>{ const od = DB.tasks.filter(t=>t.assignee===id && t.status!=='Done' && t.due && t.due<TODAY).length; const rd = DB.reminders.filter(r=>r.owner===id && r.status==='Open' && r.due<=TODAY).length; return od||rd ? `- ${uname(id)}: ${rd} reminder${rd===1?'':'s'} due, ${od} overdue task${od===1?'':'s'}` : ''; }).filter(Boolean);
    if(rows.length) lines.push('YOUR TEAM', ...rows, '');
  }
  if(!lines.length) return '';
  return `Good morning ${first(u.name)},\n\nHere is what needs you today (${fmtD(TODAY)}):\n\n${lines.join('\n')}\nOpen the CRM to action these. Reminders keep coming back until they are done.`;
}
async function emailDigests(){
  const W = DB.settings.workflow, ops = DB.settings.ops;
  if(emailBusy || !live() || W.emailReminders===false) return;
  const todo = DB.users.filter(u=>isEmail(u.email) && ops.emailed[u.id]!==TODAY); if(!todo.length) return;
  emailBusy = true;
  try {
    for(const u of todo){
      const text = digestFor(u);
      if(text) await ws().post({action:'send', to:u.email.trim(), subject:`Your reminders for ${fmtD(TODAY)}`, text, fromName:`${company()} Operations`, signature:{name:company(), title:'Operations OS'}});
      ops.emailed[u.id] = TODAY; save();
    }
    ops.emailErr = '';
  } catch(err){ ops.emailErr = err.message; console.warn('Reminder email not sent:', err.message); }
  finally { emailBusy = false; }
}

/* ===================== Pipeline automation ===================== */
/* Every logged action is stamped on the client as its "last action", with who did it */
const baseLog = window.log;
window.log = function(text, clientId, link, kind, user){
  baseLog.apply(this, arguments);
  const c = clientId && get.client(clientId);
  if(c) c.lastEvent = {text, by:user||DB.me, at:nowStamp(), kind:kind||'note'};
  try { pipelineHooks(text, clientId, link, kind); } catch(e){ console.error(e); }
};
function pipelineHooks(text, clientId, link, kind){
  const c = clientId && get.client(clientId);
  if(kind==='accepted' && link && link.startsWith('quote-')){
    const q = get.quote(link.slice(6)); if(!q) return;
    const fin = DB.users.some(u=>u.sysRole==='Finance');
    const t = {id:nextId('T-',DB.tasks), title:`Send deposit invoice for ${q.id} (${c?c.name:''})`, projectId:q.projectId||'', workstream:'Finance', assignee:fin?null:(get.user(q.sentBy)?q.sentBy:q.owner||DB.me), pool:fin?'Finance':null, created:nowStamp(), reviewer:null, priority:'High', status:'To do', start:TODAY, due:addDays(TODAY,1), est:0.5, description:`${q.id} was accepted. Create and send the deposit invoice from the quote page.`, deps:[], attachments:[], comments:[], clientId:q.clientId};
    DB.tasks.push(t); if(!t.assignee) window.notifyPool(t); else if(t.assignee!==DB.me) notify('task', `New: ${t.title}`, 'tasks-'+t.id, t.assignee);
    tellLeaders(DB.me, `${uname(DB.me)} closed ${q.id} with ${c?c.name:'a client'} (${fmtR(calc.quote(q).total,true)})`, 'quote-'+q.id);
  }
  if(kind==='payment' && link && link.startsWith('invoices-') && c){
    const i = get.invoice(link.slice(9)); if(i && calc.inv(i).status==='Paid' && ['Accepted','Payment pending','Quote sent','Awaiting decision'].includes(c.status)) c.status = 'Active client';
  }
}
const baseDrop = A.dropCard;
A.dropCard = (kind, id, status) => { baseDrop(kind, id, status); if(kind==='client'){ const c = get.client(id); if(c){ c.lastEvent = {text:`Moved to ${esc(status)}`, by:DB.me, at:nowStamp(), kind:'status'}; save(); } } };
/* Contacting a client by any route closes their "contact" tasks automatically */
function autoCloseContactTasks(c, why){
  DB.enquiries.filter(e=>e.clientId===c.id && ['Unprocessed','New'].includes(e.status)).forEach(e=>{ e.status='Contacted'; });
  DB.tasks.filter(t=>t.status!=='Done' && t.clientId===c.id && (t.enquiryId || /^contact\b|quot/i.test(t.title)) && (!t.assignee || t.assignee===DB.me)).forEach(t=>{ if(!t.assignee){ t.assignee=DB.me; t.pool=null; t.claimedAt=nowStamp(); } t.status='Done'; t.doneAt=nowStamp(); t.comments.push({by:DB.me, at:nowStamp(), text:'Completed automatically: '+why}); });
  if(['New enquiry','Contact pending'].includes(c.status)) c.status = 'Contacted';
  c.lastContact = TODAY;
}

/* ===================== Sending quotes & invoices ===================== */
let SEND = null;
async function emailClient(c, to, subject, text, projectId, extra){
  const u = me();
  const full = extra && extra.details ? text.replace(/\n*Kind regards\s*$/, '') + '\n\n' + extra.details + '\n\nKind regards' : text;
  const cv = {id:nextId('CV-', DB.conversations), clientId:c.id, channel:'email', subject, participants:[c.contact, u.name], assigned:DB.me, projectId:projectId||null, followUp:'Awaiting client', messages:[], to};
  await ws().post({action:'send', to, subject, text: full, cover: extra && extra.html ? text : undefined, html: extra && extra.html ? extra.html : undefined, fromName:`${u.name} | ${company()}`, signature:{name:u.name, title:u.title||u.role||''}, token:'c-'+String(cv.id).toLowerCase(), quote:null});
  cv.messages.push({from:u.name, at:nowStamp(), body:full, attachments:[], sent:true, to});
  DB.conversations.unshift(cv); return cv;
}
function recordOnly(c, to, subject, text, projectId, how){
  DB.conversations.unshift({id:nextId('CV-', DB.conversations), clientId:c.id, channel:'email', subject, participants:[c.contact, me().name], assigned:DB.me, projectId:projectId||null, followUp:'Awaiting client', messages:[{from:me().name, at:nowStamp(), body:text+(how?`\n\n[${how}]`:''), attachments:[], to}]});
}
function sendModal(o){
  SEND = o; const ok = live();
  modal({title:o.title, size:'lg', body:`${ok?`<div class="callout cyan" style="margin-bottom:12px">${ic('send',15)}<span>Sends from your work email through n8n. Replies come back into <b>Communications</b>.</span></div>`:`<div class="callout amber" style="margin-bottom:12px">${ic('info',15)}<span>Direct sending isn’t connected yet (Intake Inbox → plug icon). Use <b>Open in my email app</b>: a ready-to-send email opens and this is recorded as sent with your name.</span></div>`}
    <div class="form-grid">${field('To *',`<input class="inp" id="sm-to" type="email" value="${esc(o.to||'')}">`)}${field('Subject *',`<input class="inp" id="sm-subj" value="${esc(o.subject)}">`)}${field('Message',`<textarea class="ta" id="sm-body" style="min-height:${o.details?180:320}px;font-family:inherit">${esc(o.text)}</textarea>`,'span2')}</div>${o.details?`<div class="callout mt-12">${ic('file-check-2',15)}<span>Your message is the cover note. The full branded ${esc(o.docName||'document')} is added below it automatically, with your BEMO-SOLUTIONS signature.</span></div>`:''}`,
    foot:`${o.print?`<button class="btn" data-a="sendPrint" style="margin-right:auto">${ic('printer',14)}Print / PDF</button>`:''}<button class="btn ghost" data-a="closeTop">Cancel</button>${o.allowRecord?`<button class="btn" data-a="sendRecord" data-tip="Already sent it another way">Record as sent</button>`:''}<button class="btn" data-a="sendMailto">${ic('mail',14)}Open in my email app</button><button class="btn pri" data-a="sendNow" ${ok?'':'disabled'}>${ic('send',14)}Send email</button>`});
}
const readSend = () => ({to:val('sm-to'), subject:val('sm-subj'), text:val('sm-body')});
A.sendNow = async (d, el) => {
  const m = readSend(); if(!isEmail(m.to)) return toast('Enter a valid email address','err'); if(!m.text) return toast('The message is empty','err');
  const c = get.client(SEND.clientId); el.disabled = true; el.textContent = 'Sending…';
  try { await emailClient(c, m.to, m.subject, m.text, SEND.projectId, SEND.details ? {details: SEND.details, html: SEND.html ? SEND.html() : null} : null); closeTop(); SEND.done('emailed', m.to); }
  catch(err){ el.disabled = false; el.innerHTML = ic('send',14)+'Send email'; toast('Not sent: '+err.message, 'err'); }
};
A.sendMailto = () => {
  const m = readSend(); if(!isEmail(m.to)) return toast('Enter a valid email address','err');
  const full = (SEND.details ? m.text.replace(/\n*Kind regards\s*$/, '') + '\n\n' + SEND.details + '\n\nKind regards' : m.text) + (window.brand ? '\n' + window.brand.textSignature() : '');
  const a = document.createElement('a'); a.href = `mailto:${encodeURIComponent(m.to)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(full)}`; document.body.append(a); a.click(); a.remove();
  recordOnly(get.client(SEND.clientId), m.to, m.subject, full, SEND.projectId, 'Opened in email app by '+me().name);
  closeTop(); SEND.done('sent from email app', m.to);
};
A.sendRecord = () => { const m = readSend(); closeTop(); SEND.done('sent outside the CRM', m.to); };
A.sendPrint = () => SEND && SEND.print && SEND.print();

function printHtml(inner, title){
  const css = Array.from(document.querySelectorAll('style')).map(s=>s.outerHTML).join('') + Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l=>l.outerHTML).join('');
  const f = document.createElement('iframe'); f.setAttribute('aria-hidden','true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.append(f);
  const doc = f.contentDocument; doc.open();
  doc.write(`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><title>${esc(title)}</title>${css}<style>@page{margin:12mm}html,body{background:#fff!important;height:auto!important;overflow:visible!important;display:block!important}body{margin:0;padding:0}.doc{box-shadow:none!important;margin:0 auto!important;max-width:820px}</style></head><body>${inner}</body></html>`);
  doc.close();
  setTimeout(()=>{ try { f.contentWindow.focus(); f.contentWindow.print(); } catch(e){ toast('The browser blocked printing','err'); } setTimeout(()=>f.remove(), 60000); }, 450);
}
A.printQuote = d => { const q = get.quote(d.id); if(q) printHtml(window.quoteDoc(q), q.id); };
A.printInvoice = d => { const i = get.invoice(d.id); if(i) printHtml(window.invDoc(i), i.id); };
A.pdfQuote = A.printQuote;

function quoteText(q){
  const c = get.client(q.clientId), t = calc.quote(q), W = DB.settings.workflow, C = DB.settings.company;
  const valid = addDays(TODAY, q.validDays||30);
  return [`Dear ${first(c.contact)},`, '', `Thank you for the opportunity. Here is our quotation for ${q.title}.`, '',
    `QUOTATION ${q.id} (version ${q.version})`, q.description||'', '',
    ...(q.scope&&q.scope.length?['Scope:', ...q.scope.map(s=>'- '+s), '']:[]),
    'Items:', ...q.items.map(i=>`- ${i.desc}: ${i.qty} x ${fmtR(i.price,true)} = ${fmtR(i.qty*i.price,true)}`), '',
    `Subtotal: ${fmtR(t.sub,true)}`, `VAT (${Math.round(q.vat*100)}%): ${fmtR(t.vat,true)}`, `Total: ${fmtR(t.total,true)}`, '',
    `Valid until: ${fmtD(valid)}`, W.depositRequired?`Terms: ${W.depositPct}% deposit on acceptance; balance on agreed milestones.`:'', C.bank?`Banking details: ${C.bank} (reference ${q.id})`:'', '',
    'To go ahead, simply reply to this email to confirm. Happy to walk you through anything on a quick call.', '', 'Kind regards'].filter((l,i,a)=>!(l==='' && a[i-1]==='')).join('\n');
}
function invoiceText(i, reminder){
  const c = get.client(i.clientId), t = calc.inv(i), C = DB.settings.company;
  const terms = Math.max(1, days(i.issued, i.due) || 14); const draft = i.flag==='draft';
  const issued = draft ? TODAY : i.issued, due = draft ? addDays(TODAY, terms) : i.due;
  const head = reminder
    ? `This is a friendly reminder that invoice ${i.id} for ${fmtR(t.outstanding,true)} ${t.overdue?`was due on ${fmtD(due)} and is now ${t.daysOver} day${t.daysOver===1?'':'s'} overdue`:`is due on ${fmtD(due)}`}. If you have already paid, thank you — please ignore this message.`
    : `Please find below tax invoice ${i.id} from ${C.name}.`;
  return [`Dear ${first(c.contact)},`, '', head, '', `Invoice number: ${i.id}`, `Invoice date: ${fmtD(issued)}`, `Due date: ${fmtD(due)}`, `For: ${i.desc}`, i.quoteId?`Quote reference: ${i.quoteId}`:'', '',
    `Amount (excl. VAT): ${fmtR(t.sub,true)}`, `VAT (${Math.round(i.vat*100)}%): ${fmtR(t.vat,true)}`, `Total: ${fmtR(t.total,true)}`, t.received?`Paid to date: ${fmtR(t.received,true)}`:'', t.received?`Balance due: ${fmtR(t.outstanding,true)}`:'', '',
    C.bank?`Banking details: ${C.bank}`:'', `Payment reference: ${i.id}`, C.vatNo?`${C.name} · VAT no. ${C.vatNo}`:'', '',
    'Any questions about this invoice? Just reply to this email.', '', 'Kind regards'].filter(l=>l!==null).filter((l,k,a)=>!(l==='' && a[k-1]==='')).join('\n');
}

A.sendQuote = d => {
  const q = get.quote(d.id), c = get.client(q.clientId);
  sendModal({title:`Send quote ${q.id}`, clientId:c.id, projectId:q.projectId, to:c.email, subject:`Quotation ${q.id}: ${q.title} — ${company()}`, text:window.brand?brand.quoteCover(q):quoteText(q), details:window.brand?brand.between(quoteText(q), /^QUOTATION /, /^To go ahead/):null, html:()=>brand.emailQuote(q), docName:'quotation', allowRecord:true, print:()=>A.printQuote({id:q.id}),
    done:(how, to)=>{
      q.status = 'Sent'; q.sent = TODAY; q.sentBy = DB.me; q.sentVia = how; q.owner = get.user(q.owner) ? q.owner : DB.me; q.remSet = false;
      (q.history = q.history||[]).push({v:q.version, date:TODAY, note:`Sent to ${to||c.contact} by ${uname(DB.me)} (${how})`});
      if(STATUS.client.indexOf(c.status) < STATUS.client.indexOf('Quote sent')) c.status = 'Quote sent';
      autoCloseContactTasks(c, `quote ${q.id} sent`);
      DB.reminders.filter(r=>r.kind==='quote' && r.ref===q.id && r.status==='Open').forEach(r=>{ r.status='Done'; r.doneAt=nowStamp(); r.autoClosed='quote re-sent'; });
      window.log(`Quote <b>${q.id}</b> (${fmtR(calc.quote(q).total,true)}) sent to ${esc(c.name)} — ${esc(how)}`, c.id, 'quote-'+q.id, 'quote');
      tellLeaders(DB.me, `${uname(DB.me)} sent quote ${q.id} to ${c.name} (${fmtR(calc.quote(q).total,true)})`, 'quote-'+q.id);
      commit(`Quote sent — follow-up reminder set for ${fmtD(addDays(TODAY, +DB.settings.workflow.quoteFollowDays||3))}`); tick();
    }});
};
A.sendInvoice = d => {
  const i = get.invoice(d.id), c = get.client(i.clientId);
  sendModal({title:`Send invoice ${i.id}`, clientId:c.id, projectId:i.projectId, to:c.email, subject:`Tax invoice ${i.id} from ${company()}`, text:window.brand?brand.invoiceCover(i,false):invoiceText(i,false), details:window.brand?brand.between(invoiceText(i,false), /^Invoice number:/, /^Any questions/):null, html:()=>brand.emailInvoice(i,false), docName:'invoice', print:()=>A.printInvoice({id:i.id}),
    done:(how, to)=>{
      if(i.flag==='draft'){ const terms = Math.max(1, days(i.issued, i.due)||14); i.flag = null; i.issued = TODAY; i.due = addDays(TODAY, terms); }
      i.sentAt = TODAY; i.sentBy = DB.me; i.sentTo = to; i.sentVia = how;
      if(['Accepted'].includes(c.status)) c.status = 'Payment pending';
      window.log(`Invoice <b>${i.id}</b> (${fmtR(calc.inv(i).total,true)}) sent to ${esc(c.name)} — ${esc(how)}`, c.id, 'invoices-'+i.id, 'invoice');
      DB.tasks.filter(t=>t.status!=='Done' && t.clientId===c.id && /invoice/i.test(t.title)).forEach(t=>{ if(!t.assignee){ t.assignee=DB.me; t.pool=null; } t.status='Done'; t.doneAt=nowStamp(); t.comments.push({by:DB.me, at:nowStamp(), text:`Completed automatically: ${i.id} sent`}); });
      commit('Invoice sent — payment reminders are set'); tick();
    }});
};
A.remindInvoice = d => {
  const i = get.invoice(d.id), c = get.client(i.clientId);
  sendModal({title:`Payment reminder · ${i.id}`, clientId:c.id, projectId:i.projectId, to:i.sentTo||c.email, subject:`Payment reminder: invoice ${i.id}`, text:window.brand?brand.invoiceCover(i,true):invoiceText(i,true), details:window.brand?brand.between(invoiceText(i,true), /^Invoice number:/, /^Any questions/):null, html:()=>brand.emailInvoice(i,true), docName:'invoice', print:()=>A.printInvoice({id:i.id}),
    done:how=>{
      window.log(`Payment reminder for <b>${i.id}</b> sent to ${esc(c.name)} — ${esc(how)}`, c.id, 'invoices-'+i.id, 'email');
      DB.reminders.filter(r=>r.kind==='invoice' && r.ref===i.id && r.status==='Open').forEach(r=>{ r.history.push({at:nowStamp(), by:DB.me, note:'Reminder emailed'}); r.due = addDays(TODAY, r.repeat||7); r.nudged=null; r.escalated=null; });
      commit('Payment reminder sent');
    }});
};
const baseIssue = A.issueInvoice;
A.issueInvoice = d => { const i = get.invoice(d.id); if(i && !i.createdBy) i.createdBy = DB.me; baseIssue(d); tick(); };
const baseSaveInvoice = A.saveInvoice;
A.saveInvoice = () => { const n = DB.invoices.length; baseSaveInvoice(); if(DB.invoices.length>n){ DB.invoices[DB.invoices.length-1].createdBy = DB.me; save(); tick(); } };

/* ===================== Deleting records ===================== */
const guardDel = () => { if(!can('delete_data')){ toast('Your role can’t delete records. Ask the owner.', 'err'); return false; } return true; };
const dropFiles = list => list.forEach(x=>(x.versions||[]).forEach(v=>v.blobKey && window.FILES && FILES.del(v.blobKey)));
function removeTasks(pred){ const gone = new Set(DB.tasks.filter(pred).map(t=>t.id)); DB.tasks = DB.tasks.filter(t=>!gone.has(t.id)); DB.tasks.forEach(t=>{ t.deps = (t.deps||[]).filter(x=>!gone.has(x)); }); DB.reminders = DB.reminders.filter(r=>!(r.kind==='task' && gone.has(r.ref))); return gone.size; }
function removeProjects(ids){
  ids = new Set(ids); removeTasks(t=>ids.has(t.projectId));
  DB.projects = DB.projects.filter(p=>!ids.has(p.id));
  DB.quotes.forEach(q=>{ if(ids.has(q.projectId)) q.projectId=null; }); DB.invoices.forEach(i=>{ if(ids.has(i.projectId)) i.projectId=null; });
  (DB.documents||[]).forEach(x=>{ if(ids.has(x.projectId)) x.projectId=null; }); DB.conversations.forEach(x=>{ if(ids.has(x.projectId)) x.projectId=null; });
  (DB.expenses||[]).forEach(x=>{ if(ids.has(x.projectId)) x.projectId=null; });
}
function removeClient(id){
  removeProjects(DB.projects.filter(p=>p.clientId===id).map(p=>p.id));
  removeTasks(t=>t.clientId===id);
  dropFiles((DB.documents||[]).filter(x=>x.clientId===id));
  ['quotes','invoices','enquiries','conversations','notes','discoveries','assessments','retainers','reminders','documents'].forEach(k=>{ DB[k] = (DB[k]||[]).filter(x=>x.clientId!==id); });
  DB.activity = DB.activity.filter(a=>a.clientId!==id);
  DB.clients = DB.clients.filter(c=>c.id!==id);
}
const countFor = id => ({projects:DB.projects.filter(p=>p.clientId===id).length, quotes:DB.quotes.filter(q=>q.clientId===id).length, invoices:DB.invoices.filter(i=>i.clientId===id).length, tasks:DB.tasks.filter(t=>t.clientId===id || DB.projects.some(p=>p.clientId===id && p.id===t.projectId)).length});
A.delClient = d => { if(!guardDel()) return; const c = get.client(d.id); const n = countFor(c.id);
  confirmBox({title:`Delete ${esc(c.name)}?`, text:`This permanently deletes the client and everything linked to them: ${n.projects} project(s), ${n.quotes} quote(s), ${n.invoices} invoice(s) with their payments, ${n.tasks} task(s), plus enquiries, conversations, notes, documents and reminders.<br><br><b>This cannot be undone.</b> Export a backup first if you might need it.`, ok:'Delete permanently', danger:true,
    onOk:()=>{ removeClient(c.id); audit('Deleted client', c.name); save(); go('crm'); renderShellCounts(); toast(`${c.name} deleted`); }}); };
A.delTask = d => { if(!guardDel()) return; const t = get.task(d.id); confirmBox({title:'Delete this task?', text:`“${esc(t.title)}” and its comments are permanently deleted.`, ok:'Delete', danger:true, onOk:()=>{ removeTasks(x=>x.id===t.id); audit('Deleted task', t.title); closeAll(); if(ROUTE.page==='tasks' && ROUTE.id) go('tasks'); else commit('Task deleted'); }}); };
A.delQuote = d => { if(!guardDel()) return; const q = get.quote(d.id); confirmBox({title:`Delete quote ${q.id}?`, text:'The quote and its follow-up reminders are deleted. Invoices and projects made from it are kept.', ok:'Delete', danger:true, onOk:()=>{ DB.quotes = DB.quotes.filter(x=>x.id!==q.id); DB.invoices.forEach(i=>{ if(i.quoteId===q.id) i.quoteId=null; }); DB.projects.forEach(p=>{ if(p.quoteId===q.id) p.quoteId=null; }); DB.reminders = DB.reminders.filter(r=>!(r.kind==='quote' && r.ref===q.id)); audit('Deleted quote', q.id); save(); go('quotes'); toast(`${q.id} deleted`); }}); };
A.delInvoice = d => { if(!guardDel()) return; const i = get.invoice(d.id); const paid = calc.inv(i).received; confirmBox({title:`Delete invoice ${i.id}?`, text:`${paid?`<b>${fmtR(paid,true)} in payments recorded on it will also be deleted</b> and will disappear from revenue. If the invoice was sent to the client, cancelling it is usually better. `:''}This cannot be undone.`, ok:'Delete', danger:true, onOk:()=>{ DB.invoices = DB.invoices.filter(x=>x.id!==i.id); DB.reminders = DB.reminders.filter(r=>!(r.kind==='invoice' && r.ref===i.id)); audit('Deleted invoice', i.id); closeAll(); if(ROUTE.page==='invoices' && ROUTE.id) go('invoices'); else commit(`${i.id} deleted`); }}); };
A.delPayment = d => { if(!guardDel()) return; const i = get.invoice(d.id); const p = i.payments[+d.i]; confirmBox({title:'Delete this payment?', text:`${fmtR(p.amount,true)} received ${fmtD(p.date)} is removed from ${i.id}.`, ok:'Delete', danger:true, onOk:()=>{ i.payments.splice(+d.i,1); window.log(`Deleted a payment of ${fmtR(p.amount,true)} on ${i.id}`, i.clientId, 'invoices-'+i.id, 'payment'); commit('Payment deleted'); }}); };
A.delProject = d => { if(!guardDel()) return; const p = get.project(d.id); const n = DB.tasks.filter(t=>t.projectId===p.id).length; confirmBox({title:`Delete ${esc(p.name)}?`, text:`The project, its workstreams and ${n} task(s) are permanently deleted. Quotes and invoices are kept and unlinked.`, ok:'Delete', danger:true, onOk:()=>{ removeProjects([p.id]); audit('Deleted project', p.name); save(); go('projects'); toast(`${p.name} deleted`); }}); };
A.delWs = d => { if(!guardDel()) return; const p = get.project(d.p); const w = p.workstreams.find(x=>x.id===d.w); closeTop(); confirmBox({title:`Delete ${esc(w.name)}?`, text:'The workstream is removed from this project. Its tasks stay on the project.', ok:'Delete', danger:true, onOk:()=>{ p.workstreams = p.workstreams.filter(x=>x.id!==w.id); p.workstreams.forEach(x=>{ x.deps = x.deps.filter(n=>n!==w.name); }); commit('Workstream deleted'); }}); };
A.delEnquiry = d => { if(!guardDel()) return; const e = get.enquiry(d.id); confirmBox({title:'Delete this enquiry?', text:`The enquiry from ${esc(e.from)} and its unfinished follow-up task are deleted. The client record (if any) is kept.`, ok:'Delete', danger:true, onOk:()=>{ removeTasks(t=>t.enquiryId===e.id && t.status!=='Done'); DB.enquiries = DB.enquiries.filter(x=>x.id!==e.id); DB.discoveries.forEach(x=>{ if(x.enquiryId===e.id) x.enquiryId=null; }); audit('Deleted enquiry', e.from); save(); go('inbox'); toast('Enquiry deleted'); }}); };
A.delDisc = d => { if(!guardDel()) return; confirmBox({title:'Delete this discovery record?', text:'Answers, notes and extracted requirements are deleted.', ok:'Delete', danger:true, onOk:()=>{ DB.discoveries = DB.discoveries.filter(x=>x.id!==d.id); save(); go('discovery'); toast('Discovery deleted'); }}); };
A.delNote = d => { if(!guardDel()) return; DB.notes = DB.notes.filter(n=>n.id!==d.id); commit('Note deleted'); };

/* Bulk delete (Administration → Backup & data) */
const BULK = [
  ['clients','Clients (and everything linked to them)', ()=>DB.clients.length, ()=>DB.clients.map(c=>c.id).forEach(removeClient)],
  ['enquiries','Enquiries', ()=>DB.enquiries.length, ()=>{ removeTasks(t=>t.enquiryId && t.status!=='Done'); DB.enquiries=[]; }],
  ['quotes','Quotes', ()=>DB.quotes.length, ()=>{ DB.quotes=[]; DB.invoices.forEach(i=>i.quoteId=null); DB.projects.forEach(p=>p.quoteId=null); DB.reminders=DB.reminders.filter(r=>r.kind!=='quote'); }],
  ['invoices','Invoices and payments', ()=>DB.invoices.length, ()=>{ DB.invoices=[]; DB.reminders=DB.reminders.filter(r=>r.kind!=='invoice'); }],
  ['projects','Projects (and their tasks)', ()=>DB.projects.length, ()=>removeProjects(DB.projects.map(p=>p.id))],
  ['tasks','Tasks', ()=>DB.tasks.length, ()=>removeTasks(()=>true)],
  ['reminders','Reminders', ()=>DB.reminders.length, ()=>{ DB.reminders=[]; DB.quotes.forEach(q=>q.remSet=true); DB.invoices.forEach(i=>i.remSet=true); }],
  ['conversations','Communications history', ()=>DB.conversations.length, ()=>{ DB.conversations=[]; }],
  ['notifications','Notifications', ()=>DB.notifications.length, ()=>{ DB.notifications=[]; }],
  ['activity','Activity feed', ()=>DB.activity.length, ()=>{ DB.activity=[]; DB.clients.forEach(c=>delete c.lastEvent); }]
];
window.bulkDeleteCard = () => can('delete_data') ? card('Delete records', `<p class="sub small" style="padding:12px 16px 4px">Remove a whole type of record. Everything else is kept. This cannot be undone — export a backup first.</p>${BULK.map(([k,l,n])=>`<div class="row between" style="padding:10px 16px;border-top:1px solid var(--line)"><span>${l} <span class="muted small">· ${n()}</span></span><button class="btn sm danger" data-a="bulkDel" data-k="${k}" ${n()?'':'disabled'}>${ic('trash-2',13)}Delete all</button></div>`).join('')}`, {flush:true}) : '';
A.bulkDel = d => { if(!guardDel()) return; const b = BULK.find(x=>x[0]===d.k); confirmBox({title:`Delete all ${b[1].toLowerCase()}?`, text:`${b[2]()} record(s) will be permanently deleted. This cannot be undone.`, ok:'Delete all', danger:true, onOk:()=>{ b[3](); audit('Bulk delete', b[1]); commit(`${b[1]} deleted`); }}); };

/* ===================== Portals (home page per role) ===================== */
const kpiRow = items => `<div class="kpis" style="grid-template-columns:repeat(${items.length},minmax(0,1fr))">${items.map(kpiCell).join('')}</div>`;
function taskLi(t){ const od = t.due && t.due<TODAY; return `<div class="li" data-a="openTask" data-id="${t.id}">${badge(t.status,null,'nodot')}<div class="grow" style="min-width:0"><div class="t">${esc(t.title)}</div><div class="s ${od?'down':''}">${dueTxt(t.due)}${t.clientId&&get.client(t.clientId)?' · '+esc(get.client(t.clientId).name):''}</div></div>${prio(t.priority)}</div>`; }
function poolLi(t, assign){
  const mem = assign ? teamOf(DB.me).map(id=>get.user(id)).filter(Boolean) : [];
  const age = t.created ? rel(t.created) : '';
  return `<div class="li"><span class="src" style="background:var(--accent-soft);color:var(--accent-2)">${ic('hand',13)}</span><div class="grow" style="min-width:0" data-a="openTask" data-id="${t.id}"><div class="t">${esc(t.title)}</div><div class="s">${esc(t.pool||'Anyone')} pool${age?' · since '+age:''}${t.clientId&&get.client(t.clientId)?' · '+esc(get.client(t.clientId).name):''}</div></div>${assign&&mem.length?`<select class="sel sm" style="width:auto" data-ch="poolAssign" data-id="${t.id}" aria-label="Assign to">${opts(mem.map(u=>[u.id,u.name]), '', {blank:'Assign to…'})}</select>`:''}${canClaim(t)?`<button class="btn acc xs" data-a="claimTask" data-id="${t.id}">${ic('hand',12)}Claim</button>`:''}</div>`;
}
function teamBoard(ids){
  if(!ids.length) return empty('users','No team yet','Add team members in Administration → Team members and set who they report to.');
  const week = addDays(TODAY,-7);
  return `<div class="tw"><table class="tbl"><thead><tr><th>Person</th><th>Role</th><th class="r">Open tasks</th><th class="r">Overdue</th><th class="r">Reminders due</th><th class="r">Done (7d)</th><th>Last action</th></tr></thead><tbody>${ids.map(id=>{ const u = get.user(id); if(!u) return '';
    const open = DB.tasks.filter(t=>t.assignee===id && t.status!=='Done'); const od = open.filter(t=>t.due && t.due<TODAY).length;
    const rd = DB.reminders.filter(r=>r.owner===id && r.status==='Open' && r.due<=TODAY).length;
    const done = DB.tasks.filter(t=>t.assignee===id && t.status==='Done' && (t.doneAt||'')>=week).length;
    const last = DB.activity.find(a=>a.user===id);
    return `<tr data-go="team-${id}" style="cursor:pointer"><td>${who(id)}</td><td>${badge(u.sysRole||'—','gray','nodot')}</td><td class="r num">${open.length}</td><td class="r num ${od?'down':''}">${od}</td><td class="r num ${rd?'warn':''}">${rd}</td><td class="r num">${done}</td><td class="small muted">${last?`${last.text.replace(/<[^>]+>/g,'').slice(0,60)} · ${rel(last.at)}`:'No activity yet'}</td></tr>`; }).join('')}</tbody></table></div>`;
}
window.teamBoard = teamBoard;
function portal(){
  const u = me(), r = role();
  const myT = DB.tasks.filter(t=>t.assignee===u.id && t.status!=='Done').sort((a,b)=>(a.due||'9').localeCompare(b.due||'9'));
  const od = myT.filter(t=>t.due && t.due<TODAY);
  const myR = DB.reminders.filter(x=>x.status==='Open' && x.owner===u.id).sort((a,b)=>a.due.localeCompare(b.due));
  const dueR = myR.filter(x=>x.due<=TODAY), soonR = myR.filter(x=>x.due>TODAY && x.due<=addDays(TODAY,7));
  const pool = DB.tasks.filter(t=>!t.assignee && t.status!=='Done' && canClaim(t));
  const hr = new Date().getHours(); const greet = hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';
  const myClients = DB.clients.filter(c=>c.owner===u.id || c.assistant===u.id);
  const myQ = DB.quotes.filter(q=>(q.sentBy||q.owner)===u.id);
  const awaitQ = myQ.filter(q=>['Sent','Viewed'].includes(q.status));
  const remCard = card(`${ic('alarm-clock',15)} Reminders`, (dueR.length||soonR.length)?`<div class="list">${dueR.concat(soonR).map(x=>remRow(x,false)).join('')}</div>`:empty('check-circle-2','Nothing due','You’re on top of it.'), {flush:true, hint:`${dueR.length} due now`, act:`<button class="btn ghost xs" data-a="newReminder">${ic('plus',12)}Reminder</button><a class="btn ghost xs" href="#reminders">All</a>`});
  const poolCard = card(`${ic('hand',15)} Up for grabs`, pool.length?`<div class="list">${pool.slice(0,10).map(t=>poolLi(t, isLeader())).join('')}</div>`:empty('inbox','Nothing waiting','New leads and open tasks appear here for your team to claim.'), {flush:true, hint:'First to claim it owns it'});
  const taskCard = card(`${ic('list-checks',15)} My tasks`, myT.length?`<div class="list">${myT.slice(0,10).map(taskLi).join('')}</div>`:empty('check-square','No open tasks',''), {flush:true, act:`<button class="btn ghost xs" data-a="newTask">${ic('plus',12)}Task</button><a class="btn ghost xs" href="#tasks">All</a>`});
  let kp = [{l:'My open tasks', v:myT.length, d:`${od.length} overdue`, tone:od.length?'down':'', icon:'list-checks', go:'tasks'}, {l:'Reminders due', v:dueR.length, d:`${soonR.length} in the next 7 days`, tone:dueR.length?'warn':'', icon:'alarm-clock', go:'reminders'}, {l:'Up for grabs', v:pool.length, d:'Claim to own', icon:'hand', go:'tasks'}];
  let extra = '';
  if(r==='Sales' || r==='Team leader'){
    const pipe = sum(awaitQ, q=>calc.quote(q).sub);
    kp = kp.concat([{l:'My clients', v:myClients.length, d:`${myClients.filter(c=>['Active client','Ongoing partnership'].includes(c.status)).length} active`, icon:'users', go:'crm'}, {l:'My quotes awaiting reply', v:awaitQ.length, d:fmtR(pipe)+' ex VAT', icon:'file-text', go:'quotes'}, {l:'Won this month', v:myQ.filter(q=>q.status==='Accepted' && (q.accepted||'').startsWith(TODAY.slice(0,7))).length, d:fmtR(sum(myQ.filter(q=>q.status==='Accepted' && (q.accepted||'').startsWith(TODAY.slice(0,7))), q=>calc.quote(q).sub)), tone:'up', icon:'badge-check', go:'quotes'}]);
    const stages = STATUS.client.filter(s=>myClients.some(c=>c.status===s));
    extra += `<div class="grid g2 mt-16">${card('My pipeline', myClients.length?`<div class="row wrap" style="gap:6px;padding:12px 16px 4px">${stages.map(s=>`<span class="tag">${esc(s)} <b>${myClients.filter(c=>c.status===s).length}</b></span>`).join('')}</div><div class="list">${myClients.filter(c=>c.status!=='Lost / archived').sort((a,b)=>((b.lastEvent||{}).at||'').localeCompare((a.lastEvent||{}).at||'')).slice(0,10).map(c=>`<div class="li" data-go="client-${c.id}">${coIc(c)}<div class="grow" style="min-width:0"><div class="t">${esc(c.name)}</div><div class="s">${c.lastEvent?c.lastEvent.text.replace(/<[^>]+>/g,'')+' · '+rel(c.lastEvent.at):'No activity yet'}</div></div>${badge(c.status)}</div>`).join('')}</div>`:empty('users','No clients yet','Claim a lead from the pool or add a client.',`<button class="btn sm" data-a="newClient">${ic('plus',13)}Client</button>`), {flush:true, act:`<a class="btn ghost xs" href="#crm">Pipeline</a>`})}
      ${card('My quotes awaiting a reply', awaitQ.length?`<div class="list">${awaitQ.map(q=>`<div class="li" data-go="quote-${q.id}"><span class="src web">${ic('file-text',13)}</span><div class="grow"><div class="t">${q.id} · ${esc(q.title)}</div><div class="s">${esc((get.client(q.clientId)||{}).name||'')} · sent ${q.sent?rel(q.sent):'—'}</div></div><b class="num small">${fmtRk(calc.quote(q).sub)}</b></div>`).join('')}</div>`:empty('file-text','No quotes waiting','',`<button class="btn sm" data-a="newQuote">${ic('plus',13)}Quote</button>`), {flush:true})}</div>`;
  }
  if(r==='Finance'){
    const inv = DB.invoices.map(i=>({i, c:calc.inv(i)})).filter(x=>x.c.outstanding>0).sort((a,b)=>a.i.due.localeCompare(b.i.due));
    const drafts = DB.invoices.filter(i=>i.flag==='draft');
    kp = kp.concat([{l:'Outstanding', v:fmtRk(sum(inv,x=>x.c.outstanding)), d:`${inv.length} invoices`, icon:'hourglass', go:'invoices'}, {l:'Overdue', v:fmtRk(sum(inv.filter(x=>x.c.overdue),x=>x.c.outstanding)), d:`${inv.filter(x=>x.c.overdue).length} invoices`, tone:'down', icon:'alert-triangle', go:'invoices'}, {l:'Drafts to send', v:drafts.length, icon:'send', go:'invoices'}]);
    extra += `<div class="grid g2 mt-16">${card('Invoices to chase', inv.length?`<div class="list">${inv.slice(0,12).map(({i,c})=>`<div class="li"><div class="grow" data-a="openInvoice" data-id="${i.id}" style="cursor:pointer"><div class="t">${i.id} · ${esc((get.client(i.clientId)||{}).name||'')}</div><div class="s ${c.overdue?'down':''}">${fmtR(c.outstanding,true)} · ${c.overdue?c.daysOver+'d overdue':'due '+dueTxt(i.due).toLowerCase()}</div></div><button class="btn xs" data-a="remindInvoice" data-id="${i.id}">${ic('bell-ring',12)}Remind</button></div>`).join('')}</div>`:empty('check-circle-2','Nothing outstanding',''), {flush:true})}
      ${card('Drafts to send', drafts.length?`<div class="list">${drafts.map(i=>`<div class="li"><div class="grow"><div class="t">${i.id} · ${esc((get.client(i.clientId)||{}).name||'')}</div><div class="s">${esc(i.desc)}</div></div><button class="btn pri xs" data-a="sendInvoice" data-id="${i.id}">${ic('send',12)}Send</button></div>`).join('')}</div>`:empty('receipt','No drafts','',`<button class="btn sm" data-a="newInvoice">${ic('plus',13)}Invoice</button>`), {flush:true})}</div>`;
  }
  if(r==='Delivery' || r==='Team leader'){
    const projs = DB.projects.filter(p=>!['Completed','On hold'].includes(p.status) && (p.pm===u.id || p.tech===u.id || p.owner===u.id || (p.team||[]).includes(u.id)));
    if(r==='Delivery') kp.push({l:'My projects', v:projs.length, icon:'folder-kanban', go:'projects'});
    if(projs.length) extra += `<div class="mt-16">${card('My projects', `<div class="col" style="gap:12px">${projs.map(p=>`<div data-go="project-${p.id}" style="cursor:pointer"><div class="row between"><span class="strong trunc" style="font-size:12.5px">${esc(p.name)}</span>${badge(p.status)}</div><div class="row mt-8" style="gap:10px">${prog(calc.progress(p))}<span class="muted xs nowrap">due ${fmtDs(p.target)}</span></div></div>`).join('')}</div>`)}</div>`;
  }
  let lead = '';
  if(isLeader()){
    const mem = teamOf(u.id);
    const teamOverdue = DB.reminders.filter(x=>x.status==='Open' && x.due<TODAY && mem.includes(x.owner)).sort((a,b)=>a.due.localeCompare(b.due));
    lead = `<div class="mt-16">${card(`${ic('users',15)} My team`, teamBoard(mem), {flush:true, hint:'Click a person to see their work'})}</div>${teamOverdue.length?`<div class="mt-16">${card('Team reminders overdue', `<div class="list">${teamOverdue.slice(0,12).map(x=>remRow(x,true)).join('')}</div>`, {flush:true})}</div>`:''}`;
  }
  const html = `<div class="page">${pageHead(`${greet}, ${esc(first(u.name))}`, `${fmtD(TODAY)} · Your ${esc(r.toLowerCase())} portal`, `<button class="btn" data-a="newReminder">${ic('alarm-clock',14)}Reminder</button><button class="btn pri" data-a="createMenu">${ic('plus',14)}Create</button>`)}
    ${kpiRow(kp.slice(0,6))}
    <div class="grid g3 mt-16">${remCard}${poolCard}${taskCard}</div>${lead}${extra}</div>`;
  return {html, crumbs:[['My portal']], title:'My portal'};
}
const baseHome = Views.home;
Views.home = id => {
  if(!isBoss()) return portal();
  const out = baseHome(id);
  const mem = teamOf(DB.me);
  const pool = DB.tasks.filter(t=>!t.assignee && t.status!=='Done');
  if(mem.length || pool.length){
    const pulse = `<div class="grid g-12" style="margin-bottom:16px">${card(`${ic('users',15)} Team pulse`, teamBoard(mem), {flush:true, act:`<a class="btn ghost xs" href="#reminders">Reminders</a>`})}${card(`${ic('hand',15)} Up for grabs`, pool.length?`<div class="list">${pool.slice(0,8).map(t=>poolLi(t,true)).join('')}</div>`:empty('inbox','Nothing waiting',''), {flush:true, hint:`${pool.length} unclaimed`})}</div>`;
    out.html = out.html.replace('<div class="kpis">', pulse+'<div class="kpis">');
  }
  return out;
};
/* Pages outside a role's portal */
const GUARD = {admin:()=>can('admin'), finance:()=>can('view_fin'), integrations:()=>can('admin'), analytics:()=>isBoss() || can('view_fin') || role()==='Team leader'};
Object.keys(GUARD).forEach(k=>{ const f = Views[k]; if(!f) return; Views[k] = (...a) => GUARD[k]() ? f(...a) : {html:`<div class="page">${empty('lock','Not part of your portal',`Your role (${esc(role())}) doesn’t include this page. The owner can change your role or permissions in Administration.`)}</div>`, crumbs:[['Restricted']], title:'Restricted'}; });

/* Team page: show role and who people report to */
const baseTeam = Views.team;
Views.team = id => { const out = baseTeam(id); out.html = out.html.replace(/<div class="member" data-a="openMember" data-id="([^"]+)">/g, (m, uid)=>{ const u = get.user(uid); return m + (u ? `<div class="row wrap" style="gap:6px">${badge(u.sysRole||'—','gray','nodot')}${u.leader&&get.user(u.leader)?`<span class="muted xs">Reports to ${esc(uname(u.leader))}</span>`:''}</div>` : ''); }); return out; };

/* Shell counts */
window.opsCounts = () => ({rem: (DB.reminders||[]).filter(r=>r.status==='Open' && r.owner===DB.me && r.due<=TODAY).length});
const baseSwitch = A.switchUser;
A.switchUser = d => { baseSwitch(d); setTimeout(()=>{ go('home'); tick(); }, 0); };

/* ===================== Upgrade existing data, start the engine ===================== */
function migrate(){
  const S = DB.settings; S.ops = S.ops || {}; S.ops.digest = S.ops.digest || {}; S.ops.emailed = S.ops.emailed || {};
  DB.reminders = DB.reminders || []; S.projectTypes = S.projectTypes || [];
  const P = window.DEFAULT_PERMS || {};
  if(!S.ops.v1){
    DB.templates = (DB.templates||[]).filter(t=>!/^TPL-[1-6]$/.test(t.id));   // remove the built-in project templates
    const map = {Manager:'Team leader', Member:'Delivery'};
    DB.users.forEach(u=>{ if(map[u.sysRole]) u.sysRole = map[u.sysRole]; });
    if(S.perms) Object.keys(map).forEach(k=>{ if(S.perms[k]){ S.perms[map[k]] = S.perms[k]; delete S.perms[k]; } });
    if(S.perms && S.perms['Team leader'] && !S.perms['Team leader'].includes('assign_tasks')) S.perms['Team leader'].push('assign_tasks');
    delete DB.aiChats;
    DB.quotes.forEach(q=>{ if(!['Sent','Viewed'].includes(q.status)) q.remSet = true; });
    S.ops.v1 = true;
  }
  if(S.company && /^Ikusasa/.test(S.company.name||'')) S.company.name = S.company.name.replace(/^Ikusasa/, 'BEMO-SOLUTIONS');   // renamed business
  S.perms = S.perms || JSON.parse(JSON.stringify(P));
  (window.ROLES||[]).forEach(rn=>{ if(!S.perms[rn]) S.perms[rn] = (P[rn]||[]).slice(); });
  ['Owner','Admin'].forEach(rn=>['delete_data','assign_tasks'].forEach(k=>{ if(S.perms[rn] && !S.perms[rn].includes(k)) S.perms[rn].push(k); }));
}
const baseStart = App.start;
App.start = () => {
  baseStart();
  try { migrate(); save(); } catch(e){ console.error('Upgrade failed', e); }
  render(true);
  setTimeout(tick, 1200); setInterval(tick, 60000);
};
})();
