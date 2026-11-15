/* =====================================================================
   SALES PERFORMANCE: how many businesses we contact, meet, quote, win
   and get paid by. Built only from records the CRM already keeps, so it
   works from the first logged call with nothing extra to set up:
     contacts   = logged calls/meetings/emails/WhatsApps (Communications,
                  "Log activity", sent quotes/invoices) + Lead Acquisition
                  conversations
     meetings   = discovery calls + team-calendar meetings/site visits,
                  counted on the day they are BOOKED
     quotes     = quotes sent;  won = quotes accepted;  lost = rejected
     paid       = invoice payments received
   ===================================================================== */
(function(){
const W = window;
const PERIODS = [['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['30', 'Last 30 days'], ['quarter', 'This quarter'], ['year', 'This year']];
const day = s => String(s || '').slice(0, 10);
const inR = (d, r) => d && d >= r.from && d <= r.to;
const monday = d => addDays(d, -((pd(d).getUTCDay() + 6) % 7));

function range(p, base){
  const t = base || TODAY, x = pd(t), y = x.getUTCFullYear(), m = x.getUTCMonth();
  const ymd = (Y, M, D) => iso(new Date(Date.UTC(Y, M, D)));
  switch(p){
    case 'week': return {from: monday(t), to: t, label: 'this week'};
    case 'lastweek': { const f = addDays(monday(t), -7); return {from: f, to: addDays(f, 6), label: 'last week'}; }
    case 'lastmonth': return {from: ymd(y, m - 1, 1), to: ymd(y, m, 0), label: 'last month'};
    case '30': return {from: addDays(t, -29), to: t, label: 'the last 30 days'};
    case 'quarter': return {from: ymd(y, Math.floor(m / 3) * 3, 1), to: t, label: 'this quarter'};
    case 'year': return {from: ymd(y, 0, 1), to: t, label: 'this year'};
    default: return {from: ymd(y, m, 1), to: t, label: 'this month'};
  }
}
function prevRange(p, r){
  if(p === 'month' || p === 'lastmonth'){ const x = pd(r.from); const f = iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() - 1, 1))); const full = iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 0))); return {from: f, to: p === 'month' ? addDays(f, days(r.from, r.to)) : full}; }
  if(p === 'year'){ const y = pd(r.from).getUTCFullYear() - 1; return {from: y + '-01-01', to: addDays(y + '-01-01', days(r.from, r.to))}; }
  if(p === 'quarter'){ const x = pd(r.from); const f = iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() - 3, 1))); return {from: f, to: addDays(f, days(r.from, r.to))}; }
  const n = days(r.from, r.to) + 1; return {from: addDays(r.from, -n), to: addDays(r.from, -1)};
}

