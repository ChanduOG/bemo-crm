/* =====================================================================
   BEMO-SOLUTIONS Lead Engine
   One source of truth for the Lead Acquisition rules. Used by:
     - the CRM (browser): window.LeadEngine
     - the n8n workflows: inlined into each Code node by n8n/lead-acquisition/build.js
   Pure functions only: no network, no storage. Callers do the fetching.
   ===================================================================== */
(function(root){
'use strict';
const E = {};
E.VERSION = '1.0.0';

/* ---------------- Reference data ---------------- */
E.PROVINCES = {
  'Gauteng': ['Johannesburg','Pretoria','Sandton','Midrand','Centurion','Randburg','Roodepoort','Kempton Park','Benoni','Boksburg','Germiston','Soweto','Vereeniging','Krugersdorp'],
  'Western Cape': ['Cape Town','Stellenbosch','Paarl','George','Bellville','Somerset West','Worcester','Mossel Bay'],
  'KwaZulu-Natal': ['Durban','Pietermaritzburg','Umhlanga','Ballito','Richards Bay','Newcastle','Pinetown','Ladysmith'],
  'Eastern Cape': ['Gqeberha','East London','Mthatha','Makhanda','Queenstown'],
  'Free State': ['Bloemfontein','Welkom','Bethlehem','Kroonstad','Sasolburg'],
  'Limpopo': ['Polokwane','Tzaneen','Mokopane','Thohoyandou','Lephalale'],
  'Mpumalanga': ['Mbombela','Witbank','Middelburg','Secunda','Ermelo'],
  'North West': ['Rustenburg','Mahikeng','Potchefstroom','Klerksdorp','Brits'],
  'Northern Cape': ['Kimberley','Upington','Springbok','Kuruman']
};

/* Centre points used for radius searches (lat, lon). Province / nationwide searches cover each listed town. */
E.CITY_COORDS = {
  'Johannesburg':[-26.2041,28.0473],'Pretoria':[-25.7479,28.2293],'Sandton':[-26.1076,28.0567],'Midrand':[-25.9992,28.1263],'Centurion':[-25.8603,28.1894],'Randburg':[-26.0936,28.0064],'Roodepoort':[-26.1625,27.8725],'Kempton Park':[-26.1007,28.2330],'Benoni':[-26.1885,28.3208],'Boksburg':[-26.2125,28.2596],'Germiston':[-26.2309,28.1677],'Soweto':[-26.2485,27.8540],'Vereeniging':[-26.6731,27.9261],'Krugersdorp':[-26.0855,27.7676],
  'Cape Town':[-33.9249,18.4241],'Stellenbosch':[-33.9321,18.8602],'Paarl':[-33.7342,18.9621],'George':[-33.9630,22.4617],'Bellville':[-33.9000,18.6333],'Somerset West':[-34.0757,18.8433],'Worcester':[-33.6465,19.4485],'Mossel Bay':[-34.1831,22.1460],
  'Durban':[-29.8587,31.0218],'Pietermaritzburg':[-29.6006,30.3794],'Umhlanga':[-29.7276,31.0820],'Ballito':[-29.5390,31.2144],'Richards Bay':[-28.7807,32.0383],'Newcastle':[-27.7577,29.9318],'Pinetown':[-29.8167,30.8500],'Ladysmith':[-28.5539,29.7784],
  'Gqeberha':[-33.9608,25.6022],'East London':[-33.0153,27.9116],'Mthatha':[-31.5889,28.7844],'Makhanda':[-33.3042,26.5328],'Queenstown':[-31.8976,26.8753],
  'Bloemfontein':[-29.0852,26.1596],'Welkom':[-27.9774,26.7351],'Bethlehem':[-28.2308,28.3071],'Kroonstad':[-27.6504,27.2349],'Sasolburg':[-26.8136,27.8170],
  'Polokwane':[-23.9045,29.4689],'Tzaneen':[-23.8332,30.1635],'Mokopane':[-24.1944,29.0097],'Thohoyandou':[-22.9456,30.4840],'Lephalale':[-23.6833,27.7000],
  'Mbombela':[-25.4753,30.9694],'Witbank':[-25.8713,29.2332],'Middelburg':[-25.7751,29.4648],'Secunda':[-26.5500,29.1700],'Ermelo':[-26.5333,29.9833],
  'Rustenburg':[-25.6676,27.2421],'Mahikeng':[-25.8560,25.6403],'Potchefstroom':[-26.7145,27.0970],'Klerksdorp':[-26.8521,26.6667],'Brits':[-25.6347,27.7802],
  'Kimberley':[-28.7282,24.7499],'Upington':[-28.4478,21.2561],'Springbok':[-29.6643,17.8865],'Kuruman':[-27.4524,23.4325]
};
E.provinceOf = city => Object.keys(E.PROVINCES).find(p => E.PROVINCES[p].includes(city)) || '';
/* Which towns a campaign covers: explicit cities, else every town in the chosen provinces, else nationwide */
E.campaignTowns = function(cp){
  if(cp.cities && cp.cities.length) return cp.cities.filter(c => E.CITY_COORDS[c]);
  const provs = cp.provinces && cp.provinces.length ? cp.provinces : Object.keys(E.PROVINCES);
  return provs.flatMap(p => E.PROVINCES[p] || []).filter(c => E.CITY_COORDS[c]);
};
/* Overpass QL for one industry around one town (light query; no country-wide area scans) */
E.overpassQuery = function(industry, town, radiusKm, limit){
  const ll = E.CITY_COORDS[town]; const ind = E.INDUSTRIES[industry] || E.INDUSTRIES.other;
  const sel = ind.osm.map(t => { const [k, v] = t.split('='); return `nwr["${k}"="${v}"]["name"](around:${Math.round((radiusKm || 15) * 1000)},${ll[0]},${ll[1]});`; }).join('');
  return `[out:json][timeout:40];(${sel});out center tags ${limit || 60};`;
};
/* OSM element -> discovered business */
E.fromOsm = function(el, industry, town){
  const t = el.tags || {}; const now = new Date().toISOString();
  const web = t.website || t['contact:website'] || t.url || '';
  const phone = t.phone || t['contact:phone'] || t['contact:mobile'] || '';
  const ref = 'https://www.openstreetmap.org/' + el.type + '/' + el.id;
  const addr = [t['addr:housenumber'], t['addr:street'], t['addr:suburb'], t['addr:city']].filter(Boolean).join(' ');
  const src = (field) => ({field, provider: 'OpenStreetMap', ref, at: now, usage: 'ODbL open data. Attribution: © OpenStreetMap contributors.'});
  const lead = {industry, company: {name: t.name, tradingName: t['name:en'] && t['name:en'] !== t.name ? t['name:en'] : null, website: web || null, domain: E.normDomain(web) || null,
    industry, category: (E.INDUSTRIES[industry] || {}).label, province: E.provinceOf(t['addr:city'] || town) || E.provinceOf(town), city: t['addr:city'] || town, address: addr || null,
    phone: phone ? E.makePhone(String(phone).split(/[;,]/)[0], 'Published company number', 'OpenStreetMap') : null,
    email: t.email || t['contact:email'] ? {value: (t.email || t['contact:email']).toLowerCase(), status: 'published', source: 'OpenStreetMap'} : null,
    socials: [t['contact:facebook'], t['contact:linkedin'], t['contact:instagram']].filter(Boolean), closed: !!(t['disused:office'] || t['was:office'] || /closed/i.test(t.opening_hours || '')), lat: el.lat || (el.center || {}).lat, lon: el.lon || (el.center || {}).lon},
    contacts: [], sources: [src('company'), ...(phone ? [src('phone')] : []), ...(web ? [src('website')] : [])], providerIds: {osm: el.type + '/' + el.id}};
  if(lead.company.email && lead.company.email.value) lead.contacts.push({id: 'k-' + E.normName(lead.company.email.value).replace(/ /g, '-'), name: '', title: 'General business inbox', email: lead.company.email.value, emailStatus: 'published', emailSource: 'OpenStreetMap', phones: [], source: 'OpenStreetMap', collectedAt: now, purpose: 'B2B prospecting for BEMO-SOLUTIONS services'});
  return lead;
};

/* osm: OpenStreetMap tag selectors; kw: search keywords; titles: decision-maker priority (first = best);
   rel: industry relevance to BEMO (0-20); auto: typical admin/automation load (0-20); sensitive: needs compliance review */
E.INDUSTRIES = {
  law:          {label:'Law firms', osm:['office=lawyer'], kw:['attorneys','law firm','legal practice'], rel:20, auto:18,
                 titles:['managing partner','founder','owner','director','partner','practice manager','office manager','operations manager']},
  accounting:   {label:'Accounting practices', osm:['office=accountant','office=tax_advisor'], kw:['accountants','accounting practice','tax practitioner','bookkeeping'], rel:20, auto:18,
                 titles:['owner','managing partner','founder','director','partner','practice manager','office manager']},
  financial:    {label:'Financial services', osm:['office=financial','office=financial_advisor'], kw:['financial advisor','financial planning','wealth management'], rel:18, auto:16,
                 titles:['owner','founder','managing director','director','operations manager','practice manager']},
  insurance:    {label:'Insurance brokers', osm:['office=insurance'], kw:['insurance broker','short-term insurance','brokerage'], rel:18, auto:17,
                 titles:['owner','managing director','principal','director','operations manager','office manager']},
  consulting:   {label:'Consulting firms', osm:['office=consulting'], kw:['consulting','consultancy','management consultants'], rel:16, auto:13,
                 titles:['founder','owner','managing director','director','head of operations']},
  logistics:    {label:'Logistics & transport', osm:['office=logistics','office=courier','office=moving_company','office=transport'], kw:['logistics','freight','courier','transport company','warehousing'], rel:17, auto:19,
                 titles:['operations director','operations manager','managing director','owner','founder','head of operations','it manager']},
  property:     {label:'Property businesses', osm:['office=estate_agent','office=property_management'], kw:['estate agents','property management','real estate'], rel:16, auto:16,
                 titles:['principal','owner','managing director','director','office manager','operations manager']},
  recruitment:  {label:'Recruitment agencies', osm:['office=employment_agency'], kw:['recruitment agency','staffing','labour broker','placement agency'], rel:17, auto:17,
                 titles:['owner','founder','managing director','director','operations manager']},
  construction: {label:'Construction', osm:['office=construction_company','craft=builder','office=architect','office=engineer'], kw:['construction company','builders','civil engineering','contractors'], rel:14, auto:15,
                 titles:['owner','managing director','director','operations director','operations manager','office manager','finance manager']},
  healthcare:   {label:'Healthcare administration', osm:['amenity=clinic','amenity=doctors','amenity=dentist','healthcare=physiotherapist'], kw:['medical practice','dental practice','physiotherapy practice'], rel:14, auto:16, sensitive:true,
                 titles:['practice manager','office manager','owner','director','head of administration']},
  retail:       {label:'Retail & distribution', osm:['shop=wholesale','shop=trade','office=distributor'], kw:['wholesale','distributor','supplier'], rel:13, auto:15,
                 titles:['owner','managing director','operations manager','director','it manager','finance manager']},
  other:        {label:'Other growing businesses', osm:['office=company'], kw:['company'], rel:10, auto:10,
                 titles:['owner','founder','managing director','ceo','director','operations manager','general manager']}
};
E.SENIOR = ['founder','owner','managing director','ceo','chief executive','principal','managing partner','director','partner','operations director','operations manager','practice manager','office manager','head of operations','head of administration','it manager','finance manager','business development director','general manager','coo','cfo','cto'];

E.SERVICES = ['AI consultancy','Business process automation','AI-powered assistants','Customer enquiry automation','CRM integrations','Workflow automation','Website development','Web applications','Internal business systems','Customer portals','Dashboards','API integrations','Custom software'];

E.REVIEW = ['New','Reviewed','Approved for contact','Contacted','Meeting booked','Unsuitable','Do not contact','Transferred'];
E.PERMISSION = ['Permission confirmed','Consent required','Consent request permitted','Contact restricted','Opted out','Do not contact','Compliance review required'];
E.VERIFY = ['Verified business','Probable business','Unverified business','Inactive or closed','Unable to determine'];
E.PHONE_STATUS = ['Verified business number','Verified professional mobile','Published company number','Unverified number','Invalid number','Unknown number type'];

/* ---------------- Normalisation ---------------- */
E.normDomain = function(url){
  if(!url) return '';
  let s = String(url).trim().toLowerCase();
  if(!s || /^(mailto|tel):/.test(s)) return '';
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\d?\./, '').split(/[\/?#:]/)[0];
  if(!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return '';
  // social / directory / free-mail hosts are not the business's own domain
  if(/(^|\.)(facebook|instagram|linkedin|twitter|x|tiktok|youtube|google|goo\.gl|wa\.me|whatsapp|yellosa|yellowpages|brabys|snupit|cylex|hotfrog|gmail|yahoo|outlook|hotmail|icloud|mweb|telkomsa|vodamail|webmail|wixsite|business\.site)\.(com|co\.za|net|org|me|site)$/.test(s) || /(gmail|yahoo|hotmail|outlook|icloud)\./.test(s)) return '';
  return s;
};
E.normName = function(n){
  return String(n || '').toLowerCase()
    .replace(/&/g, ' and ').replace(/\(pty\)|\bpty\b|\bltd\b|\blimited\b|\bcc\b|\binc\b|\bnpc\b|\bsoc\b|\(rf\)|\bincorporated\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
};
E.dedupeKey = function(c){
  const d = E.normDomain(c.website || c.domain);
  if(d) return 'd:' + d;
  return 'n:' + E.normName(c.name) + '|' + String(c.city || c.province || '').toLowerCase().trim();
};

/* South African phone numbers -> +27..., with kind */
E.normPhone = function(raw){
  const out = {raw: String(raw == null ? '' : raw).trim(), e164: '', kind: 'unknown', valid: false};
  let d = out.raw.replace(/[^\d+]/g, '');
  if(!d) return out;
  if(d.startsWith('+')) d = d.slice(1);
  if(d.startsWith('00')) d = d.slice(2);
  if(d.startsWith('27') && d.length === 11) d = d.slice(2);
  else if(d.startsWith('0') && d.length === 10) d = d.slice(1);
  else if(d.length === 9 && /^[1-9]/.test(d)) { /* already national without 0 */ }
  else { out.kind = 'invalid'; return out; }
  if(d.length !== 9){ out.kind = 'invalid'; return out; }
  const p2 = d.slice(0, 2), p1 = d[0];
  if(['60','61','62','63','64','65','66','67','68','71','72','73','74','76','78','79','81','82','83','84'].includes(p2)) out.kind = 'mobile';
  else if(p2 === '80') out.kind = 'tollfree';
  else if(p2 === '86') out.kind = 'sharecall';
  else if(p2 === '87') out.kind = 'voip';
  else if(['1','2','3','4','5'].includes(p1)) out.kind = 'landline';
  else { out.kind = 'invalid'; return out; }
  out.e164 = '+27' + d; out.valid = true;
  return out;
};
E.fmtPhone = e => { const m = /^\+27(\d{2})(\d{3})(\d{4})$/.exec(e || ''); return m ? `0${m[1]} ${m[2]} ${m[3]}` : (e || ''); };
/* status ranking: never replace a stronger number with a weaker one */
E.PHONE_RANK = {'Verified professional mobile': 5, 'Verified business number': 4, 'Published company number': 3, 'Unverified number': 2, 'Unknown number type': 1, 'Invalid number': 0};
E.makePhone = function(raw, status, source){
  const n = E.normPhone(raw);
  return {e164: n.e164, raw: n.raw, kind: n.kind, status: n.valid ? (status || 'Unverified number') : 'Invalid number', source: source || null};
};
E.EMAIL_RANK = {'valid': 4, 'verified': 4, 'accept_all': 2, 'webmail': 2, 'unknown': 1, 'published': 2, 'risky': 1, 'invalid': 0};
E.isPersonalEmail = e => /@(gmail|yahoo|hotmail|outlook|icloud|live|mweb|telkomsa|vodamail|webmail)\./i.test(e || '');
E.isGenericEmail = e => /^(info|admin|office|hello|contact|enquiries|enquiry|sales|accounts|reception|support|mail|general)@/i.test(e || '');

/* ---------------- Website audit (from fetched HTML) ---------------- */
E.extractContacts = function(html, baseDomain){
  const h = String(html || '');
  const emails = new Set(), phones = new Set();
  (h.match(/mailto:([^"'?>\s]+)/gi) || []).forEach(m => emails.add(decodeURIComponent(m.slice(7)).toLowerCase()));
  (h.replace(/<[^>]+>/g, ' ').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).forEach(e => emails.add(e.toLowerCase()));
  (h.match(/tel:([+\d\s()-]{9,20})/gi) || []).forEach(m => phones.add(m.slice(4)));
  (h.replace(/<[^>]+>/g, ' ').match(/(?:\+27|\b0)[\s(-]*\d{2}[\s)-]*\d{3}[\s-]*\d{4}\b/g) || []).forEach(p => phones.add(p));
  const em = Array.from(emails).filter(e => !/\.(png|jpe?g|gif|svg|webp)$/.test(e) && !/(example|sentry|wixpress|domain)\./.test(e) && e.length < 80);
  const own = baseDomain ? em.filter(e => e.endsWith('@' + baseDomain) || e.endsWith('.' + baseDomain)) : [];
  return {emails: (own.length ? own.concat(em.filter(e => !own.includes(e))) : em).slice(0, 10),
          phones: Array.from(phones).map(p => E.normPhone(p)).filter(p => p.valid).filter((p, i, a) => a.findIndex(x => x.e164 === p.e164) === i).slice(0, 6)};
};
E.auditWebsite = function(r){
  /* r = {url, finalUrl, status, html, error, ms, robotsBlocked} -> findings with evidence */
  const now = new Date().toISOString();
  if(!r || !r.url) return {status: 'NO WEBSITE FOUND', checkedAt: now, confidence: 'Medium', notes: 'No website was found in the sources checked. This is not proof that the business has no website.'};
  if(r.robotsBlocked) return {status: 'Website found', url: r.url, checkedAt: now, confidence: 'Low', notes: 'The site asks automated tools not to read it (robots.txt), so it was not audited.'};
  if(r.error || !r.status || r.status >= 400) return {status: 'Website unreachable', url: r.url, httpStatus: r.status || null, checkedAt: now, confidence: 'Medium', notes: 'The website did not load when checked (' + (r.error || ('HTTP ' + r.status)) + '). It may be temporarily down.'};
  const h = String(r.html || ''); const low = h.toLowerCase(); const text = low.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  const has = re => re.test(low);
  const years = (text.match(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2}|19\d{2})/g) || []).map(s => +s.match(/(20\d{2}|19\d{2})(?!.*\d{4})/)[1]);
  const cy = years.length ? Math.max(...years) : null; const thisYear = new Date().getFullYear();
  const f = {
    status: 'Website found', url: r.finalUrl || r.url, httpStatus: r.status, checkedAt: now, loadMs: r.ms || null,
    https: /^https:/i.test(r.finalUrl || r.url),
    mobile: has(/<meta[^>]+name=["']viewport["'][^>]*width=device-width/),
    contactForm: has(/<form[\s\S]{0,4000}?(type=["']email["']|name=["'][^"']*(email|message|enquir)[^"']*["']|<textarea)/),
    booking: has(/calendly\.com|setmore|acuityscheduling|simplybook|bookings\.|book (an |a )?(appointment|consultation|meeting)|book online|schedule (a |an )?(call|appointment|consultation)|fresha\.com|booksy/),
    intake: has(/client intake|new client form|onboarding form|get a quote|request a quote|apply now|application form|submit (your )?(documents|enquiry)/),
    portal: has(/client portal|customer portal|client login|member login|my account|sign in to your account|portal login/),
    quote: has(/get a quote|request a quote|online quote|instant quote|quote calculator/),
    selfService: has(/track (your )?(order|parcel|shipment|delivery)|pay online|download (your )?(statement|invoice)|self[- ]service/),
    chat: has(/tawk\.to|intercom|drift\.com|crisp\.chat|livechat|zendesk|hubspot.*chat|wa\.me\/|api\.whatsapp\.com|whatsapp/),
    cms: (low.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/) || [])[1] || null,
    copyrightYear: cy,
    outdated: false, automationSignals: []
  };
  if(f.chat) f.automationSignals.push('Live chat or WhatsApp link');
  if(f.booking) f.automationSignals.push('Online booking');
  if(f.portal) f.automationSignals.push('Client portal / login');
  if(f.selfService) f.automationSignals.push('Self-service features');
  if(has(/hubspot|salesforce|zoho|pipedrive|mailchimp|activecampaign|klaviyo/)) f.automationSignals.push('Marketing/CRM tool on site');
  const reasons = [];
  if(cy && cy < thisYear - 2) reasons.push('copyright year ' + cy);
  if(!f.mobile) reasons.push('no mobile viewport');
  if(!f.https) reasons.push('no HTTPS');
  if(has(/<table[^>]+(width=|bgcolor=)|<font |<marquee|<frameset|\.swf/)) reasons.push('old-style page layout');
  f.outdated = !!(reasons.length >= 2 || (cy && cy < thisYear - 4));
  if(f.cms) f.cms = f.cms.split(';')[0].slice(0, 40);
  f.outdatedReasons = reasons;
  f.confidence = h.length > 2000 ? 'High' : 'Medium';
  if(h.length < 600) f.notes = 'Very little content was returned (the site may load its content with JavaScript), so some checks may be incomplete.';
  return f;
};

/* ---------------- Verification ---------------- */
E.verifyBusiness = function(lead){
  const ev = []; const now = new Date().toISOString(); const c = lead.company || {}; const w = lead.website || {};
  const add = (check, result, source, ok) => ev.push({check, result, source: source || null, at: now, ok: ok === true ? true : ok === false ? false : null});
  const srcProviders = Array.from(new Set((lead.sources || []).map(s => s.provider)));
  add('Listed in public sources', srcProviders.length ? srcProviders.join(', ') : 'No source recorded', srcProviders.join(', '), srcProviders.length > 0);
  if(w.status === 'Website found') add('Website accessible', (w.url || '') + (w.httpStatus ? ' (HTTP ' + w.httpStatus + ')' : ''), w.url, true);
  else if(w.status === 'Website unreachable') add('Website accessible', 'Did not load when checked', w.url, false);
  else add('Website accessible', 'No website found', null, null);
  const ph = c.phone && c.phone.e164;
  add('Phone number format', ph ? E.fmtPhone(ph) + ' (' + c.phone.kind + ')' : 'No business number', c.phone && c.phone.source, ph ? true : null);
  const sameName = srcProviders.length > 1 ? 'Seen in ' + srcProviders.length + ' independent sources' : 'Only one source so far';
  add('Identity consistent across sources', sameName, null, srcProviders.length > 1 ? true : null);
  if(c.regNo) add('Company registration', 'Registration number ' + c.regNo + (c.regSource ? '' : ' (not yet checked against CIPC)'), c.regSource || null, c.regVerified === true ? true : null);
  const emailOk = (lead.contacts || []).some(x => ['valid', 'verified'].includes(x.emailStatus));
  add('Verified email address', emailOk ? 'At least one verified address' : 'None verified yet', null, emailOk ? true : null);
  if(c.closed) add('Business activity', 'Marked as closed by a source', c.closedSource, false);
  const ok = ev.filter(e => e.ok === true).length, bad = ev.filter(e => e.ok === false).length;
  let status = 'Unable to determine';
  if(c.closed) status = 'Inactive or closed';
  else if(ok >= 3) status = 'Verified business';
  else if(ok === 2) status = 'Probable business';
  else if(ok === 1) status = 'Unverified business';
  else if(bad) status = 'Unverified business';
  return {status, evidence: ev, checkedAt: now};
};

/* ---------------- Decision makers ---------------- */
E.titleRank = function(title, industry){
  const t = String(title || '').toLowerCase(); if(!t) return 99;
  const list = (E.INDUSTRIES[industry] || E.INDUSTRIES.other).titles;
  for(let i = 0; i < list.length; i++) if(t.includes(list[i])) return i;
  for(let i = 0; i < E.SENIOR.length; i++) if(t.includes(E.SENIOR[i])) return 20 + i;
  return 60;
};
E.bestContact = function(lead){
  const cs = (lead.contacts || []).filter(c => !c.dnc && !c.optOut);
  return cs.slice().sort((a, b) => E.titleRank(a.title, lead.industry) - E.titleRank(b.title, lead.industry) || E.contactQuality(b) - E.contactQuality(a))[0] || null;
};
E.contactQuality = function(c){
  let q = 0;
  if(c.email) q += (E.EMAIL_RANK[c.emailStatus] || 1);
  (c.phones || []).forEach(p => { q += (E.PHONE_RANK[p.status] || 0) * (p.kind === 'mobile' ? 1.2 : 1); });
  if(c.name) q += 1; if(c.title) q += 1;
  return q;
};

/* ---------------- Scoring (0-100) ---------------- */
E.score = function(lead){
  const ind = E.INDUSTRIES[lead.industry] || E.INDUSTRIES.other; const w = lead.website || {}; const c = lead.company || {};
  const b = {};
  b.industry = Math.min(20, ind.rel);
  // operational automation potential: industry load, plus signs of manual processes
  let auto = Math.round(ind.auto * 0.7);
  if(w.status === 'Website found' && !w.contactForm) auto += 2;
  if(w.status === 'Website found' && !w.booking && ['law','accounting','financial','insurance','healthcare','property','consulting'].includes(lead.industry)) auto += 2;
  if(!w.portal && !w.selfService) auto += 2;
  if((w.automationSignals || []).length >= 3) auto -= 4;
  b.automation = clamp(auto, 0, 20);
  // digital presence opportunity
  let dg = 0;
  if(w.status === 'NO WEBSITE FOUND') dg = 13;
  else if(w.status === 'Website unreachable') dg = 11;
  else if(w.status === 'Website found'){ if(w.outdated) dg += 7; if(!w.mobile) dg += 3; if(!w.https) dg += 2; if(!w.contactForm) dg += 2; if(!w.booking && !w.intake) dg += 2; if(!w.chat) dg += 1; }
  b.digital = clamp(dg, 0, 15);
  // decision maker availability
  const best = E.bestContact(lead); const rank = best ? E.titleRank(best.title, lead.industry) : 99;
  b.decisionMaker = !best ? 0 : rank < 3 ? 15 : rank < 10 ? 12 : rank < 40 ? 8 : best.name ? 4 : 2;
  // contact quality
  let cq = 0; const allPhones = [].concat(c.phone ? [c.phone] : [], ...(lead.contacts || []).map(x => x.phones || []));
  if(allPhones.some(p => p.status === 'Verified professional mobile')) cq += 6; else if(allPhones.some(p => p.status === 'Verified business number')) cq += 5; else if(allPhones.some(p => p.e164)) cq += 3;
  const emails = (lead.contacts || []).filter(x => x.email);
  if(emails.some(x => ['valid', 'verified'].includes(x.emailStatus) && !E.isGenericEmail(x.email))) cq += 6; else if(emails.some(x => ['valid', 'verified'].includes(x.emailStatus))) cq += 4; else if(emails.length || c.email) cq += 2;
  if(best && best.name && (best.email || (best.phones || []).length)) cq += 3;
  b.contactQuality = clamp(cq, 0, 15);
  const v = (lead.verification || {}).status;
  b.verification = v === 'Verified business' ? 10 : v === 'Probable business' ? 7 : v === 'Unverified business' ? 3 : 0;
  b.activity = c.closed ? 0 : (w.status === 'Website found' && w.copyrightYear && w.copyrightYear >= new Date().getFullYear() - 1) ? 5 : (allPhones.length || w.status === 'Website found') ? 3 : 1;
  const total = Object.values(b).reduce((s, x) => s + x, 0);
  const category = total >= 85 ? 'High-priority prospect' : total >= 70 ? 'Strong prospect' : total >= 50 ? 'Potential prospect' : total >= 30 ? 'Low-priority prospect' : 'Insufficient information or unsuitable';
  // confidence: how much of the picture is backed by evidence
  let conf = 0; if(v === 'Verified business') conf += 2; else if(v === 'Probable business') conf += 1;
  if(w.status && w.confidence === 'High') conf += 1; if((lead.sources || []).length >= 3) conf += 1; if(best && best.name) conf += 1;
  const confidence = conf >= 4 ? 'High' : conf >= 2 ? 'Medium' : 'Low';
  const reachable = allPhones.some(p => p.e164 && p.status !== 'Invalid number') || emails.some(x => ['valid', 'verified', 'published'].includes(x.emailStatus));
  const blocked = (lead.contacts || []).length && (lead.contacts || []).every(x => x.dnc || x.optOut);
  return {total, breakdown: b, category, confidence, readyToContact: !!(reachable && !blocked && !c.closed),
          notReadyReason: c.closed ? 'Business appears closed' : blocked ? 'Every contact has opted out or is marked do-not-contact' : !reachable ? 'No verified or published contact details yet' : null,
          scoredAt: new Date().toISOString(), engine: E.VERSION};
};
function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }

/* ---------------- Opportunity report & service matching (rules; AI may add narrative) ---------------- */
E.observations = function(lead){
  const w = lead.website || {}; const c = lead.company || {}; const o = [];
  if(w.status === 'NO WEBSITE FOUND') o.push('No website found in the sources checked.');
  else if(w.status === 'Website unreachable') o.push('The listed website did not load when checked.');
  else if(w.status === 'Website found'){
    o.push('Website: ' + (w.url || '') + (w.https ? ' (secure HTTPS)' : ' (no HTTPS)') + '.');
    if(!w.mobile) o.push('No mobile viewport setting found, so the site may not display well on phones.');
    if(w.outdated) o.push('The site shows signs of being outdated: ' + (w.outdatedReasons || []).join(', ') + '.');
    o.push(w.contactForm ? 'An online contact form was found.' : 'No online contact or enquiry form was identified.');
    o.push(w.booking ? 'Online booking was found.' : 'No online booking or scheduling was identified.');
    if(w.portal) o.push('A client portal or login area was found.');
    if((w.automationSignals || []).length) o.push('Visible digital tools: ' + w.automationSignals.join(', ') + '.');
  }
  if(c.phone && c.phone.e164) o.push('Public business number available (' + c.phone.kind + ').');
  const n = (lead.contacts || []).filter(x => x.name).length;
  o.push(n ? n + ' named contact' + (n === 1 ? '' : 's') + ' found.' : 'No named decision-maker found yet.');
  return o;
};
E.matchServices = function(lead){
  const w = lead.website || {}; const i = lead.industry; const s = [];
  const add = (name, why) => { if(!s.some(x => x.name === name)) s.push({name, why}); };
  if(w.status === 'NO WEBSITE FOUND') add('Website development', 'No website was found, so clients searching online may not find them.');
  if(w.status === 'Website unreachable') add('Website development', 'Their listed website did not load when checked.');
  if(w.status === 'Website found' && (w.outdated || !w.mobile)) add('Website development', 'The current site ' + (w.outdated ? 'looks outdated' : 'does not appear mobile-friendly') + '.');
  if(w.status === 'Website found' && !w.contactForm || w.status !== 'Website found') add('Customer enquiry automation', 'No online enquiry capture was identified, so enquiries likely arrive by phone or email and are handled manually.');
  const bookingFit = ['law','accounting','financial','insurance','healthcare','property','consulting','recruitment'].includes(i);
  if(bookingFit && !w.booking) add('Workflow automation', 'Consultations and appointments could be booked and confirmed automatically; no online booking was identified.');
  if(['law','accounting','insurance','financial','healthcare'].includes(i) && !w.portal) add('Customer portals', 'Client document collection and status updates usually run over email in this sector; no client portal was identified.');
  if(['accounting','law','recruitment','insurance','property'].includes(i)) add('Business process automation', 'Onboarding, reminders and follow-ups in this sector are repetitive and well suited to automation.');
  if(['logistics','construction','retail'].includes(i)) { add('Internal business systems', 'Job, delivery or stock tracking in this sector often runs on spreadsheets and phone calls.'); add('Dashboards', 'Operational reporting (jobs, deliveries, cash flow) could be automated into live dashboards.'); }
  if(['logistics','retail'].includes(i) && !w.selfService) add('Customer portals', 'Customers could track orders or deliveries themselves; no self-service tracking was identified.');
  if(['recruitment','property','insurance'].includes(i)) add('CRM integrations', 'High volumes of candidates, tenants or policy holders benefit from a connected CRM.');
  if(['consulting','financial','other'].includes(i)) add('AI consultancy', 'A practical AI and automation assessment would identify quick wins.');
  if(!w.chat && (w.status === 'Website found')) add('AI-powered assistants', 'No chat or WhatsApp assistant was identified; an assistant could answer common questions and capture leads after hours.');
  return s.slice(0, 5);
};
E.angle = function(lead){
  const svc = (lead.opportunity && lead.opportunity.services || E.matchServices(lead))[0];
  const name = (lead.company || {}).name || 'the business';
  if(!svc) return 'Ask how ' + name + ' currently handles new enquiries and follow-ups.';
  return 'Open with how ' + name + ' handles ' + ({'Website development': 'being found online and new enquiries', 'Customer enquiry automation': 'new enquiries and follow-ups', 'Workflow automation': 'booking and confirming appointments', 'Customer portals': 'collecting documents and keeping clients updated', 'Business process automation': 'client onboarding and reminders', 'Internal business systems': 'tracking jobs and deliveries', 'Dashboards': 'reporting on operations', 'CRM integrations': 'keeping track of clients and contacts', 'AI consultancy': 'repetitive admin work', 'AI-powered assistants': 'questions that come in after hours'}[svc.name] || 'their admin workload') + ', then mention one specific observation.';
};
E.opportunity = function(lead){
  const services = E.matchServices(lead);
  return {observations: E.observations(lead), services, suggestions: services.map(s => s.name), angle: E.angle(Object.assign({}, lead, {opportunity: {services}})), source: 'rules', generatedAt: new Date().toISOString()};
};

/* ---------------- Compliance (POPIA s69 aware, configurable) ---------------- */
E.defaultPermission = function(contact, lead, cfg){
  cfg = cfg || {};
  if(contact.optOut) return 'Opted out';
  if(contact.dnc) return 'Do not contact';
  if(contact.consent && contact.consent.status === 'given') return 'Permission confirmed';
  if(!contact.complianceCleared && (lead && E.INDUSTRIES[lead.industry] || {}).sensitive) return 'Compliance review required';
  if(!contact.complianceCleared && contact.email && E.isPersonalEmail(contact.email)) return 'Compliance review required';
  if(contact.consentRequest && contact.consentRequest.sentAt) return 'Consent required';
  return cfg.allowConsentRequest === false ? 'Consent required' : 'Consent request permitted';
};
E.retentionDate = function(fromIso, months){ const d = new Date(fromIso || Date.now()); d.setMonth(d.getMonth() + (months || 12)); return d.toISOString().slice(0, 10); };
E.suppressionKeys = function(lead){
  const k = []; const c = lead.company || {};
  const d = E.normDomain(c.website || c.domain); if(d) k.push('domain:' + d);
  k.push('name:' + E.normName(c.name) + '|' + String(c.city || '').toLowerCase());
  if(c.phone && c.phone.e164) k.push('phone:' + c.phone.e164);
  (lead.contacts || []).forEach(x => { if(x.email) k.push('email:' + x.email.toLowerCase()); (x.phones || []).forEach(p => p.e164 && k.push('phone:' + p.e164)); });
  return k;
};

/* ---------------- Merging (never downgrade verified data) ---------------- */
E.mergeContacts = function(a, b){
  const out = (a || []).map(x => Object.assign({}, x));
  (b || []).forEach(n => {
    const m = out.find(x => (n.email && x.email && x.email.toLowerCase() === n.email.toLowerCase()) || (n.name && x.name && E.normName(x.name) === E.normName(n.name)));
    if(!m){ out.push(Object.assign({foundBy: [n.source].filter(Boolean)}, n)); return; }
    m.foundBy = Array.from(new Set([].concat(m.foundBy || [m.source].filter(Boolean), n.foundBy || [n.source].filter(Boolean))));
    ['name','title','dept','profileUrl'].forEach(k => { if(!m[k] && n[k]) m[k] = n[k]; });
    if(n.email && (!m.email || (E.EMAIL_RANK[n.emailStatus] || 0) > (E.EMAIL_RANK[m.emailStatus] || 0))){ m.email = n.email; m.emailStatus = n.emailStatus; m.emailScore = n.emailScore; m.emailSource = n.emailSource; }
    m.phones = E.mergePhones(m.phones, n.phones);
    m.sources = Array.from(new Set([].concat(m.sources || [], n.sources || [])));
    // compliance fields always come from the existing record
  });
  return out;
};
E.mergePhones = function(a, b){
  const out = (a || []).map(x => Object.assign({}, x));
  (b || []).forEach(p => {
    if(!p || !p.e164) return; const m = out.find(x => x.e164 === p.e164);
    if(!m) out.push(Object.assign({}, p));
    else if((E.PHONE_RANK[p.status] || 0) > (E.PHONE_RANK[m.status] || 0)){ m.status = p.status; m.source = p.source; }
  });
  return out.sort((x, y) => (E.PHONE_RANK[y.status] || 0) - (E.PHONE_RANK[x.status] || 0));
};
E.mergeLead = function(old, inc){
  if(!old) return inc;
  const out = Object.assign({}, old, inc);
  out.company = Object.assign({}, old.company || {}, stripEmpty(inc.company || {}));
  const op = (old.company || {}).phone, np = (inc.company || {}).phone;
  if(op && op.e164 && (!np || !np.e164 || (E.PHONE_RANK[np.status] || 0) < (E.PHONE_RANK[op.status] || 0))) out.company.phone = op;
  out.contacts = E.mergeContacts(old.contacts, inc.contacts);
  out.sources = (old.sources || []).concat((inc.sources || []).filter(s => !(old.sources || []).some(o => o.provider === s.provider && o.field === s.field && o.ref === s.ref)));
  if(inc.website && inc.website.status === 'NO WEBSITE FOUND' && old.website && old.website.status === 'Website found') out.website = old.website;
  ['id','createdAt','review','transfer','notes','conversations','meetings','consentLog'].forEach(k => { if(old[k] !== undefined) out[k] = old[k]; });
  return out;
};
function stripEmpty(o){ const r = {}; Object.keys(o).forEach(k => { const v = o[k]; if(v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) r[k] = v; }); return r; }

/* Run all rule stages on a lead (safe to repeat) */
E.qualify = function(lead, cfg){
  lead.verification = E.verifyBusiness(lead);
  lead.contacts = (lead.contacts || []).map(c => Object.assign(c, {permission: E.defaultPermission(c, lead, cfg), retainUntil: c.retainUntil || E.retentionDate(c.collectedAt, (cfg || {}).retentionMonths)}));
  const ai = lead.opportunity && lead.opportunity.source === 'ai' ? lead.opportunity : null;
  lead.opportunity = Object.assign(E.opportunity(lead), ai ? {narrative: ai.narrative, angle: ai.angle || undefined, aiServices: ai.aiServices, source: 'rules+ai', aiModel: ai.aiModel} : {});
  if(!lead.opportunity.angle) lead.opportunity.angle = E.angle(lead);
  lead.score = E.score(lead);
  lead.bestContactId = (E.bestContact(lead) || {}).id || null;
  return lead;
};

/* ---------------- Scripts and drafts (never sent automatically) ---------------- */
E.callScript = function(lead, contact, me){
  const c = lead.company || {}; const o = lead.opportunity || {}; const who = contact && contact.name ? contact.name.split(' ')[0] : 'there';
  const obs = (o.observations || []).filter(x => !/named contact|Public business number/.test(x)).slice(0, 2);
  return [
    `Hi ${who}, this is ${me.name} from ${me.company}. Is now a bad time for a two-minute call?`,
    ``,
    `[If yes: ask when to call back and end politely.]`,
    ``,
    `We help ${E.INDUSTRIES[lead.industry] ? E.INDUSTRIES[lead.industry].label.toLowerCase() : 'businesses'} in ${c.city || c.province || 'South Africa'} cut down on admin with automation and better online systems.`,
    obs.length ? `I had a quick look at ${c.name}'s public information and noticed: ${obs.join(' ').replace(/\.$/, '')}.` : '',
    ``,
    `Question to open: ${o.angle || 'How do you currently handle new enquiries and follow-ups?'}`,
    ``,
    `If there is interest: offer a free 30-minute discovery call and book it while on the phone.`,
    `If they are not interested or ask not to be contacted: thank them, and mark them "Do not contact" in the CRM straight away.`,
    ``,
    `Recommended services to mention: ${(o.services || []).slice(0, 3).map(s => s.name).join(', ') || 'Business process automation'}.`
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
};
E.consentRequest = function(lead, contact, me, optOutUrl){
  const c = lead.company || {};
  return {
    subject: `${me.company}: may we send you information?`,
    body: [
      `Dear ${contact && contact.name ? contact.name.split(' ')[0] : 'Sir/Madam'},`,
      ``,
      `My name is ${me.name} from ${me.company}. We help South African businesses such as ${c.name || 'yours'} reduce admin through automation, AI tools and better websites.`,
      ``,
      `In terms of section 69 of the Protection of Personal Information Act (POPIA), we are asking for your permission before sending you any direct marketing. We obtained your business contact details from ${((lead.sources || [])[0] || {}).provider || 'a public business listing'}.`,
      ``,
      `If you would like to hear from us about: ${(lead.opportunity && lead.opportunity.services || []).slice(0, 3).map(s => s.name).join(', ') || 'our automation services'}, simply reply "YES" to this email.`,
      ``,
      `If you do not reply, we will not contact you again for marketing purposes. To object to any further contact, reply "STOP"${optOutUrl ? ' or use this link: ' + optOutUrl : ''}.`,
      ``,
      `Kind regards,`,
      `${me.name}`, `${me.company}`, [me.phone, me.email].filter(Boolean).join(' · '), me.website || '', me.address || ''
    ].filter((l, k, a) => !(l === '' && k === a.length - 1)).join('\n')
  };
};
E.outreachDraft = function(lead, contact, me, optOutUrl){
  const c = lead.company || {}; const o = lead.opportunity || {};
  return {
    subject: `${c.name}: an idea to save admin time`,
    body: [
      `Hi ${contact && contact.name ? contact.name.split(' ')[0] : 'there'},`,
      ``,
      `Thank you for agreeing to hear from us. Based on what we could see publicly about ${c.name}:`,
      ...(o.observations || []).slice(0, 3).map(x => '• ' + x),
      ``,
      `Ideas that could help:`,
      ...(o.services || []).slice(0, 3).map(s => `• ${s.name}: ${s.why}`),
      ``,
      `Would a free 30-minute call next week be useful?`,
      ``,
      `Kind regards,`, `${me.name}`, `${me.company}`, [me.phone, me.email].filter(Boolean).join(' · '), me.website || '',
      ``,
      `You are receiving this because you gave us permission to contact you. To stop receiving messages, reply STOP${optOutUrl ? ' or visit ' + optOutUrl : ''}.`
    ].join('\n')
  };
};

if(typeof module !== 'undefined' && module.exports) module.exports = E;
root.LeadEngine = E;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
