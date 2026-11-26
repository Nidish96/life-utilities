// My home: the place you moved into. Rent, recurring upkeep, repairs (seeded from the move-in inspection),
// useful contacts, and calendar reminders. All offline; due items surface on the Home page.
import { live, get, upsert, remove } from '../state.js';
import { $, $$, esc, setTitle, openSheet, confirmDlg, toast, today, fmtDate, fmtMoney, daysFromToday, photoImg, hydrate, download, go } from '../ui.js';
import { uid } from '../storage.js';
import { inspectionFor } from './inspect.js';

export const myHome = () => live('homes').find(h => h.active);
export const homeHouse = () => { const m = myHome(); return m && get('houses', m.houseId); };

const addDays = (d, n) => { const x = new Date((d || today()) + 'T00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const ym = d => (d || today()).slice(0, 7);
const everyLabel = n => (n % 365 === 0 ? (n === 365 ? 'Every year' : `Every ${n / 365} years`) : n % 30 === 0 ? (n === 30 ? 'Every month' : `Every ${n / 30} months`) : n % 7 === 0 ? (n === 7 ? 'Every week' : `Every ${n / 7} weeks`) : `Every ${n} days`);
const dueText = n => (n === null ? '' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'due today' : n === 1 ? 'due tomorrow' : `due in ${n} days`);

// Recurring upkeep; `when` = only suggest if the inspection found that fixture
const TASKS = [
  ['❄️', 'AC servicing', 180, /\bAC\b/], ['💧', 'Water purifier filter change', 90, /purifier/i], ['🍳', 'Chimney cleaning', 180, /chimney/i],
  ['🔥', 'Geyser check & descaling', 365, /geyser/i], ['🔋', 'Inverter battery top-up', 60, /inverter/i], ['🧯', 'Gas pipe & regulator check', 365, /gas/i],
  ['🪳', 'Pest control', 90], ['🧽', 'Deep cleaning', 90], ['🌀', 'Clean fan blades', 60], ['🚰', 'Water tank cleaning', 180], ['🪟', 'Clean window mesh & grills', 90],
];
const ROLES = ['Owner', 'Broker', 'Society office', 'Security', 'Plumber', 'Electrician', 'Carpenter', 'AC service', 'Water purifier service', 'Pest control', 'Cleaner', 'Gas agency', 'Internet provider'];

// Rent status for this month: { due, paid, days }
export function rentStatus(m) {
  if (!m?.rent?.amount) return null;
  const now = today(), cur = ym(now);
  const due = `${cur}-${String(Math.min(28, m.rent.dueDay || 5)).padStart(2, '0')}`;
  const paid = m.rent.payments?.[cur];
  if (m.movedIn && m.movedIn.slice(0, 7) === cur && m.movedIn > due && !paid) return null; // moved in after this month's due date
  return { due, paid, days: daysFromToday(due), month: cur };
}
// Things to show under "Heads up" on Home
export function homeAlerts() {
  const m = myHome(); if (!m) return [];
  const out = [];
  const r = rentStatus(m);
  if (r && !r.paid && r.days <= 5) out.push({ e: '💸', t: `Rent ${fmtMoney(m.rent.amount)}`, s: r.days < 0 ? `${-r.days}d overdue` : r.days === 0 ? 'due today' : `due ${fmtDate(r.due)}`, warn: r.days <= 0 });
  for (const t of (m.tasks || [])) { const n = daysFromToday(t.next); if (n !== null && n <= 7) out.push({ e: t.icon || '🧰', t: t.name, s: dueText(n), warn: n < 0 }); }
  const open = (m.repairs || []).filter(x => x.status !== 'fixed').length;
  if (open) out.push({ e: '🔧', t: `${open} repair${open === 1 ? '' : 's'} pending`, s: 'my home' });
  return out;
}

/* ---------- becoming "my home" ---------- */
export function myHomeCard(h) {
  const m = myHome();
  if (m && m.houseId === h.id) return `<a class="card row insp-cta" href="#/myhome">🏡 <span class="grow"><b>This is my home</b><br><small class="muted">Rent, upkeep, repairs & contacts</small></span><span class="muted">›</span></a>`;
  if (h.status !== 'finalized') return '';
  return `<button class="card row insp-cta block-btn" id="mh-make">🏡 <span class="grow"><b>Make this my home</b><br><small class="muted">Track rent, upkeep, repairs and useful contacts once you move in.</small></span><span class="muted">›</span></button>`;
}
export function makeMyHome(h) {
  const insp = inspectionFor(h.id);
  // fixtures the inspection actually found in the house (checked, and not missing / N/A)
  const items = insp ? insp.rooms.flatMap(r => r.items.filter(i => ['good', 'fair', 'damaged'].includes(i.cond)).map(i => i.name)).join(' | ') : '';
  const sug = TASKS.map(([icon, name, every, when]) => ({ icon, name, every, on: !when || (insp ? when.test(items) : false) }));
  const issues = insp ? insp.rooms.flatMap(r => r.items.filter(i => ['damaged', 'missing'].includes(i.cond) || (i.cond === 'fair' && i.note)).map(i => ({ r, i }))) : [];
  const s = openSheet(`<h3>🏡 Make this my home</h3>
    <div class="grid2"><label>Moving-in date<input type="date" id="mh-in" value="${today()}"></label>
      <label>Rent due on day<input type="number" id="mh-day" min="1" max="28" value="5" inputmode="numeric"></label></div>
    <label>Monthly rent <small>(leave empty if you own it)</small><input type="number" id="mh-rent" inputmode="numeric" value="${h.deal === 'rent' && h.price ? h.price : ''}"></label>
    <div class="small muted">Regular upkeep to remind you about</div>
    <div class="chips" id="mh-tasks">${sug.map((t, i) => `<button class="chip ${t.on ? 'on' : ''}" data-t="${i}">${t.icon} ${esc(t.name)} <small>${everyLabel(t.every).replace('Every ', '')}</small></button>`).join('')}</div>
    ${issues.length ? `<p class="small">🔧 ${issues.length} issue${issues.length === 1 ? '' : 's'} from your move-in inspection will be added to <b>Repairs</b> so you can follow up with the owner.</p>` : ''}
    <button class="btn primary block" id="mh-go">Set up my home</button>`);
  $$('[data-t]', s.el).forEach(b => b.onclick = () => { sug[+b.dataset.t].on = !sug[+b.dataset.t].on; b.classList.toggle('on'); });
  $('#mh-go', s.el).onclick = () => {
    const movedIn = $('#mh-in', s.el).value || today();
    live('homes').forEach(x => x.active && upsert('homes', { ...x, active: false })); // only one current home
    const contacts = h.contactPhone || h.contactName ? [{ id: uid(), name: h.contactName || 'Owner', role: h.contactRole || 'Owner', phone: h.contactPhone || '' }] : [];
    upsert('homes', {
      houseId: h.id, active: true, movedIn,
      rent: { amount: +$('#mh-rent', s.el).value || null, dueDay: Math.min(28, Math.max(1, +$('#mh-day', s.el).value || 5)), payments: {} },
      tasks: sug.filter(t => t.on).map(t => ({ id: uid(), icon: t.icon, name: t.name, every: t.every, last: null, next: addDays(movedIn, t.every) })),
      repairs: issues.map(({ r, i }) => ({ id: uid(), title: i.name, where: r.name, note: i.note || '', cond: i.cond, status: 'open', createdOn: today(), photo: i.photos?.[0] || null })),
      contacts, notes: '',
    });
    s.close(); toast('Welcome home 🏡'); go('#/myhome');
  };
}

/* ---------- the hub ---------- */
let rerender = () => {};
export function myHomePage(view) {
  const m = myHome(), h = m && get('houses', m.houseId);
  setTitle('My home', true);
  if (!m || !h) {
    const fin = live('houses').filter(x => x.status === 'finalized');
    view.innerHTML = `<div class="empty">No home set yet.<br>${fin.length ? `Open your finalised house and tap <b>🏡 Make this my home</b>:<br>${fin.map(x => `<a href="#/h/${x.id}">${esc(x.title)}</a>`).join('<br>')}` : 'Mark the house you chose as 🔑 Finalised, then tap <b>🏡 Make this my home</b> on it.'}</div>`;
    return;
  }
  rerender = () => myHomePage(view);
  const save = fn => { const x = get('homes', m.id); fn(x); upsert('homes', x); rerender(); };
  const r = rentStatus(m);
  const tasks = [...(m.tasks || [])].sort((a, b) => (a.next || '').localeCompare(b.next || ''));
  const open = (m.repairs || []).filter(x => x.status !== 'fixed'), fixed = (m.repairs || []).filter(x => x.status === 'fixed');
  const owner = (m.contacts || []).find(c => /owner/i.test(c.role) && c.phone) || (m.contacts || []).find(c => c.phone);
  const days = daysFromToday(m.movedIn);
  view.innerHTML = `
    <div class="card mh-hero">${h.photos?.[0] ? photoImg(h.photos[0], 'mh-cover') : ''}
      <div><h2>${esc(h.title)}</h2><div class="small muted">${esc([h.locality, h.address].filter(Boolean).join(' — '))}</div>
      <div class="small">${days > 0 ? `Moving in ${fmtDate(m.movedIn)} (in ${days} days)` : days === 0 ? 'Moving in today 🎉' : `Home since ${fmtDate(m.movedIn)}`}</div>
      <div class="row wrap"><a class="btn small" href="#/h/${h.id}">House details</a>${inspectionFor(h.id) ? `<a class="btn small" href="#/h/${h.id}/inspect">📋 Inspection</a>` : ''}<button class="btn small" id="mh-ics">📅 Add reminders to calendar</button></div></div></div>

    ${m.rent?.amount ? `<h3 class="section">💸 Rent</h3>
    <div class="card"><div class="row"><span class="grow"><b>${fmtMoney(m.rent.amount)}</b> / month · due on the ${m.rent.dueDay}${['th', 'st', 'nd', 'rd'][(m.rent.dueDay % 10 > 3 || [11, 12, 13].includes(m.rent.dueDay)) ? 0 : m.rent.dueDay % 10]}</span><button class="btn small ghost" id="mh-rentedit">Edit</button></div>
      ${r ? (r.paid ? `<p class="small ok-text">✅ ${new Date(r.due + 'T00:00').toLocaleDateString(undefined, { month: 'long' })} paid on ${fmtDate(r.paid.paidOn)}</p>`
      : `<div class="row"><span class="grow ${r.days < 0 ? 'warn' : ''}">${new Date(r.due + 'T00:00').toLocaleDateString(undefined, { month: 'long' })}: ${r.days < 0 ? `<b>${-r.days} days overdue</b>` : r.days === 0 ? '<b>due today</b>' : `due ${fmtDate(r.due)}`}</span><button class="btn primary small" id="mh-paid">Mark paid</button></div>`) : '<p class="small muted">First rent after you move in.</p>'}
      ${Object.keys(m.rent.payments || {}).length ? `<details class="small"><summary>Payment history</summary>${Object.entries(m.rent.payments).sort((a, b) => b[0].localeCompare(a[0])).map(([k, p]) => `<div class="row"><span class="grow">${new Date(k + '-01T00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span><span>${fmtMoney(p.amount)} · ${fmtDate(p.paidOn)}</span><button class="icon small" data-unpay="${k}" title="Undo">✕</button></div>`).join('')}</details>` : ''}
    </div>` : ''}

    <h3 class="section">🧰 Upkeep <small>${tasks.length}</small></h3>
    ${tasks.map(t => { const n = daysFromToday(t.next); return `<div class="card row task ${n !== null && n < 0 ? 'late' : n !== null && n <= 7 ? 'soon' : ''}">
      <span class="task-e">${t.icon || '🧰'}</span><span class="grow"><b>${esc(t.name)}</b><br><small class="muted">${everyLabel(t.every)} · ${t.last ? `last ${fmtDate(t.last)} · ` : ''}<span class="${n !== null && n <= 7 ? 'warn' : ''}">${dueText(n)}</span></small></span>
      <button class="btn small" data-done="${t.id}">✓ Done</button><button class="icon" data-tedit="${t.id}">⋯</button></div>`; }).join('') || '<p class="small muted">No upkeep tasks yet.</p>'}
    <button class="btn ghost block" id="mh-addtask">＋ Add upkeep task</button>

    <h3 class="section">🔧 Repairs <small>${open.length} open</small></h3>
    ${open.map(x => `<div class="card repair">
      <div class="row">${x.photo ? photoImg(x.photo, 'rep-ph') : ''}<span class="grow"><b>${esc(x.title)}</b>${x.where ? ` <small class="muted">· ${esc(x.where)}</small>` : ''}${x.note ? `<br><small>${esc(x.note)}</small>` : ''}
        <br><small class="muted">${x.status === 'reported' ? `📨 Reported ${fmtDate(x.reportedOn)}` : `Noted ${fmtDate(x.createdOn)}`}</small></span></div>
      <div class="row wrap">${owner ? `<a class="btn small" target="_blank" rel="noopener" data-wa="${x.id}" href="https://wa.me/${esc(owner.phone.replace(/\D/g, ''))}?text=${encodeURIComponent(`Hi ${owner.name.split(' ')[0]}, ${x.where ? `in the ${x.where.toLowerCase()}, ` : ''}the ${x.title.toLowerCase()} ${/s$/i.test(x.title) && !/ss$/i.test(x.title) ? (x.cond === 'missing' ? 'are missing' : 'need fixing') : (x.cond === 'missing' ? 'is missing' : 'needs fixing')}${x.note ? ` (${x.note})` : ''}. Could you please get this sorted? Thanks!`)}">💬 Message ${esc(owner.name.split(' ')[0])}</a>` : ''}
        ${x.status !== 'reported' ? `<button class="btn small" data-rep="${x.id}">📨 Reported</button>` : ''}<button class="btn small primary" data-fix="${x.id}">✅ Fixed</button><span class="grow"></span><button class="icon" data-rdel="${x.id}">🗑</button></div></div>`).join('') || '<p class="small muted">Nothing to fix 🎉</p>'}
    <button class="btn ghost block" id="mh-addrep">＋ Something needs fixing</button>
    ${fixed.length ? `<details class="small"><summary>Fixed (${fixed.length})</summary>${fixed.map(x => `<div class="row"><span class="grow">✅ ${esc(x.title)}${x.where ? ` · ${esc(x.where)}` : ''}</span><small class="muted">${fmtDate(x.fixedOn)}</small><button class="icon small" data-reopen="${x.id}" title="Reopen">↺</button></div>`).join('')}</details>` : ''}

    <h3 class="section">📞 Useful contacts</h3>
    ${(m.contacts || []).map(c => `<div class="card row"><span class="grow"><b>${esc(c.name)}</b> <small class="muted">${esc(c.role || '')}</small>${c.phone ? `<br><small>${esc(c.phone)}</small>` : ''}</span>
      ${c.phone ? `<a class="btn small" href="tel:${esc(c.phone)}">📞</a><a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${esc(c.phone.replace(/\D/g, ''))}">💬</a>` : ''}<button class="icon" data-cedit="${c.id}">⋯</button></div>`).join('') || '<p class="small muted">Add your owner, society office, plumber, electrician…</p>'}
    <button class="btn ghost block" id="mh-addc">＋ Add contact</button>

    <div class="card"><label>Home notes<textarea id="mh-notes" rows="3" placeholder="Wi-Fi password, where the main valve is, bin day…">${esc(m.notes || '')}</textarea></label></div>
    <button class="btn ghost danger" id="mh-stop">Stop tracking this home</button>`;

  $('#mh-notes').onchange = e => { const x = get('homes', m.id); x.notes = e.target.value; upsert('homes', x); toast('Saved'); };
  $('#mh-paid')?.addEventListener('click', () => {
    const s = openSheet(`<h3>Rent paid</h3><div class="grid2"><label>Amount<input type="number" id="rp-a" value="${m.rent.amount}" inputmode="numeric"></label><label>Paid on<input type="date" id="rp-d" value="${today()}"></label></div><button class="btn primary block" id="rp-ok">Save</button>`);
    $('#rp-ok', s.el).onclick = () => { s.close(); save(x => { x.rent.payments = { ...(x.rent.payments || {}), [r.month]: { amount: +$('#rp-a', s.el).value || m.rent.amount, paidOn: $('#rp-d', s.el).value || today() } }; }); toast('Rent marked as paid'); };
  });
  $$('[data-unpay]', view).forEach(b => b.onclick = () => save(x => { delete x.rent.payments[b.dataset.unpay]; }));
  $('#mh-rentedit')?.addEventListener('click', () => {
    const s = openSheet(`<h3>Rent</h3><div class="grid2"><label>Monthly rent<input type="number" id="re-a" value="${m.rent.amount || ''}" inputmode="numeric"></label><label>Due on day<input type="number" id="re-d" min="1" max="28" value="${m.rent.dueDay}"></label></div><button class="btn primary block" id="re-ok">Save</button>`);
    $('#re-ok', s.el).onclick = () => { s.close(); save(x => { x.rent.amount = +$('#re-a', s.el).value || null; x.rent.dueDay = Math.min(28, Math.max(1, +$('#re-d', s.el).value || 5)); }); };
  });
  $$('[data-done]', view).forEach(b => b.onclick = () => { save(x => { const t = x.tasks.find(t => t.id === b.dataset.done); t.last = today(); t.next = addDays(today(), t.every); }); toast('Done — next one scheduled'); });
  const taskSheet = t => {
    const isNew = !t; t = t || { icon: '🧰', name: '', every: 90, next: addDays(today(), 90) };
    const s = openSheet(`<h3>${isNew ? 'New upkeep task' : esc(t.name)}</h3>
      <label>What<input id="tk-n" value="${esc(t.name)}" placeholder="e.g. Clean the bathroom exhaust"></label>
      <div class="grid2"><label>Every<select id="tk-e">${[[7, 'week'], [14, '2 weeks'], [30, 'month'], [60, '2 months'], [90, '3 months'], [180, '6 months'], [365, 'year']].map(([d, l]) => `<option value="${d}" ${t.every === d ? 'selected' : ''}>${l}</option>`).join('')}${[7, 14, 30, 60, 90, 180, 365].includes(t.every) ? '' : `<option value="${t.every}" selected>${t.every} days</option>`}</select></label>
      <label>Next due<input type="date" id="tk-d" value="${t.next || ''}"></label></div>
      <div class="row">${isNew ? '' : '<button class="btn danger ghost" id="tk-del">Delete</button>'}<span class="grow"></span><button class="btn primary" id="tk-ok">Save</button></div>`);
    $('#tk-e', s.el).onchange = e => { if (isNew) $('#tk-d', s.el).value = addDays(today(), +e.target.value); };
    $('#tk-ok', s.el).onclick = () => {
      const name = $('#tk-n', s.el).value.trim(); if (!name) return toast('Give it a name');
      s.close(); save(x => {
        const v = { name, every: +$('#tk-e', s.el).value, next: $('#tk-d', s.el).value || addDays(today(), +$('#tk-e', s.el).value) };
        if (isNew) x.tasks.push({ id: uid(), icon: '🧰', last: null, ...v }); else Object.assign(x.tasks.find(y => y.id === t.id), v);
      });
    };
    $('#tk-del', s.el)?.addEventListener('click', () => { s.close(); save(x => { x.tasks = x.tasks.filter(y => y.id !== t.id); }); });
  };
  $('#mh-addtask').onclick = () => taskSheet();
  $$('[data-tedit]', view).forEach(b => b.onclick = () => taskSheet(m.tasks.find(t => t.id === b.dataset.tedit)));
  $$('[data-rep]', view).forEach(b => b.onclick = () => save(x => { const y = x.repairs.find(y => y.id === b.dataset.rep); y.status = 'reported'; y.reportedOn = today(); }));
  $$('[data-wa]', view).forEach(a => a.addEventListener('click', () => setTimeout(() => save(x => { const y = x.repairs.find(y => y.id === a.dataset.wa); if (y.status === 'open') { y.status = 'reported'; y.reportedOn = today(); } }), 500)));
  $$('[data-fix]', view).forEach(b => b.onclick = () => { save(x => { const y = x.repairs.find(y => y.id === b.dataset.fix); y.status = 'fixed'; y.fixedOn = today(); }); toast('Marked as fixed ✅'); });
  $$('[data-reopen]', view).forEach(b => b.onclick = () => save(x => { const y = x.repairs.find(y => y.id === b.dataset.reopen); y.status = 'open'; y.fixedOn = null; }));
  $$('[data-rdel]', view).forEach(b => b.onclick = async () => { if (await confirmDlg('Remove this repair?', 'Remove')) save(x => { x.repairs = x.repairs.filter(y => y.id !== b.dataset.rdel); }); });
  $('#mh-addrep').onclick = () => {
    const rooms = inspectionFor(h.id)?.rooms.map(r => r.name) || ['Kitchen', 'Living room', 'Bedroom', 'Bathroom', 'Balcony'];
    const s = openSheet(`<h3>Something needs fixing</h3><label>What<input id="ar-t" placeholder="e.g. Bathroom tap leaking"></label>
      <label>Where<input id="ar-w" list="ar-rooms"></label><datalist id="ar-rooms">${rooms.map(n => `<option>${esc(n)}</option>`).join('')}</datalist>
      <label>Details<input id="ar-n"></label><button class="btn primary block" id="ar-ok">Add</button>`);
    $('#ar-ok', s.el).onclick = () => { const t = $('#ar-t', s.el).value.trim(); if (!t) return toast('What needs fixing?'); s.close(); save(x => x.repairs.push({ id: uid(), title: t, where: $('#ar-w', s.el).value.trim(), note: $('#ar-n', s.el).value.trim(), status: 'open', createdOn: today() })); };
  };
  const contactSheet = c => {
    const isNew = !c; c = c || { name: '', role: '', phone: '' };
    const s = openSheet(`<h3>${isNew ? 'Add contact' : 'Edit contact'}</h3><label>Name<input id="ac-n" value="${esc(c.name)}"></label>
      <label>Role<input id="ac-r" value="${esc(c.role)}" list="ac-roles"></label><datalist id="ac-roles">${ROLES.map(r => `<option>${r}</option>`).join('')}</datalist>
      <label>Phone<input id="ac-p" type="tel" value="${esc(c.phone)}"></label>
      <div class="row">${isNew ? '' : '<button class="btn danger ghost" id="ac-del">Delete</button>'}<span class="grow"></span><button class="btn primary" id="ac-ok">Save</button></div>`);
    $('#ac-ok', s.el).onclick = () => {
      const v = { name: $('#ac-n', s.el).value.trim(), role: $('#ac-r', s.el).value.trim(), phone: $('#ac-p', s.el).value.trim() };
      if (!v.name) return toast('Add a name'); s.close();
      save(x => { if (isNew) x.contacts.push({ id: uid(), ...v }); else Object.assign(x.contacts.find(y => y.id === c.id), v); });
    };
    $('#ac-del', s.el)?.addEventListener('click', () => { s.close(); save(x => { x.contacts = x.contacts.filter(y => y.id !== c.id); }); });
  };
  $('#mh-addc').onclick = () => contactSheet();
  $$('[data-cedit]', view).forEach(b => b.onclick = () => contactSheet(m.contacts.find(c => c.id === b.dataset.cedit)));
  $('#mh-ics').onclick = () => { download(`my-home-reminders.ics`, ics(get('homes', m.id), h), 'text/calendar'); toast('Open the file to add the reminders to your calendar', 4000); };
  $('#mh-stop').onclick = async () => { if (await confirmDlg('Stop tracking this home? Rent history, upkeep and repairs will be removed.', 'Stop')) { remove('homes', m.id); go(`#/h/${h.id}`); } };
  hydrate(view);
}

// Calendar file: rent every month + each upkeep task on its cycle, with a reminder the day before.
function ics(m, h) {
  const d = s => s.replace(/-/g, '');
  const esc2 = s => String(s).replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const ev = (id, date, title, rrule, desc) => ['BEGIN:VEVENT', `UID:${id}@life-utilities`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d(date)}`, `DTEND;VALUE=DATE:${d(addDays(date, 1))}`, `SUMMARY:${esc2(title)}`, rrule && `RRULE:${rrule}`, desc && `DESCRIPTION:${esc2(desc)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc2(title)}`, 'TRIGGER:-PT15H', 'END:VALARM', 'END:VEVENT'].filter(Boolean);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Life Utilities//My home//EN', 'CALSCALE:GREGORIAN'];
  if (m.rent?.amount) {
    const r = rentStatus(m); let first = r && !r.paid ? r.due : `${ym(addDays(`${ym()}-01`, 32))}-${String(m.rent.dueDay).padStart(2, '0')}`;
    lines.push(...ev(`rent-${m.id}`, first, `💸 Rent due ${fmtMoney(m.rent.amount)}`, `FREQ=MONTHLY;BYMONTHDAY=${m.rent.dueDay}`, h.title));
  }
  for (const t of m.tasks || []) lines.push(...ev(`task-${t.id}`, t.next || today(), `${t.icon || '🧰'} ${t.name}`, `FREQ=DAILY;INTERVAL=${t.every}`, `${h.title} · ${everyLabel(t.every)}`));
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
