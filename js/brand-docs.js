/* =====================================================================
   BEMO-SOLUTIONS branded communications
   - Printed / PDF quotes and invoices (letterhead layout)
   - Email-safe versions (inline styles) added below the cover note
   - Short cover notes and a plain-text signature for "open in my email app"
   Colours and fonts match www.bemosolutions.co.za and the n8n email template.
   ===================================================================== */
(function(){
const W = window;
const B = {navy: '#0B1220', ink: '#1A2233', soft: '#5E6782', line: '#E6E9F2', bg: '#EEF2F8', panel: '#F6F8FC', teal: '#0A7F8E', cyan: '#20C7D9', cyanSoft: '#E2F7F9',
  sans: "'Urbanist','Segoe UI',Helvetica,Arial,sans-serif", serif: "'Fraunces',Georgia,'Times New Roman',serif"};
const C = () => DB.settings.company || {};
const site = () => String(C().website || 'www.bemosolutions.co.za').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const mark = s => `<svg width="${s}" height="${s}" viewBox="0 0 64 64" role="img" aria-label="BEMO-SOLUTIONS"><rect width="64" height="64" rx="16" fill="#0B1220"/><path d="M20 15V49M20 15H31A8.5 8.5 0 0 1 31 32H20M20 32H33.5A8.5 8.5 0 0 1 33.5 49H20" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="49" cy="15" r="4.25" fill="#20C7D9"/></svg>`;
const lines = arr => arr.filter(Boolean).map(esc).join('<br>');
const companyLines = () => { const c = C(); return [c.address, [c.reg ? 'Reg. ' + c.reg : '', c.vatNo ? 'VAT ' + c.vatNo : ''].filter(Boolean).join(' · '), [c.email, c.phone].filter(Boolean).join(' · '), site()]; };
const first = n => String(n || '').replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '').split(' ')[0] || 'there';

/* ---------------- printed / PDF documents ---------------- */
function head(kind, id, stamp){
  const c = C();
  return `<div class="bd-head"><div class="bd-brand">${mark(42)}<div><div class="bd-name">${esc(c.name || 'BEMO-SOLUTIONS')}</div><div class="bd-tag">${esc(c.tagline || 'Intelligent solutions. Real business results.')}</div></div></div>
    <div class="bd-title"><div class="bd-kind">${kind}</div><div class="bd-id">${esc(id)}</div>${stamp ? `<div class="bd-stamp">${stamp}</div>` : ''}</div></div><div class="bd-bar"></div>`;
}
function foot(extra){
  return `<div class="bd-foot"><div>${mark(18)}<b>${esc(C().name || 'BEMO-SOLUTIONS')}</b></div><div>${lines([[C().email, C().phone].filter(Boolean).join(' · '), site()])}</div>${extra ? `<div>${extra}</div>` : ''}</div>`;
}
function quoteDoc(q){
  const c = get.client(q.clientId) || {}, t = calc.quote(q), W_ = DB.settings.workflow;
  return `<div class="doc bdoc">${head('Quotation', q.id + ' · v' + q.version, q.status === 'Accepted' ? 'Accepted' : '')}
    <div class="bd-parties"><div><div class="bd-lbl">From</div><b>${esc(C().name || '')}</b><div class="bd-muted">${lines(companyLines().slice(0, 3))}</div></div>
      <div><div class="bd-lbl">Prepared for</div><b>${esc(c.name || '')}</b><div class="bd-muted">${lines([[c.contact, c.title].filter(Boolean).join(', '), c.email, c.location && c.location !== '—' ? c.location : ''])}</div></div>
      <div class="bd-meta"><div><span>Date</span>${fmtD(q.sent || q.created)}</div><div><span>Valid for</span>${q.validDays || 30} days</div>${q.type ? `<div><span>Project type</span>${esc(q.type)}</div>` : ''}</div></div>
    <h3 class="bd-h">${esc(q.title)}</h3>${q.description ? `<p class="bd-muted">${esc(q.description)}</p>` : ''}
    ${q.scope && q.scope.length ? `<div class="bd-scope"><div class="bd-lbl">Scope</div><ul>${q.scope.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
    <table class="bd-tbl"><thead><tr><th style="width:52%">Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead><tbody>${q.items.map(i => `<tr><td>${esc(i.desc)}</td><td class="r">${i.qty}${i.unit && i.unit !== 'item' ? ' ' + esc(i.unit) : ''}</td><td class="r">${fmtR(i.price, true)}</td><td class="r">${fmtR(i.qty * i.price, true)}</td></tr>`).join('')}</tbody></table>
    <div class="bd-tot"><div><span>Subtotal</span><span>${fmtR(t.sub, true)}</span></div><div><span>VAT (${Math.round(q.vat * 100)}%)</span><span>${fmtR(t.vat, true)}</span></div><div class="gt"><span>Total</span><span>${fmtR(t.total, true)}</span></div></div>
    <div class="bd-note"><b>Terms.</b> ${W_.depositRequired !== false ? `${W_.depositPct}% deposit on acceptance; balance on agreed milestones. Work starts once the deposit has cleared. ` : ''}Prices in South African Rand${q.vat ? ', VAT included as shown' : ''}. To accept, reply to the email this quote came with.</div>
    ${C().bank ? `<div class="bd-bank"><div class="bd-lbl">Banking details</div>${esc(C().bank)}<div>Reference: <b>${esc(q.id)}</b></div></div>` : ''}
    ${foot('Thank you for considering BEMO-SOLUTIONS.')}</div>`;
}
function invDoc(i){
  const c = get.client(i.clientId) || {}, t = calc.inv(i); const draft = i.flag === 'draft';
  const terms = Math.max(1, days(i.issued, i.due) || 14); const issued = draft ? TODAY : i.issued, due = draft ? addDays(TODAY, terms) : i.due;
  return `<div class="doc bdoc">${head('Tax invoice', i.id, t.status === 'Paid' ? 'Paid' : draft ? 'Draft' : '')}
    <div class="bd-parties"><div><div class="bd-lbl">From</div><b>${esc(C().name || '')}</b><div class="bd-muted">${lines(companyLines().slice(0, 3))}</div></div>
      <div><div class="bd-lbl">Bill to</div><b>${esc(c.name || '')}</b><div class="bd-muted">${lines([c.contact, c.email, c.location && c.location !== '—' ? c.location : ''])}</div></div>
      <div class="bd-meta"><div><span>Invoice date</span>${fmtD(issued)}</div><div><span>Due date</span>${fmtD(due)}</div>${i.quoteId ? `<div><span>Quote</span>${esc(i.quoteId)}</div>` : ''}</div></div>
    <table class="bd-tbl"><thead><tr><th>Description</th><th class="r">Amount</th></tr></thead><tbody><tr><td>${esc(i.desc || '')}</td><td class="r">${fmtR(t.sub, true)}</td></tr></tbody></table>
    <div class="bd-tot"><div><span>Subtotal</span><span>${fmtR(t.sub, true)}</span></div><div><span>VAT (${Math.round(i.vat * 100)}%)</span><span>${fmtR(t.vat, true)}</span></div><div class="gt"><span>Total</span><span>${fmtR(t.total, true)}</span></div>
      ${t.received ? `<div><span>Paid to date</span><span>${fmtR(t.received, true)}</span></div><div class="gt"><span>Balance due</span><span>${fmtR(t.outstanding, true)}</span></div>` : ''}</div>
    <div class="bd-bank"><div class="bd-lbl">How to pay</div>${C().bank ? esc(C().bank) : '<span class="bd-muted">Banking details are on request.</span>'}<div>Payment reference: <b>${esc(i.id)}</b></div></div>
    ${foot('Thank you for your business.')}</div>`;
}

/* ---------------- email versions (inline styles only) ---------------- */
const td = (html, st) => `<td style="font-family:${B.sans};font-size:14px;line-height:1.5;color:${B.ink};${st || ''}">${html}</td>`;
function emailFrame(kind, id, inner){
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 6px;border:1px solid ${B.line};border-radius:14px;border-collapse:separate;overflow:hidden">
    <tr><td bgcolor="${B.navy}" style="background:${B.navy};padding:16px 20px;border-radius:14px 14px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:${B.sans};font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${B.cyan}">${kind}</td>
      <td align="right" style="font-family:${B.serif};font-size:18px;font-weight:700;color:#ffffff">${esc(id)}</td></tr></table></td></tr>
    <tr><td height="3" bgcolor="${B.cyan}" style="height:3px;line-height:3px;font-size:0;background:${B.cyan}">&nbsp;</td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:18px 20px 20px;border-radius:0 0 14px 14px">${inner}</td></tr></table>`;
}
const rowsTable = (head, rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:6px 0 4px"><tr>${head.map((h, k) => `<td style="font-family:${B.sans};font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${B.soft};padding:8px 6px;border-bottom:2px solid ${B.navy};${k ? 'text-align:right' : ''}">${h}</td>`).join('')}</tr>${rows.map(r => `<tr>${r.map((c, k) => td(c, `padding:9px 6px;border-bottom:1px solid ${B.line};${k ? 'text-align:right;white-space:nowrap' : ''}`)).join('')}</tr>`).join('')}</table>`;
const totals = list => `<table role="presentation" align="right" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;min-width:250px">${list.map(([l, v, big]) => `<tr>${td(esc(l), `padding:4px 6px;color:${big ? B.navy : B.soft};${big ? 'font-weight:800;font-size:15px;border-top:2px solid ' + B.navy + ';padding-top:8px' : ''}`)}${td(v, `padding:4px 6px;text-align:right;white-space:nowrap;${big ? 'font-weight:800;font-size:15px;color:' + B.navy + ';border-top:2px solid ' + B.navy + ';padding-top:8px' : ''}`)}</tr>`).join('')}</table><div style="clear:both;font-size:0;line-height:0">&nbsp;</div>`;
const facts = list => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px">${list.filter(x => x[1]).map(([l, v]) => `<tr>${td(esc(l), `padding:3px 0;color:${B.soft};width:120px`)}${td(v, 'padding:3px 0;font-weight:600')}</tr>`).join('')}</table>`;
const panel = (title, html) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0"><tr><td bgcolor="${B.cyanSoft}" style="background:${B.cyanSoft};border-radius:10px;padding:12px 14px;font-family:${B.sans};font-size:13.5px;line-height:1.5;color:${B.ink}"><b style="color:${B.teal}">${title}</b><br>${html}</td></tr></table>`;
function emailQuote(q){
  const c = get.client(q.clientId) || {}, t = calc.quote(q), W_ = DB.settings.workflow;
  const inner = facts([['Prepared for', esc(c.name || '')], ['Project', esc(q.title)], ['Valid until', fmtD(addDays(q.sent || TODAY, q.validDays || 30))]]) +
    (q.scope && q.scope.length ? `<p style="margin:10px 0 4px;font-family:${B.sans};font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${B.navy}">Scope</p><ul style="margin:0 0 6px;padding-left:18px;font-family:${B.sans};font-size:14px;line-height:1.55;color:${B.ink}">${q.scope.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '') +
    rowsTable(['Description', 'Qty', 'Amount'], q.items.map(i => [esc(i.desc), String(i.qty), fmtR(i.qty * i.price, true)])) +
    totals([['Subtotal', fmtR(t.sub, true)], [`VAT (${Math.round(q.vat * 100)}%)`, fmtR(t.vat, true)], ['Total', fmtR(t.total, true), true]]) +
    panel('Terms', (W_.depositRequired !== false ? `${W_.depositPct}% deposit on acceptance; balance on agreed milestones. ` : '') + 'To go ahead, simply reply to this email.');
  return emailFrame('Quotation', q.id, inner);
}
function emailInvoice(i, reminder){
  const c = get.client(i.clientId) || {}, t = calc.inv(i); const draft = i.flag === 'draft';
  const terms = Math.max(1, days(i.issued, i.due) || 14); const issued = draft ? TODAY : i.issued, due = draft ? addDays(TODAY, terms) : i.due;
  const inner = facts([['Bill to', esc(c.name || '')], ['Invoice date', fmtD(issued)], ['Due date', fmtD(due) + (reminder && t.overdue ? ` <span style="color:#B42318">(${t.daysOver} day${t.daysOver === 1 ? '' : 's'} overdue)</span>` : '')], ['Quote', i.quoteId ? esc(i.quoteId) : '']]) +
    rowsTable(['Description', 'Amount'], [[esc(i.desc || ''), fmtR(t.sub, true)]]) +
    totals([['Subtotal', fmtR(t.sub, true)], [`VAT (${Math.round(i.vat * 100)}%)`, fmtR(t.vat, true)], ['Total', fmtR(t.total, true), !t.received]].concat(t.received ? [['Paid to date', fmtR(t.received, true)], ['Balance due', fmtR(t.outstanding, true), true]] : [])) +
    panel('How to pay', (C().bank ? esc(C().bank) + '<br>' : '') + `Payment reference: <b>${esc(i.id)}</b>` + (C().vatNo ? `<br><span style="color:${B.soft}">${esc(C().name)} · VAT no. ${esc(C().vatNo)}</span>` : ''));
  return emailFrame(reminder ? 'Payment reminder' : 'Tax invoice', i.id, inner);
}

/* ---------------- cover notes & text signature ---------------- */
function quoteCover(q){ const c = get.client(q.clientId) || {};
  return [`Dear ${first(c.contact)},`, '', `Thank you for the opportunity. Our quotation for ${q.title} is below. It's valid until ${fmtD(addDays(TODAY, q.validDays || 30))}.`, '', 'To go ahead, simply reply to this email to confirm. Happy to walk you through anything on a quick call.', '', 'Kind regards'].join('\n'); }
function invoiceCover(i, reminder){ const c = get.client(i.clientId) || {}, t = calc.inv(i); const draft = i.flag === 'draft'; const due = draft ? addDays(TODAY, Math.max(1, days(i.issued, i.due) || 14)) : i.due;
  return (reminder
    ? [`Dear ${first(c.contact)},`, '', `This is a friendly reminder that invoice ${i.id} for ${fmtR(t.outstanding, true)} ${t.overdue ? `was due on ${fmtD(due)}` : `is due on ${fmtD(due)}`}. The details and our banking details are below. If you've already paid, thank you, and please ignore this message.`, '', 'Kind regards']
    : [`Dear ${first(c.contact)},`, '', `Please find tax invoice ${i.id} for ${fmtR(t.total, true)} below, due on ${fmtD(due)}. Our banking details and the payment reference are included.`, '', 'Any questions? Just reply to this email.', '', 'Kind regards']).join('\n'); }
/* the detail lines of the plain-text versions (used for "open in my email app" and as the plain-text fallback) */
function between(text, from, to){ const L = String(text).split('\n'); const a = L.findIndex(l => from.test(l)); const b = L.findIndex((l, k) => k > a && to.test(l)); return a < 0 ? '' : L.slice(a, b < 0 ? undefined : b).join('\n').trim(); }
function textSignature(){ const u = me() || {}, c = C();
  return ['', '—', u.name || '', [u.title || u.role, c.name || 'BEMO-SOLUTIONS'].filter(Boolean).join(' · '), [u.email || c.email, u.phone && u.phone !== '—' ? u.phone : c.phone].filter(Boolean).join(' · '), site()].filter((x, k) => k < 2 || x).join('\n'); }

W.brand = {B, mark, quoteDoc, invDoc, emailQuote, emailInvoice, quoteCover, invoiceCover, between, textSignature, site};
W.brandQuoteDoc = quoteDoc; W.brandInvoiceDoc = invDoc;
})();
