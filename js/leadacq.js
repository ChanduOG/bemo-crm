/* =====================================================================
   LEAD ACQUISITION: review prospects found by the n8n engine, contact
   them within POPIA rules, book meetings, and approve them into the
   existing client pipeline. Data lives in DB.acqLeads / laCampaigns /
   laSuppression and DB.settings.leadAcq (synced like everything else).
   ===================================================================== */
(function(){
const W = window, LE = W.LeadEngine;
const PAGE = 25;
const IND = LE.INDUSTRIES, PROV = Object.keys(LE.PROVINCES);
const REVIEW_TONE = {'New': 'blue', 'Reviewed': 'gray', 'Approved for contact': 'cyan', 'Contacted': 'amber', 'Meeting booked': 'green', 'Unsuitable': 'gray', 'Do not contact': 'red', 'Transferred': 'green'};
const PERM_TONE = {'Permission confirmed': 'green', 'Consent required': 'amber', 'Consent request permitted': 'blue', 'Contact restricted': 'amber', 'Opted out': 'red', 'Do not contact': 'red', 'Compliance review required': 'amber'};
const VER_TONE = {'Verified business': 'green', 'Probable business': 'cyan', 'Unverified business': 'amber', 'Inactive or closed': 'red', 'Unable to determine': 'gray'};
const PROVIDERS = [
  ['osm', 'OpenStreetMap', 'Free open data (no key). Finds businesses with and without websites. Fair-use limits apply.', 'map'],
  ['serper', 'Serper.dev (Google Maps + Google search)', 'Recommended. Google Maps listings (name, phone, address, website) and Google search. 2,500 free searches when you sign up, no card needed.', 'search'],
  ['tavily', 'Tavily search', 'Recommended backup. Takes over web searches when Serper is off or used up. 1,000 free searches every month, no card needed.', 'search'],
  ['hunter', 'Hunter.io', 'Business emails per domain and email verification. The free plan has small monthly limits.', 'at-sign'],
  ['snov', 'Snov.io', 'Optional extra email source (off by default).', 'mail-search'],
  ['prospeo', 'Prospeo', 'Optional extra email source (off by default).', 'mail-search'],
  ['anthropic', 'Claude AI write-ups', 'Optional. Writes the opportunity summary and conversation angle. Paid per use.', 'sparkles'],
  ['brave', 'Brave Search API (optional)', 'Optional extra web search. Brave asks for a card at signup, so it is off by default.', 'search'],
  ['apollo', 'Apollo.io (optional)', 'Optional companies and decision-makers. API access depends on your Apollo plan, so it is off by default.', 'users']
];
const DEF_PROV = {osm: {enabled: true, daily: 200, monthly: 3000, costZar: 0}, serper: {enabled: true, daily: 80, monthly: 800, costZar: 0}, tavily: {enabled: true, daily: 30, monthly: 950, costZar: 0},
  brave: {enabled: false, daily: 60, monthly: 1500, costZar: 0}, apollo: {enabled: false, daily: 20, monthly: 100, costZar: 0, reveal: true},
  hunter: {enabled: true, daily: 10, monthly: 25, costZar: 0}, snov: {enabled: false, daily: 10, monthly: 50, costZar: 0}, prospeo: {enabled: false, daily: 10, monthly: 50, costZar: 0}, anthropic: {enabled: true, daily: 100, monthly: 1000, costZar: 0.6}};

/* ---------- data helpers ---------- */
function ensure(){
  ['acqLeads', 'laCampaigns', 'laSuppression'].forEach(k => { if(!Array.isArray(DB[k])) DB[k] = []; });
  const S = DB.settings; S.leadAcq = S.leadAcq || {};
  const L = S.leadAcq; L.providers = L.providers || {};
  Object.keys(DEF_PROV).forEach(p => { L.providers[p] = Object.assign({}, DEF_PROV[p], L.providers[p] || {}); });
  ['monthlyBudgetZar', 'autoEnrichScore', 'aiMinScore', 'retentionMonths'].forEach((k, i) => { if(L[k] === undefined) L[k] = [500, 60, 55, 12][i]; });
  L.sender = Object.assign({name: '', company: (S.company || {}).name || 'BEMO-SOLUTIONS', email: (S.company || {}).email || '', phone: (S.company || {}).phone || '', address: (S.company || {}).address || ''}, L.sender || {});
  return L;
}
const cfg = () => ensure();
const lead = id => (DB.acqLeads || []).find(l => l.id === id);
const sender = () => { const L = cfg(), u = me() || {}; return {name: L.sender.name || u.name || '', company: L.sender.company, email: L.sender.email || u.email || '', phone: L.sender.phone || u.phone || '', address: L.sender.address, website: (DB.settings.company || {}).website || 'www.bemosolutions.co.za'}; };
const optUrl = c => cfg().optOutUrl && c && c.optoutToken ? cfg().optOutUrl.replace(/\/?$/, '') + '?t=' + c.optoutToken : '';
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
const canUse = () => !W.can || can('admin') || ['Team leader', 'Sales'].includes((me() || {}).sysRole);
const phonesOf = l => [].concat(l.company && l.company.phone && l.company.phone.e164 ? [Object.assign({label: 'Business'}, l.company.phone)] : [], ...((l.company || {}).otherPhones || []).map(p => Object.assign({label: 'Business'}, p)));
const bestPhone = l => { const c = LE.bestContact(l); const ps = (c && c.phones || []).concat(phonesOf(l)).filter(p => p.e164 && p.status !== 'Invalid number'); return ps.sort((a, b) => (LE.PHONE_RANK[b.status] || 0) - (LE.PHONE_RANK[a.status] || 0))[0]; };
const bestEmail = l => { const c = LE.bestContact(l); if(c && c.email) return c; return (l.contacts || []).find(x => x.email && !x.dnc && !x.optOut); };
const verifiedEmail = l => (l.contacts || []).some(x => ['valid', 'verified'].includes(x.emailStatus));
const verifiedPhone = l => phonesOf(l).concat(...(l.contacts || []).map(x => x.phones || [])).some(p => /^Verified/.test(p.status || ''));
const reviewOf = l => (l.review || {}).status || 'New';
const scoreOf = l => (l.score || {}).total || 0;
const scorePill = l => { const s = scoreOf(l); const t = s >= 85 ? 'green' : s >= 70 ? 'cyan' : s >= 50 ? 'amber' : 'gray'; return `<span class="la-score ${t}" data-tip="${esc((l.score || {}).category || '')}">${s}</span>`; };
const webBadge = l => { const w = l.website || {}; return w.status === 'NO WEBSITE FOUND' ? badge('No website', 'amber') : w.status === 'Website unreachable' ? badge('Site down', 'red') : w.outdated ? badge('Outdated site', 'amber') : w.status === 'Website found' ? badge('Website', 'gray') : badge('Not checked', 'gray'); };
const mask = s => s ? esc(s) : '<span class="muted">—</span>';
function rescore(l){ LE.qualify(l, cfg()); l.updatedAt = new Date().toISOString(); }
function addSuppression(values, reason, leadId){
  DB.laSuppression = DB.laSuppression || [];
  values.filter(Boolean).forEach(v => { if(!DB.laSuppression.some(s => s.value === v)) DB.laSuppression.push({id: 'SUP-' + hashStr(v), value: v, reason, at: nowStamp(), by: DB.me, leadId: leadId || null}); });
}
function hashStr(s){ let h = 0; for(let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0; return (h >>> 0).toString(16); }
function ensureTokens(l){ (l.contacts || []).forEach(c => { if(!c.optoutToken) c.optoutToken = token(); if(!c.id) c.id = 'c-' + hashStr((c.email || '') + (c.name || '') + Math.random()); }); }

/* ---------- filtering ---------- */
const F = () => UI.v.laF || (UI.v.laF = {q: '', ind: '', prov: '', city: '', min: '', cat: '', ver: '', contact: '', web: '', review: 'open', src: '', when: '', below: false, page: 0, sort: 'priority'});
function filtered(){
  const f = F(), q = f.q.trim().toLowerCase(); const now = Date.now();
  let rows = (DB.acqLeads || []).filter(l => {
    if(!f.below && l.belowThreshold) return false;
    const r = reviewOf(l);
    if(f.review === 'open' && ['Unsuitable', 'Do not contact', 'Transferred'].includes(r)) return false;
    if(f.review && f.review !== 'open' && r !== f.review) return false;
    if(f.ind && l.industry !== f.ind) return false;
    if(f.prov && (l.company || {}).province !== f.prov) return false;
    if(f.city && (l.company || {}).city !== f.city) return false;
    if(f.min && scoreOf(l) < +f.min) return false;
    if(f.cat && (l.score || {}).category !== f.cat) return false;
    if(f.ver && (l.verification || {}).status !== f.ver) return false;
    if(f.contact === 'phone' && !bestPhone(l)) return false;
    if(f.contact === 'vphone' && !verifiedPhone(l)) return false;
    if(f.contact === 'vemail' && !verifiedEmail(l)) return false;
    if(f.contact === 'dm' && !(l.contacts || []).some(c => c.name && LE.titleRank(c.title, l.industry) < 40)) return false;
    if(f.web === 'none' && (l.website || {}).status !== 'NO WEBSITE FOUND') return false;
    if(f.web === 'outdated' && !((l.website || {}).outdated || ['NO WEBSITE FOUND', 'Website unreachable'].includes((l.website || {}).status))) return false;
    if(f.web === 'has' && (l.website || {}).status !== 'Website found') return false;
    if(f.src && !(l.sources || []).some(s => s.provider === f.src)) return false;
    if(f.when && (now - new Date(l.createdAt || 0).getTime()) > +f.when * 864e5) return false;
    if(q && ![l.company.name, l.company.city, l.company.domain, ...(l.contacts || []).map(c => c.name + ' ' + c.email)].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
  const ready = l => (l.score || {}).readyToContact ? 1 : 0;
  const sorts = {priority: (a, b) => ready(b) - ready(a) || scoreOf(b) - scoreOf(a), score: (a, b) => scoreOf(b) - scoreOf(a), newest: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)), name: (a, b) => a.company.name.localeCompare(b.company.name)};
  return rows.sort(sorts[f.sort] || sorts.priority);
}

/* ---------- main page ---------- */
Views.leads = id => {
  ensure();
  if(!canUse()) return {html: `<div class="page">${empty('lock', 'Not part of your portal', 'Lead Acquisition is for sales, team leaders and admins.')}</div>`, crumbs: [['Lead Acquisition']], title: 'Lead Acquisition'};
  if(id && lead(id)) return detail(lead(id));
  const tab = uv('laTab', 'leads');
  const tabs = [['leads', 'Prospects', (DB.acqLeads || []).filter(l => reviewOf(l) === 'New' && !l.belowThreshold).length], ['campaigns', 'Campaigns', (DB.laCampaigns || []).length], ['providers', 'Providers & budget'], ['suppression', 'Do-not-contact list', (DB.laSuppression || []).length], ['setup', 'Connection']];
  const body = tab === 'campaigns' ? campaignsTab() : tab === 'providers' ? providersTab() : tab === 'suppression' ? suppressionTab() : tab === 'setup' ? setupTab() : leadsTab();
  const html = `<div class="page full">${pageHead('Lead Acquisition', 'South African businesses found and researched by the prospecting engine. Call the top of the list first, then approve good ones into your pipeline.',
    `<button class="btn" data-a="laPropAll" title="Send a short, tailored proposal to every prospect in the current list that may be emailed">${ic('send', 14)}Send proposals</button><button class="btn" data-a="laImport">${ic('upload', 14)}Import CSV</button><button class="btn" data-a="laAdd">${ic('plus', 14)}Add prospect</button><button class="btn pri" data-a="laGoCampaigns">${ic('radar', 14)}Find prospects</button>`)}
    ${tabsc('laTab', tabs, tab)}${body}</div>`;
  return {html, crumbs: [['Lead Acquisition']], title: 'Lead Acquisition'};
};

function leadsTab(){
  const all = DB.acqLeads || [], f = F();
  const k = {total: all.length, high: all.filter(l => scoreOf(l) >= 85 && !l.belowThreshold).length, review: all.filter(l => reviewOf(l) === 'New' && !l.belowThreshold).length,
    approved: all.filter(l => ['Approved for contact', 'Contacted'].includes(reviewOf(l))).length, meet: all.filter(l => reviewOf(l) === 'Meeting booked' || (l.meetings || []).length).length, moved: all.filter(l => reviewOf(l) === 'Transferred').length};
  const chips = [['vbiz', 'Verified businesses', all.filter(l => (l.verification || {}).status === 'Verified business').length, () => { f.ver = f.ver === 'Verified business' ? '' : 'Verified business'; }],
    ['vemail', 'Verified emails', all.filter(verifiedEmail).length, () => { f.contact = f.contact === 'vemail' ? '' : 'vemail'; }],
    ['vphone', 'Verified phones', all.filter(verifiedPhone).length, () => { f.contact = f.contact === 'vphone' ? '' : 'vphone'; }],
    ['noweb', 'No website found', all.filter(l => (l.website || {}).status === 'NO WEBSITE FOUND').length, () => { f.web = f.web === 'none' ? '' : 'none'; }]];
  W.LA_CHIPS = chips;
  const rows = filtered(); const pages = Math.max(1, Math.ceil(rows.length / PAGE)); if(f.page >= pages) f.page = pages - 1;
  const view = rows.slice(f.page * PAGE, f.page * PAGE + PAGE); const sel = UI.v.laSel || (UI.v.laSel = new Set());
  const cities = uniq(all.map(l => (l.company || {}).city).filter(Boolean)).sort();
  const srcs = uniq(all.flatMap(l => (l.sources || []).map(s => s.provider))).sort();
  const sl = (key, list, cur, blank) => `<select class="sel sm" data-ch="laF" data-k="${key}" aria-label="${blank}">${opts(list, cur, {blank})}</select>`;
  const isOn = id => ({vbiz: f.ver === 'Verified business', vemail: f.contact === 'vemail', vphone: f.contact === 'vphone', noweb: f.web === 'none'})[id];
  return `<div class="kpis" style="grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:14px">${[
      {l: 'Businesses found', v: k.total, icon: 'building-2'}, {l: 'High priority (85+)', v: k.high, icon: 'flame', d: 'Call these first', tone: 'up'}, {l: 'Awaiting review', v: k.review, icon: 'inbox'},
      {l: 'Approved / contacted', v: k.approved, icon: 'phone-outgoing'}, {l: 'Meetings booked', v: k.meet, icon: 'calendar-check'}, {l: 'Moved to pipeline', v: k.moved, icon: 'arrow-right-circle'}].map(kpiCell).join('')}</div>
    <div class="row wrap" style="gap:8px;margin-bottom:12px">${chips.map(c => `<button class="fchip ${isOn(c[0]) ? 'on' : ''}" data-a="laChip" data-id="${c[0]}">${c[1]} <span class="ct">${c[2]}</span></button>`).join('')}</div>
    <div class="card"><div class="card-b" style="padding-bottom:6px"><div class="la-filters">
      <div class="inp-wrap la-search">${ic('search', 14)}<input class="inp sm" id="la-q" placeholder="Search business, town, contact…" value="${esc(f.q)}" data-in="laQ" autocomplete="off"></div>
      ${sl('ind', Object.keys(IND).map(i => [i, IND[i].label]), f.ind, 'All industries')}${sl('prov', PROV, f.prov, 'All provinces')}${sl('city', cities, f.city, 'All towns')}
      ${sl('min', [['50', '50+'], ['70', '70+'], ['85', '85+']], f.min, 'Any score')}${sl('ver', LE.VERIFY, f.ver, 'Any verification')}
      ${sl('contact', [['phone', 'Has a phone'], ['vphone', 'Verified phone'], ['vemail', 'Verified email'], ['dm', 'Decision-maker named']], f.contact, 'Any contact details')}
      ${sl('web', [['none', 'No website found'], ['outdated', 'Weak / no website'], ['has', 'Has a website']], f.web, 'Any website')}
      ${sl('review', [['open', 'Open (to work)'], ...LE.REVIEW.map(r => [r, r])], f.review, 'Every status')}${sl('src', srcs, f.src, 'Any source')}
      ${sl('when', [['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days']], f.when, 'Any date')}
      ${sl('sort', [['priority', 'Call first'], ['score', 'Highest score'], ['newest', 'Newest'], ['name', 'A–Z']], f.sort, 'Sort')}
      <label class="chk small"><input type="checkbox" data-ch="laF" data-k="below" ${f.below ? 'checked' : ''}>Show below campaign threshold</label>
      <button class="btn ghost sm" data-a="laReset">Reset</button></div></div>
      ${sel.size ? `<div class="la-bulk"><b>${sel.size} selected</b>${[['Reviewed', 'Mark reviewed'], ['Approved for contact', 'Approve for contact'], ['Unsuitable', 'Unsuitable'], ['Do not contact', 'Do not contact']].map(([s, l]) => `<button class="btn sm ${s === 'Do not contact' ? 'danger' : ''}" data-a="laBulk" data-s="${s}">${l}</button>`).join('')}<button class="btn sm pri" data-a="laPropSel">${ic('send', 13)}Send proposals</button><button class="btn sm" data-a="laBulkEnrich">${ic('coins', 13)}Approve enrichment</button>${W.can && can('delete_data') ? `<button class="btn sm danger" data-a="laBulkDel">${ic('trash-2', 13)}Delete</button>` : ''}<button class="btn ghost sm" data-a="laSelNone">Clear</button></div>` : ''}
      ${rows.length ? `<div class="tw"><table class="tbl la-tbl"><thead><tr><th style="width:30px"><input type="checkbox" data-ch="laSelAll" ${view.length && view.every(l => sel.has(l.id)) ? 'checked' : ''} aria-label="Select page"></th><th>Business</th><th>Location</th><th>Website</th><th class="r">Score</th><th>Decision-maker</th><th>Phone</th><th>Email</th><th>Verification</th><th>Suggested service</th><th>Found</th><th>Status</th></tr></thead><tbody>
      ${view.map(l => { const c = LE.bestContact(l); const p = bestPhone(l); const e = bestEmail(l); return `<tr data-go="leads-${l.id}" class="${(l.score || {}).readyToContact ? '' : 'la-dim'}">
        <td><input type="checkbox" data-ch="laSel" data-id="${l.id}" ${sel.has(l.id) ? 'checked' : ''} aria-label="Select ${esc(l.company.name)}"></td>
        <td class="wrap"><div class="cell-t">${esc(l.company.name)}</div><div class="cell-s">${esc((IND[l.industry] || IND.other).label)}</div></td>
        <td>${esc(l.company.city || '—')}<div class="cell-s">${esc(l.company.province || '')}</div></td><td>${webBadge(l)}</td><td class="r">${scorePill(l)}</td>
        <td>${c && c.name ? `<div class="cell-t">${esc(c.name)}</div><div class="cell-s">${esc(c.title || '')}</div>` : '<span class="muted">Not found yet</span>'}</td>
        <td class="num">${p ? `${esc(LE.fmtPhone(p.e164))}<div class="cell-s">${esc(p.kind)}${/^Verified/.test(p.status) ? ' · verified' : ''}</div>` : '<span class="muted">—</span>'}</td>
        <td>${e ? `<span class="trunc" style="max-width:190px;display:inline-block">${esc(e.email)}</span><div class="cell-s">${['valid', 'verified'].includes(e.emailStatus) ? 'verified' : esc(e.emailStatus || 'unverified')}</div>` : '<span class="muted">—</span>'}</td>
        <td>${badge((l.verification || {}).status || 'Unable to determine', VER_TONE[(l.verification || {}).status] || 'gray')}</td>
        <td class="wrap" style="min-width:150px">${esc(((l.opportunity || {}).services || [])[0] ? l.opportunity.services[0].name : '—')}</td>
        <td class="small muted">${l.createdAt ? fmtDs(String(l.createdAt).slice(0, 10)) : '—'}</td><td>${badge(reviewOf(l), REVIEW_TONE[reviewOf(l)])}</td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="row between la-pager"><span class="muted small">${rows.length} prospect${rows.length === 1 ? '' : 's'} · page ${f.page + 1} of ${pages}</span><div class="row" style="gap:6px"><button class="btn sm" data-a="laPage" data-n="-1" ${f.page ? '' : 'disabled'}>Previous</button><button class="btn sm" data-a="laPage" data-n="1" ${f.page < pages - 1 ? '' : 'disabled'}>Next</button></div></div>`
      : empty('radar', all.length ? 'No prospects match these filters' : 'No prospects yet', all.length ? 'Clear a filter to see more.' : 'Create a campaign and connect n8n (see the Connection tab), or add and import prospects yourself.', all.length ? `<button class="btn sm" data-a="laReset">Reset filters</button>` : `<button class="btn pri sm" data-a="laGoCampaigns">${ic('radar', 13)}Create a campaign</button>`)}</div>`;
}

/* ---------- lead detail ---------- */
function detail(l){
  ensureTokens(l);
  const c = l.company, w = l.website || {}, s = l.score || {}, o = l.opportunity || {}, v = l.verification || {};
  const p = bestPhone(l); const r = reviewOf(l); const done = r === 'Transferred';
  const B = s.breakdown || {}; const MAX = {industry: 20, automation: 20, digital: 15, decisionMaker: 15, contactQuality: 15, verification: 10, activity: 5};
  const LBL = {industry: 'Industry relevance', automation: 'Automation potential', digital: 'Website & digital gaps', decisionMaker: 'Decision-maker found', contactQuality: 'Contact details quality', verification: 'Business verified', activity: 'Business activity'};
  const yes = (b, t) => `<li class="${b ? 'ok' : 'no'}">${ic(b ? 'check-circle-2' : 'circle-dashed', 14)}<span>${t}</span></li>`;
  const contactRow = x => {
    const perm = x.permission || LE.defaultPermission(x, l, cfg()); const blocked = ['Opted out', 'Do not contact'].includes(perm) || x.dnc || x.optOut;
    return `<div class="la-contact ${blocked ? 'blocked' : ''}"><div class="row between wrap" style="gap:8px"><div><div class="strong">${esc(x.name || (x.title === 'General business inbox' ? 'General inbox' : 'Unnamed contact'))}${x.id === l.bestContactId ? ` <span class="b cyan nodot">Best person to contact</span>` : ''}</div><div class="muted small">${esc([x.title, x.dept].filter(Boolean).join(' · ') || 'Title unknown')}</div></div>${badge(perm, PERM_TONE[perm] || 'gray')}</div>
      <div class="la-cd">${x.email ? `<div>${ic('mail', 13)} <span class="mono">${esc(x.email)}</span> ${badge(['valid', 'verified'].includes(x.emailStatus) ? 'Verified' : x.emailStatus === 'invalid' ? 'Invalid' : (x.emailStatus || 'Unverified'), ['valid', 'verified'].includes(x.emailStatus) ? 'green' : x.emailStatus === 'invalid' ? 'red' : 'gray', 'nodot')}${x.emailScore ? `<span class="muted xs"> ${x.emailScore}% confidence</span>` : ''} <button class="ib sm" data-a="laCopy" data-v="${esc(x.email)}" aria-label="Copy email" data-tip="Copy">${ic('copy', 13)}</button></div>` : ''}
        ${(x.phones || []).map(ph => `<div>${ic('phone', 13)} <span class="num">${esc(LE.fmtPhone(ph.e164))}</span> ${badge(ph.status, /^Verified/.test(ph.status) ? 'green' : 'gray', 'nodot')} <span class="muted xs">${esc(ph.kind)}</span>${blocked ? '' : ` <a class="btn xs" href="tel:${ph.e164}">${ic('phone-call', 12)}Call</a>`} <button class="ib sm" data-a="laCopy" data-v="${ph.e164}" aria-label="Copy number">${ic('copy', 13)}</button></div>`).join('')}
        ${x.profileUrl ? `<div>${ic('linkedin', 13)} <a href="${esc(x.profileUrl)}" target="_blank" rel="noopener">Professional profile</a></div>` : ''}
        <div class="muted xs">Found by ${esc((x.foundBy || [x.source]).filter(Boolean).join(', ') || 'unknown')} · collected ${x.collectedAt ? fmtD(String(x.collectedAt).slice(0, 10)) : '—'} · keep until ${x.retainUntil ? fmtD(x.retainUntil) : '—'}${x.consentRequest && x.consentRequest.sentAt ? ` · consent request sent ${fmtD(String(x.consentRequest.sentAt).slice(0, 10))}` : ''}</div></div>
      ${blocked || done ? '' : `<div class="row wrap" style="gap:6px;margin-top:8px"><button class="btn xs" data-a="laScript" data-id="${l.id}" data-c="${x.id}">${ic('scroll-text', 12)}Call script</button>${x.email ? `<button class="btn xs" data-a="laDraft" data-id="${l.id}" data-c="${x.id}">${ic('mail', 12)}${perm === 'Permission confirmed' ? 'Outreach email' : 'Consent request'}</button><button class="btn xs" data-a="laPropOne" data-id="${l.id}">${ic('send', 12)}Send proposal</button>` : ''}<button class="btn xs" data-a="laConsent" data-id="${l.id}" data-c="${x.id}">${ic('badge-check', 12)}Record consent</button>${perm === 'Compliance review required' ? `<button class="btn xs" data-a="laClear" data-id="${l.id}" data-c="${x.id}">${ic('shield-check', 12)}Mark compliance reviewed</button>` : ''}<button class="btn xs danger" data-a="laDncContact" data-id="${l.id}" data-c="${x.id}">${ic('ban', 12)}Do not contact</button></div>`}</div>`;
  };
  const conv = (l.conversations || []).slice().reverse();
  const html = `<div class="page">
    <div class="dh"><div class="dh-l"><span class="co-ic lg">${esc(initials(c.name || '?'))}</span><div><div class="row wrap" style="gap:8px"><h1>${esc(c.name)}</h1>${badge(r, REVIEW_TONE[r])}${l.belowThreshold ? badge('Below campaign threshold', 'gray') : ''}</div>
      <div class="meta">${esc((IND[l.industry] || IND.other).label)} · ${esc([c.city, c.province].filter(Boolean).join(', ') || 'Location unknown')} · ${l.id} · found ${l.createdAt ? fmtD(String(l.createdAt).slice(0, 10)) : '—'}</div></div></div>
      <div class="ph-act">${c.website ? `<a class="btn" href="${esc(/^https?:/.test(c.website) ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener">${ic('globe', 14)}Website</a>` : ''}
        ${p && !done ? `<a class="btn" href="tel:${p.e164}">${ic('phone-call', 14)}Call ${esc(LE.fmtPhone(p.e164))}</a>` : ''}
        ${done ? `<a class="btn pri" href="#client-${esc(l.transfer.clientId)}">${ic('arrow-right', 14)}Open client</a>` : `<button class="btn" data-a="laConv" data-id="${l.id}">${ic('message-square-plus', 14)}Record conversation</button><button class="btn" data-a="laMeet" data-id="${l.id}">${ic('calendar-plus', 14)}Book meeting</button><button class="btn pri" data-a="laTransfer" data-id="${l.id}">${ic('arrow-right-circle', 14)}Approve into pipeline</button>`}
        <button class="ib" data-a="laMore" data-id="${l.id}" aria-label="More actions">${ic('more-horizontal', 16)}</button></div></div>
    ${!s.readyToContact && s.notReadyReason ? `<div class="callout amber" style="margin-bottom:14px">${ic('alert-triangle', 15)}<span><b>Not ready to contact:</b> ${esc(s.notReadyReason)}.${l.enrichment && l.enrichment.status === 'Awaiting approval' ? ` <button class="btn xs" data-a="laEnrich" data-id="${l.id}">${ic('coins', 12)}Approve enrichment</button>` : ''}</span></div>` : ''}
    ${l.enrichment && l.enrichment.status === 'Awaiting approval' && s.readyToContact ? `<div class="callout cyan" style="margin-bottom:14px">${ic('coins', 15)}<span>${esc(l.enrichment.reason)} <button class="btn xs" data-a="laEnrich" data-id="${l.id}">Approve enrichment</button></span></div>` : ''}
    ${l.enrichRequested ? `<div class="callout" style="margin-bottom:14px">${ic('loader', 15)}<span>Enrichment approved. The engine will look this business up on its next run.</span></div>` : ''}
    <div class="grid g-21">
      <div class="stack">
        ${card(`${ic('users', 15)} Who to contact`, (l.contacts || []).length ? `<div class="col gap-12">${(l.contacts || []).slice().sort((a, b) => (b.id === l.bestContactId) - (a.id === l.bestContactId)).map(contactRow).join('')}</div>` : empty('user-search', 'No named people yet', c.domain ? 'Approve enrichment to look up decision-makers, or call the business number and ask for the owner or practice manager.' : 'No website domain is known, so email lookups aren’t possible. Call the business number and ask for the owner.'), {act: done ? '' : `<button class="btn ghost xs" data-a="laAddContact" data-id="${l.id}">${ic('plus', 12)}Add person</button>`})}
        ${card(`${ic('building-2', 15)} Company`, `<dl class="kv"><dt>Name</dt><dd>${esc(c.name)}${c.tradingName ? `<div class="muted xs">Trading as ${esc(c.tradingName)}</div>` : ''}</dd><dt>Industry</dt><dd>${esc(c.category || (IND[l.industry] || IND.other).label)}</dd>
          <dt>Address</dt><dd>${mask(c.address)}</dd><dt>Town</dt><dd>${esc([c.city, c.province].filter(Boolean).join(', ') || '—')}</dd><dt>Website</dt><dd>${c.website ? `<a href="${esc(/^https?:/.test(c.website) ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener">${esc(c.domain || c.website)}</a>` : '<span class="muted">None found</span>'}</dd>
          <dt>Phone</dt><dd>${phonesOf(l).length ? phonesOf(l).map(ph => `<div><span class="num">${esc(LE.fmtPhone(ph.e164))}</span> <span class="muted xs">${esc(ph.kind)} · ${esc(ph.status)}</span> <button class="ib sm" data-a="laCopy" data-v="${ph.e164}" aria-label="Copy">${ic('copy', 13)}</button></div>`).join('') : '<span class="muted">None found</span>'}</dd>
          <dt>Email</dt><dd>${c.email && c.email.value ? `<span class="mono">${esc(c.email.value)}</span> <button class="ib sm" data-a="laCopy" data-v="${esc(c.email.value)}" aria-label="Copy">${ic('copy', 13)}</button>` : '<span class="muted">None found</span>'}</dd>
          ${c.size ? `<dt>Size</dt><dd>${esc(c.size)} employees</dd>` : ''}${c.regNo ? `<dt>Registration</dt><dd>${esc(c.regNo)}</dd>` : ''}${c.description ? `<dt>About</dt><dd>${esc(c.description)}</dd>` : ''}
          ${(c.socials || []).length ? `<dt>Profiles</dt><dd>${c.socials.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}</a>`).join('<br>')}</dd>` : ''}</dl>`)}
        ${card(`${ic('globe', 15)} Digital audit`, `<div class="row wrap" style="gap:8px;margin-bottom:10px">${webBadge(l)}${w.confidence ? `<span class="muted xs">Confidence: ${esc(w.confidence)}</span>` : ''}${w.checkedAt ? `<span class="muted xs">· checked ${fmtD(String(w.checkedAt).slice(0, 10))}</span>` : ''}</div>
          ${w.status === 'Website found' ? `<ul class="la-checks">${yes(w.https, 'Secure (HTTPS)')}${yes(w.mobile, 'Mobile-friendly')}${yes(w.contactForm, 'Online contact / enquiry form')}${yes(w.booking, 'Online booking')}${yes(w.intake || w.quote, 'Online quote or client intake')}${yes(w.portal, 'Client portal / login')}${yes(w.selfService, 'Self-service features')}${yes(w.chat, 'Chat or WhatsApp link')}${yes(!w.outdated, 'Looks current' + (w.copyrightYear ? ` (© ${w.copyrightYear})` : ''))}</ul>` : `<p class="small">${esc(w.notes || '')}</p>`}
          ${w.status === 'Website found' && w.notes ? `<p class="muted xs mt-8">${esc(w.notes)}</p>` : ''}
          <div class="eyebrow mt-16" style="margin-bottom:6px">What we observed (facts)</div><ul class="bul">${(o.observations || []).map(x => `<li>${ic('dot', 14, 'muted')}<span>${esc(x)}</span></li>`).join('')}</ul>
          <p class="muted xs mt-8">Something not being found publicly does not prove the business doesn’t have it internally. Confirm on the call.</p>`)}
        ${card(`${ic('history', 15)} Conversations & notes`, (conv.length || (l.notes || []).length) ? `<div class="tl">${conv.map(x => `<div class="tl-i"><div class="tl-ic">${ic(x.channel === 'Email' ? 'mail' : x.channel === 'Meeting' ? 'users' : 'phone', 14)}</div><div class="tl-b"><div class="t">${esc(x.channel)} · ${esc(x.outcome)}</div><div class="s">${esc(uname(x.by))} · ${fmtDT(x.at)}${x.contact ? ' · with ' + esc(x.contact) : ''}</div>${x.notes ? `<div class="body">${esc(x.notes)}</div>` : ''}</div></div>`).join('')}${(l.notes || []).map(n => `<div class="tl-i"><div class="tl-ic">${ic('sticky-note', 14)}</div><div class="tl-b"><div class="t">Note</div><div class="s">${esc(uname(n.by))} · ${fmtDT(n.at)}</div><div class="body">${esc(n.text)}</div></div></div>`).join('')}</div>` : empty('message-square', 'No conversations yet', 'After a call or email, record what happened so the team can see it.'), {act: done ? '' : `<button class="btn ghost xs" data-a="laNote" data-id="${l.id}">${ic('plus', 12)}Note</button>`})}
      </div>
      <div class="stack">
        ${card(`${ic('target', 15)} Opportunity score`, `<div class="row" style="gap:14px;margin-bottom:12px"><span class="la-big ${scoreOf(l) >= 85 ? 'green' : scoreOf(l) >= 70 ? 'cyan' : scoreOf(l) >= 50 ? 'amber' : 'gray'}">${scoreOf(l)}</span><div><div class="strong">${esc(s.category || '—')}</div><div class="muted small">Confidence: ${esc(s.confidence || '—')}</div><div class="small ${s.readyToContact ? 'up' : 'warn'}">${s.readyToContact ? 'Ready to contact' : 'Not ready to contact'}</div></div></div>
          <div class="col" style="gap:7px">${Object.keys(MAX).map(k => `<div class="la-bar"><span>${LBL[k]}</span><div class="pg"><i style="width:${Math.round((B[k] || 0) / MAX[k] * 100)}%"></i></div><span class="num muted">${B[k] || 0}/${MAX[k]}</span></div>`).join('')}</div>
          <p class="muted xs mt-12">This scores the opportunity, not whether they want to buy.</p>`)}
        ${card(`${ic('lightbulb', 15)} How BEMO-SOLUTIONS can help`, `${o.narrative ? `<p style="line-height:1.55;margin-bottom:10px">${esc(o.narrative)}</p>` : ''}
          <div class="col" style="gap:8px">${((o.aiServices && o.aiServices.length ? o.aiServices.map(x => ({name: x.service, why: x.why})) : o.services) || []).map(x => `<div class="la-svc"><b>${esc(x.name)}</b><span>${esc(x.why)}</span></div>`).join('') || '<span class="muted small">No suggestion yet.</span>'}</div>
          ${o.angle ? `<div class="callout cyan mt-12">${ic('message-circle', 15)}<span><b>Conversation angle:</b> ${esc(o.angle)}</span></div>` : ''}
          ${(o.unknowns || []).length ? `<div class="eyebrow mt-12" style="margin-bottom:4px">Confirm on the call</div><ul class="bul">${o.unknowns.map(x => `<li>${ic('help-circle', 14, 'muted')}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
          <p class="muted xs mt-12">${o.source === 'rules+ai' ? `AI-generated suggestions (${esc(o.aiModel || 'Claude')}), based only on the facts above.` : 'Rule-based suggestions from the facts above.'} Treat them as ideas, not facts.</p>`)}
        ${card(`${ic('shield-check', 15)} Business verification`, `<div style="margin-bottom:10px">${badge(v.status || 'Unable to determine', VER_TONE[v.status] || 'gray')}</div><div class="col" style="gap:6px">${(v.evidence || []).map(e => `<div class="la-ev">${ic(e.ok === true ? 'check-circle-2' : e.ok === false ? 'x-circle' : 'minus-circle', 14, e.ok === true ? 'up' : e.ok === false ? 'down' : 'muted')}<div><div class="small strong">${esc(e.check)}</div><div class="muted xs">${esc(e.result)}${e.at ? ' · ' + fmtD(String(e.at).slice(0, 10)) : ''}</div></div></div>`).join('')}</div><p class="muted xs mt-8">Each check is separate evidence. A working website does not prove registration, and a registration does not prove an email works.</p>`)}
        ${card(`${ic('database', 15)} Where this came from`, `<div class="tw"><table class="tbl"><thead><tr><th>Data</th><th>Source</th><th>Collected</th></tr></thead><tbody>${(l.sources || []).map(sr => `<tr><td>${esc(sr.field)}</td><td class="wrap" style="min-width:140px">${esc(sr.provider)}${sr.ref && /^https?:/.test(sr.ref) ? ` <a href="${esc(sr.ref)}" target="_blank" rel="noopener" class="xs">link</a>` : ''}${sr.usage ? `<div class="cell-s">${esc(sr.usage)}</div>` : ''}</td><td class="small muted">${sr.at ? fmtD(String(sr.at).slice(0, 10)) : '—'}</td></tr>`).join('')}</tbody></table></div>${l.enrichment ? `<p class="muted xs mt-8">Enrichment: ${esc(l.enrichment.status)}${(l.enrichment.providers || []).length ? ' via ' + esc(l.enrichment.providers.join(', ')) : ''}${l.enrichment.at ? ' · ' + fmtD(String(l.enrichment.at).slice(0, 10)) : ''}</p>` : ''}`)}
      </div></div></div>`;
  return {html, crumbs: [['Lead Acquisition', 'leads'], [c.name]], title: c.name};
}

/* ---------- list actions ---------- */
A.laGoCampaigns = () => { setv('laTab', 'campaigns'); go('leads'); };
A.laF = (v, d, el) => { const f = F(); f[d.k] = el && el.type === 'checkbox' ? el.checked : v; f.page = 0; rerender(); };
A.laQ = v => { F().q = v; F().page = 0; clearTimeout(A.laQ.t); A.laQ.t = setTimeout(() => { rerender(); const i = document.getElementById('la-q'); if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); };
A.laReset = () => { UI.v.laF = null; rerender(); };
A.laChip = d => { const c = (W.LA_CHIPS || []).find(x => x[0] === d.id); if(c){ c[3](); F().page = 0; rerender(); } };
A.laPage = d => { F().page += +d.n; rerender(); };
A.laSel = (v, d, el) => { const s = UI.v.laSel || (UI.v.laSel = new Set()); el.checked ? s.add(d.id) : s.delete(d.id); rerender(); };
A.laSelAll = (v, d, el) => { const s = UI.v.laSel || (UI.v.laSel = new Set()); const f = F(); filtered().slice(f.page * PAGE, f.page * PAGE + PAGE).forEach(l => el.checked ? s.add(l.id) : s.delete(l.id)); rerender(); };
A.laSelNone = () => { UI.v.laSel = new Set(); rerender(); };
A.laBulk = d => { const ids = Array.from(UI.v.laSel || []); if(d.s === 'Do not contact') return confirmBox({title: `Mark ${ids.length} as do not contact?`, text: 'They are added to the permanent do-not-contact list and the engine will never bring them back.', ok: 'Do not contact', danger: true, onOk: () => { ids.forEach(id => dnc(lead(id), 'Marked do not contact (bulk)')); UI.v.laSel = new Set(); commit(`${ids.length} marked do not contact`); }});
  ids.forEach(id => { const l = lead(id); if(l && reviewOf(l) !== 'Transferred') setReview(l, d.s); }); UI.v.laSel = new Set(); commit(`${ids.length} updated`); };
A.laBulkEnrich = () => { const ids = Array.from(UI.v.laSel || []); ids.forEach(id => { const l = lead(id); if(l){ l.enrichRequested = true; } }); UI.v.laSel = new Set(); log(`Approved enrichment for ${ids.length} prospect(s)`, null, 'leads', 'note'); commit('Enrichment approved. It runs on the next engine pass, within your budget.'); };
A.laBulkDel = () => { const ids = Array.from(UI.v.laSel || []); confirmBox({title: `Delete ${ids.length} prospect(s)?`, text: 'Deleted prospects can be found again by a later campaign. To stop a business coming back, use “Unsuitable” or “Do not contact” instead.', ok: 'Delete', danger: true, onOk: () => { DB.acqLeads = DB.acqLeads.filter(l => !ids.includes(l.id)); UI.v.laSel = new Set(); audit('Deleted prospects', ids.join(', ')); commit('Deleted'); }}); };
function setReview(l, s){ l.review = {status: s, by: DB.me, at: nowStamp()}; l.updatedAt = new Date().toISOString(); }

/* ---------- detail actions ---------- */
A.laCopy = d => { (navigator.clipboard ? navigator.clipboard.writeText(d.v) : Promise.reject()).then(() => toast('Copied'), () => toast(d.v)); };
A.laMore = (d, el) => { const l = lead(d.id); popover(el, `<div class="menu">
  <button data-a="laStatus" data-id="${l.id}" data-s="Reviewed">${ic('eye', 14)}Mark reviewed</button><button data-a="laStatus" data-id="${l.id}" data-s="Approved for contact">${ic('check', 14)}Approve for contact</button>
  <button data-a="laStatus" data-id="${l.id}" data-s="Unsuitable">${ic('thumbs-down', 14)}Mark unsuitable</button>${l.enrichment && l.enrichment.status !== 'Enriched' ? `<button data-a="laEnrich" data-id="${l.id}">${ic('coins', 14)}Approve enrichment</button>` : ''}
  <button data-a="laRescore" data-id="${l.id}">${ic('refresh-cw', 14)}Recalculate score</button><div class="sep"></div>
  <button data-a="laDnc" data-id="${l.id}" style="color:var(--red)">${ic('ban', 14)}Do not contact this business</button>${W.can && can('delete_data') ? `<button data-a="laDelete" data-id="${l.id}" style="color:var(--red)">${ic('trash-2', 14)}Delete</button>` : ''}</div>`, {w: 250}); };
A.laStatus = d => { closePop(); const l = lead(d.id); setReview(l, d.s); log(`${esc(l.company.name)} marked ${d.s.toLowerCase()}`, null, 'leads-' + l.id, 'note'); commit('Updated'); };
A.laRescore = d => { closePop(); const l = lead(d.id); rescore(l); commit('Score recalculated'); };
A.laEnrich = d => { closePop(); const l = lead(d.id); l.enrichRequested = true; log(`Approved enrichment for ${esc(l.company.name)}`, null, 'leads-' + l.id, 'note'); commit('Approved. The engine looks it up on its next run.'); };
A.laDelete = d => { closePop(); const l = lead(d.id); confirmBox({title: 'Delete this prospect?', text: 'A later campaign may find it again. Use “Unsuitable” or “Do not contact” to stop that.', ok: 'Delete', danger: true, onOk: () => { DB.acqLeads = DB.acqLeads.filter(x => x.id !== l.id); audit('Deleted prospect', l.company.name); save(); go('leads'); toast('Deleted'); }}); };
function dnc(l, reason){
  if(!l) return; setReview(l, 'Do not contact');
  (l.contacts || []).forEach(c => { c.dnc = true; c.permission = 'Do not contact'; });
  addSuppression(LE.suppressionKeys(l), reason, l.id);
  audit('Do not contact', l.company.name + ': ' + reason);
}
A.laDnc = d => { closePop(); const l = lead(d.id); confirmBox({title: `Never contact ${esc(l.company.name)}?`, text: 'The business, its numbers and every email address are added to the permanent do-not-contact list. The engine will not bring them back, and they can’t be approved into the pipeline.', ok: 'Do not contact', danger: true, onOk: () => { dnc(l, 'Marked by ' + uname(DB.me)); commit('Added to the do-not-contact list'); }}); };
A.laDncContact = d => { const l = lead(d.id), c = (l.contacts || []).find(x => x.id === d.c); confirmBox({title: `Never contact ${esc(c.name || c.email || 'this person')}?`, text: 'Their email and numbers are added to the permanent do-not-contact list.', ok: 'Do not contact', danger: true, onOk: () => { c.dnc = true; c.permission = 'Do not contact'; addSuppression([c.email && 'email:' + c.email.toLowerCase(), ...(c.phones || []).map(p => p.e164 && 'phone:' + p.e164)], 'Contact objected / marked by ' + uname(DB.me), l.id); rescore(l); commit('Added to the do-not-contact list'); }}); };
A.laClear = d => { const l = lead(d.id), c = l.contacts.find(x => x.id === d.c); confirmBox({title: 'Mark compliance review as done?', text: 'Confirm you have checked that contacting this person for marketing is lawful (e.g. it is a business address and the sector rules allow it). This is recorded in the audit log.', ok: 'Reviewed', onOk: () => { c.complianceCleared = {by: DB.me, at: nowStamp()}; c.permission = LE.defaultPermission(c, l, cfg()); audit('Compliance review completed', l.company.name + ' · ' + (c.email || c.name)); commit('Recorded'); }}); };
A.laScript = d => { const l = lead(d.id), c = (l.contacts || []).find(x => x.id === d.c) || LE.bestContact(l); const t = LE.callScript(l, c, sender());
  const ph = (c && (c.phones || [])[0]) || bestPhone(l);
  modal({title: 'Call script', size: 'lg', body: `<div class="callout" style="margin-bottom:12px">${ic('info', 15)}<span>Calls are made by you, personally, never by an automatic dialler. If the person objects, stop and mark them “Do not contact”.</span></div><pre class="la-pre">${esc(t)}</pre>`, foot: `<button class="btn" data-a="laCopy" data-v="${esc(t)}">${ic('copy', 14)}Copy</button>${ph ? `<a class="btn pri" href="tel:${ph.e164}">${ic('phone-call', 14)}Call now</a>` : ''}`}); };
A.laDraft = d => {
  const l = lead(d.id), c = l.contacts.find(x => x.id === d.c); ensureTokens(l);
  const perm = c.permission || LE.defaultPermission(c, l, cfg()); const me_ = sender(); const opt = optUrl(c);
  if(['Opted out', 'Do not contact'].includes(perm)) return toast('This person must not be contacted.', 'err');
  if(perm === 'Compliance review required') return toast('Complete the compliance review for this contact first.', 'err');
  if(perm === 'Consent required') return toast('A consent request was already sent. POPIA allows one request: wait for their reply, then record their consent.', 'err');
  const isConsent = perm !== 'Permission confirmed';
  const m = isConsent ? LE.consentRequest(l, c, me_, opt) : LE.outreachDraft(l, c, me_, opt);
  const warn = !me_.name || !me_.email ? `<div class="callout amber" style="margin-bottom:12px">${ic('alert-triangle', 15)}<span>Add your sender name and email under <b>Providers & budget → Sender identity</b> so every message identifies you.</span></div>` : '';
  const noOpt = !opt ? `<div class="callout amber" style="margin-bottom:12px">${ic('alert-triangle', 15)}<span>No opt-out link is set up yet, so the message relies on “reply STOP”. Add the n8n opt-out URL under Providers & budget.</span></div>` : '';
  modal({title: isConsent ? 'Consent request (one per person)' : 'Outreach email', size: 'lg', body: `${warn}${noOpt}<div class="callout ${isConsent ? 'cyan' : 'green'}" style="margin-bottom:12px">${ic(isConsent ? 'shield' : 'badge-check', 15)}<span>${isConsent ? 'POPIA section 69 lets you ask for consent once. Send it yourself, then click <b>Mark as sent</b>; the CRM will block a second request.' : 'This person gave permission on ' + esc(fmtD(String((c.consent || {}).at || '').slice(0, 10))) + '. Nothing is sent automatically.'}</span></div>
    ${field('To', `<input class="inp" value="${esc(c.email)}" readonly>`)}${field('Subject', `<input class="inp" id="la-sub" value="${esc(m.subject)}">`)}<div class="field mt-12"><label>Message</label><textarea class="ta" id="la-body" style="min-height:280px">${esc(m.body)}</textarea></div>`,
    foot: `<button class="btn" data-a="laMail" data-to="${esc(c.email)}">${ic('external-link', 14)}Open in my email app</button>${isConsent ? `<button class="btn pri" data-a="laSent" data-id="${l.id}" data-c="${c.id}">${ic('check', 14)}Mark as sent</button>` : `<button class="btn pri" data-a="laSentMk" data-id="${l.id}" data-c="${c.id}">${ic('check', 14)}Log as sent</button>`}`});
};
A.laMail = d => { const s = document.getElementById('la-sub').value, b = document.getElementById('la-body').value; location.href = `mailto:${encodeURIComponent(d.to)}?subject=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`; };
A.laSent = d => { const l = lead(d.id), c = l.contacts.find(x => x.id === d.c); c.consentRequest = {sentAt: new Date().toISOString(), by: DB.me, channel: 'Email'}; c.permission = 'Consent required';
  (l.conversations = l.conversations || []).push({at: nowStamp(), by: DB.me, channel: 'Email', outcome: 'Consent request sent', contact: c.name || c.email, notes: document.getElementById('la-sub').value});
  if(['New', 'Reviewed', 'Approved for contact'].includes(reviewOf(l))) setReview(l, 'Contacted'); closeTop(); commit('Consent request recorded. No further requests can be sent to this person.'); };
A.laSentMk = d => { const l = lead(d.id), c = l.contacts.find(x => x.id === d.c); (l.conversations = l.conversations || []).push({at: nowStamp(), by: DB.me, channel: 'Email', outcome: 'Outreach email sent', contact: c.name || c.email, notes: document.getElementById('la-sub').value}); setReview(l, 'Contacted'); closeTop(); commit('Logged'); };
/* ---------- proposal emails (bulk or one) ---------- */
const sendLive = () => !!(W.WebsiteSync && W.WebsiteSync.connected && W.WebsiteSync.connected());
const sentToday = () => (DB.acqLeads || []).reduce((n, l) => n + (l.proposals || []).filter(p => String(p.at || '').slice(0, 10) === TODAY).length, 0);
const propCap = () => Math.max(1, +cfg().proposalDailyCap || 80);
let PROP = null;
function proposalPlan(ids){
  const sup = new Set((DB.laSuppression || []).map(s => s.value)); const me_ = sender();
  const ready = [], skipped = {};
  ids.map(lead).filter(Boolean).forEach(l => {
    ensureTokens(l); const t = LE.proposalTarget(l, cfg(), sup);
    if(!t.ok){ skipped[t.reason] = (skipped[t.reason] || 0) + 1; return; }
    const p = LE.proposal(l, t.contact, me_, {mode: t.mode, optOutUrl: optUrl(t.contact)});
    ready.push({id: l.id, contactId: t.contact.id, to: t.contact.email, p});
  });
  return {ready, skipped};
}
function openProposals(ids){
  ensure(); const plan = proposalPlan(ids); const left = Math.max(0, propCap() - sentToday());
  PROP = Object.assign(plan, {i: 0, left, sending: false});
  modal({title: 'Send proposal emails', size: 'xl', render: propBody, foot: propFoot});
}
function propFoot(){
  const n = Math.min(PROP.ready.length, PROP.left); const me_ = sender();
  const blocked = !sendLive() || !me_.name || !me_.email || !n;
  return `<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="laPropSend" ${blocked || PROP.sending ? 'disabled' : ''}>${ic('send', 14)}Send ${n} proposal${n === 1 ? '' : 's'}</button>`;
}
function propBody(){
  const P = PROP, me_ = sender(), cur = P.ready[P.i];
  const first = P.ready.filter(r => r.p.mode === 'first').length, perm = P.ready.length - first;
  const warn = [];
  if(!sendLive()) warn.push('Emails send through your n8n website workflow, which isn’t connected. Connect it under <b>Settings → Website sync</b> first.');
  if(!me_.name || !me_.email) warn.push('Add your sender name and email under <b>Lead Acquisition → Providers & budget → Sender identity</b>.');
  if(!cfg().optOutUrl) warn.push('No opt-out link is set, so emails rely on “reply STOP”. Add it under <b>Providers & budget</b>.');
  if(P.ready.length > P.left) warn.push(`Only <b>${P.left}</b> more can go out today (daily limit ${propCap()}, to protect your email reputation and Brevo’s free cap). The rest stay ready for tomorrow.`);
  const skipped = Object.entries(P.skipped);
  return `${warn.map(w => `<div class="callout amber" style="margin-bottom:10px">${ic('alert-triangle', 15)}<span>${w}</span></div>`).join('')}
    <div class="grid g-21" style="align-items:start"><div class="stack">
      ${cur ? `<div class="row between wrap" style="gap:8px;margin-bottom:8px"><div><div class="cell-t">To: ${esc(cur.to)}</div><div class="cell-s">Subject: <b>${esc(cur.p.subject)}</b></div></div>
        <div class="row" style="gap:6px"><button class="btn sm" data-a="laPropNav" data-n="-1" ${P.i ? '' : 'disabled'}>${ic('chevron-left', 13)}</button><span class="muted small">${P.i + 1} of ${P.ready.length}</span><button class="btn sm" data-a="laPropNav" data-n="1" ${P.i < P.ready.length - 1 ? '' : 'disabled'}>${ic('chevron-right', 13)}</button></div></div>
        <iframe title="Email preview" style="width:100%;height:560px;border:1px solid var(--line);border-radius:12px;background:#fff" srcdoc="${esc('<!doctype html><meta charset=utf-8><body style=margin:0>' + brand.proposalPreview(cur.p))}"></iframe>`
      : empty('mail-x', 'No one here can receive a proposal yet', 'See the reasons on the right.')}
    </div><div class="stack">
      ${card(`${ic('send', 15)} Ready to send`, `<dl class="kv" style="grid-template-columns:1fr auto"><dt>Proposals ready</dt><dd><b>${P.ready.length}</b></dd><dt>First contact (asks for a YES)</dt><dd>${first}</dd><dt>Gave permission (straight pitch)</dt><dd>${perm}</dd><dt>Sent today</dt><dd>${sentToday()} of ${propCap()}</dd></dl>
        <div id="lp-prog" class="small muted" style="margin-top:8px"></div>`)}
      ${skipped.length ? card(`${ic('filter', 15)} Skipped`, `<dl class="kv" style="grid-template-columns:1fr auto">${skipped.map(([r, n]) => `<dt>${esc(r)}</dt><dd>${n}</dd>`).join('')}</dl>`) : ''}
      ${card(`${ic('shield', 15)} How this stays POPIA-safe`, `<ul class="la-how small" style="margin:0;padding-left:18px"><li>Each email pitches the service the engine recommends for that business, with one thing we noticed.</li><li>People we haven’t contacted before get <b>one</b> email asking them to reply YES. The CRM then blocks further marketing to them until they say yes.</li><li>Every email says who you are, where we found them, links to your website and has an unsubscribe link.</li><li>Opted-out, do-not-contact and already-emailed people are skipped automatically.</li></ul>`)}
    </div></div>`;
}
A.laPropAll = () => openProposals(filtered().map(l => l.id));
A.laPropSel = () => openProposals(Array.from(UI.v.laSel || []));
A.laPropOne = d => openProposals([d.id]);
A.laPropNav = d => { PROP.i = Math.max(0, Math.min(PROP.ready.length - 1, PROP.i + (+d.n))); refreshLayers(); };
A.laPropSend = async () => {
  if(PROP.sending) return; PROP.sending = true;
  const btn = document.querySelector('[data-a="laPropSend"]'); if(btn) btn.disabled = true;
  const me_ = sender(), u = me() || {}; const list = PROP.ready.slice(0, PROP.left); let ok = 0; const fails = [];
  const prog = () => { const el = document.getElementById('lp-prog'); if(el) el.innerHTML = `Sending… <b>${ok + fails.length}</b> of ${list.length}${fails.length ? ` · ${fails.length} failed` : ''}`; };
  for(const r of list){
    prog();
    try {
      await W.WebsiteSync.post({action: 'send', to: r.to, subject: r.p.subject, text: r.p.text, cover: r.p.cover, html: brand.emailProposal(r.p), signatureAfter: true,
        fromName: `${me_.name || u.name} | ${me_.company || 'BEMO-SOLUTIONS'}`, signature: {name: me_.name || u.name, title: u.title || u.role || ''}, quote: null});
      const l = lead(r.id), c = (l.contacts || []).find(x => x.id === r.contactId); const at = new Date().toISOString();
      (l.proposals = l.proposals || []).push({at, by: DB.me, contactId: r.contactId, to: r.to, subject: r.p.subject, service: r.p.service, mode: r.p.mode});
      if(r.p.mode === 'first' && c){ c.consentRequest = {sentAt: at, by: DB.me, channel: 'Email (proposal)'}; c.permission = 'Consent required'; }
      (l.conversations = l.conversations || []).push({at: nowStamp(), by: DB.me, channel: 'Email', outcome: 'Proposal sent', contact: (c && (c.name || c.email)) || r.to, notes: `${r.p.service}: ${r.p.subject}`});
      if(['New', 'Reviewed', 'Approved for contact'].includes(reviewOf(l))) setReview(l, 'Contacted');
      l.updatedAt = at; ok++;
      if(ok % 10 === 0) save();
    } catch(e){ fails.push(r.to + ': ' + (e && e.message || 'failed')); }
    await new Promise(res => setTimeout(res, 1200));
  }
  prog(); PROP.sending = false;
  if(ok) log(`Sent ${ok} proposal email${ok === 1 ? '' : 's'}`, null, 'leads', 'note');
  UI.v.laSel = new Set(); closeTop();
  commit(fails.length ? `${ok} sent, ${fails.length} failed. The failed ones stay ready to retry.` : `${ok} proposal${ok === 1 ? '' : 's'} sent`);
  if(fails.length) console.warn('Proposal send failures', fails);
};
A.laConsent = d => { const l = lead(d.id), c = l.contacts.find(x => x.id === d.c);
  modal({title: 'Record consent', body: `<div class="form-grid">${field('Their answer', `<select class="sel" id="lc-st"><option value="given">Yes, they agreed to hear from us</option><option value="refused">No / asked not to be contacted</option></select>`, 'span2')}${field('How they said it', `<select class="sel" id="lc-src">${opts(['Replied to consent email', 'Phone call', 'In person / meeting', 'Website form', 'WhatsApp'])}</select>`)}${field('Date', `<input class="inp" type="date" id="lc-dt" value="${TODAY}">`)}${field('Notes (what exactly they agreed to)', `<textarea class="ta" id="lc-n"></textarea>`, 'span2')}</div>`,
    foot: `<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="laConsentSave" data-id="${l.id}" data-c="${c.id}">Save</button>`}); };
A.laConsentSave = d => { const l = lead(d.id), c = l.contacts.find(x => x.id === d.c); const st = val('lc-st');
  c.consent = {status: st, source: val('lc-src'), at: val('lc-dt'), notes: val('lc-n'), by: DB.me};
  (l.consentLog = l.consentLog || []).push(Object.assign({contact: c.email || c.name}, c.consent));
  if(st === 'refused'){ c.optOut = true; c.permission = 'Opted out'; addSuppression([c.email && 'email:' + c.email.toLowerCase(), ...(c.phones || []).map(p => p.e164 && 'phone:' + p.e164)], 'Refused consent (' + val('lc-src') + ')', l.id); }
  else c.permission = 'Permission confirmed';
  audit('Consent recorded', `${l.company.name} · ${c.email || c.name}: ${st}`); rescore(l); closeTop(); commit(st === 'given' ? 'Consent recorded' : 'Recorded and added to the do-not-contact list'); };
A.laAddContact = d => modal({title: 'Add a person', body: `<div class="form-grid">${field('Name', `<input class="inp" id="ac-n">`)}${field('Job title', `<input class="inp" id="ac-t" placeholder="e.g. Practice Manager">`)}${field('Business email', `<input class="inp" id="ac-e" type="email">`)}${field('Phone', `<input class="inp" id="ac-p">`)}${field('Where you got it', `<input class="inp" id="ac-s" placeholder="e.g. Receptionist on the phone, business card">`, 'span2')}</div>`, foot: `<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="laAddContactSave" data-id="${d.id}">Add</button>`});
A.laAddContactSave = d => { const l = lead(d.id); if(!val('ac-n') && !val('ac-e')) return toast('Add a name or email', 'err'); if(!val('ac-s')) return toast('Say where the details came from', 'err');
  const e = val('ac-e').toLowerCase(); if(e && (DB.laSuppression || []).some(s => s.value === 'email:' + e)) return toast('That email is on the do-not-contact list', 'err');
  const c = {name: val('ac-n'), title: val('ac-t'), email: e, emailStatus: e ? 'unknown' : '', phones: val('ac-p') ? [LE.makePhone(val('ac-p'), 'Unverified number', val('ac-s'))] : [], source: val('ac-s'), collectedAt: new Date().toISOString(), purpose: 'B2B prospecting for BEMO-SOLUTIONS services'};
  l.contacts = LE.mergeContacts(l.contacts, [c]); ensureTokens(l); l.sources.push({field: 'contact', provider: 'Manual entry: ' + val('ac-s'), at: new Date().toISOString(), ref: null}); rescore(l); closeTop(); commit('Person added'); };
A.laNote = d => modal({title: 'Add a note', body: `<textarea class="ta" id="ln-t" style="min-height:120px"></textarea>`, foot: `<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="laNoteSave" data-id="${d.id}">Save</button>`});
A.laNoteSave = d => { const t = val('ln-t'); if(!t) return; const l = lead(d.id); (l.notes = l.notes || []).push({text: t, by: DB.me, at: nowStamp()}); closeTop(); commit('Note added'); };
A.laConv = d => { const l = lead(d.id);
  modal({title: 'Record a conversation', body: `<div class="form-grid">${field('How', `<select class="sel" id="cv-ch">${opts(['Call', 'Email', 'Meeting', 'WhatsApp'])}</select>`)}${field('With', `<select class="sel" id="cv-w">${opts(['Reception / switchboard'].concat((l.contacts || []).filter(c => c.name || c.email).map(c => c.name || c.email)))}</select>`)}
    ${field('What happened', `<select class="sel" id="cv-o">${opts(['Interested', 'Asked to call back', 'Sent information', 'Not interested right now', 'No answer / voicemail', 'Asked not to be contacted'])}</select>`, 'span2')}${field('Notes', `<textarea class="ta" id="cv-n"></textarea>`, 'span2')}${field('Follow up on (creates a reminder)', `<input class="inp" type="date" id="cv-f">`)}</div>`,
    foot: `<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="laConvSave" data-id="${l.id}">Save</button>`}); };
A.laConvSave = d => { const l = lead(d.id); const o = val('cv-o'); const x = {at: nowStamp(), by: DB.me, channel: val('cv-ch'), contact: val('cv-w'), outcome: o, notes: val('cv-n')};
  (l.conversations = l.conversations || []).push(x);
  if(o === 'Asked not to be contacted'){ dnc(l, 'Objected during ' + x.channel.toLowerCase() + ' with ' + uname(DB.me)); closeTop(); commit('Recorded and added to the do-not-contact list'); return; }
  if(o === 'Not interested right now') setReview(l, 'Reviewed'); else if(reviewOf(l) !== 'Meeting booked') setReview(l, 'Contacted');
  const fu = val('cv-f');
  if(fu){ DB.reminders = DB.reminders || []; DB.reminders.push({id: nextId('R-', DB.reminders.concat(DB.retainers || [])), title: `Follow up: ${l.company.name} (${o.toLowerCase()})`, kind: 'custom', ref: 'leads-' + l.id, owner: DB.me, due: fu, repeat: 0, status: 'Open', created: nowStamp(), createdBy: DB.me, history: []}); }
  closeTop(); commit(o === 'Interested' ? 'Recorded. Book a meeting while they’re keen.' : 'Recorded');
};
A.laMeet = d => { const l = lead(d.id); const p = bestPhone(l), c = LE.bestContact(l);
  if(!W.calOpenBooking) return toast('The team calendar is not available', 'err');
  W.calOpenBooking({kind: 'meeting', leadId: l.id, title: 'Intro call: ' + l.company.name, notes: [c && c.name, p && LE.fmtPhone(p.e164), c && c.email].filter(Boolean).join(' · '), people: [DB.me]}); };
W.onLeadMeeting = (id, ev) => { const l = lead(id); if(!l) return; (l.meetings = l.meetings || []).push({eventId: ev.id, date: ev.date, time: ev.time, by: DB.me}); if(reviewOf(l) !== 'Transferred') setReview(l, 'Meeting booked');
  (l.conversations = l.conversations || []).push({at: nowStamp(), by: DB.me, channel: 'Meeting', outcome: 'Meeting booked for ' + fmtD(ev.date) + (ev.time ? ' ' + ev.time : ''), contact: ''}); };

/* ---------- approve into the existing pipeline ---------- */
function findClient(l){
  const d = LE.normDomain(l.company.website || l.company.domain), n = LE.normName(l.company.name);
  const emails = (l.contacts || []).map(c => (c.email || '').toLowerCase()).filter(Boolean); const phones = phonesOf(l).map(p => p.e164);
  return DB.clients.find(c => (d && LE.normDomain(c.website) === d) || LE.normName(c.name) === n || (c.email && emails.includes(c.email.toLowerCase())) || (c.phone && phones.includes(LE.normPhone(c.phone).e164)));
}
A.laTransfer = d => {
  const l = lead(d.id);
  if(l.transfer && l.transfer.clientId && get.client(l.transfer.clientId)) return go('client-' + l.transfer.clientId);
  if(['Do not contact', 'Unsuitable'].includes(reviewOf(l))) return toast('This prospect is marked ' + reviewOf(l).toLowerCase() + '.', 'err');
  const ex = findClient(l); const best = LE.bestContact(l); const usable = (l.contacts || []).filter(c => !c.dnc && !c.optOut && (c.name || c.email));
  confirmBox({title: ex ? `Link to existing client ${esc(ex.name)}?` : `Create ${esc(l.company.name)} as a client?`,
    text: ex ? `This business already exists in the CRM, so no duplicate is created. Missing contacts (${usable.length}) and the research notes are added to <b>${esc(ex.name)}</b>.` : `A client record is created at <b>${(l.meetings || []).length ? 'Discovery scheduled' : 'Contacted'}</b> in your pipeline, with ${usable.length} contact(s), the audit findings and the sources. Everything after this uses your normal CRM process.`,
    ok: ex ? 'Link and transfer' : 'Create client', onOk: () => transfer(l, ex, best, usable)});
};
function transfer(l, ex, best, usable){
  const c = l.company; const o = l.opportunity || {}; const p = bestPhone(l);
  let cl = ex;
  const toContact = x => ({name: x.name || x.email, title: x.title || '', email: x.email || '', phone: (x.phones || [])[0] ? LE.fmtPhone(x.phones[0].e164) : '', permission: x.permission || ''});
  if(!cl){
    const main = best && !best.dnc && !best.optOut ? best : usable[0];
    cl = {id: nextId('C-', DB.clients), name: c.name, contact: main ? (main.name || '') : '', title: main ? (main.title || '') : '', email: main ? (main.email || '') : ((c.email || {}).value || ''), phone: p ? LE.fmtPhone(p.e164) : '', whatsapp: '',
      industry: (IND[l.industry] || IND.other).label, size: c.size ? String(c.size) : '—', location: [c.city, c.province].filter(Boolean).join(', ') || '—', website: c.website || '—', source: 'Lead Acquisition',
      owner: DB.me, assistant: DB.me, status: (l.meetings || []).length ? 'Discovery scheduled' : 'Contacted', ies: 1, created: TODAY, lastContact: (l.conversations || []).length ? String(l.conversations[l.conversations.length - 1].at).slice(0, 10) : null,
      nextFollowUp: addDays(TODAY, 2), notes: o.narrative || (o.observations || []).slice(0, 3).join(' '), contacts: usable.filter(x => x !== main).map(toContact), leadId: l.id};
    DB.clients.push(cl);
    log(`New client <b>${esc(cl.name)}</b> from Lead Acquisition`, cl.id, 'client-' + cl.id, 'status');
  } else {
    cl.contacts = cl.contacts || [];
    usable.forEach(x => { if(!cl.contacts.some(y => (x.email && y.email && y.email.toLowerCase() === x.email.toLowerCase()) || (x.name && y.name === x.name)) && !(cl.email && x.email && cl.email.toLowerCase() === x.email.toLowerCase())) cl.contacts.push(toContact(x)); });
    log(`Lead Acquisition research added to <b>${esc(cl.name)}</b>`, cl.id, 'client-' + cl.id, 'note');
  }
  const note = [`Lead Acquisition summary (${l.id}, score ${scoreOf(l)} · ${(l.score || {}).category || ''})`, '',
    'Observed:', ...(o.observations || []).map(x => '- ' + x), '', 'Suggested services:', ...((o.aiServices && o.aiServices.length ? o.aiServices.map(x => ({name: x.service, why: x.why})) : o.services) || []).map(x => `- ${x.name}: ${x.why}`),
    o.angle ? '\nConversation angle: ' + o.angle : '', '', 'Contact permissions:', ...(l.contacts || []).filter(x => x.email || x.name).map(x => `- ${x.name || x.email}: ${x.permission || '—'}`),
    '', 'Sources: ' + uniq((l.sources || []).map(s => s.provider)).join(', '), ...(l.conversations || []).map(x => `\n${x.at} ${x.channel}: ${x.outcome}${x.notes ? ' (' + x.notes + ')' : ''}`)].join('\n');
  DB.notes.push({id: nextId('NT-', DB.notes), clientId: cl.id, by: DB.me, at: nowStamp(), text: note});
  DB.tasks.push({id: nextId('T-', DB.tasks), title: `Follow up with ${cl.name}${best && best.name ? ' (' + best.name + ')' : ''}`, projectId: '', workstream: 'Client follow-up', assignee: DB.me, pool: null, created: nowStamp(), assignedBy: DB.me, reviewer: null, priority: scoreOf(l) >= 85 ? 'High' : 'Medium', status: 'To do', start: TODAY, due: addDays(TODAY, 2), est: 0.5, description: `From Lead Acquisition ${l.id}. ${o.angle || ''}`, deps: [], attachments: [], comments: [], clientId: cl.id});
  (DB.events || []).filter(e => e.leadId === l.id && !e.clientId).forEach(e => { e.clientId = cl.id; });
  l.transfer = {clientId: cl.id, at: nowStamp(), by: DB.me, linkedExisting: !!ex}; setReview(l, 'Transferred');
  audit('Prospect transferred to pipeline', `${l.company.name} → ${cl.id}`);
  save(); go('client-' + cl.id); toast(ex ? 'Linked to the existing client' : 'Client created in your pipeline');
}

/* ---------- add / import ---------- */
function newLead(fields, source){
  const ind = IND[fields.industry] ? fields.industry : 'other'; const now = new Date().toISOString();
  const l = {industry: ind, company: {name: fields.name.trim(), website: fields.website || null, domain: LE.normDomain(fields.website) || null, industry: ind, category: IND[ind].label, city: fields.city || '', province: fields.province || LE.provinceOf(fields.city || ''), address: fields.address || null,
    phone: fields.phone ? LE.makePhone(fields.phone, 'Unverified number', source) : null, email: fields.email ? {value: fields.email.toLowerCase(), status: 'published', source} : null},
    contacts: [], sources: [{field: 'company', provider: source, at: now, ref: fields.ref || null, usage: fields.usage || 'Entered by the team'}], website: fields.website ? {status: 'Website found', url: fields.website, checkedAt: null, confidence: 'Low', notes: 'Not audited yet. The engine audits it when it next refreshes this business.'} : LE.auditWebsite(null),
    createdAt: now, review: {status: 'New'}, campaignId: null};
  if(fields.email) l.contacts.push({name: '', title: LE.isGenericEmail(fields.email) ? 'General business inbox' : '', email: fields.email.toLowerCase(), emailStatus: 'unknown', phones: [], source, collectedAt: now, purpose: 'B2B prospecting for BEMO-SOLUTIONS services'});
  if(fields.contactName || fields.contactEmail) l.contacts.push({name: fields.contactName || '', title: fields.contactTitle || '', email: (fields.contactEmail || '').toLowerCase(), emailStatus: fields.contactEmail ? 'unknown' : '', phones: fields.contactPhone ? [LE.makePhone(fields.contactPhone, 'Unverified number', source)] : [], source, collectedAt: now, purpose: 'B2B prospecting for BEMO-SOLUTIONS services'});
  l.contacts = LE.mergeContacts([], l.contacts); ensureTokens(l);
  l.dedupeKey = LE.dedupeKey(l.company); l.nameKey = LE.normName(l.company.name) + '|' + String(l.company.city || '').toLowerCase();
  rescore(l); return l;
}
function blockedReason(l){
  const S = new Set((DB.laSuppression || []).map(s => s.value));
  if(LE.suppressionKeys({company: l.company, contacts: []}).some(k => S.has(k))) return 'on the do-not-contact list';
  const dup = (DB.acqLeads || []).find(x => x.dedupeKey === l.dedupeKey || (l.company.domain && x.company.domain === l.company.domain));
  if(dup) return 'already in Lead Acquisition (' + dup.id + ')';
  return null;
}
const nextLeadId = () => nextId('AQM-', DB.acqLeads.filter(x => /^AQM-/.test(x.id)));
A.laAdd = () => { ensure(); modal({title: 'Add a prospect', size: 'lg', body: `<div class="form-grid">${field('Business name *', `<input class="inp" id="la-n">`, 'span2')}${field('Industry', `<select class="sel" id="la-i">${opts(Object.keys(IND).map(k => [k, IND[k].label]), 'other')}</select>`)}${field('Town / city', `<input class="inp" id="la-c" list="la-cities"><datalist id="la-cities">${Object.keys(LE.CITY_COORDS).map(c => `<option value="${c}">`).join('')}</datalist>`)}
  ${field('Website', `<input class="inp" id="la-w" placeholder="www.example.co.za">`)}${field('Business phone', `<input class="inp" id="la-p">`)}${field('Business email', `<input class="inp" id="la-e" type="email">`)}${field('Address', `<input class="inp" id="la-a">`)}
  ${field('Contact person', `<input class="inp" id="la-cn">`)}${field('Their job title', `<input class="inp" id="la-ct">`)}${field('Where did this come from? *', `<input class="inp" id="la-s" placeholder="e.g. Referral from a client, networking event, company website">`, 'span2')}</div>`,
  foot: `<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="laAddSave">Add prospect</button>`}); };
A.laAddSave = () => { if(!requireFields([['la-n', 'Business name'], ['la-s', 'Source']])) return;
  const l = newLead({name: val('la-n'), industry: val('la-i'), city: val('la-c'), website: val('la-w'), phone: val('la-p'), email: val('la-e'), address: val('la-a'), contactName: val('la-cn'), contactTitle: val('la-ct')}, 'Manual entry: ' + val('la-s'));
  const why = blockedReason(l); if(why) return toast('Not added: this business is ' + why + '.', 'err');
  l.id = nextLeadId(); DB.acqLeads.push(l); log(`Added prospect <b>${esc(l.company.name)}</b>`, null, 'leads-' + l.id, 'note'); closeTop(); save(); go('leads-' + l.id); toast('Prospect added'); };
A.laImport = () => modal({title: 'Import prospects (CSV)', body: `<p class="sub" style="margin-bottom:10px">Use a file you are allowed to use for prospecting. Columns (first row): <span class="mono xs">name, industry, city, province, website, phone, email, contact_name, contact_title, contact_email, contact_phone</span>.</p>${field('Where did this list come from? *', `<input class="inp" id="li-s" placeholder="e.g. Law Society directory export (permitted use)">`)}<div class="field mt-12"><label>CSV file</label><input type="file" accept=".csv,text/csv" id="li-f" class="inp"></div><p class="muted xs mt-8">Businesses already in the list or on the do-not-contact list are skipped.</p>`, foot: `<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="laImportRun">Import</button>`});
function parseCsv(t){ const rows = []; let row = [], cur = '', q = false; for(let i = 0; i < t.length; i++){ const ch = t[i]; if(q){ if(ch === '"'){ if(t[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += ch; } else if(ch === '"') q = true; else if(ch === ','){ row.push(cur); cur = ''; } else if(ch === '\n' || ch === '\r'){ if(ch === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch; } if(cur || row.length){ row.push(cur); rows.push(row); } return rows.filter(r => r.some(x => x.trim())); }
A.laImportRun = () => { const f = document.getElementById('li-f').files[0]; if(!requireFields([['li-s', 'Source']])) return; if(!f) return toast('Choose a CSV file', 'err');
  const src = val('li-s'); const r = new FileReader();
  r.onload = () => { const rows = parseCsv(String(r.result)); const head = (rows.shift() || []).map(h => h.trim().toLowerCase().replace(/\s+/g, '_')); const g = (row, k) => (row[head.indexOf(k)] || '').trim();
    let added = 0, skipped = 0; const indKey = s => Object.keys(IND).find(k => k === s.toLowerCase() || IND[k].label.toLowerCase().includes(s.toLowerCase())) || 'other';
    rows.forEach(row => { const name = g(row, 'name') || g(row, 'company'); if(!name){ skipped++; return; }
      const l = newLead({name, industry: indKey(g(row, 'industry') || 'other'), city: g(row, 'city'), province: g(row, 'province'), website: g(row, 'website'), phone: g(row, 'phone'), email: g(row, 'email'), contactName: g(row, 'contact_name'), contactTitle: g(row, 'contact_title'), contactEmail: g(row, 'contact_email'), contactPhone: g(row, 'contact_phone')}, 'CSV import: ' + src);
      if(blockedReason(l)){ skipped++; return; } l.id = nextLeadId(); DB.acqLeads.push(l); added++; });
    log(`Imported ${added} prospects (${src})`, null, 'leads', 'note'); closeTop(); commit(`${added} imported, ${skipped} skipped`); };
  r.readAsText(f); };

/* ---------- campaigns ---------- */
const SIZES = [['1,10', '1–10'], ['11,50', '11–50'], ['51,200', '51–200'], ['201,500', '201–500']];
const SRC = [['osm', 'OpenStreetMap'], ['maps', 'Google Maps'], ['web', 'Web search'], ['apollo', 'Apollo (optional)']];
const EXAMPLES = {
  A: {name: 'Law firms · Gauteng', industries: ['law'], provinces: ['Gauteng'], cities: [], sizes: ['1,10', '11,50', '51,200'], websiteFilter: 'any', titles: ['owner', 'managing partner', 'practice manager'], minScore: 70},
  B: {name: 'Accounting · Free State (weak websites)', industries: ['accounting'], provinces: ['Free State'], cities: [], sizes: [], websiteFilter: 'outdated', titles: ['owner', 'managing partner'], minScore: 60},
  C: {name: 'Logistics · KwaZulu-Natal', industries: ['logistics'], provinces: ['KwaZulu-Natal'], cities: [], sizes: [], websiteFilter: 'any', titles: ['operations manager', 'operations director'], minScore: 70}
};
function campaignsTab(){
  const list = DB.laCampaigns || [];
  return `<div class="row between wrap" style="margin-bottom:14px;gap:10px"><p class="sub">Each campaign tells the engine what to look for. It runs on its schedule, never finds the same business twice, and only spends credits on promising prospects.</p><button class="btn pri" data-a="laCamp">${ic('plus', 14)}New campaign</button></div>
    ${list.length ? `<div class="grid g2">${list.map(c => { const st = c.lastStats || {}; return card(`${esc(c.name)} ${badge(c.status || 'Paused', c.status === 'Active' ? 'green' : 'gray')}`,
      `<dl class="kv" style="grid-template-columns:110px 1fr"><dt>Industries</dt><dd>${esc((c.industries || []).map(i => (IND[i] || {}).label || i).join(', ') || '—')}</dd><dt>Area</dt><dd>${esc((c.cities || []).length ? c.cities.join(', ') : (c.provinces || []).length ? c.provinces.join(', ') : 'Nationwide')}</dd>
       <dt>Looking for</dt><dd>${esc({any: 'Any website', none: 'No website found', outdated: 'No or outdated website', has: 'Has a website'}[c.websiteFilter || 'any'])} · score ${c.minScore || 0}+ · ${c.quantity || 25} per run</dd><dt>Decision-makers</dt><dd>${esc((c.titles || []).join(', ') || 'Industry defaults')}</dd>
       <dt>Sources</dt><dd>${esc(LE.campaignSources(c).map(s => (SRC.find(x => x[0] === s) || [s, s])[1]).join(', '))}</dd><dt>Schedule</dt><dd>Every ${c.everyHours || 24} hours</dd>
       <dt>Last run</dt><dd>${c.lastRun ? fmtDT(String(c.lastRun).replace(' ', 'T').slice(0, 16)) + ` · ${st.created || 0} new, ${st.updated || 0} refreshed, ${st.known || 0} already known${(st.towns || []).length ? ' · ' + esc(st.towns.join(', ')) : ''}` : '<span class="muted">Not run yet</span>'}${c.runRequested ? ' · <b>run requested</b>' : ''}</dd><dt>Found in total</dt><dd>${c.totalFound || 0}</dd></dl>`,
      {act: `<button class="btn sm" data-a="laRun" data-id="${c.id}">${ic('play', 13)}Run now</button><button class="ib sm" data-a="laCamp" data-id="${c.id}" aria-label="Edit">${ic('pencil', 14)}</button><button class="ib sm" data-a="laCampDel" data-id="${c.id}" aria-label="Delete">${ic('trash-2', 14)}</button>`}); }).join('')}</div>`
    : card(null, empty('radar', 'No campaigns yet', 'Start from an example or build your own.', `<div class="row wrap" style="gap:6px;justify-content:center">${Object.keys(EXAMPLES).map(k => `<button class="btn sm" data-a="laCamp" data-ex="${k}">${esc(EXAMPLES[k].name)}</button>`).join('')}</div>`))}`;
}
let CF = null;
A.laCamp = d => {
  const ex = d.id ? (DB.laCampaigns || []).find(c => c.id === d.id) : null;
  CF = JSON.parse(JSON.stringify(ex || Object.assign({name: '', status: 'Active', industries: [], provinces: [], cities: [], keywords: [], sizes: [], websiteFilter: 'any', titles: [], minScore: 50, quantity: 25, townsPerRun: 3, radiusKm: 15, sources: LE.DEFAULT_SOURCES.slice(), everyHours: 24}, d.ex ? EXAMPLES[d.ex] : {})));
  CF.sources = LE.campaignSources(CF);
  modal({title: ex ? 'Edit campaign' : 'New campaign', size: 'xl', render: campForm, foot: `<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="laCampSave" data-id="${ex ? ex.id : ''}">${ex ? 'Save' : 'Create and run'}</button>`});
};
function campForm(){
  const c = CF; const chk = (key, val_, label, on) => `<label class="chk la-pill"><input type="checkbox" data-ch="laCF" data-k="${key}" data-v="${esc(val_)}" ${on ? 'checked' : ''}>${esc(label)}</label>`;
  const cityList = (c.provinces.length ? c.provinces : PROV).flatMap(p => LE.PROVINCES[p]);
  return `<div class="form-grid">${field('Campaign name *', `<input class="inp" id="cf-name" value="${esc(c.name)}" data-in="laCFv" data-k="name">`, 'span2')}
    <div class="field span2"><label>Industries *</label><div class="la-pills">${Object.keys(IND).map(k => chk('industries', k, IND[k].label, c.industries.includes(k))).join('')}</div></div>
    <div class="field span2"><label>Provinces <span class="muted xs">(none = nationwide)</span></label><div class="la-pills">${PROV.map(p => chk('provinces', p, p, c.provinces.includes(p))).join('')}</div></div>
    <div class="field span2"><label>Towns <span class="muted xs">(optional: narrows to these towns)</span></label><div class="la-pills">${cityList.map(t => chk('cities', t, t, c.cities.includes(t))).join('')}</div></div>
    ${field('Extra search keywords', `<input class="inp" id="cf-kw" value="${esc((c.keywords || []).join(', '))}" placeholder="e.g. conveyancing, family law" data-in="laCFv" data-k="keywords">`)}
    ${field('Decision-makers to look for', `<input class="inp" id="cf-ti" value="${esc((c.titles || []).join(', '))}" placeholder="e.g. owner, managing partner, practice manager" data-in="laCFv" data-k="titles">`)}
    <div class="field"><label>Company size <span class="muted xs">(Apollo only)</span></label><div class="la-pills">${SIZES.map(s => chk('sizes', s[0], s[1], c.sizes.includes(s[0]))).join('')}</div></div>
    <div class="field"><label>Sources</label><div class="la-pills">${SRC.map(s => chk('sources', s[0], s[1], c.sources.includes(s[0]))).join('')}</div></div>
    ${field('Website', `<select class="sel" data-ch="laCFs" data-k="websiteFilter">${opts([['any', 'Any'], ['none', 'No website found'], ['outdated', 'No or outdated website'], ['has', 'Has a website']], c.websiteFilter)}</select>`)}
    ${field('Only show prospects scoring', `<select class="sel" data-ch="laCFs" data-k="minScore">${opts([[0, 'Any score'], [50, '50+'], [60, '60+'], [70, '70+'], [85, '85+']], c.minScore)}</select>`)}
    ${field('Prospects per run', `<select class="sel" data-ch="laCFs" data-k="quantity">${opts([10, 25, 50, 100], c.quantity)}</select>`)}
    ${field('Towns searched per run', `<select class="sel" data-ch="laCFs" data-k="townsPerRun">${opts([1, 2, 3, 5, 8], c.townsPerRun)}</select>`)}
    ${field('Search radius', `<select class="sel" data-ch="laCFs" data-k="radiusKm">${opts([[10, '10 km'], [15, '15 km'], [25, '25 km'], [40, '40 km']], c.radiusKm)}</select>`)}
    ${field('Run every', `<select class="sel" data-ch="laCFs" data-k="everyHours">${opts([[12, '12 hours'], [24, 'Day'], [48, '2 days'], [168, 'Week']], c.everyHours)}</select>`)}
    ${field('Status', `<select class="sel" data-ch="laCFs" data-k="status">${opts(['Active', 'Paused'], c.status)}</select>`)}</div>`;
}
A.laCF = (v, d, el) => { const arr = CF[d.k] = CF[d.k] || []; if(el.checked){ if(!arr.includes(d.v)) arr.push(d.v); } else CF[d.k] = arr.filter(x => x !== d.v); if(d.k === 'provinces') CF.cities = CF.cities.filter(t => !CF.provinces.length || CF.provinces.some(p => LE.PROVINCES[p].includes(t))); W.refreshLayers && refreshLayers(); };
A.laCFs = (v, d) => { CF[d.k] = ['minScore', 'quantity', 'townsPerRun', 'radiusKm', 'everyHours'].includes(d.k) ? +v : v; };
A.laCFv = (v, d) => { CF[d.k] = ['keywords', 'titles'].includes(d.k) ? v.split(',').map(x => x.trim().toLowerCase()).filter(Boolean) : v; };
A.laCampSave = d => {
  CF.name = val('cf-name') || CF.name; if(!CF.name) return toast('Give the campaign a name', 'err'); if(!CF.industries.length) return toast('Pick at least one industry', 'err'); if(!CF.sources.length) return toast('Pick at least one source', 'err');
  DB.laCampaigns = DB.laCampaigns || [];
  if(d.id){ const c = DB.laCampaigns.find(x => x.id === d.id); Object.assign(c, CF, {updatedAt: nowStamp()}); }
  else { const c = Object.assign(CF, {id: nextId('CP-', DB.laCampaigns), created: nowStamp(), createdBy: DB.me, runRequested: CF.status === 'Active', cursor: 0, totalFound: 0}); DB.laCampaigns.push(c); }
  closeTop(); commit(d.id ? 'Campaign saved' : 'Campaign created. The engine picks it up on its next run (every 30 minutes).');
};
A.laRun = d => { const c = DB.laCampaigns.find(x => x.id === d.id); c.runRequested = true; c.status = 'Active'; commit('Queued. The engine runs it within 30 minutes (or press “Execute workflow” in n8n).'); };
A.laCampDel = d => confirmBox({title: 'Delete this campaign?', text: 'Prospects it already found stay in the list.', ok: 'Delete', danger: true, onOk: () => { DB.laCampaigns = DB.laCampaigns.filter(c => c.id !== d.id); commit('Campaign deleted'); }});

/* ---------- providers & budget ---------- */
let STATS = null, STATS_AT = 0;
async function loadStats(){ if(!W.CRM_SB || Date.now() - STATS_AT < 30000) return; STATS_AT = Date.now(); try { const {data, error} = await W.CRM_SB.rpc('la_provider_stats'); if(!error){ STATS = data; if(ROUTE.page === 'leads' && uv('laTab') === 'providers' && !STACK.length) rerender(); } } catch(e){} }
function providersTab(){
  const L = cfg(); loadStats(); const U = (STATS && STATS.usage) || {}; const admin = !W.can || can('admin');
  const status = (p, pc) => { const u = U[p]; if(!pc.enabled) return badge('Disabled', 'gray');
    if(!W.CLOUD_ON) return badge('Shows once online', 'gray');
    if(!u) return badge('Pending: no requests yet', 'amber');
    if(u.lastError && (!u.lastOk || u.lastErrorAt > u.lastOk)) return badge(/credential|auth|401|403|invalid/i.test(u.lastError) ? 'Credentials problem' : /pending/.test(u.lastError) ? 'Credentials pending' : /limit|budget/.test(u.lastError) ? 'Limit reached' : 'Error', /pending|limit|budget/.test(u.lastError) ? 'amber' : 'red');
    return badge('Connected', 'green'); };
  const num = (p, k, w) => `<input class="inp sm num" type="number" min="0" step="${k === 'costZar' ? '0.01' : '1'}" style="width:${w || 80}px" value="${L.providers[p][k]}" data-ch="laProv" data-p="${p}" data-k="${k}" ${admin ? '' : 'disabled'}>`;
  return `<div class="grid g-21"><div class="stack">${card(`${ic('plug', 15)} Data providers`, `<div class="tw"><table class="tbl"><thead><tr><th>Provider</th><th>Status</th><th class="r">Today</th><th class="r">This month</th><th class="r">Credits</th><th class="r">Cost</th><th>Daily / monthly limit</th><th>R per credit</th><th>On</th></tr></thead><tbody>
    ${PROVIDERS.map(([p, n, desc]) => { const pc = L.providers[p], u = U[p] || {}; return `<tr><td class="wrap" style="min-width:200px"><div class="cell-t">${n}</div><div class="cell-s">${esc(desc)}</div>${u.lastOk ? `<div class="cell-s">Last success ${esc(String(u.lastOk).slice(0, 16).replace('T', ' '))}</div>` : ''}${u.lastError ? `<div class="cell-s" style="color:var(--red)">${esc(u.lastError)}</div>` : ''}</td><td>${status(p, pc)}</td>
      <td class="r num">${u.today || 0}</td><td class="r num">${u.month || 0}</td><td class="r num">${u.creditsMonth || 0}${u.remaining != null ? `<div class="cell-s">${esc(String(u.remaining))} left</div>` : ''}</td><td class="r num">${fmtR(+u.costMonth || 0, true)}</td>
      <td>${num(p, 'daily', 64)} / ${num(p, 'monthly', 74)}</td><td>${num(p, 'costZar', 70)}</td><td><label class="switch"><input type="checkbox" data-ch="laProvOn" data-p="${p}" ${pc.enabled ? 'checked' : ''} ${admin ? '' : 'disabled'}><span></span></label></td></tr>`; }).join('')}</tbody></table></div>
    <p class="muted xs" style="padding:0 20px 16px">API keys are entered in n8n only, never in the CRM. A provider without a key shows “pending” and the engine carries on with the others. Daily and monthly limits stop the engine before it goes past a free plan.</p>`, {flush: true})}
    ${card(`${ic('activity', 15)} Recent engine activity`, STATS && (STATS.recent || []).length ? `<div class="tw" style="max-height:360px;overflow:auto"><table class="tbl"><thead><tr><th>When</th><th>What</th><th>Provider</th><th>Result</th><th>Detail</th></tr></thead><tbody>${STATS.recent.map(e => `<tr><td class="small muted nowrap">${esc(String(e.at).slice(5, 16).replace('T', ' '))}</td><td class="small">${esc(e.request_type || e.kind)}</td><td class="small">${esc(e.provider || '—')}</td><td>${badge(e.status, e.status === 'ok' ? 'green' : e.status === 'skipped' ? 'gray' : /suppress|opted/.test(e.status) ? 'amber' : 'red', 'nodot')}</td><td class="wrap small muted" style="min-width:220px">${esc(e.message || '')}</td></tr>`).join('')}</tbody></table></div>` : empty('activity', W.CLOUD_ON ? 'No engine activity yet' : 'Available once the CRM is online', W.CLOUD_ON ? 'Run the n8n workflow to see requests, credits and errors here.' : 'The engine writes its activity to Supabase.'), {flush: true})}</div>
    <div class="stack">${card(`${ic('wallet', 15)} Budget & rules`, `<div class="col gap-12">
      ${field('Monthly provider budget (R)', `<input class="inp num" type="number" min="0" value="${L.monthlyBudgetZar}" data-ch="laSet" data-k="monthlyBudgetZar" ${admin ? '' : 'disabled'}><span class="muted xs">A cap on paid usage across all providers. 0 means no cap.</span>`)}
      ${field('Proposal emails per day', `<input class="inp num" type="number" min="1" max="250" value="${L.proposalDailyCap || 80}" data-ch="laSet" data-k="proposalDailyCap" ${admin ? '' : 'disabled'}><span class="muted xs">Brevo’s free plan sends 300 emails a day in total. Keep this lower so new domains build a good reputation.</span>`)}
      ${field('Look up people automatically from score', `<input class="inp num" type="number" min="0" max="100" value="${L.autoEnrichScore}" data-ch="laSet" data-k="autoEnrichScore" ${admin ? '' : 'disabled'}><span class="muted xs">Below this, credits are only spent when you approve enrichment.</span>`)}
      ${field('AI write-ups from score', `<input class="inp num" type="number" min="0" max="101" value="${L.aiMinScore}" data-ch="laSet" data-k="aiMinScore" ${admin ? '' : 'disabled'}>`)}
      ${field('Keep prospect personal data for (months)', `<input class="inp num" type="number" min="1" max="60" value="${L.retentionMonths}" data-ch="laSet" data-k="retentionMonths" ${admin ? '' : 'disabled'}>`)}
      ${field('Opt-out link (n8n "Opt-out link" production URL)', `<input class="inp" placeholder="https://your-n8n/webhook/bemo-optout" value="${esc(L.optOutUrl || '')}" data-ch="laSet" data-k="optOutUrl" ${admin ? '' : 'disabled'}>`)}</div>`)}
      ${card(`${ic('contact', 15)} Sender identity`, `<p class="muted small" style="margin-bottom:10px">Shown on every consent request and outreach email.</p><div class="col gap-12">${['name', 'company', 'email', 'phone', 'address'].map(k => field({name: 'Your name', company: 'Company', email: 'Reply email', phone: 'Phone', address: 'Physical address'}[k], `<input class="inp" value="${esc(L.sender[k] || '')}" data-ch="laSender" data-k="${k}" ${admin ? '' : 'disabled'}>`)).join('')}</div>`)}</div></div>`;
}
A.laProv = (v, d) => { cfg().providers[d.p][d.k] = Math.max(0, +v || 0); save(); };
A.laProvOn = (v, d, el) => { cfg().providers[d.p].enabled = el.checked; commit(el.checked ? 'Enabled' : 'Disabled'); };
A.laSet = (v, d) => { cfg()[d.k] = d.k === 'optOutUrl' ? String(v).trim() : Math.max(0, +v || 0); save(); toast('Saved'); };
A.laSender = (v, d) => { cfg().sender[d.k] = v; save(); };

/* ---------- suppression ---------- */
function suppressionTab(){
  const list = (DB.laSuppression || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at))); const owner = !W.can || can('admin');
  return `<div class="row between wrap" style="margin-bottom:14px;gap:10px"><p class="sub">People and businesses here are never contacted again and never re-added by the engine. Only an admin can remove an entry, and it is recorded in the audit log.</p><button class="btn" data-a="laSupAdd">${ic('plus', 14)}Add entry</button></div>
  ${card(null, list.length ? `<div class="tw"><table class="tbl"><thead><tr><th>Type</th><th>Value</th><th>Reason</th><th>Added</th><th></th></tr></thead><tbody>${list.map(s => { const [t, ...v] = String(s.value).split(':'); return `<tr><td>${badge(t, 'gray', 'nodot')}</td><td class="mono small">${esc(v.join(':'))}</td><td class="wrap small">${esc(s.reason || '')}${s.leadId ? ` · <a href="#leads-${esc(s.leadId)}">${esc(s.leadId)}</a>` : ''}</td><td class="small muted">${esc(String(s.at || '').slice(0, 10))}${s.by ? ' · ' + esc(uname(s.by)) : ''}</td><td class="r">${owner ? `<button class="ib sm" data-a="laSupDel" data-id="${esc(s.id)}" aria-label="Remove">${ic('x', 14)}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : empty('shield-check', 'Nobody on the list yet', 'Opt-outs, objections and “Do not contact” decisions land here automatically.'), {flush: true})}`;
}
A.laSupAdd = () => modal({title: 'Add to the do-not-contact list', body: `<div class="form-grid">${field('Type', `<select class="sel" id="ls-t">${opts([['email', 'Email address'], ['phone', 'Phone number'], ['domain', 'Website domain (whole business)']])}</select>`)}${field('Value', `<input class="inp" id="ls-v">`)}${field('Reason', `<input class="inp" id="ls-r" placeholder="e.g. Asked by phone not to be contacted">`, 'span2')}</div>`, foot: `<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="laSupSave">Add</button>`});
A.laSupSave = () => { const t = val('ls-t'), raw = val('ls-v'); if(!raw) return toast('Enter a value', 'err');
  const v = t === 'phone' ? LE.normPhone(raw).e164 : t === 'domain' ? LE.normDomain(raw) : raw.toLowerCase(); if(!v) return toast('That doesn’t look valid', 'err');
  addSuppression([t + ':' + v], val('ls-r') || 'Added manually'); (DB.acqLeads || []).forEach(l => { (l.contacts || []).forEach(c => { if((t === 'email' && (c.email || '').toLowerCase() === v) || (t === 'phone' && (c.phones || []).some(p => p.e164 === v))){ c.dnc = true; c.permission = 'Do not contact'; } }); if(t === 'domain' && l.company.domain === v) dnc(l, val('ls-r') || 'Domain added to list'); });
  audit('Added to do-not-contact list', t + ':' + v); closeTop(); commit('Added'); };
A.laSupDel = d => confirmBox({title: 'Remove from the do-not-contact list?', text: 'Only do this if the entry was added by mistake, or the person has since given clear permission. The removal is recorded in the audit log. People already marked “do not contact” stay marked until you change them.', ok: 'Remove', danger: true, onOk: () => { const s = DB.laSuppression.find(x => x.id === d.id); DB.laSuppression = DB.laSuppression.filter(x => x.id !== d.id); audit('Removed from do-not-contact list', s ? s.value : d.id); commit('Removed'); }});

/* ---------- connection / setup ---------- */
function setupTab(){
  const lastRun = (DB.laCampaigns || []).map(c => c.lastRun).filter(Boolean).sort().pop();
  const step = (ok, t, s) => `<div class="la-step ${ok ? 'ok' : ''}">${ic(ok ? 'check-circle-2' : 'circle', 18)}<div><b>${t}</b><div class="muted small">${s}</div></div></div>`;
  return `<div class="grid g2">${card(`${ic('workflow', 15)} Engine connection`, `<div class="col gap-12">
    ${step(W.CLOUD_ON, 'CRM is online (Supabase)', W.CLOUD_ON ? 'Connected. n8n writes prospects straight into this list.' : 'Needed for the automatic engine. Follow the Complete Setup Guide first; until then you can add and import prospects by hand.')}
    ${step(W.CLOUD_ON && !!lastRun, 'n8n engine has run', lastRun ? 'Last campaign run: ' + esc(String(lastRun).slice(0, 16).replace('T', ' ')) : 'Import the LA workflows into n8n and paste your keys (see the guide).')}
    ${step((DB.laCampaigns || []).some(c => c.status === 'Active'), 'At least one active campaign', 'Campaigns tell the engine which industries and towns to search.')}
    ${step(!!cfg().optOutUrl, 'Opt-out link set', 'Lets people remove themselves with one click (POPIA).')}
    ${step(!!(cfg().sender.name && cfg().sender.email), 'Sender identity set', 'Every message must say who it is from.')}</div>`)}
    ${card(`${ic('book-open', 15)} How it works`, `<ol class="la-how"><li><b>Discover:</b> OpenStreetMap, Google Maps and web search (Serper, with Tavily as backup) find businesses in your chosen industries and towns, with or without websites.</li><li><b>Audit:</b> each business’s public website is checked (mobile, forms, booking, portal…), respecting robots.txt.</li><li><b>Enrich:</b> for promising businesses only, the business’s own website and Hunter (plus Apollo if you switch it on) find decision-makers and verify emails, within your limits.</li><li><b>Score:</b> a 0–100 opportunity score with reasons, plus suggested services and a conversation angle.</li><li><b>Comply:</b> opt-outs and objections go on a permanent do-not-contact list that the engine checks every time.</li><li><b>You:</b> call the top of the list, record the conversation, book a meeting and approve good prospects into your normal pipeline.</li></ol><p class="muted xs">Setup steps: BEMO-Complete-Setup-Guide.pdf, Part 11.</p>`)}</div>`;
}

/* ---------- navigation, roles, counts ---------- */
const NAV = W.NAV; const g = NAV.find(x => x.g === 'Clients');
if(g && !g.items.some(i => i[0] === 'leads')) g.items.unshift(['leads', 'Lead Acquisition', 'radar', 'leads']);
const baseCounts = W.opsCounts;
W.opsCounts = () => Object.assign(baseCounts ? baseCounts() : {}, {leads: (W.DB && DB.acqLeads || []).filter(l => reviewOf(l) === 'New' && !l.belowThreshold).length});
const baseAllowed = W.navAllowed;
if(baseAllowed) W.navAllowed = id => id === 'leads' ? canUse() : baseAllowed(id);
const baseStart = App.start;
App.start = (...a) => { const r = baseStart(...a); try { if(W.DB && DB.setupDone) ensure(); } catch(e){} return r; };
})();