/* ---------- one list of everything that happened ---------- */
function events(){
  const out = [], byName = {}; DB.users.forEach(u => { byName[(u.name || '').trim().toLowerCase()] = u.id; });
  const team = n => byName[String(n || '').trim().toLowerCase()];
  const leadKey = {}; (DB.acqLeads || []).forEach(l => { leadKey[l.id] = l.transfer && l.transfer.clientId ? 'c:' + l.transfer.clientId : 'l:' + l.id; });
  const src = k => { if(k.startsWith('c:')){ const c = get.client(k.slice(2)); return c ? (c.source || 'Unknown') : 'Unknown'; } return 'Lead Acquisition'; };
  const push = (type, at, by, key, extra) => { if(!at || !key) return; out.push(Object.assign({type, d: day(at), by: by || null, key}, extra || {})); };
  // contacts from Communications / Log activity / sent quotes & invoices
  (DB.conversations || []).forEach(cv => {
    if(!cv.clientId || cv.channel === 'note') return;
    const msgs = cv.messages || []; const inbound = msgs.some(m => !team(m.from));
    msgs.forEach(m => { const uid = team(m.from); if(!uid) return;
      const live = ['call', 'meeting'].includes(cv.channel);
      push('contact', m.at, uid, 'c:' + cv.clientId, {channel: cv.channel, connected: live || inbound}); });
  });
  // Lead Acquisition conversations (calls, consent requests, emails)
  (DB.acqLeads || []).forEach(l => {
    (l.conversations || []).forEach(x => { if(x.channel === 'Meeting' && /booked/i.test(x.outcome || '')) return;
      push('contact', x.at, x.by, leadKey[l.id], {channel: String(x.channel || '').toLowerCase(), connected: !/No answer|Consent request sent|Outreach email sent/i.test(x.outcome || ''), lead: true}); });
    push('found', l.createdAt, null, leadKey[l.id], {lead: true});
    if(l.transfer && l.transfer.at) push('transfer', l.transfer.at, l.transfer.by, leadKey[l.id], {lead: true});
  });
  // meetings, counted on the day they were booked, for the person who booked them
  (DB.discoveries || []).forEach(d => { if(d.status === 'Cancelled') return; push('meeting', d.booked || d.created || d.date, d.bookedBy || d.assistant, 'c:' + d.clientId, {kind: 'Discovery', heldOn: day(d.date)}); });
  (DB.events || []).forEach(e => { if(!['meeting', 'site'].includes(e.kind)) return; const k = e.clientId ? 'c:' + e.clientId : e.leadId ? leadKey[e.leadId] : null; if(k) push('meeting', e.created || e.date, e.createdBy || (e.people || [])[0], k, {kind: e.kind === 'site' ? 'Site visit' : 'Meeting', heldOn: e.date}); });
  // new opportunities
  (DB.enquiries || []).forEach(e => push('enquiry', e.received, e.assistant, e.clientId ? 'c:' + e.clientId : 'e:' + e.id, {source: ({web: 'Website form', email: 'Email', whatsapp: 'WhatsApp', referral: 'Referral', manual: 'Manual'})[e.channel] || 'Other'}));
  (DB.clients || []).forEach(c => push('client', c.created, c.owner, 'c:' + c.id));
  // commercial
  (DB.quotes || []).forEach(q => { const v = calc.quote(q).total; const by = q.sentBy || q.owner; const k = 'c:' + q.clientId;
    if(q.sent) push('quote', q.sent, by, k, {value: v, id: q.id});
    if(q.accepted) push('won', q.accepted, by, k, {value: v, id: q.id});
    if(q.rejected) push('lost', q.rejected, by, k, {value: v, id: q.id}); });
  (DB.invoices || []).forEach(i => (i.payments || []).forEach(p => push('paid', p.date, i.sentBy || i.createdBy || null, 'c:' + i.clientId, {value: +p.amount || 0, id: i.id})));
  out.forEach(e => { e.source = e.source || src(e.key || ''); });
  return out;
}

function summarise(ev, r, who){
  const E = ev.filter(e => inR(e.d, r) && (!who || e.by === who));
  const of = t => E.filter(e => e.type === t);
  const uniqKeys = list => new Set(list.map(e => e.key)).size;
  const contacts = of('contact'), meetings = of('meeting'), quotes = of('quote'), won = of('won'), lost = of('lost'), paid = of('paid');
  return {
    attempts: contacts.length, contacted: uniqKeys(contacts), conversations: contacts.filter(c => c.connected).length,
    meetings: meetings.length, met: uniqKeys(meetings), quotes: quotes.length, quoted: uniqKeys(quotes), quoteValue: sum(quotes, q => q.value),
    won: won.length, wonClients: uniqKeys(won), wonValue: sum(won, q => q.value), lost: lost.length, winRate: won.length + lost.length ? Math.round(won.length / (won.length + lost.length) * 100) : null,
    collected: sum(paid, p => p.value), newOpps: uniqKeys(of('enquiry').concat(of('found'), of('client'))), found: of('found').length, transfers: of('transfer').length,
    byChannel: ['call', 'email', 'whatsapp', 'meeting'].map(ch => [ch, contacts.filter(c => c.channel === ch).length]), E
  };
}

