/* ============ Website connection (n8n) ============
   Connects the Operations OS to the n8n workflow "BEMO: Client intake, reminders & follow-ups"
   (n8n/bemo-intake-automation.n8n.json).

   Every sync sends one POST to the webhook:
     { action:'push', key, today, company, statuses, tasks, calls, invoices, followUps }
   and gets back the website leads from the Google Sheet:
     { ok:true, count, leads:[{ leadId, name, email, company, phone, industry, interests, message, status, ... }] }

   - New website leads become enquiries in the Intake Inbox (channel "Website form"), matched to an existing
     client by email or company name, with a high-priority reply task due within one business day.
   - Each enquiry's progress goes back as the lead status (New / Contacted / Booked / Proposal / Won / Lost / Closed),
     which stops follow-up nudges once a lead has moved on.
   - Open tasks, upcoming discovery calls, client follow-ups and overdue invoices go to n8n for the 07:00 digest email.
   - Email: "Send email" in Communications / Intake Inbox sends through n8n ({action:'send'}), and replies that
     n8n received through Brevo come back in the same sync response ({messages:[…]}) and land in the right thread.

   The URL and key are kept in this browser only (not in backups). */
(function(){
  const PK = 'web-sync';
  const EVERY_MIN = 5;
  const cfg = () => Object.assign({url:'', key:'', auto:true, last:null, lastErr:'', imported:[]}, pref.get(PK, {}));
  const setCfg = patch => pref.set(PK, Object.assign(cfg(), patch));
  const connected = () => { const c = cfg(); return !!(c.url && c.key); };
  let busy = false, timer = null;

  /* Enquiry (and its client) -> lead status used by the workflow */
  function leadStatus(e){
    const c = e.clientId ? get.client(e.clientId) : null;
    const cs = c ? c.status : '';
    if(/Lost/.test(cs)) return 'Lost';
    if(/Accepted|Payment pending|Active client|Project completed|Ongoing partnership/.test(cs)) return 'Won';
    if(/Quote|Awaiting decision|Assessment/.test(cs)) return 'Proposal';
    if(/Discovery/.test(cs) || e.status === 'Converted') return 'Booked';
    if(e.status === 'Archived') return 'Closed';
    if(e.status === 'Contacted' || cs === 'Contacted') return 'Contacted';
    return 'New';
  }

  const uname = id => { const u = id && get.user(id); return u ? u.name : ''; };
  const cname = id => { const c = id && get.client(id); return c ? c.name : ''; };
  const nextWorkday = d => { let x = addDays(d, 1); while([0,6].includes(new Date(x + 'T12:00').getDay())) x = addDays(x, 1); return x; };

  function payload(){
    const c = cfg();
    const in7 = addDays(TODAY, 7);
    return {
      action: 'push', key: c.key, today: TODAY, company: (DB.settings.company && DB.settings.company.name) || '',
      statuses: DB.enquiries.filter(e => e.leadId).map(e => ({leadId: e.leadId, status: leadStatus(e)})),
      tasks: DB.tasks.filter(t => t.status !== 'Done' && t.due && t.due <= in7)
        .sort((a,b) => a.due.localeCompare(b.due)).slice(0, 150)
        .map(t => ({title: t.title, client: cname(t.clientId), assignee: uname(t.assignee), due: t.due, priority: t.priority})),
      calls: DB.discoveries.filter(d => d.status === 'Scheduled' && d.date && d.date.slice(0,10) >= TODAY).slice(0, 50)
        .map(d => ({client: cname(d.clientId), date: d.date, with: uname(d.assistant), category: d.category})),
      invoices: DB.invoices.map(i => ({i, x: calc.inv(i)})).filter(o => o.x.overdue).slice(0, 100)
        .map(o => ({number: o.i.id, client: cname(o.i.clientId), daysOver: o.x.daysOver, outstanding: Math.round(o.x.outstanding * 100) / 100})),
      followUps: DB.clients.filter(cl => cl.nextFollowUp && cl.nextFollowUp <= TODAY && cl.status !== 'Lost / archived').slice(0, 100)
        .map(cl => ({client: cl.name, contact: cl.contact, date: cl.nextFollowUp, owner: uname(cl.owner)}))
    };
  }

  /* Sheet timestamp (ISO) -> the app's local "YYYY-MM-DDTHH:MM" */
  function stamp(v){
    const d = new Date(v || Date.now()); if(isNaN(d)) return nowStamp();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* Likely engagement from what the lead ticked */
  function engagement(interests){
    const t = String(interests || '');
    if(/Partnership/i.test(t)) return 'Evolution partnership';
    if(/Build|Automation|AI|Website/i.test(t)) return 'Build & implement';
    return 'Assessment';
  }

  function matchClient(email, company){
    const em = email.toLowerCase(), co = company.toLowerCase().trim();
    return DB.clients.find(x => em && (x.email || '').toLowerCase() === em)
      || DB.clients.find(x => em && (x.contacts || []).some(k => (k.email || '').toLowerCase() === em))
      || DB.clients.find(x => co && (x.name || '').toLowerCase().trim() === co) || null;
  }

  function importLeads(leads){
    const c = cfg();
    const seen = new Set(c.imported.concat(DB.enquiries.filter(e => e.leadId).map(e => e.leadId)));
    const added = [];
    (leads || []).forEach(l => {
      // Sheets written by the simpler workflow have no leadId: fall back to time + email.
      const id = String(l.leadId || (l.submittedAt && l.email ? 'W-' + l.submittedAt + '-' + String(l.email).toLowerCase() : ''));
      if(!id || seen.has(id)) return;
      seen.add(id);
      const email = String(l.email || '').trim(), name = String(l.name || '').trim() || email;
      const company = String(l.company || '').trim();
      const client = matchClient(email, company);
      const interests = Array.isArray(l.interests) ? l.interests.join(', ') : String(l.interests || '');
      const body = [String(l.message || '').trim() || '(No message)',
        interests ? 'Interested in: ' + interests : '', l.industry ? 'Industry: ' + l.industry : '',
        'Likely engagement: ' + engagement(interests)].filter(Boolean).join('\n\n');
      const e = {id: nextId('E-', DB.enquiries), channel: 'web', from: name, company: client ? client.name : (company || name),
        email, phone: String(l.phone || ''), clientId: client ? client.id : null, received: stamp(l.submittedAt),
        subject: 'Website: discovery call request', body, status: 'Unprocessed', assistant: null, read: false,
        ai: Object.assign(window.classify(body), {match: client ? 'existing' : 'new'}), leadId: id,
        tags: [l.industry, ...interests.split(',').map(s => s.trim()), engagement(interests)].filter(Boolean)};
      if(e.ai && l.industry && (!e.ai.industry || e.ai.industry === 'Unclassified')) e.ai.industry = l.industry;
      DB.enquiries.unshift(e); added.push(e);
    });
    setCfg({imported: Array.from(seen).slice(-3000)});
    if(added.length && DB.users.length && (!DB.settings.workflow || DB.settings.workflow.autoClassify !== false)){
      added.forEach(e => {
        try {
          window.finishProcess(e);
          const t = DB.tasks.find(x => x.enquiryId === e.id);
          if(t){ t.title = `Reply to website lead: ${e.from} (${e.company})`; t.priority = 'High'; t.due = nextWorkday(e.received.slice(0,10)); if(t.due < TODAY) t.due = TODAY; }
        } catch(err){ console.warn('Auto-process failed', err); }
      });
    }
    if(added.length) notify('task', `${added.length} new website lead${added.length===1?'':'s'} in the Intake Inbox`, 'inbox');
    return added.length;
  }

  async function sync(opts){
    opts = opts || {};
    if(busy || !connected()) return;
    busy = true;
    try {
      const c = cfg();
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
      // text/plain keeps this a "simple" request, so the browser sends no CORS preflight.
      const res = await fetch(c.url, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify(payload()), signal: ctrl.signal, redirect: 'follow'});
      clearTimeout(t);
      let data = {}; try { data = await res.json(); } catch(e){}
      if(!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
      if(!Array.isArray(data.leads)) throw new Error('No lead list returned. Check that you used the Production URL.');
      const n = importLeads(data.leads);
      const r = importMessages(data.messages);
      // Newer workflows say what they support; the old one has no email sending.
      setCfg({last: new Date().toISOString(), lastErr: '', oldWorkflow: !(Array.isArray(data.features) && data.features.includes('email'))});
      const bits = [n ? `${n} new website lead${n===1?'':'s'}` : '', r ? `${r} new email${r===1?'':'s'}` : ''].filter(Boolean).join(' and ');
      commit(opts.quiet && !bits ? '' : (bits ? `${bits} received` : 'Synced. Nothing new.'));
    } catch(err){
      const msg = err.name === 'AbortError' ? 'Timed out' : (err.message || 'Failed to fetch');
      setCfg({lastErr: msg + ' · ' + new Date().toLocaleString()});
      if(!opts.quiet) toast('Website sync failed: ' + msg, 'err');
      if(ROUTE.page === 'inbox') rerender();
    } finally { busy = false; }
  }

  function schedule(){
    clearInterval(timer);
    if(connected() && cfg().auto) timer = setInterval(() => { if(window.engineAllowed && !window.engineAllowed()) return; sync({quiet: true}); }, EVERY_MIN * 60 * 1000);
  }

  /* ---- UI: "Sync website leads" + plug button on the Intake Inbox ---- */
  const baseInbox = Views.inbox;
  Views.inbox = id => {
    const r = baseInbox(id); const c = cfg();
    const btn = (connected() ? `<button class="btn ghost" data-a="webSync">${ic('refresh-cw',14)}Sync website leads</button>` : '') +
      `<button class="btn ghost" data-a="webConn" title="Website connection" aria-label="Website connection">${ic('plug',14)}${connected() ? '' : 'Connect website'}</button>`;
    r.html = r.html.replace('<button class="btn pri" data-a="newEnquiry">', btn + '<button class="btn pri" data-a="newEnquiry">');
    if(connected()){
      const st = c.lastErr ? `<b>Last sync failed:</b> ${esc(c.lastErr)}` : (c.last ? `Website form connected. Last sync ${esc(rel(stamp(c.last)))}.` : 'Website form connected. Not synced yet.');
      r.html = r.html.replace(/Email, WhatsApp and website forms are not connected yet\.[^<]*<b>New enquiry<\/b>;[^<]*/, st + ' Leads arrive here automatically while the app is open. ');
    }
    return r;
  };

  A.webConn = () => { const c = cfg(); modal({title: 'Website connection', body:
    `<p class="sub small" style="line-height:1.55;margin-bottom:12px">Paste the <b>Production URL</b> of the n8n webhook (node “Website &amp; CRM requests”, ends in <span class="mono">/webhook/bemo-lead</span>) and the same <b>CRM_KEY</b> you set in the n8n node “Settings (edit me)”.</p>
     <div class="form-grid">${field('Webhook production URL', `<input class="inp" id="ws-url" value="${esc(c.url)}" placeholder="https://your-n8n/webhook/bemo-lead">`, 'span2')}
     ${field('CRM key (20+ characters)', `<input class="inp" id="ws-key" type="password" value="${esc(c.key)}" autocomplete="off">`, 'span2')}
     ${field('Sync automatically', `<select class="sel" id="ws-auto">${opts([['1',`Every ${EVERY_MIN} minutes while the app is open`],['0','Only when I click Sync website leads']], c.auto ? '1' : '0')}</select>`, 'span2')}</div>
     <p class="muted xs" style="margin-top:10px">Saved in this browser only, never in backups. ${c.last ? 'Last successful sync: ' + esc(new Date(c.last).toLocaleString()) + '.' : ''}</p>`,
    foot: `${connected() ? '<button class="btn ghost" data-a="webDisconnect">Disconnect</button>' : ''}<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="webSave">${ic('plug',14)}Save &amp; sync</button>`}); };

  A.webSave = () => {
    const url = String(val('ws-url') || '').trim(), key = String(val('ws-key') || '').trim();
    if(!/^https?:\/\/\S+$/.test(url)) return toast('Enter the full webhook URL (https://…)', 'err');
    if(/\/webhook-test\//.test(url)) return toast('That is the Test URL. Use the Production URL (/webhook/…)', 'err');
    if(key.length < 20) return toast('The CRM key must be at least 20 characters, the same as in n8n', 'err');
    setCfg({url, key, auto: val('ws-auto') === '1', lastErr: ''});
    closeTop(); schedule(); sync();
  };
  A.webDisconnect = () => { setCfg({url: '', key: ''}); clearInterval(timer); closeTop(); commit('Website disconnected'); };
  A.webSync = () => sync();

  /* ================= CRM email: send from the CRM, receive replies ================= */
  const MSG_PK = 'web-sync-msgs';
  const OLD_WF = 'n8n is still running the OLD workflow, which can’t send email. Re-import n8n\\bemo-intake-automation.n8n.json in n8n, reconnect the logins, switch it on, then try again.';
  let composeLead = null;

  async function post(body){
    const c = cfg();
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(c.url, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify(Object.assign({key: c.key}, body)), signal: ctrl.signal});
      let data = {}; try { data = await res.json(); } catch(e){}
      if(!res.ok || data.ok === false){
        // The pre-email workflow treats {action:'send'} as a website form with no name and answers this:
        if(body.action === 'send' && /name and a valid email are required/i.test(data.error || '')){ setCfg({oldWorkflow: true}); throw new Error(OLD_WF); }
        throw new Error(data.error || ('HTTP ' + res.status));
      }
      return data;
    } catch(err){ throw new Error(err.name === 'AbortError' ? 'Timed out' : (err.message || 'Failed to fetch')); }
    finally { clearTimeout(t); }
  }

  const baseSubj = s => String(s || '').replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, '').trim();
  const clientByEmail = addr => { const a = String(addr || '').toLowerCase(); return a ? (DB.clients.find(x => (x.email || '').toLowerCase() === a) || DB.clients.find(x => (x.contacts || []).some(k => (k.email || '').toLowerCase() === a)) || null) : null; };
  function newConv(client, subject, leadId){
    const cv = {id: nextId('CV-', DB.conversations), clientId: client.id, channel: 'email', subject: subject || 'Email',
      participants: [client.contact, me() ? me().name : ''].filter(Boolean), assigned: client.assistant || DB.me, projectId: null, followUp: 'Open', messages: []};
    if(leadId) cv.leadId = leadId;
    DB.conversations.unshift(cv); return cv;
  }

  /* Replies collected by n8n -> the right conversation (or a new enquiry for unknown senders) */
  function importMessages(list){
    if(!Array.isArray(list) || !list.length) return 0;
    const seen = new Set(pref.get(MSG_PK, []));
    DB.conversations.forEach(cv => (cv.messages || []).forEach(m => m.mid && seen.add(m.mid)));
    let n = 0;
    list.forEach(m => {
      if(!m || !m.id || seen.has(m.id)) return;
      seen.add(m.id);
      const tok = (m.to || []).map(a => String(a).match(/^(c|lead)-([^@]+)@/)).find(Boolean) || [];
      let cv = null, client = null;
      if(tok[1] === 'c') cv = DB.conversations.find(x => String(x.id).toLowerCase() === tok[2]) || null;
      if(!cv && tok[1] === 'lead'){
        const e = DB.enquiries.find(x => String(x.leadId || '').toLowerCase() === tok[2]);
        if(e){
          if(!e.clientId && DB.users.length && window.finishProcess){ try { window.finishProcess(e); } catch(err){} }
          client = e.clientId ? get.client(e.clientId) : null;
          if(client) cv = DB.conversations.find(x => x.leadId === e.leadId) || newConv(client, baseSubj(m.subject) || 'Website enquiry', e.leadId);
        }
      }
      if(!cv){
        client = client || clientByEmail(m.from);
        if(client){
          const s = baseSubj(m.subject).toLowerCase();
          cv = DB.conversations.find(x => x.clientId === client.id && x.channel === 'email' && baseSubj(x.subject).toLowerCase() === s) || newConv(client, baseSubj(m.subject));
        }
      }
      if(!cv){
        // Someone the CRM doesn't know yet: becomes a new email enquiry in the Intake Inbox.
        const body = m.text || '(empty email)';
        DB.enquiries.unshift({id: nextId('E-', DB.enquiries), channel: 'email', from: m.fromName || m.from, company: m.fromName || m.from, email: m.from, phone: '',
          clientId: null, received: stamp(m.at), subject: m.subject || 'Email', body, status: 'Unprocessed', assistant: null, read: false,
          ai: Object.assign(window.classify(body), {match: 'new'}), mid: m.id});
        notify('enquiry', `New email from ${m.fromName || m.from} in the Intake Inbox`, 'inbox');
        n++; return;
      }
      cv.messages.push({from: m.fromName || m.from, fromAddr: m.from, at: stamp(m.at), body: m.text || '', attachments: m.attachments || [], mid: m.id, inbound: true});
      cv.followUp = 'Open'; cv.unread = true;
      const cl = get.client(cv.clientId); if(cl) cl.lastContact = TODAY;
      log(`Email received from <b>${esc(m.fromName || m.from)}</b>: “${esc(baseSubj(m.subject))}”`, cv.clientId, 'comms', 'email');
      notify('message', `Email reply from ${m.fromName || m.from}: ${baseSubj(m.subject)}`, 'comms');
      n++;
    });
    pref.set(MSG_PK, Array.from(seen).slice(-3000));
    return n;
  }

  const isMine = m => !m.inbound && DB.users.some(u => u.name === m.from);
  const lastInbound = cv => { for(let i = cv.messages.length - 1; i >= 0; i--){ if(!isMine(cv.messages[i])) return cv.messages[i]; } return null; };
  function markContacted(client){
    DB.enquiries.filter(e => e.clientId === client.id && (e.status === 'Unprocessed' || e.status === 'New')).forEach(e => { e.status = 'Contacted'; });
    if(client.status === 'New enquiry' || client.status === 'Contact pending') client.status = 'Contacted';
    client.lastContact = TODAY;
  }

  /* Sends one email for a conversation through n8n and records it */
  async function sendEmail(cv, text){
    const c = get.client(cv.clientId); const li = lastInbound(cv); const u = me() || {};
    const to = (li && li.fromAddr) || cv.to || (c && c.email) || '';
    if(!/^\S+@\S+\.\S+$/.test(to)) throw new Error('No email address for this client. Add one on the client record first.');
    const subject = !cv.messages.length || /^re:/i.test(cv.subject) ? cv.subject : 'Re: ' + cv.subject;
    const company = (DB.settings.company && DB.settings.company.name) || 'BEMO-SOLUTIONS';
    await post({action: 'send', to, subject, text, fromName: u.name ? `${u.name} | ${company}` : company,
      signature: {name: u.name || '', title: u.title || u.role || ''}, token: 'c-' + String(cv.id).toLowerCase(),
      quote: li ? {from: li.from, at: fmtDT(li.at), text: li.body} : null});
    cv.messages.push({from: u.name || company, at: nowStamp(), body: text, attachments: [], sent: true, to});
    cv.followUp = 'Awaiting client'; cv.unread = false;
    if(c) markContacted(c);
  }

  const busyBtn = (el, on, label) => { if(!el) return; el.disabled = on; if(on) el.textContent = 'Sending…'; else el.innerHTML = ic('send', 13) + label; };

  const baseSendReply = A.sendReply;
  A.sendReply = async (d, el) => {
    const cv = get.conv(d.id);
    if(!cv || cv.channel !== 'email' || !connected()) return baseSendReply(d, el);
    const text = String(val('rp-' + d.id) || '').trim(); if(!text) return toast('Write a reply first', 'err');
    busyBtn(el, true);
    try { await sendEmail(cv, text); log(`Emailed reply on “${esc(cv.subject)}”`, cv.clientId, 'comms', 'email'); commit('Email sent'); }
    catch(err){ toast('Not sent: ' + err.message, 'err'); busyBtn(el, false, 'Send email'); }
  };

  const baseSendCompose = A.sendCompose;
  A.sendCompose = async (d, el) => {
    if(val('cm-ch') !== 'email' || !connected()) return baseSendCompose(d, el);
    if(!requireFields([['cm-client','Client'],['cm-subj','Subject'],['cm-body','Message']])) return;
    const c = get.client(val('cm-client'));
    const cv = {id: nextId('CV-', DB.conversations), clientId: c.id, channel: 'email', subject: val('cm-subj'), participants: [c.contact, me().name],
      assigned: DB.me, projectId: val('cm-proj') || null, followUp: 'Awaiting client', messages: [], to: String(val('cm-to') || '').trim()};
    if(composeLead) cv.leadId = composeLead;
    busyBtn(el, true);
    try {
      await sendEmail(cv, val('cm-body'));
      DB.conversations.unshift(cv); composeLead = null;
      log(`Email sent: “${esc(cv.subject)}”`, c.id, 'comms', 'email');
      closeTop(); setv('convSel', cv.id, false); setv('ctabc', 'all'); save(); go('comms'); toast('Email sent');
    } catch(err){ toast('Not sent: ' + err.message, 'err'); busyBtn(el, false, 'Send email'); }
  };

  function patchCompose(){
    const btn = document.querySelector('[data-a="sendCompose"]'), ch = document.getElementById('cm-ch');
    if(!btn || !ch || !connected()) return;
    const span = [...document.querySelectorAll('.callout span')].find(s => /records the message/.test(s.textContent));
    const orig = span ? span.innerHTML : '';
    const title = [...document.querySelectorAll('h1,h2,h3,.mh,.modal-title,.mt')].find(x => x.textContent.trim() === 'Log a message' || x.textContent.trim() === 'New email');
    const upd = () => {
      const em = ch.value === 'email';
      if(title) title.textContent = em ? 'New email' : 'Log a message';
      btn.innerHTML = ic(em ? 'send' : 'check', 14) + (em ? 'Send email' : 'Save to history');
      if(span) span.innerHTML = em ? 'This email is <b>sent</b> from your work address through n8n. Replies come back to <b>Communications</b> automatically.' : orig;
    };
    ch.addEventListener('change', upd); upd();
  }
  const baseCompose = A.compose;
  A.compose = d => { composeLead = null; baseCompose(d); patchCompose(); };

  /* Intake Inbox: one-click "Email lead" for the selected enquiry */
  A.emailLead = d => {
    const e = get.enquiry(d.id); if(!e) return;
    if(!e.clientId && DB.users.length && window.finishProcess){ try { window.finishProcess(e); } catch(err){} }
    if(!e.clientId) return toast('Process the enquiry first so it has a client', 'err');
    baseCompose({client: e.clientId, to: e.email, subject: 'Your discovery call request with ' + ((DB.settings.company && DB.settings.company.name) || 'BEMO-SOLUTIONS')});
    composeLead = e.leadId || null; patchCompose();
  };
  const inboxView = Views.inbox;
  Views.inbox = id => {
    const r = inboxView(id);
    const m = r.html.match(/class="ibx-m on[^"]*" data-go="inbox-([^"]+)"/);
    const e = m && get.enquiry(m[1]);
    if(connected() && e && e.email) r.html = r.html.replace('<button class="btn pri" data-a="newEnquiry">', `<button class="btn ghost" data-a="emailLead" data-id="${esc(e.id)}">${ic('mail',14)}Email ${esc(String(e.from).split(' ')[0])}</button><button class="btn pri" data-a="newEnquiry">`);
    return r;
  };

  /* Communications: real "Send email", a "Check email" button, and unread replies in bold */
  const commsView = Views.comms;
  Views.comms = (...args) => {
    const r = commsView(...args);
    if(!connected()) return r;
    const m = r.html.match(/data-a="sendReply" data-id="([^"]+)"/); const sel = m && get.conv(m[1]);
    if(sel && sel.channel === 'email'){
      if(sel.unread){ sel.unread = false; save(); }
      r.html = r.html.replace(`${ic('flask-conical',12)} Saved to the history only — send it from your mail or WhatsApp app.`, `${ic('send',12)} Sends from your work email. Replies arrive here automatically.`)
                     .replace(`${ic('check',13)}Save reply</button>`, `${ic('send',13)}Send email</button>`);
    }
    if(cfg().oldWorkflow) r.html = r.html.replace('<div class="ibx"', `<div class="callout warn" style="margin-bottom:12px">${ic('alert-triangle',15)}<span><b>Email can’t be sent yet.</b> ${esc(OLD_WF)} <a href="#" data-a="webSync">Check again</a></span></div><div class="ibx"`);
    r.html = r.html.replace(/class="ibx-m ([^"]*)" data-a="convSel" data-id="([^"]+)"/g, (all, cls, id) => { const cv = get.conv(id); return cv && cv.unread ? `class="ibx-m ${cls} unread" data-a="convSel" data-id="${id}"` : all; })
                   .replace('<button class="btn pri" data-a="compose">', `<button class="btn ghost" data-a="webSync" title="Check for new emails and leads">${ic('refresh-cw',14)}Check email</button><button class="btn pri" data-a="compose">`);
    return r;
  };

  window.WebsiteSync = {sync, schedule, payload, leadStatus, importMessages, post, connected, lastInbound: cv => lastInbound(cv)};
  if(!window.CLOUD_ON) window.addEventListener('load', () => setTimeout(() => { schedule(); sync({quiet: true}); }, 1500));   // online mode: cloud.js starts it after sign-in
  document.addEventListener('visibilitychange', () => { const l = cfg().last; if(document.visibilityState === 'visible' && (!l || Date.now() - new Date(l) > 60000)) sync({quiet: true}); });
})();
