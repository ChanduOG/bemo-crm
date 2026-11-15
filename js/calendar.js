/* =====================================================================
   Team calendar: one shared schedule for discovery calls, meetings,
   site visits, blocked time and leave. Blocks double bookings.
   ===================================================================== */
(function(){
const W = window;
const H = 46;                                   // pixels per hour in week view
const KINDS = [['discovery','Discovery call','phone-call'],['meeting','Meeting','users'],['site','Site visit','map-pin'],['blocked','Blocked time','lock'],['leave','Leave / away','plane']];
const KIND = Object.fromEntries(KINDS.map(k => [k[0], k]));
const DURS = [[15,'15 min'],[30,'30 min'],[45,'45 min'],[60,'1 hour'],[90,'1½ hours'],[120,'2 hours'],[180,'3 hours'],[240,'4 hours']];

const cfg = () => { const S = DB.settings; S.calendar = Object.assign({start:'08:00', end:'17:00', buffer:15, dur:60, days:[1,2,3,4,5]}, S.calendar || {}); return S.calendar; };
const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const toT = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const dow = d => pd(d).getUTCDay();
const weekStart = d => addDays(d, -((dow(d) + 6) % 7));       // Monday
const nowMin = () => { const t = new Date(); return t.getHours() * 60 + t.getMinutes(); };
const uname = id => (get.user(id) || {name: 'Someone'}).name;
const firstN = id => uname(id).split(' ')[0];

/* ---------- all bookings in one shape ---------- */
function bookings(from, to){
  const out = [];
  (DB.discoveries || []).forEach(d => {
    if(!d.date || d.status === 'Cancelled') return; const day = d.date.slice(0, 10);
    if(from && (day < from || day > to)) return;
    const c = get.client(d.clientId) || {name: 'Client'};
    out.push({key: 'disc:' + d.id, kind: 'discovery', title: c.name, sub: d.category + ' discovery', date: day, start: toMin(d.date.slice(11, 16) || '10:00'), dur: +d.duration || cfg().dur, people: uniq([d.assistant].concat(d.attendees || [])).filter(Boolean), clientId: d.clientId, done: d.status === 'Completed', src: d});
  });
  (DB.events || []).forEach(e => {
    const until = e.until && e.until > e.date ? e.until : e.date;
    for(let day = e.date, n = 0; day <= until && n < 62; day = addDays(day, 1), n++){
      if(from && (day < from || day > to)) continue;
      out.push({key: 'ev:' + e.id, kind: e.kind, title: e.title || KIND[e.kind][1], sub: e.clientId && get.client(e.clientId) ? get.client(e.clientId).name : (e.notes || ''), date: day, start: e.allDay ? 0 : toMin(e.time), dur: e.allDay ? 1440 : (+e.duration || 60), allDay: !!e.allDay, people: e.people || [], clientId: e.clientId, src: e});
    }
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}
W.calBookings = bookings;

/* Clashes: same person, overlapping time (plus the buffer between calls) */
function clashes({people, date, start, dur, allDay, until, ignore}){
  const buf = +cfg().buffer || 0; const out = [];
  const daysList = []; for(let d = date, n = 0; d <= (allDay && until > date ? until : date) && n < 62; d = addDays(d, 1), n++) daysList.push(d);
  daysList.forEach(day => bookings(day, day).forEach(b => {
    if(b.key === ignore || b.done) return;
    const who = b.people.filter(p => people.includes(p)); if(!who.length) return;
    const s = allDay ? 0 : start, e = allDay ? 1440 : start + dur;
    const pad = (allDay || b.allDay) ? 0 : buf;
    if(s < b.start + b.dur + pad && b.start < e + pad) out.push(Object.assign({who}, b));
  }));
  return out;
}
function freeSlots(people, date, dur, ignore, limit){
  const c = cfg(), out = []; const step = 15;
  for(let m = toMin(c.start); m + dur <= toMin(c.end); m += step){
    if(date === TODAY && m < nowMin() + 15) continue;
    if(!clashes({people, date, start: m, dur, ignore}).length){ out.push(m); if(out.length >= (limit || 99)) break; }
  }
  return out;
}
function nextFree(people, from, dur, ignore){
  const c = cfg();
  for(let i = 0; i < 45; i++){
    const day = addDays(from < TODAY ? TODAY : from, i); if(!c.days.includes(dow(day))) continue;
    const s = freeSlots(people, day, dur, ignore, 1); if(s.length) return {date: day, start: s[0]};
  }
  return null;
}
W.calNextFree = nextFree; W.calClashes = clashes;

/* ---------- page ---------- */
const kindCls = b => 'k-' + b.kind + (b.done ? ' done' : '');
const peopleHtml = ids => ids.map(id => av(id, 'sm')).join('');
function evChip(b, style){
  return `<div class="cal-ev ${kindCls(b)}" ${style ? `style="${style}"` : ''} data-a="calOpen" data-k="${esc(b.key)}" data-d="${b.date}" title="${esc((b.allDay ? 'All day' : toT(b.start) + '–' + toT(b.start + b.dur)) + ' · ' + KIND[b.kind][1] + ': ' + b.title + ' · ' + b.people.map(uname).join(', '))}">
    <div class="t">${b.allDay ? '' : `<span class="tm">${toT(b.start)}</span>`}${esc(b.title)}</div>${b.dur >= 45 || b.allDay ? `<div class="s">${esc(b.sub || KIND[b.kind][1])}</div>` : ''}<div class="p">${peopleHtml(b.people)}</div></div>`;
}
function lanes(list){
  const ends = []; list.forEach(b => { let l = ends.findIndex(e => e <= b.start); if(l < 0){ l = ends.length; ends.push(0); } ends[l] = b.start + b.dur; b.lane = l; });
  list.forEach(b => { b.lanes = Math.max(1, ...list.filter(x => x.start < b.start + b.dur && b.start < x.start + x.dur).map(x => x.lane + 1)); });
  return list;
}
function weekView(cur, who){
  const c = cfg(), ws = weekStart(cur), daysArr = Array.from({length: 7}, (_, i) => addDays(ws, i));
  const all = bookings(daysArr[0], daysArr[6]).filter(b => who === 'all' || b.people.includes(who));
  const h0 = Math.max(0, Math.floor(toMin(c.start) / 60) - 1), h1 = Math.min(24, Math.ceil(toMin(c.end) / 60) + 1);
  const ws0 = toMin(c.start), we0 = toMin(c.end);
  const allDayRow = daysArr.map(d => `<div class="cal-ad">${all.filter(b => b.allDay && b.date === d).map(b => evChip(b)).join('')}</div>`).join('');
  const cols = daysArr.map(d => {
    const items = lanes(all.filter(b => !b.allDay && b.date === d));
    const off = !c.days.includes(dow(d));
    const slots = []; for(let m = h0 * 60; m < h1 * 60; m += 30){ const out = off || m < ws0 || m >= we0; slots.push(`<div class="cal-slot ${out ? 'off' : ''} ${m % 60 ? 'half' : ''}" data-a="calSlot" data-d="${d}" data-t="${toT(m)}" aria-label="Book ${fmtD(d)} ${toT(m)}"></div>`); }
    const evs = items.map(b => evChip(b, `top:${(b.start - h0 * 60) / 60 * H}px;height:${Math.max(20, b.dur / 60 * H - 2)}px;left:calc(${b.lane / b.lanes * 100}% + 2px);width:calc(${100 / b.lanes}% - 4px)`)).join('');
    const now = d === TODAY && nowMin() >= h0 * 60 && nowMin() <= h1 * 60 ? `<div class="cal-now" style="top:${(nowMin() - h0 * 60) / 60 * H}px"></div>` : '';
    return `<div class="cal-col ${d === TODAY ? 'today' : ''}">${slots.join('')}${evs}${now}</div>`;
  }).join('');
  const hours = Array.from({length: h1 - h0}, (_, i) => `<div class="cal-h" style="height:${H}px">${String(h0 + i).padStart(2, '0')}:00</div>`).join('');
  const heads = daysArr.map(d => `<div class="cal-dh ${d === TODAY ? 'today' : ''}" data-a="calDay" data-d="${d}"><span>${DOW[dow(d)]}</span><b>${pd(d).getUTCDate()}</b></div>`).join('');
  return `<div class="cal-wk"><div class="cal-head"><div></div>${heads}</div><div class="cal-adrow"><div class="cal-h xs muted">All day</div>${allDayRow}</div><div class="cal-body"><div class="cal-hours">${hours}</div>${cols}</div></div>`;
}
function monthView(cur, who){
  const m0 = cur.slice(0, 8) + '01'; const start = weekStart(m0); const cells = Array.from({length: 42}, (_, i) => addDays(start, i));
  const all = bookings(cells[0], cells[41]).filter(b => who === 'all' || b.people.includes(who));
  return `<div class="cal-mo"><div class="cal-mo-h">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x => `<div>${x}</div>`).join('')}</div><div class="cal-mo-g">${cells.map(d => {
    const items = all.filter(b => b.date === d);
    return `<div class="cal-mc ${d.slice(0, 7) !== cur.slice(0, 7) ? 'other' : ''} ${d === TODAY ? 'today' : ''}" data-a="calDay" data-d="${d}"><div class="n">${pd(d).getUTCDate()}</div>${items.slice(0, 3).map(b => `<div class="cal-pill ${kindCls(b)}" data-a="calOpen" data-k="${esc(b.key)}" data-d="${b.date}">${b.allDay ? '' : toT(b.start) + ' '}${esc(b.title)}</div>`).join('')}${items.length > 3 ? `<div class="muted xs">+${items.length - 3} more</div>` : ''}</div>`;
  }).join('')}</div></div>`;
}
function agendaView(cur, who){
  const to = addDays(cur, 20); const all = bookings(cur, to).filter(b => who === 'all' || b.people.includes(who));
  if(!all.length) return card(null, empty('calendar-days', 'Nothing booked', 'Nothing in the next three weeks. Click “New booking” to add something.'));
  const byDay = {}; all.forEach(b => (byDay[b.date] = byDay[b.date] || []).push(b));
  return `<div class="col gap-16">${Object.keys(byDay).map(d => card(`${d === TODAY ? 'Today · ' : ''}${DOW[dow(d)]} ${fmtD(d)}`, `<div class="list">${byDay[d].map(b => `<div class="li" data-a="calOpen" data-k="${esc(b.key)}" data-d="${b.date}"><span class="cal-dot ${kindCls(b)}"></span><div class="cal-ag-t num">${b.allDay ? 'All day' : toT(b.start) + '–' + toT(b.start + b.dur)}</div><div class="grow"><div class="t">${esc(b.title)}</div><div class="s">${esc(KIND[b.kind][1])}${b.sub ? ' · ' + esc(b.sub) : ''}</div></div><span class="avs">${peopleHtml(b.people)}</span></div>`).join('')}</div>`, {flush: true})).join('')}</div>`;
}

Views.calendar = () => {
  let view = uv('calView', 'week'); const narrow = W.innerWidth < 860; if(narrow && view === 'week') view = 'agenda';
  const cur = UI.v.calDate || TODAY; const who = uv('calWho', 'all');
  const label = view === 'month' ? MON[pd(cur).getUTCMonth()] + ' ' + pd(cur).getUTCFullYear() : view === 'week' ? `${fmtDs(weekStart(cur))} – ${fmtD(addDays(weekStart(cur), 6))}` : `From ${fmtD(cur)}`;
  const mineToday = bookings(TODAY, TODAY).filter(b => b.people.includes(DB.me));
  const boss = W.can ? (can('admin') || (me() || {}).sysRole === 'Team leader') : true;
  const html = `<div class="page full">${pageHead('Team calendar', 'Everyone’s discovery calls, meetings and leave in one place. The calendar won’t let anyone be booked twice.',
      `${boss ? `<button class="btn ghost" data-a="calSettings">${ic('settings-2', 14)}Booking rules</button>` : ''}<button class="btn" data-a="calIcs">${ic('download', 14)}Export (.ics)</button><button class="btn pri" data-a="calNew">${ic('plus', 14)}New booking</button>`)}
    <div class="toolbar cal-tb"><div class="row" style="gap:6px"><button class="ib" data-a="calMove" data-n="-1" aria-label="Previous">${ic('chevron-left', 16)}</button><button class="btn sm" data-a="calToday">Today</button><button class="ib" data-a="calMove" data-n="1" aria-label="Next">${ic('chevron-right', 16)}</button><b class="cal-label">${label}</b></div><span class="spacer"></span>
      <select class="sel sm" data-ch="calWho" aria-label="Whose calendar">${opts([['all', 'Whole team']].concat(DB.users.map(u => [u.id, u.id === DB.me ? 'Only me' : u.name])), who)}</select>
      ${segc('calView', narrow ? [['agenda', 'List'], ['month', 'Month']] : [['week', 'Week'], ['month', 'Month'], ['agenda', 'List']], view)}</div>
    <div class="cal-legend">${KINDS.map(k => `<span><i class="cal-dot k-${k[0]}"></i>${k[1]}</span>`).join('')}<span class="muted">· ${mineToday.length ? `You have ${mineToday.length} booking${mineToday.length === 1 ? '' : 's'} today` : 'Nothing booked for you today'}</span></div>
    ${view === 'month' ? card(null, monthView(cur, who), {flush: true}) : view === 'week' ? card(null, weekView(cur, who), {flush: true}) : agendaView(cur, who)}</div>`;
  return {html, crumbs: [['Team calendar']], title: 'Team calendar'};
};

A.calMove = d => { const v = uv('calView', 'week'), cur = UI.v.calDate || TODAY, n = +d.n;
  if(v === 'month'){ const x = pd(cur); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); UI.v.calDate = iso(x); }
  else UI.v.calDate = addDays(cur, n * (v === 'week' && W.innerWidth >= 860 ? 7 : 21));
  rerender(); };
A.calToday = () => { UI.v.calDate = TODAY; rerender(); };
A.calDay = d => { if(event && event.target.closest('[data-a="calOpen"]')) return; UI.v.calDate = d.d; setv('calView', W.innerWidth < 860 ? 'agenda' : 'week'); rerender(); };
A.calWho = v => { setv('calWho', v); rerender(); };
A.calSlot = d => openBooking({date: d.d, time: d.t});
A.calNew = () => openBooking({});

/* ---------- booking form (new + edit), with live availability ---------- */
let BK = null;
function openBooking(o){
  closePop && closePop();
  const c = cfg(); const ex = o.key ? bookings().find(b => b.key === o.key) : null; const src = ex ? ex.src : null;
  const kind = ex ? ex.kind : (o.kind || 'discovery');
  BK = {key: ex ? ex.key : null, kind, leadId: o.leadId || (src && src.leadId) || null};
  const people = ex ? ex.people : (o.people || [o.who || DB.me]);
  let nextWork = addDays(TODAY, 1); for(let i = 0; i < 7 && !c.days.includes(dow(nextWork)); i++) nextWork = addDays(nextWork, 1);
  const date = ex ? (src.date || '').slice(0, 10) : (o.date || nextWork);
  const time = ex ? (ex.allDay ? c.start : toT(ex.start)) : (o.time || '10:00');
  const dur = ex ? (ex.allDay ? c.dur : ex.dur) : c.dur;
  const dCat = src && src.category ? src.category : 'Automation';
  const body = `<div class="form-grid">
    ${field('What is it?', `<select class="sel" id="bk-kind" data-ch="calCheck" ${ex ? 'disabled' : ''}>${opts(KINDS.map(k => [k[0], k[1]]), kind)}</select>`)}
    ${field('Client', `<select class="sel" id="bk-client" data-ch="calCheck" ${ex && kind === 'discovery' ? 'disabled' : ''}>${clientOpts(ex ? ex.clientId : (o.client || ''), 'No client')}</select>`)}
    <div class="field span2 bk-title-f">${'<label>Title</label>'}<input class="inp" id="bk-title" placeholder="e.g. Team stand-up, proposal review" value="${esc(src && src.title || o.title || '')}"></div>
    ${field('Date', `<input class="inp" type="date" id="bk-date" value="${date}" data-ch="calCheck">`)}
    <div class="field bk-time-f"><label>Start time</label><input class="inp" type="time" step="900" id="bk-time" value="${time}" data-ch="calCheck"></div>
    <div class="field bk-dur-f"><label>How long</label><select class="sel" id="bk-dur" data-ch="calCheck">${opts(DURS, dur)}</select></div>
    <div class="field bk-until-f"><label>Until (last day)</label><input class="inp" type="date" id="bk-until" value="${src && src.until || date}" data-ch="calCheck"></div>
    <div class="field bk-cat-f"><label>Project category</label><select class="sel" id="bk-cat">${opts(Object.keys(W.DQ || {Automation: 1}), dCat)}</select></div>
    <div class="field span2"><label>Who is involved</label><div class="bk-people">${DB.users.map(u => `<label class="chk bk-pp"><input type="checkbox" class="bk-p" value="${u.id}" data-ch="calCheck" ${people.includes(u.id) ? 'checked' : ''}>${av(u.id, 'sm')}<span>${esc(u.name)}</span></label>`).join('')}</div></div>
    <div class="field span2"><label>Notes</label><input class="inp" id="bk-notes" placeholder="Meeting link, address, agenda…" value="${esc(src && (src.notes || src.where) || o.notes || '')}"></div>
  </div><div id="bk-avail" class="mt-12"></div>`;
  modal({title: ex ? 'Edit booking' : 'New booking', size: 'lg', body,
    foot: `${ex ? `<button class="btn danger" data-a="calCancel" style="margin-right:auto">${ic('x-circle', 14)}${kind === 'discovery' ? 'Cancel call' : 'Delete'}</button>` : ''}<button class="btn ghost" data-a="closeTop">Close</button><button class="btn pri" data-a="calSave">${ic('check', 14)}${ex ? 'Save changes' : 'Book it'}</button>`});
  setTimeout(() => A.calCheck(), 0);
}
function readForm(){
  const kind = val('bk-kind'); const allDay = kind === 'leave';
  return {kind, allDay, clientId: val('bk-client'), title: val('bk-title'), date: val('bk-date'), time: val('bk-time'), start: toMin(val('bk-time')), dur: +val('bk-dur') || 60,
    until: allDay ? (val('bk-until') || val('bk-date')) : val('bk-date'), people: Array.from(document.querySelectorAll('.bk-p:checked')).map(x => x.value), notes: val('bk-notes'), cat: val('bk-cat')};
}
A.calCheck = () => {
  const box = document.getElementById('bk-avail'); if(!box) return; const f = readForm(), c = cfg();
  const show = (sel, on) => { const el = document.querySelector(sel); if(el) el.style.display = on ? '' : 'none'; };
  show('.bk-title-f', f.kind !== 'discovery'); show('.bk-time-f', !f.allDay); show('.bk-dur-f', !f.allDay); show('.bk-until-f', f.allDay); show('.bk-cat-f', f.kind === 'discovery');
  if(!f.date || !f.people.length){ box.innerHTML = `<div class="callout">${ic('info', 15)}<span>Pick a date and at least one person to check availability.</span></div>`; return; }
  const cl = clashes({people: f.people, date: f.date, start: f.start, dur: f.dur, allDay: f.allDay, until: f.until, ignore: BK && BK.key});
  const warn = [];
  if(!f.allDay && (f.start < toMin(c.start) || f.start + f.dur > toMin(c.end))) warn.push(`outside working hours (${c.start}–${c.end})`);
  if(!c.days.includes(dow(f.date))) warn.push('on a non-working day');
  if(f.date < TODAY) warn.push('in the past');
  const clientSame = f.kind === 'discovery' && f.clientId ? bookings(f.date, f.date).filter(b => b.kind === 'discovery' && b.clientId === f.clientId && b.key !== (BK && BK.key)) : [];
  const slots = f.allDay ? [] : freeSlots(f.people, f.date, f.dur, BK && BK.key, 12);
  const dayList = bookings(f.date, f.date).filter(b => b.people.some(p => f.people.includes(p)) && b.key !== (BK && BK.key));
  box.innerHTML = `${cl.length ? `<div class="callout red bk-clash">${ic('alert-octagon', 15)}<div><b>Double booking: this can’t be saved.</b>${cl.map(b => `<div class="small">${esc(b.who.map(firstN).join(' & '))} ${b.who.length > 1 ? 'are' : 'is'} already booked: ${b.allDay ? 'all day' : toT(b.start) + '–' + toT(b.start + b.dur)} · ${esc(KIND[b.kind][1])}: ${esc(b.title)}</div>`).join('')}${cfg().buffer ? `<div class="xs muted">Includes a ${cfg().buffer}-minute gap between bookings.</div>` : ''}</div></div>` : `<div class="callout green">${ic('check-circle-2', 15)}<span><b>Everyone is free</b> at this time.</span></div>`}
    ${warn.length ? `<div class="callout amber mt-8">${ic('alert-triangle', 15)}<span>This is ${warn.join(' and ')}.</span></div>` : ''}
    ${clientSame.length ? `<div class="callout amber mt-8">${ic('alert-triangle', 15)}<span>${esc((get.client(f.clientId) || {}).name || 'This client')} already has a discovery call that day at ${clientSame.map(b => toT(b.start)).join(', ')}.</span></div>` : ''}
    ${!f.allDay ? `<div class="mt-12"><div class="eyebrow" style="margin-bottom:6px">Free times on ${fmtD(f.date)} for everyone selected</div><div class="row wrap" style="gap:6px">${slots.length ? slots.map(m => `<button class="fchip" data-a="calPick" data-t="${toT(m)}">${toT(m)}</button>`).join('') : '<span class="muted small">No free time that day.</span>'}<button class="btn sm ghost" data-a="calNextFree">${ic('search', 13)}Find the next free slot</button></div></div>` : ''}
    ${dayList.length ? `<div class="mt-12"><div class="eyebrow" style="margin-bottom:6px">Already booked that day</div>${dayList.map(b => `<div class="row small" style="gap:8px;margin-bottom:4px"><span class="cal-dot ${kindCls(b)}"></span><span class="num muted" style="width:86px">${b.allDay ? 'All day' : toT(b.start) + '–' + toT(b.start + b.dur)}</span><span class="grow trunc">${esc(b.title)}</span><span class="muted xs">${esc(b.people.map(firstN).join(', '))}</span></div>`).join('')}</div>` : ''}`;
  BK.clash = cl.length > 0;
};
A.calPick = d => { const t = document.getElementById('bk-time'); if(t){ t.value = d.t; A.calCheck(); } };
A.calNextFree = () => { const f = readForm(); if(!f.people.length) return toast('Pick at least one person', 'err'); const n = nextFree(f.people, f.date || TODAY, f.dur, BK && BK.key); if(!n) return toast('No free slot in the next 6 weeks', 'err'); document.getElementById('bk-date').value = n.date; document.getElementById('bk-time').value = toT(n.start); A.calCheck(); toast(`Next free: ${fmtD(n.date)} at ${toT(n.start)}`); };

A.calSave = () => {
  A.calCheck(); const f = readForm();
  if(!f.date) return toast('Pick a date', 'err');
  if(!f.people.length) return toast('Pick at least one person', 'err');
  if(f.kind === 'discovery' && !f.clientId) return toast('Pick the client for this discovery call', 'err');
  if(f.kind !== 'discovery' && !f.title && !f.clientId && f.kind !== 'leave') return toast('Give the booking a title', 'err');
  if(BK && BK.clash) return toast('Someone is already booked then. Pick a free time or a different person.', 'err');
  const stamp = f.allDay ? f.date : f.date + 'T' + f.time;
  const others = f.people.filter(p => p !== DB.me);
  if(f.kind === 'discovery'){
    let d = BK.key ? get.disc(BK.key.slice(5)) : null; const c = get.client(f.clientId);
    if(d){
      const moved = d.date !== stamp; Object.assign(d, {date: stamp, duration: f.dur, assistant: f.people[0], attendees: f.people.slice(1), notes: f.notes || d.notes, nudge30: null});
      if(moved){ log(`Discovery with ${esc(c.name)} moved to ${fmtD(f.date)} ${f.time}`, c.id, 'discovery-' + d.id, 'call'); others.forEach(p => notify('reminder', `Discovery with ${c.name} moved to ${fmtDs(f.date)} at ${f.time}`, 'calendar', p)); }
    } else {
      const cat = W.DQ && W.DQ[f.cat] ? f.cat : Object.keys(W.DQ || {Automation: 1})[0];
      d = {id: nextId('D-', DB.discoveries), clientId: c.id, enquiryId: null, date: stamp, duration: f.dur, assistant: f.people[0], attendees: f.people.slice(1), category: cat, status: 'Scheduled', summary: '', confirmed: [], unanswered: (W.DQ && W.DQ[cat] || []).slice(), systems: [], integrations: [], risks: [], limitations: [], decisions: [], next: [], answers: {}, notes: f.notes || '', transcript: [], bookedBy: DB.me, booked: nowStamp()};
      DB.discoveries.push(d);
      if(STATUS.client.indexOf(c.status) < STATUS.client.indexOf('Discovery scheduled')) c.status = 'Discovery scheduled';
      log(`Discovery call booked with ${esc(c.name)} for ${fmtD(f.date)} ${f.time}`, c.id, 'discovery-' + d.id, 'call');
      others.forEach(p => notify('reminder', `You’re booked for a discovery call with ${c.name} on ${fmtDs(f.date)} at ${f.time}`, 'calendar', p));
    }
    closeTop(); save(); toast('Discovery call booked'); if(ROUTE.page === 'calendar') rerender(); else go('discovery-' + d.id); return;
  }
  DB.events = DB.events || [];
  let e = BK.key ? DB.events.find(x => x.id === BK.key.slice(3)) : null; const isNew = !e;
  if(!e){ e = {id: nextId('EV-', DB.events), createdBy: DB.me, created: nowStamp()}; DB.events.push(e); }
  if(BK.leadId) e.leadId = BK.leadId;
  Object.assign(e, {kind: f.kind, title: f.title || (f.kind === 'leave' ? 'Leave: ' + f.people.map(firstN).join(', ') : KIND[f.kind][1]), date: f.date, time: f.allDay ? null : f.time, duration: f.allDay ? null : f.dur, allDay: f.allDay, until: f.allDay ? f.until : null, people: f.people, clientId: f.clientId || null, notes: f.notes, nudge30: null});
  others.forEach(p => notify('reminder', `${isNew ? 'Booked' : 'Updated'}: ${e.title}, ${fmtDs(f.date)}${f.allDay ? '' : ' at ' + f.time}`, 'calendar', p));
  if(BK.leadId && W.onLeadMeeting) W.onLeadMeeting(BK.leadId, e, isNew);
  closeTop(); commit(isNew ? 'Booked' : 'Booking updated');
};
W.calOpenBooking = openBooking;
A.calCancel = () => {
  const key = BK && BK.key; if(!key) return;
  confirmBox({title: key.startsWith('disc:') ? 'Cancel this discovery call?' : 'Delete this booking?', text: 'Everyone involved will see it disappear from the team calendar.', ok: key.startsWith('disc:') ? 'Cancel the call' : 'Delete', danger: true, onOk: () => {
    if(key.startsWith('disc:')){ const d = get.disc(key.slice(5)); d.status = 'Cancelled'; log(`Discovery with ${esc((get.client(d.clientId) || {}).name || '')} cancelled`, d.clientId, 'discovery-' + d.id, 'call'); }
    else DB.events = DB.events.filter(x => x.id !== key.slice(3));
    closeAll(); commit('Removed from the calendar');
  }});
};
A.calOpen = d => { if(W.event) W.event.stopPropagation(); const b = bookings(d.d, d.d).find(x => x.key === d.k); if(!b) return;
  if(b.kind === 'discovery' && b.done) return go('discovery-' + b.src.id);
  modal({title: esc(KIND[b.kind][1] + ': ' + b.title), size: 'sm', body: `<dl class="kv" style="grid-template-columns:90px 1fr"><dt>When</dt><dd>${DOW[dow(b.date)]} ${fmtD(b.date)}${b.allDay ? (b.src.until && b.src.until > b.src.date ? ' – ' + fmtD(b.src.until) : ' · all day') : ` · ${toT(b.start)}–${toT(b.start + b.dur)}`}</dd><dt>Who</dt><dd class="col" style="gap:4px">${b.people.map(p => who(p)).join('')}</dd>${b.clientId ? `<dt>Client</dt><dd><a href="#client-${b.clientId}">${esc((get.client(b.clientId) || {}).name || '')}</a></dd>` : ''}${(b.src.notes) ? `<dt>Notes</dt><dd>${esc(b.src.notes)}</dd>` : ''}</dl>`,
    foot: `<button class="btn ghost" data-a="calIcs" data-k="${esc(b.key)}" style="margin-right:auto">${ic('calendar-plus', 14)}Add to my calendar</button>${b.kind === 'discovery' ? `<button class="btn" data-a="go" data-to="discovery-${b.src.id}">Open call</button>` : ''}<button class="btn pri" data-a="calEdit" data-k="${esc(b.key)}">${ic('pencil', 14)}Edit / move</button>`});
};
A.calEdit = d => { closeTop(); openBooking({key: d.k}); };
A.calReschedule = d => openBooking({key: 'disc:' + d.id});

/* ---------- rules ---------- */
A.calSettings = () => { const c = cfg(); modal({title: 'Booking rules', body: `<div class="form-grid">${field('Working day starts', `<input class="inp" type="time" id="cs-s" value="${c.start}">`)}${field('Working day ends', `<input class="inp" type="time" id="cs-e" value="${c.end}">`)}${field('Default length of a call', `<select class="sel" id="cs-d">${opts(DURS, c.dur)}</select>`)}${field('Gap between bookings', `<select class="sel" id="cs-b">${opts([[0, 'No gap'], [10, '10 min'], [15, '15 min'], [30, '30 min']], c.buffer)}</select>`)}<div class="field span2"><label>Working days</label><div class="row wrap" style="gap:10px">${[1, 2, 3, 4, 5, 6, 0].map(i => `<label class="chk"><input type="checkbox" class="cs-day" value="${i}" ${c.days.includes(i) ? 'checked' : ''}>${DOW[i]}</label>`).join('')}</div></div></div><p class="muted xs mt-12">The gap stops back-to-back calls so people have time to write up notes. Nobody can be booked twice at the same time.</p>`, foot: `<button class="btn ghost" data-a="closeTop">Cancel</button><button class="btn pri" data-a="calSaveSettings">Save rules</button>`}); };
A.calSaveSettings = () => { const c = cfg(); Object.assign(c, {start: val('cs-s') || '08:00', end: val('cs-e') || '17:00', dur: +val('cs-d') || 60, buffer: +val('cs-b') || 0, days: Array.from(document.querySelectorAll('.cs-day:checked')).map(x => +x.value)}); closeTop(); commit('Booking rules saved'); };

/* ---------- export to Google / Outlook / phone calendars ---------- */
A.calIcs = d => {
  const list = d && d.k ? bookings().filter(b => b.key === d.k).slice(0, 1) : bookings(TODAY, addDays(TODAY, 90)).filter(b => (uv('calWho', 'all') === 'all') || b.people.includes(uv('calWho', 'all')));
  if(!list.length) return toast('Nothing to export', 'err');
  const fmt = (day, m) => day.replace(/-/g, '') + 'T' + toT(m).replace(':', '') + '00';
  const escI = s => String(s || '').replace(/[\\;,]/g, x => '\\' + x).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BEMO-SOLUTIONS//Operations OS//EN', 'CALSCALE:GREGORIAN'];
  list.forEach(b => { lines.push('BEGIN:VEVENT', 'UID:' + b.key.replace(':', '-') + '-' + b.date + '@bemosolutions', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z');
    if(b.allDay){ lines.push('DTSTART;VALUE=DATE:' + b.date.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + addDays(b.date, 1).replace(/-/g, '')); }
    else lines.push('DTSTART:' + fmt(b.date, b.start), 'DTEND:' + fmt(b.date, Math.min(b.start + b.dur, 1439)));
    lines.push('SUMMARY:' + escI(KIND[b.kind][1] + ': ' + b.title), 'DESCRIPTION:' + escI('With ' + b.people.map(uname).join(', ') + (b.src.notes ? '\n' + b.src.notes : '')), 'END:VEVENT'); });
  lines.push('END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], {type: 'text/calendar'}));
  const a = document.createElement('a'); a.href = url; a.download = list.length === 1 ? 'booking.ics' : 'bemo-team-calendar.ics'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(list.length === 1 ? 'Open the file to add it to your calendar' : `${list.length} bookings exported`);
};

/* ---------- discovery screens use the calendar ---------- */
A.scheduleDiscovery = d => openBooking({kind: 'discovery', client: d && d.client});
const baseStartDisc = A.startDiscovery;
if(baseStartDisc) A.startDiscovery = d => {
  const before = new Set((DB.discoveries || []).map(x => x.id)); baseStartDisc(d);
  const disc = (DB.discoveries || []).find(x => !before.has(x.id)); if(!disc) return;
  disc.duration = disc.duration || cfg().dur; disc.booked = disc.booked || nowStamp(); disc.bookedBy = disc.bookedBy || DB.me;
  const t = disc.date.slice(11, 16), day = disc.date.slice(0, 10);
  if(clashes({people: [disc.assistant], date: day, start: toMin(t), dur: disc.duration, ignore: 'disc:' + disc.id}).length || !cfg().days.includes(dow(day))){
    const n = nextFree([disc.assistant], day, disc.duration, 'disc:' + disc.id);
    if(n){ disc.date = n.date + 'T' + toT(n.start); save(); rerender(); }
  }
  toast(`Pencilled in for ${fmtDs(disc.date)} at ${disc.date.slice(11, 16)}: confirm the time with the client`);
};
const baseDiscView = Views.discovery;
Views.discovery = id => { const out = baseDiscView(id); out.html = out.html.replace(/<button class="btn sm acc" data-a="discComplete" data-id="([^"]+)">/, (m, did) => `<button class="btn sm" data-a="calReschedule" data-id="${did}">${ic('calendar-clock', 13)}Reschedule</button>` + m); return out; };

/* ---------- removed pages send people home ---------- */
['docs', 'integrations'].forEach(k => { Views[k] = () => { setTimeout(() => go('home'), 0); return {html: '', crumbs: [['Home']], title: 'Home'}; }; });

/* ---------- today strip on every home page ---------- */
const baseHome = Views.home;
Views.home = (...a) => {
  const out = baseHome(...a); const list = bookings(TODAY, TODAY).filter(b => !b.done && (b.allDay || b.start + b.dur >= nowMin()));
  const mineFirst = list.sort((x, y) => (y.people.includes(DB.me) - x.people.includes(DB.me)) || x.start - y.start).slice(0, 6);
  const strip = `<div class="cal-today card"><div class="row" style="gap:10px;flex:none"><span class="cal-today-ic">${ic('calendar-days', 16)}</span><div><b>Today</b><div class="muted xs">${list.length ? list.length + ' booking' + (list.length === 1 ? '' : 's') + ' left' : 'Nothing else booked'}</div></div></div><div class="cal-today-l">${mineFirst.map(b => `<button class="cal-tchip ${kindCls(b)}" data-a="calOpen" data-k="${esc(b.key)}" data-d="${b.date}"><span class="num">${b.allDay ? 'All day' : toT(b.start)}</span>${esc(b.title)}<span class="avs">${peopleHtml(b.people.slice(0, 3))}</span></button>`).join('')}</div><a class="btn sm" href="#calendar" style="flex:none">Open calendar</a></div>`;
  out.html = out.html.replace(/(<div class="ph">[\s\S]*?<div class="ph-act">[\s\S]*?<\/div><\/div>)/, '$1' + strip);
  return out;
};

/* ---------- 30-minute heads-up, sidebar count ---------- */
setInterval(() => {
  if(!W.DB || !DB.setupDone || (W.engineAllowed && !W.engineAllowed())) return;
  let changed = false; const n = nowMin();
  bookings(TODAY, TODAY).forEach(b => { if(b.allDay || b.done || b.src.nudge30 === TODAY) return; const left = b.start - n;
    if(left > 0 && left <= 30){ b.people.forEach(p => notify('reminder', `In ${left} min: ${KIND[b.kind][1]} – ${b.title}`, 'calendar', p)); b.src.nudge30 = TODAY; changed = true; } });
  if(changed){ save(); renderShellCounts(); }
}, 60000);
const baseCounts = W.opsCounts;
W.opsCounts = () => Object.assign(baseCounts ? baseCounts() : {}, {cal: bookings(TODAY, TODAY).filter(b => b.people.includes(DB.me) && !b.done && (b.allDay || b.start + b.dur >= nowMin())).length});

/* make sure the collection exists in older saved data */
const baseStart = App.start;
App.start = (...a) => { const r = baseStart(...a); try { if(W.DB && !DB.events){ DB.events = []; } } catch(e){} return r; };
})();