/* sales cycle & response speed (all time, filtered to period of the end event) */
function speed(ev, r, who){
  const firstTouch = {}; ev.filter(e => e.type === 'contact').sort((a, b) => a.d.localeCompare(b.d)).forEach(e => { if(!firstTouch[e.key]) firstTouch[e.key] = e; });
  const firstSeen = {}; ev.filter(e => ['enquiry', 'client', 'found'].includes(e.type)).sort((a, b) => a.d.localeCompare(b.d)).forEach(e => { if(!firstSeen[e.key]) firstSeen[e.key] = e.d; });
  const cyc = ev.filter(e => e.type === 'won' && inR(e.d, r) && (!who || e.by === who)).map(e => { const s = firstTouch[e.key] ? firstTouch[e.key].d : firstSeen[e.key]; return s ? days(s, e.d) : null; }).filter(x => x !== null && x >= 0);
  const resp = ev.filter(e => e.type === 'enquiry' && inR(e.d, r) && e.key.startsWith('c:')).map(e => { const f = firstTouch[e.key]; return f && f.d >= e.d && (!who || f.by === who) ? days(e.d, f.d) : null; }).filter(x => x !== null);
  const avg = a => a.length ? Math.round(sum(a) / a.length * 10) / 10 : null;
  return {cycle: avg(cyc), cycleN: cyc.length, response: avg(resp), responseN: resp.length};
}

/* ---------- targets ---------- */
const T = () => { const S = DB.settings; S.targets = Object.assign({contacts: 40, meetings: 4, quotes: 3, wonValue: 0}, S.targets || {}); return S.targets; };

