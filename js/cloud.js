/* =====================================================================
   Cloud mode: Supabase sign-in + shared live database.
   Turns on only when js/cloud-config.js has your Supabase URL and key.
   Without it the CRM keeps working from this browser exactly as before.
   ===================================================================== */
(function(){
const W = window;
const CFG = W.CRM_CLOUD || {};
const ON = !!(CFG.url && CFG.anonKey && /^https:\/\//.test(CFG.url) && !/YOUR-/i.test(CFG.url + CFG.anonKey));
W.CLOUD_ON = ON;
W.engineAllowed = () => true;
if(!ON) return;
if(!W.supabase || !W.supabase.createClient){ W.App.start = () => gate(`<div class="strong">Can’t load the sign-in system</div><p class="sub">Check your internet connection and refresh the page.</p>`); return; }

const TAB = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const SEP = '\u0001';
const EXCLUDE = new Set(['me', 'v', 'aiChats']);
const sb = W.supabase.createClient(CFG.url.replace(/\/+$/, ''), CFG.anonKey, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}});
W.CRM_SB = sb;

let email = '', ready = false, flushing = false, again = false, isEngine = false, ownerless = false;
let snap = new Map();   // rowId -> JSON of what the database has
let ords = new Map();   // rowId -> sort position
let queue = [], qTimer = null, uiDirty = false, lastSync = Date.now(), wasDown = false;

/* ---------- small helpers ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function hash(s){ let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for(let i = 0; i < s.length; i++){ const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36); }
const keyOf = it => (it && typeof it === 'object' && (typeof it.id === 'string' || typeof it.id === 'number') && it.id !== '') ? String(it.id) : null;
const busyUI = () => (W.STACK && W.STACK.length) || document.querySelector('body > .pop') || (document.activeElement && document.activeElement.matches && document.activeElement.matches('input,textarea,select,[contenteditable]'));

/* ---------- status pill ---------- */
let pill;
function status(txt, kind){
  if(!pill){ pill = document.createElement('div'); pill.id = 'cloud-pill'; pill.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;font:500 11px var(--font,system-ui);padding:5px 9px;border-radius:99px;border:1px solid var(--line);background:var(--surface);color:var(--fg-3);box-shadow:var(--shadow-1);pointer-events:none;transition:opacity .3s'; document.body.append(pill); }
  pill.textContent = txt; pill.style.color = kind === 'err' ? 'var(--red)' : kind === 'busy' ? 'var(--amber)' : 'var(--fg-3)'; pill.style.opacity = kind === 'ok' ? '.55' : '1';
}

/* ---------- full-screen gate (sign in, loading, errors) ---------- */
function gate(inner){
  let g = document.getElementById('cloud-gate');
  if(!g){ g = document.createElement('div'); g.id = 'cloud-gate'; g.style.cssText = 'position:fixed;inset:0;z-index:10000;background:var(--bg);display:grid;place-items:center;padding:24px 16px;overflow:auto'; document.body.append(g); }
  g.innerHTML = `<div style="width:min(400px,100%)" class="col gap-16"><div class="row" style="gap:12px"><span class="logo" style="width:40px;height:40px;border-radius:11px;display:grid;place-items:center">${W.LOGO ? W.LOGO(24) : ''}</span><div><div class="strong" style="font-size:18px">Operations OS</div><div class="muted small">${esc((CFG.companyName || 'Team workspace'))}</div></div></div><div class="card"><div class="card-b col gap-12" style="padding:22px">${inner}</div></div></div>`;
  return g;
}
function ungate(){ const g = document.getElementById('cloud-gate'); if(g) g.remove(); }
const errLine = id => `<div id="${id}" class="small" style="color:var(--red);min-height:16px"></div>`;

function showLogin(msg){
  const g = gate(`<div class="strong">Sign in</div>
    <label class="col gap-4"><span class="small muted">Work email</span><input class="inp" id="cg-email" type="email" autocomplete="username" value="${esc(localStorage.getItem('crm-last-email') || '')}"></label>
    <label class="col gap-4"><span class="small muted">Password</span><input class="inp" id="cg-pass" type="password" autocomplete="current-password"></label>
    ${errLine('cg-err')}
    <button class="btn pri" id="cg-go" style="height:38px">Sign in</button>
    <button class="btn sm" id="cg-forgot" style="align-self:flex-start">Forgot password?</button>`);
  const err = g.querySelector('#cg-err'); if(msg) err.textContent = msg;
  const go = async () => {
    const em = g.querySelector('#cg-email').value.trim(), pw = g.querySelector('#cg-pass').value;
    if(!em || !pw){ err.textContent = 'Enter your email and password.'; return; }
    err.textContent = ''; g.querySelector('#cg-go').disabled = true; g.querySelector('#cg-go').textContent = 'Signing in…';
    const {data, error} = await sb.auth.signInWithPassword({email: em, password: pw});
    if(error){ err.textContent = /invalid/i.test(error.message) ? 'Wrong email or password.' : error.message; g.querySelector('#cg-go').disabled = false; g.querySelector('#cg-go').textContent = 'Sign in'; return; }
    try { localStorage.setItem('crm-last-email', em); } catch(e){}
    enter(data.session);
  };
  g.querySelector('#cg-go').onclick = go;
  g.querySelector('#cg-pass').onkeydown = e => { if(e.key === 'Enter') go(); };
  g.querySelector('#cg-forgot').onclick = async () => {
    const em = g.querySelector('#cg-email').value.trim(); if(!em){ err.textContent = 'Type your email first.'; return; }
    const {error} = await sb.auth.resetPasswordForEmail(em, {redirectTo: location.origin + location.pathname});
    err.style.color = error ? 'var(--red)' : 'var(--green)';
    err.textContent = error ? error.message : 'If email sending is set up, a reset link is on its way. Otherwise ask the owner to reset your password in Supabase.';
  };
  setTimeout(() => (g.querySelector('#cg-email').value ? g.querySelector('#cg-pass') : g.querySelector('#cg-email')).focus(), 50);
}

function showSetPassword(then){
  const g = gate(`<div class="strong">Choose a new password</div>
    <label class="col gap-4"><span class="small muted">New password (8+ characters)</span><input class="inp" id="cg-p1" type="password" autocomplete="new-password"></label>
    <label class="col gap-4"><span class="small muted">Type it again</span><input class="inp" id="cg-p2" type="password" autocomplete="new-password"></label>
    ${errLine('cg-err')}
    <div class="row gap-8"><button class="btn pri" id="cg-go" style="height:38px;flex:1">Save password</button>${then ? '<button class="btn" id="cg-cancel" style="height:38px">Cancel</button>' : ''}</div>`);
  const err = g.querySelector('#cg-err');
  g.querySelector('#cg-go').onclick = async () => {
    const a = g.querySelector('#cg-p1').value, b = g.querySelector('#cg-p2').value;
    if(a.length < 8) return err.textContent = 'Use at least 8 characters.';
    if(a !== b) return err.textContent = 'The two passwords don’t match.';
    const {error} = await sb.auth.updateUser({password: a});
    if(error) return err.textContent = error.message;
    if(then){ ungate(); then(); W.toast && W.toast('Password changed'); } else { const {data} = await sb.auth.getSession(); enter(data.session); }
  };
  if(then) g.querySelector('#cg-cancel').onclick = () => { ungate(); then(); };
}

function showBlocked(){
  gate(`<div class="strong">You’re signed in, but not on the team list</div>
    <p class="sub" style="line-height:1.6"><b>${esc(email)}</b> isn’t one of the CRM’s team members yet. Ask the owner to add you in <b>Administration → Team members</b> using exactly this email address, then sign in again.</p>
    <button class="btn" id="cg-out" style="height:36px">Sign out</button>`).querySelector('#cg-out').onclick = signOut;
}
function showDown(e){
  gate(`<div class="strong">Can’t reach the database</div><p class="sub" style="line-height:1.6">${esc(e && e.message || 'Network error')}. Check your internet connection. If it says the project is paused, open your Supabase dashboard and press <b>Restore project</b>.</p><button class="btn pri" id="cg-retry" style="height:36px">Try again</button>`).querySelector('#cg-retry').onclick = () => location.reload();
}
async function signOut(){ try { await flush(true); } catch(e){} await sb.auth.signOut(); location.hash = ''; location.reload(); }

/* ---------- turning the CRM's data into rows and back ---------- */
function rowsOf(db){
  const out = new Map();
  Object.keys(db).forEach(name => {
    if(EXCLUDE.has(name)) return; const v = db[name];
    if(name === 'settings' && v && typeof v === 'object' && !Array.isArray(v)){
      Object.keys(v).forEach(s => { const j = JSON.stringify(v[s]); if(j !== undefined) out.set('_settings' + SEP + s, {c: '_settings', k: s, v: v[s], j, i: 0}); });
      return;
    }
    if(Array.isArray(v)){
      const seen = new Set();
      v.forEach((it, i) => { const j = JSON.stringify(it); if(j === undefined) return; let k = keyOf(it); if(k === null || seen.has(k)) k = 'h:' + hash(j); if(seen.has(k)) return; seen.add(k); out.set(name + SEP + k, {c: name, k, v: it, j, i}); });
      return;
    }
    const j = JSON.stringify(v); if(j !== undefined) out.set('_root' + SEP + name, {c: '_root', k: name, v, j, i: 0});
  });
  // sort positions: keep known ones, slot new ones between their neighbours
  const byC = {}; out.forEach((r, id) => { r.id = id; if(r.c[0] !== '_') (byC[r.c] = byC[r.c] || []).push(r); else r.o = 0; });
  Object.values(byC).forEach(list => {
    list.sort((a, b) => a.i - b.i);
    const nextKnown = new Array(list.length); let nk = null;
    for(let x = list.length - 1; x >= 0; x--){ nextKnown[x] = nk; if(ords.has(list[x].id)) nk = ords.get(list[x].id); }
    let prev = null;
    list.forEach((r, x) => {
      let o = ords.get(r.id);
      if(o === undefined || (prev !== null && o <= prev)){
        const nx = nextKnown[x];
        o = prev !== null && nx !== null && nx > prev ? (prev + nx) / 2 : prev !== null ? prev + 1 : nx !== null ? nx - 1 : 0;
      }
      r.o = o; prev = o;
    });
  });
  return out;
}
function build(rows){
  const d = {}, groups = {};
  rows.forEach(r => {
    if(r.collection === '_root'){ if(!EXCLUDE.has(r.key)) d[r.key] = r.data; }
    else if(r.collection === '_settings'){ (d.settings = d.settings || {})[r.key] = r.data; }
    else (groups[r.collection] = groups[r.collection] || []).push(r);
  });
  Object.keys(groups).forEach(c => { d[c] = groups[c].sort((a, b) => a.ord - b.ord || (a.key < b.key ? -1 : 1)).map(r => r.data); });
  return d;
}
async function fetchAll(){
  const all = []; let from = 0;
  for(;;){
    const {data, error} = await sb.from('records').select('collection,key,ord,data').order('collection').order('key').range(from, from + 999);
    if(error) throw error; all.push(...data); if(data.length < 1000) break; from += 1000;
  }
  return all;
}
function remember(rows){ snap = new Map(); ords = new Map(); rows.forEach(r => { const id = r.collection + SEP + r.key; snap.set(id, JSON.stringify(r.data)); ords.set(id, r.ord); }); }

/* ---------- making sure "me" is the person who signed in ---------- */
function ensureMe(db){
  const DB = db || W.DB; if(!DB || !Array.isArray(DB.users)) return;
  let u = DB.users.find(x => (x.email || '').trim().toLowerCase() === email);
  if(!u && DB.users.length && ownerless){
    // first sign-in on an empty database (e.g. after restoring a backup): this login becomes the owner
    u = DB.users.find(x => x.id === DB.me) || DB.users.find(x => x.sysRole === 'Owner') || DB.users[0];
    u.email = email; setTimeout(() => W.toast && W.toast(`${u.name} now signs in as ${email}`), 300);
  }
  if(u){ DB.me = u.id; ownerless = false; }
  else if(DB.users.length){ DB.me = null; }
}
function guardMyEmail(){
  const DB = W.DB, u = DB && DB.users && DB.users.find(x => x.id === DB.me);
  if(u && (u.email || '').trim().toLowerCase() !== email){ u.email = email; W.toast && W.toast('Your email must match your sign-in email, so it was kept as ' + email, 'err'); }
}

/* ---------- sending changes to the database ---------- */
const later = (() => { let t; return ms => { clearTimeout(t); t = setTimeout(() => flush(), ms); }; })();
W.onDBSaved = () => { if(ready) later(600); };

function chunks(a, n){ const out = []; for(let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }

async function flush(force){
  if(!ready) return;
  if(flushing){ again = true; return; }
  flushing = true; again = false;
  try {
    ensureMe(); guardMyEmail();
    if(W.DB.users && W.DB.users.length && !W.DB.me){ showBlocked(); return; }
    const cur = rowsOf(W.DB);
    const upd = [], fresh = [], hashed = [], del = [];
    cur.forEach((r, id) => {
      if(snap.get(id) === r.j && ords.get(id) === r.o) return;
      const row = {collection: r.c, key: r.k, ord: r.o, data: JSON.parse(r.j), client_id: TAB};
      if(snap.has(id) || r.c[0] === '_') upd.push(row); else if(r.k.startsWith('h:')) hashed.push(row); else fresh.push(row);
    });
    snap.forEach((_, id) => { if(!cur.has(id)) del.push(id); });
    if(!upd.length && !fresh.length && !hashed.length && !del.length){ status('Saved', 'ok'); return; }

    // safety net: never let a glitch wipe the shared database
    if(!force && snap.size > 60 && del.length > snap.size * 0.6){
      if(!confirm(`This would delete ${del.length} of ${snap.size} records from the shared database for everyone. Continue?`)){
        const rows = await fetchAll(); remember(rows); W.replaceDB(build(rows)); ensureMe(); W.render && W.render(true); status('Saved', 'ok'); return;
      }
    }
    status('Saving…', 'busy');
    for(const part of chunks(upd, 400)){ const {error} = await sb.from('records').upsert(part, {onConflict: 'collection,key'}); if(error) throw error; part.forEach(mark); }
    for(const part of chunks(hashed, 400)){ const {error} = await sb.from('records').upsert(part, {onConflict: 'collection,key', ignoreDuplicates: true}); if(error) throw error; part.forEach(mark); }
    for(const part of chunks(fresh, 400)){
      const {error} = await sb.from('records').insert(part);
      if(!error){ part.forEach(mark); continue; }
      if(error.code !== '23505') throw error;
      for(const row of part){   // someone created the same number at the same moment
        const r = await sb.from('records').insert(row);
        if(!r.error){ mark(row); continue; }
        if(r.error.code !== '23505') throw r.error;
        const theirs = await sb.from('records').select('collection,key,ord,data').eq('collection', row.collection).eq('key', row.key).maybeSingle();
        rekey(row.collection, row.key);
        if(theirs.data) applyRow(theirs.data);
        again = true;
      }
    }
    const byC = {}; del.forEach(id => { const [c, k] = id.split(SEP); (byC[c] = byC[c] || []).push(k); });
    for(const c of Object.keys(byC)) for(const keys of chunks(byC[c], 150)){
      const {error} = await sb.from('records').delete().eq('collection', c).in('key', keys); if(error) throw error;
      keys.forEach(k => { snap.delete(c + SEP + k); ords.delete(c + SEP + k); });
    }
    lastSync = Date.now(); status('Saved', 'ok');
  } catch(e){
    console.warn('Cloud save failed', e); status('Not saved – retrying', 'err'); again = true;
    if(/JWT|auth|401/i.test(e.message || '')){ const {data} = await sb.auth.getSession(); if(!data.session) return showLogin('Your session ended. Sign in again – your unsaved changes are kept in this tab.'); }
    setTimeout(() => flush(), 5000);
  } finally {
    flushing = false;
    if(again){ again = false; later(300); }
  }
}
function mark(row){ const id = row.collection + SEP + row.key; snap.set(id, JSON.stringify(row.data)); ords.set(id, row.ord); }

/* Two people created e.g. INV-4123 at the same moment: give ours the next free number */
function rekey(c, oldKey){
  const DB = W.DB, arr = DB[c]; if(!Array.isArray(arr)) return;
  const it = arr.find(x => keyOf(x) === oldKey); if(!it) return;
  const prefix = oldKey.replace(/\d+$/, ''), num = +oldKey.slice(prefix.length) || 0;
  let n = num + 1; const taken = k => snap.has(c + SEP + k) || arr.some(x => keyOf(x) === k);
  while(taken(prefix + n)) n++;
  const newKey = prefix + n; it.id = typeof it.id === 'number' ? n : newKey;
  const swap = o => { if(Array.isArray(o)) o.forEach((v, i) => { if(v === oldKey) o[i] = newKey; else if(v && typeof v === 'object') swap(v); }); else if(o && typeof o === 'object') Object.keys(o).forEach(k => { const v = o[k]; if(v === oldKey) o[k] = newKey; else if(typeof v === 'string' && v.includes(oldKey) && /link|hash|ref/i.test(k)) o[k] = v.split(oldKey).join(newKey); else if(v && typeof v === 'object') swap(v); }); };
  rowsOf(DB).forEach((r, id) => { if(snap.get(id) !== r.j) swap(r.v); });   // only unsaved (ours) records point at it
  if(location.hash.includes(oldKey)) history.replaceState(null, '', location.hash.split(oldKey).join(newKey));
  W.toast && W.toast(`${oldKey} was just taken by a colleague, so yours is now ${newKey}`, 'err');
}

/* ---------- receiving other people's changes ---------- */
function applyRow(row){
  const DB = W.DB, id = row.collection + SEP + row.key, j = JSON.stringify(row.data);
  if(row.collection === '_root'){ if(!EXCLUDE.has(row.key)) DB[row.key] = row.data; }
  else if(row.collection === '_settings'){ DB.settings[row.key] = row.data; }
  else {
    let arr = DB[row.collection]; if(!Array.isArray(arr)) arr = DB[row.collection] = [];
    let at = -1;
    if(row.key.startsWith('h:')){ if(snap.has(id)) at = -2; }
    else at = arr.findIndex(x => keyOf(x) === row.key);
    if(at >= 0 && !snap.has(id) && JSON.stringify(arr[at]) !== j){ rekey(row.collection, row.key); at = -1; }   // our unsaved record had the same number
    if(at >= 0){ const it = arr[at]; if(it && typeof it === 'object' && row.data && typeof row.data === 'object'){ Object.keys(it).forEach(k => delete it[k]); Object.assign(it, row.data); } else arr[at] = row.data; }
    else if(at === -1){
      let pos = arr.length;
      for(let x = 0; x < arr.length; x++){ const k = keyOf(arr[x]); const o = k !== null ? ords.get(row.collection + SEP + k) : undefined; if(o !== undefined && o > row.ord){ pos = x; break; } }
      arr.splice(pos, 0, row.data);
    }
  }
  snap.set(id, j); ords.set(id, row.ord);
}
function removeRow(c, k){
  const DB = W.DB, id = c + SEP + k; snap.delete(id); ords.delete(id);
  if(c === '_root' || c === '_settings') return;
  const arr = DB[c]; if(!Array.isArray(arr)) return;
  const at = k.startsWith('h:') ? arr.findIndex(x => keyOf(x) === null && 'h:' + hash(JSON.stringify(x)) === k) : arr.findIndex(x => keyOf(x) === k);
  if(at >= 0) arr.splice(at, 1);
}
function drain(){
  qTimer = null; const items = queue; queue = []; let n = 0;
  items.forEach(p => {
    if(p.eventType === 'DELETE'){ const o = p.old || {}; if(o.collection && snap.has(o.collection + SEP + o.key)){ removeRow(o.collection, o.key); n++; } return; }
    const r = p.new; if(!r || !r.collection || r.client_id === TAB) return;
    if(snap.get(r.collection + SEP + r.key) === JSON.stringify(r.data)) return;
    applyRow(r); n++;
  });
  if(n) afterRemote();
}
function afterRemote(){
  ensureMe(); lastSync = Date.now();
  if(W.DB.users && W.DB.users.length && !W.DB.me) return showBlocked();
  if(busyUI()){ uiDirty = true; return; }
  repaint();
}
function repaint(){ uiDirty = false; try { W.renderShellCounts && W.renderShellCounts(); W.rerender && W.rerender(); } catch(e){ console.warn(e); } }
setInterval(() => { if(uiDirty && !busyUI()) repaint(); }, 1500);

async function resync(){
  try {
    const rows = await fetchAll(); const have = new Set(); let n = 0;
    rows.forEach(r => { const id = r.collection + SEP + r.key; have.add(id); if(snap.get(id) !== JSON.stringify(r.data)){ applyRow(r); n++; } });
    Array.from(snap.keys()).forEach(id => { if(!have.has(id)){ const [c, k] = id.split(SEP); removeRow(c, k); n++; } });
    if(n) afterRemote(); lastSync = Date.now(); status('Saved', 'ok');
  } catch(e){ status('Offline – retrying', 'err'); }
}

function listen(){
  sb.channel('crm-records')
    .on('postgres_changes', {event: '*', schema: 'public', table: 'records'}, p => { queue.push(p); if(!qTimer) qTimer = setTimeout(drain, 250); })
    .subscribe(s => {
      if(s === 'SUBSCRIBED'){ if(wasDown){ wasDown = false; resync(); } status('Saved', 'ok'); }
      if(s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED'){ wasDown = true; status('Reconnecting…', 'busy'); }
    });
  document.addEventListener('visibilitychange', () => { if(!document.hidden && Date.now() - lastSync > 120000) resync(); });
  setInterval(() => { if(Date.now() - lastSync > 600000) resync(); }, 300000);
}

/* ---------- one browser runs reminders/emails at a time ---------- */
async function lease(){ try { const {data, error} = await sb.rpc('claim_engine', {p_holder: TAB}); isEngine = !error && data === true; } catch(e){ isEngine = false; } }
W.engineAllowed = () => ready && isEngine;

/* ---------- start-up ---------- */
const baseStart = W.App.start;
let entered = false;
async function enter(session){
  if(!session) return showLogin();
  if(entered){ ungate(); flush(); return; }
  entered = true;
  email = (session.user.email || '').trim().toLowerCase();
  gate(`<div class="row gap-8"><span class="muted">Loading your workspace…</span></div>`);
  try {
    sb.rpc('keepalive', {p_source: 'crm'}).then(() => {}, () => {});
    const rows = await fetchAll();
    ownerless = !rows.some(r => r.collection === 'users');
    if(rows.length === 0 && localStorage.getItem('ikusasa-os-live')){
      // this browser already has CRM data from before: offer to upload it
      try { const old = JSON.parse(localStorage.getItem('ikusasa-os-live')); if(old && old.setupDone && old.users && old.users.length){
        const ok = await new Promise(res => { const g = gate(`<div class="strong">Upload this browser’s CRM data?</div><p class="sub" style="line-height:1.6">The online database is empty, and this browser has ${old.clients.length} clients, ${old.users.length} team members and ${(old.invoices||[]).length} invoices saved from before. Upload them so the whole team can use them?</p><div class="row gap-8"><button class="btn pri" id="cg-y" style="height:36px;flex:1">Upload my data</button><button class="btn" id="cg-n" style="height:36px">Start empty</button></div>`); g.querySelector('#cg-y').onclick = () => res(true); g.querySelector('#cg-n').onclick = () => res(false); });
        if(ok) W.CLOUD_DB = old;
      } } catch(e){}
    }
    remember(rows);
    if(!W.CLOUD_DB) W.CLOUD_DB = build(rows);
    ensureMe(W.CLOUD_DB);
    await lease(); setInterval(lease, 60000);
    if(/access_token|type=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    ungate();
    baseStart();               // loads W.CLOUD_DB, runs upgrades, draws the app
    ready = true;
    shareLocalPrefs();
    ensureMe();
    if(W.DB.users.length && !W.DB.me) return showBlocked();
    W.render(true);
    listen();
    flush();
    if(W.WebsiteSync && W.WebsiteSync.schedule){ W.WebsiteSync.schedule(); setTimeout(() => { if(W.engineAllowed() && W.WebsiteSync.connected && W.WebsiteSync.connected()) W.WebsiteSync.sync({quiet: true}); }, 3000); }                   // uploads upgrades / the imported data
  } catch(e){ console.error(e); entered = false; showDown(e); }
}

W.App.start = async () => {
  gate(`<span class="muted">Connecting…</span>`);
  const recovering = /type=(recovery|invite)/.test(location.hash);
  sb.auth.onAuthStateChange((ev, s) => { if(ev === 'PASSWORD_RECOVERY') showSetPassword(); else if(ev === 'SIGNED_OUT' && ready) location.reload(); });
  const {data} = await sb.auth.getSession();
  if(recovering && data.session){ history.replaceState(null, '', location.pathname + location.search); return showSetPassword(); }
  if(data.session) enter(data.session); else showLogin();
};
window.addEventListener('beforeunload', e => { if(!ready) return; const cur = rowsOf(W.DB); let dirty = false; cur.forEach((r, id) => { if(snap.get(id) !== r.j) dirty = true; }); if(dirty){ flush(); e.preventDefault(); e.returnValue = ''; } });

/* ---------- website/n8n connection settings are shared by the whole team online ---------- */
const SHARED_PREFS = {'web-sync': 'websiteSync', 'web-sync-msgs': 'websiteSyncMsgs'};
const P = W.pref, pget = P.get.bind(P), pset = P.set.bind(P);
P.get = (k, d) => { const sk = SHARED_PREFS[k]; if(sk && ready && W.DB && W.DB.settings){ const v = W.DB.settings[sk]; return v === undefined ? d : JSON.parse(JSON.stringify(v)); } return pget(k, d); };
P.set = (k, v) => { const sk = SHARED_PREFS[k]; if(sk && ready && W.DB && W.DB.settings){ W.DB.settings[sk] = v; W.saveNow(); } else pset(k, v); };
function shareLocalPrefs(){ let moved = false; Object.keys(SHARED_PREFS).forEach(k => { const sk = SHARED_PREFS[k]; if(W.DB.settings[sk] === undefined){ const v = pget(k, undefined); if(v !== undefined){ W.DB.settings[sk] = v; moved = true; } } }); return moved; }

/* ---------- small UI changes for cloud mode ---------- */
const A = W.A;
A.switchUser = () => { W.closePop && W.closePop(); W.toast('Everyone signs in with their own email and password now. Sign out first to switch person.'); };
const baseMenu = A.profileMenu;
A.profileMenu = (d, el) => {
  baseMenu(d, el);
  const pop = document.querySelector('body > .pop .menu'); if(!pop) return;
  const mh = Array.from(pop.querySelectorAll('.mh')).find(x => /Working as/.test(x.textContent));
  if(mh){ let n = mh.previousElementSibling && mh.previousElementSibling.classList.contains('sep') ? mh.previousElementSibling : mh; while(n && n.nextElementSibling) n.nextElementSibling.remove(); n.remove(); }
  pop.insertAdjacentHTML('beforeend', `<div class="sep"></div><button data-a="cloudPassword">${W.ic('key-round', 14)}Change my password</button><button data-a="cloudSignOut">${W.ic('log-out', 14)}Sign out</button>`);
};
A.cloudSignOut = () => { W.closePop(); signOut(); };
A.cloudPassword = () => { W.closePop(); showSetPassword(() => {}); };
A.cloudSyncNow = () => { resync(); flush(); W.toast('Synced with the database'); };

const baseSetup = W.Views.setup;
W.Views.setup = () => baseSetup()
  .replace('id="su-email" type="email"', `id="su-email" type="email" value="${esc(email)}" readonly`)
  .replace(/Records are saved in this browser[^<]*/, 'Records are saved in your online database, so your whole team works from the same data. Your sign-in email is your owner account.');
})();