/* ---------- page ---------- */
Views.performance = () => {
  const role = (me() || {}).sysRole; const lead = ['Owner', 'Admin', 'Team leader'].includes(role) || (W.can && can('view_fin'));
  const p = uv('pfP', 'month'); let who = lead ? uv('pfWho', 'all') : DB.me; if(who === 'all') who = null;
  if(lead && role === 'Team leader' && who && W.teamOf && !teamOf(DB.me).concat(DB.me).includes(who)) who = null;
  const r = range(p), pr = prevRange(p, r); const ev = events();
  const s = summarise(ev, r, who), ps = summarise(ev, pr, who), sp = speed(ev, r, who);
  const delta = (a, b) => { if(b === 0 && a === 0) return {d: 'No change', tone: ''}; if(!b) return {d: 'New this period', tone: 'up'}; const pc = Math.round((a - b) / b * 100); return {d: `${pc >= 0 ? '+' : ''}${pc}% vs previous`, tone: pc > 0 ? 'up' : pc < 0 ? 'down' : ''}; };
  const k = (l, v, a, b, icon) => Object.assign({l, v, icon}, delta(a, b));
  const kp = [
    k('Businesses contacted', s.contacted, s.contacted, ps.contacted, 'phone-outgoing'), k('Contact attempts', s.attempts, s.attempts, ps.attempts, 'activity'),
    k('Real conversations', s.conversations, s.conversations, ps.conversations, 'message-circle'), k('Meetings booked', s.meetings, s.meetings, ps.meetings, 'calendar-check'),
    k('Quotes sent', s.quotes, s.quotes, ps.quotes, 'file-text'), k('Deals won', s.won, s.won, ps.won, 'trophy'),
    k('Value won', fmtRk(s.wonValue), s.wonValue, ps.wonValue, 'badge-dollar-sign'), k('Cash collected', fmtRk(s.collected), s.collected, ps.collected, 'banknote')];

  // funnel (distinct businesses at each stage this period)
  const steps = [['New opportunities', s.newOpps, 'Enquiries, new clients and prospects found'], ['Contacted', s.contacted, 'Businesses we reached out to'], ['Meeting booked', s.met, 'Discovery calls and meetings booked'], ['Quoted', s.quoted, 'Received a quote'], ['Won', s.wonClients, 'Accepted a quote']];
  const top = Math.max(1, ...steps.map(x => x[1]));
  const funnel = `<div class="pf-funnel">${steps.map((st, i) => { const prev = i ? steps[i - 1][1] : null; const conv = i && prev ? Math.round(st[1] / prev * 100) : null;
    return `<div class="pf-step"><div class="pf-lbl"><b>${st[0]}</b><span class="muted xs">${st[2]}</span></div><div class="pf-bar"><i style="width:${Math.max(st[1] ? 4 : 0, Math.round(st[1] / top * 100))}%"></i><span class="num">${st[1]}</span></div><div class="pf-conv">${conv === null ? '' : `<span class="b ${conv >= 50 ? 'green' : conv >= 20 ? 'cyan' : 'gray'} nodot">${Math.min(conv, 999)}%</span>`}</div></div>`; }).join('')}</div>
    <p class="muted xs mt-8">Percentages compare each stage with the one above it, counting businesses (not individual calls). Contacts this period may convert in a later period.</p>`;

  // trend: weekly for short periods, monthly for quarter/year
  const monthly = ['quarter', 'year'].includes(p); const buckets = [];
  if(monthly){ const x = pd(TODAY); for(let i = 11; i >= 0; i--){ const d0 = iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() - i, 1))); const d1 = iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() - i + 1, 0))); buckets.push({from: d0, to: d1, label: MON[pd(d0).getUTCMonth()].slice(0, 3)}); } }
  else { for(let i = 11; i >= 0; i--){ const f = addDays(monday(TODAY), -7 * i); buckets.push({from: f, to: addDays(f, 6), label: fmtDs(f)}); } }
  const trendS = buckets.map(b => summarise(ev, b, who));
  const hasTrend = trendS.some(x => x.attempts || x.meetings || x.won || x.quotes);
  const trend = hasTrend ? `<div class="legend" style="margin-bottom:8px"><span><i style="background:var(--c1)"></i>Businesses contacted</span><span><i style="background:var(--c2)"></i>Meetings booked</span><span><i style="background:var(--c3)"></i>Quotes sent</span><span><i style="background:var(--c4)"></i>Deals won</span></div>` +
    chBars({labels: buckets.map(b => b.label), series: [{name: 'Contacted', values: trendS.map(x => x.contacted), color: 'var(--c1)'}, {name: 'Meetings', values: trendS.map(x => x.meetings), color: 'var(--c2)'}, {name: 'Quotes', values: trendS.map(x => x.quotes), color: 'var(--c3)'}, {name: 'Won', values: trendS.map(x => x.won), color: 'var(--c4)'}], h: 240, fmt: v => Math.round(v)})
    : empty('bar-chart-3', 'No activity yet', 'As soon as calls, meetings and quotes are logged, the last 12 ' + (monthly ? 'months' : 'weeks') + ' appear here.');

  // people
  const team = lead ? (role === 'Team leader' && W.teamOf ? DB.users.filter(u => teamOf(DB.me).concat(DB.me).includes(u.id)) : DB.users.filter(u => !['Read-only'].includes(u.sysRole))) : [me()];
  const tg = T(); const wk = range('week');
  const rows = team.map(u => { const a = summarise(ev, r, u.id), w = summarise(ev, wk, u.id); return {u, a, w}; }).sort((x, y) => y.a.wonValue - x.a.wonValue || y.a.contacted - x.a.contacted);
  const bar = (v, t) => t ? `<div class="pf-tg" data-tip="${v} of ${t} this week"><div class="pg ${v >= t ? 'green' : ''}"><i style="width:${Math.min(100, Math.round(v / t * 100))}%"></i></div><span class="num xs">${v}/${t}</span></div>` : `<span class="num">${v}</span>`;
  const people = `<div class="tw"><table class="tbl"><thead><tr><th>Person</th><th class="r">Contacted</th><th class="r">Conversations</th><th class="r">Meetings booked</th><th class="r">Quotes</th><th class="r">Won</th><th class="r">Value won</th><th class="r">Win rate</th><th>This week vs target</th></tr></thead><tbody>
    ${rows.map(({u, a, w}) => `<tr><td>${W.who ? W.who(u.id) : esc(u.name)}</td><td class="r num">${a.contacted}</td><td class="r num">${a.conversations}</td><td class="r num">${a.meetings}</td><td class="r num">${a.quotes}</td><td class="r num">${a.won}</td><td class="r num">${fmtR(a.wonValue)}</td><td class="r num">${a.winRate === null ? '—' : a.winRate + '%'}</td>
      <td style="min-width:230px"><div class="pf-tgs"><span class="xs muted">Contacts</span>${bar(w.contacted, tg.contacts)}<span class="xs muted">Meetings</span>${bar(w.meetings, tg.meetings)}<span class="xs muted">Quotes</span>${bar(w.quotes, tg.quotes)}</div></td></tr>`).join('')}</tbody></table></div>`;

  // sources
  const srcMap = {}; s.E.forEach(e => { const kk = e.source || 'Unknown'; const o = srcMap[kk] = srcMap[kk] || {opps: new Set(), contacted: new Set(), won: new Set(), value: 0}; if(['enquiry', 'client', 'found'].includes(e.type)) o.opps.add(e.key); if(e.type === 'contact') o.contacted.add(e.key); if(e.type === 'won'){ o.won.add(e.key); o.value += e.value; } });
  const srcRows = Object.keys(srcMap).map(kk => ({k: kk, o: srcMap[kk]})).filter(x => x.o.opps.size || x.o.contacted.size || x.o.won.size).sort((a, b) => b.o.value - a.o.value || b.o.opps.size - a.o.opps.size);
  const sources = srcRows.length ? `<div class="tw"><table class="tbl"><thead><tr><th>Where they came from</th><th class="r">New</th><th class="r">Contacted</th><th class="r">Won</th><th class="r">Value won</th></tr></thead><tbody>${srcRows.map(x => `<tr><td>${esc(x.k)}</td><td class="r num">${x.o.opps.size}</td><td class="r num">${x.o.contacted.size}</td><td class="r num">${x.o.won.size}</td><td class="r num">${fmtR(x.o.value)}</td></tr>`).join('')}</tbody></table></div>` : empty('compass', 'No sources yet', 'Lead sources appear as enquiries, prospects and clients come in.');

  // channels & lead acquisition
  const chTotal = Math.max(1, sum(s.byChannel, x => x[1]));
  const channels = `<div class="col" style="gap:9px">${s.byChannel.map(([ch, n]) => `<div class="la-bar" style="grid-template-columns:90px minmax(0,1fr) 40px"><span>${({call: 'Calls', email: 'Emails', whatsapp: 'WhatsApp', meeting: 'Meetings'})[ch]}</span><div class="pg"><i style="width:${Math.round(n / chTotal * 100)}%"></i></div><span class="num muted">${n}</span></div>`).join('')}</div>`;
  const la = `<div class="kv2" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div><div class="k">Prospects found</div><div class="v num">${s.found}</div></div><div><div class="k">Moved to pipeline</div><div class="v num">${s.transfers}</div></div><div><div class="k">Prospects contacted</div><div class="v num">${new Set(s.E.filter(e => e.type === 'contact' && e.lead).map(e => e.key)).size}</div></div><div><div class="k">Found → pipeline</div><div class="v num">${s.found ? Math.round(s.transfers / s.found * 100) + '%' : '—'}</div></div></div>`;

  const nothing = !s.E.length && !ps.E.length;
  const canTarget = lead && (W.can ? can('admin') || role === 'Team leader' : true);
  const html = `<div class="page">${pageHead('Sales performance', `How many businesses ${who && who === DB.me ? 'you' : who ? esc(uname(who)) : 'the team'} contacted, met, quoted and won ${r.label} (${fmtDs(r.from)} – ${fmtD(r.to)}).`,
      `${lead ? `<select class="sel sm" data-ch="pfWho" aria-label="Whose numbers">${opts([['all', 'Whole team']].concat(team.map(u => [u.id, u.id === DB.me ? 'Only me' : u.name])), who || 'all')}</select>` : ''}<select class="sel sm" data-ch="pfP" aria-label="Period">${opts(PERIODS, p)}</select>${canTarget ? `<button class="btn" data-a="pfTargets">${ic('target', 14)}Weekly targets</button>` : ''}<button class="btn pri" data-a="logActivity">${ic('plus', 14)}Log a call or meeting</button>`)}
    ${nothing ? `<div class="callout cyan" style="margin-bottom:16px">${ic('info', 15)}<span><b>Nothing to count yet.</b> These numbers fill in automatically as the team works: every <b>Log a call or meeting</b>, message in Communications, quote or invoice sent, discovery call, calendar meeting and Lead Acquisition conversation is counted. Nothing extra to set up.</span></div>` : ''}
    <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:16px">${kp.map(kpiCell).join('')}</div>
    <div class="grid g-21">${card(`${ic('filter', 15)} From first contact to won`, funnel)}${card(`${ic('gauge', 15)} Speed & quality`, `<div class="kv2" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div><div class="k">Win rate</div><div class="v num pf-big">${s.winRate === null ? '—' : s.winRate + '%'}</div><div class="muted xs">${s.won} won · ${s.lost} lost</div></div>
        <div><div class="k">Contacts per deal</div><div class="v num pf-big">${s.won ? Math.round(s.attempts / s.won) : '—'}</div><div class="muted xs">attempts ÷ deals won</div></div>
        <div><div class="k">Days to win</div><div class="v num pf-big">${sp.cycle === null ? '—' : sp.cycle}</div><div class="muted xs">first contact → accepted${sp.cycleN ? ` (${sp.cycleN} deals)` : ''}</div></div>
        <div><div class="k">Days to respond</div><div class="v num pf-big">${sp.response === null ? '—' : sp.response}</div><div class="muted xs">enquiry → first contact${sp.responseN ? ` (${sp.responseN})` : ''}</div></div>
        <div><div class="k">Average deal</div><div class="v num pf-big">${s.won ? fmtRk(s.wonValue / s.won) : '—'}</div><div class="muted xs">value of quotes accepted</div></div>
        <div><div class="k">Quoted value</div><div class="v num pf-big">${fmtRk(s.quoteValue)}</div><div class="muted xs">${s.quotes} quote${s.quotes === 1 ? '' : 's'} sent</div></div></div>`)}</div>
    <div class="mt-16">${card(`${ic('bar-chart-3', 15)} ${monthly ? 'Last 12 months' : 'Last 12 weeks'}`, trend)}</div>
    <div class="mt-16">${card(`${ic('users', 15)} ${lead ? 'By person' : 'You'} · ${esc(PERIODS.find(x => x[0] === p)[1].toLowerCase())}`, people, {flush: true})}</div>
    <div class="grid g3 mt-16">${card(`${ic('compass', 15)} Lead sources`, sources, {flush: true})}${card(`${ic('phone', 15)} How we reach out`, channels)}${card(`${ic('radar', 15)} Lead Acquisition`, la)}</div>
    <p class="muted xs mt-16">What counts: a <b>contact</b> is any call, email, WhatsApp or meeting logged by a team member. A <b>real conversation</b> is a call or meeting, or a message thread the client replied to. <b>Meetings</b> count on the day they are booked, by the person who booked them. <b>Won</b> uses the date a quote was accepted, and <b>cash collected</b> uses payment dates.</p></div>`;
  return {html, crumbs: [['Sales performance']], title: 'Sales performance'};
};
A.pfP = v => { setv('pfP', v); rerender(); };
A.pfWho = v => { setv('pfWho', v); rerender(); };
A.pfTargets = () => { const t = T(); modal({title: 'Weekly targets per person', body: `<p class="sub" style="margin-bottom:12px">Shown as progress bars for each person on the Sales performance page. Set to 0 to hide one.</p><div class="form-grid">${field('Businesses contacted per week', `<input class="inp num" type="number" min="0" id="tg-c" value="${t.contacts}">`)}${field('Meetings booked per week', `<input class="inp num" type="number" min="0" id="tg-m" value="${t.meetings}">`)}${field('Quotes sent per week', `<input class="inp num" type="number" min="0" id="tg-q" value="${t.quotes}">`)}</div>`, foot: `<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="pfTargetsSave">Save targets</button>`}); };
A.pfTargetsSave = () => { const t = T(); t.contacts = Math.max(0, +val('tg-c') || 0); t.meetings = Math.max(0, +val('tg-m') || 0); t.quotes = Math.max(0, +val('tg-q') || 0); audit('Updated weekly targets', `${t.contacts}/${t.meetings}/${t.quotes}`); closeTop(); commit('Targets saved'); };
W.salesEvents = events; W.salesSummary = summarise;

/* navigation: under Commercial, for everyone who sells or leads */
const g = W.NAV.find(x => x.g === 'Commercial');
if(g && !g.items.some(i => i[0] === 'performance')) g.items.unshift(['performance', 'Sales performance', 'trending-up']);
const baseAllowed = W.navAllowed;
if(baseAllowed) W.navAllowed = id => id === 'performance' ? ['Owner', 'Admin', 'Team leader', 'Sales', 'Finance'].includes((me() || {}).sysRole) || !me() : baseAllowed(id);
})();
