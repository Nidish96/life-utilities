// Move-in inspection: go room by room, record the condition of every fixture (with photos), then export a report.
// Stored in its own collection ('inspections', one per house) so editing the house never overwrites it.
import { state, live, get, upsert, remove, on } from '../state.js';
import { $, $$, esc, setTitle, openSheet, confirmDlg, toast, today, fmtDate, hydrate, go } from '../ui.js';
import { uid } from '../storage.js';
import { addUploads, withSigs, jobsFor, retry, cancel } from '../uploads.js';
import { deletePhotos } from '../media.js';

/* ---------- what's in each kind of room ---------- */
const DOOR = ['Door', 'Door handle & lock', 'Door hinges', 'Door stopper'];
const ELEC = ['Lights', 'Switches & sockets'];
const FINISH = ['Walls & paint', 'Ceiling', 'Floor'];
export const ROOM_TYPES = {
  entrance: { e: '🚪', l: 'Entrance', items: ['Main door', 'Main door lock & keys', 'Door hinges', 'Safety door / grill', 'Peephole', 'Doorbell', 'Name plate', 'Shoe rack', ...ELEC, 'Floor'] },
  living: { e: '🛋️', l: 'Living room', items: ['Windows', 'Window grills', 'Window mesh', 'Curtain rods', ...ELEC, 'Fans', 'AC', 'TV point', 'Internet / cable point', ...FINISH] },
  dining: { e: '🍽️', l: 'Dining', items: ['Lights', 'Fan', 'Switches & sockets', 'Wash basin', 'Mirror', ...FINISH] },
  kitchen: { e: '🍳', l: 'Kitchen', items: ['Cabinet doors', 'Cabinet hinges', 'Cabinet handles', 'Drawers & channels', 'Countertop', 'Sink', 'Tap', 'Sink drain', 'Chimney / exhaust', 'Hob / stove', 'Gas pipeline & valve', 'Water purifier', 'Tiles / backsplash', 'Windows', ...ELEC, 'Floor'] },
  bedroom: { e: '🛏️', l: 'Bedroom', items: [...DOOR, 'Windows', 'Window grills', 'Curtain rods', 'Wardrobe doors', 'Wardrobe hinges & handles', 'Wardrobe shelves & locks', ...ELEC, 'Fan', 'AC', ...FINISH] },
  bathroom: { e: '🚿', l: 'Bathroom', items: ['Door', 'Door lock & latch', 'Taps', 'Shower', 'Geyser', 'Wash basin', 'Mirror', 'WC & flush', 'Health faucet', 'Exhaust fan', 'Floor drain', 'Towel rod & accessories', 'Tiles', 'Lights', 'Ventilator window'] },
  balcony: { e: '🌿', l: 'Balcony', items: ['Door', 'Door lock', 'Railing / grill', 'Floor', 'Drain', 'Tap', 'Lights', 'Clothes drying stand'] },
  utility: { e: '🧺', l: 'Utility', items: ['Washing machine point', 'Tap', 'Sink', 'Drain', 'Lights', 'Floor'] },
  study: { e: '📚', l: 'Study', items: [...DOOR, 'Windows', 'Shelves', ...ELEC, 'Fan', ...FINISH] },
  general: { e: '🔑', l: 'Meters & keys', items: ['Electricity meter reading', 'Water meter reading', 'Gas meter reading', 'MCB / fuse board', 'Inverter / power backup', 'Water tank & motor', 'Intercom', 'Keys handed over', 'Access cards / remotes', 'Parking slot'] },
  other: { e: '📦', l: 'Other', items: [] },
};
export const COND = {
  good: { l: 'Good', e: '✅', c: '#1d5e3f', bg: '#e2f3ea' },
  fair: { l: 'Fair', e: '🟡', c: '#7a5600', bg: '#fff1c7' },
  damaged: { l: 'Damaged', e: '🔴', c: '#8a2c22', bg: '#f9e3e1' },
  missing: { l: 'Missing', e: '⚫', c: '#3a3a3a', bg: '#e6e6e6' },
  na: { l: 'N/A', e: '—', c: '#786f64', bg: '#efeae2' },
};
const ISSUE = c => c === 'damaged' || c === 'missing';
const READING = n => /reading|keys|cards|remotes/i.test(n); // these want a value, not just a condition

export const inspectionFor = houseId => live('inspections').find(i => i.houseId === houseId);
const newItem = name => ({ id: uid(), name, cond: null, qty: null, note: '', photos: [] });
const newRoom = (type, name) => ({ id: uid(), type, name: name || ROOM_TYPES[type].l, items: ROOM_TYPES[type].items.map(newItem), notes: '' });
export function stats(insp) {
  const all = (insp?.rooms || []).flatMap(r => r.items);
  const by = k => all.filter(i => i.cond === k).length;
  return { total: all.length, checked: all.filter(i => i.cond).length, good: by('good'), fair: by('fair'), damaged: by('damaged'), missing: by('missing'), na: by('na'), photos: all.reduce((n, i) => n + (i.photos?.length || 0), 0) };
}
const save = insp => upsert('inspections', insp);
const fresh = id => get('inspections', id); // re-read before changing (background photo uploads may have updated it)

/* ---------- card on the house page ---------- */
export function inspectionCard(h) {
  const insp = inspectionFor(h.id);
  if (!insp) return h.status === 'finalized'
    ? `<a class="card row insp-cta" href="#/h/${h.id}/inspect">📋 <span class="grow"><b>Move-in inspection</b><br><small class="muted">Go room by room and record the condition of everything before you move in.</small></span><span class="muted">›</span></a>`
    : `<p class="small"><a href="#/h/${h.id}/inspect">📋 Start a move-in inspection</a></p>`;
  const s = stats(insp);
  return `<a class="card row" href="#/h/${h.id}/inspect">📋 <span class="grow"><b>Move-in inspection</b>${insp.done ? ' ✅' : ''}<br>
    <small class="muted">${s.checked} of ${s.total} checked${s.damaged + s.missing ? ` · ⚠️ ${s.damaged + s.missing} issue${s.damaged + s.missing === 1 ? '' : 's'}` : ''}${s.photos ? ` · 📷 ${s.photos}` : ''}</small>
    <div class="bar"><span style="width:${s.total ? Math.round(s.checked / s.total * 100) : 0}%"></span></div></span><span class="muted">›</span></a>`;
}

/* ---------- overview: rooms ---------- */
export function inspectPage(view, houseId) {
  const h = get('houses', houseId);
  if (!h) { view.innerHTML = '<div class="empty">House not found.</div>'; return; }
  setTitle('Move-in inspection', true);
  let insp = inspectionFor(houseId);
  if (!insp) return setupPage(view, h);
  const s = stats(insp);
  view.innerHTML = `
    <div class="card">
      <div class="row"><b class="grow">${esc(h.title || 'House')}</b><span class="small muted">${fmtDate(insp.date)}</span></div>
      <div class="bar big"><span style="width:${s.total ? Math.round(s.checked / s.total * 100) : 0}%"></span></div>
      <div class="small">${s.checked} of ${s.total} items checked</div>
      <div class="chips insp-tally">${['good', 'fair', 'damaged', 'missing'].map(k => `<span class="chip" style="background:${COND[k].bg};color:${COND[k].c};border-color:transparent">${COND[k].e} ${COND[k].l} <b>${s[k]}</b></span>`).join('')}${s.photos ? `<span class="chip">📷 ${s.photos}</span>` : ''}</div>
    </div>
    <div id="rooms">${insp.rooms.map(r => { const rs = stats({ rooms: [r] }); return `
      <a class="card room-card" href="#/h/${houseId}/inspect/${r.id}"><span class="room-e">${ROOM_TYPES[r.type]?.e || '📦'}</span>
        <span class="grow"><b>${esc(r.name)}</b><small class="muted">${rs.checked}/${rs.total} checked${rs.damaged + rs.missing ? ` · <span class="warn">⚠️ ${rs.damaged + rs.missing}</span>` : ''}${rs.photos ? ` · 📷 ${rs.photos}` : ''}</small>
        <span class="bar"><span style="width:${rs.total ? Math.round(rs.checked / rs.total * 100) : 0}%"></span></span></span>
        ${rs.total && rs.checked === rs.total ? '<span>✅</span>' : '<span class="muted">›</span>'}</a>`; }).join('')}</div>
    <button class="btn block" id="i-addroom">＋ Add a room</button>
    <div class="card">
      <div class="grid2"><label>Inspection date<input type="date" id="i-date" value="${esc(insp.date || today())}"></label>
      <label>Present <small>(names)</small><input id="i-present" value="${esc(insp.present || '')}" placeholder="Me, Ramesh (owner)"></label></div>
      <label>Overall notes<textarea id="i-notes" rows="3" placeholder="Anything the owner promised to fix, deep cleaning done, etc.">${esc(insp.notes || '')}</textarea></label>
    </div>
    <button class="btn primary block big" id="i-export">📄 Export report</button>
    <div class="row"><button class="btn ghost" id="i-done">${insp.done ? '↩︎ Reopen' : '✅ Mark inspection complete'}</button><span class="grow"></span><button class="btn danger ghost" id="i-del">Delete inspection</button></div>`;
  const field = (sel, k) => $(sel).onchange = e => { const x = fresh(insp.id); x[k] = e.target.value.trim(); save(x); };
  field('#i-date', 'date'); field('#i-present', 'present'); field('#i-notes', 'notes');
  $('#i-addroom').onclick = () => addRoom(insp.id, r => go(`#/h/${houseId}/inspect/${r.id}`));
  $('#i-export').onclick = async () => { const { exportInspection } = await import('../inspectreport.js'); exportInspection(fresh(insp.id), h); };
  $('#i-done').onclick = () => { const x = fresh(insp.id); x.done = !x.done; x.completedAt = x.done ? Date.now() : null; save(x); inspectPage(view, houseId); if (x.done) toast('Inspection complete — export the report to keep a copy'); };
  $('#i-del').onclick = async () => {
    if (!(await confirmDlg('Delete this inspection and all its photos?'))) return;
    const x = fresh(insp.id); x.rooms.forEach(r => r.items.forEach(i => deletePhotos(i.photos))); remove('inspections', x.id); go(`#/h/${houseId}`);
  };
}

function setupPage(view, h) {
  const m = String(h.bhk || '').match(/(\d+)\s*b/i);
  const beds = m ? +m[1] : 2;
  const counts = { entrance: 1, living: 1, dining: 0, kitchen: 1, bedroom: beds, bathroom: Math.max(1, Math.min(beds, 3)), balcony: 1, utility: 0, study: 0, general: 1 };
  const draw = () => {
    view.innerHTML = `
      <div class="card"><h3>📋 Set up the rooms</h3>
        <p class="small muted">Each room comes with a checklist of the usual fixtures (handles, hinges, taps, lights, fans, floor…). You can add, rename or remove anything later.</p>
        ${Object.entries(counts).map(([k, n]) => `<div class="row room-count"><span class="grow">${ROOM_TYPES[k].e} ${ROOM_TYPES[k].l}</span>
          <button class="btn small" data-m="${k}" ${n ? '' : 'disabled'}>−</button><b>${n}</b><button class="btn small" data-p="${k}">＋</button></div>`).join('')}
        <label>Inspection date<input type="date" id="s-date" value="${today()}"></label>
      </div>
      <button class="btn primary block big" id="s-go">Start inspection (${Object.values(counts).reduce((a, b) => a + b, 0)} rooms)</button>`;
    $$('[data-m]', view).forEach(b => b.onclick = () => { counts[b.dataset.m] = Math.max(0, counts[b.dataset.m] - 1); draw(); });
    $$('[data-p]', view).forEach(b => b.onclick = () => { counts[b.dataset.p]++; draw(); });
    $('#s-go').onclick = () => {
      const rooms = [];
      for (const [k, n] of Object.entries(counts)) for (let i = 1; i <= n; i++) rooms.push(newRoom(k, n > 1 ? `${ROOM_TYPES[k].l} ${i}` : ROOM_TYPES[k].l));
      if (!rooms.length) return toast('Add at least one room');
      save({ houseId: h.id, date: $('#s-date').value || today(), present: '', notes: '', rooms, done: false });
      inspectPage(view, h.id);
    };
  };
  draw();
}

function addRoom(inspId, done) {
  const s = openSheet(`<h3>Add a room</h3><div class="room-types">${Object.entries(ROOM_TYPES).map(([k, v]) => `<button class="btn" data-t="${k}">${v.e} ${v.l}</button>`).join('')}</div>
    <label>Name<input id="ar-name" placeholder="e.g. Guest bedroom"></label>`);
  $$('[data-t]', s.el).forEach(b => b.onclick = () => {
    const x = fresh(inspId), t = b.dataset.t;
    const same = x.rooms.filter(r => r.type === t).length;
    const r = newRoom(t, $('#ar-name', s.el).value.trim() || (same ? `${ROOM_TYPES[t].l} ${same + 1}` : ROOM_TYPES[t].l));
    x.rooms.push(r); save(x); s.close(); done(r);
  });
}

/* ---------- one room: the checklist ---------- */
export function roomPage(view, houseId, roomId) {
  const insp = inspectionFor(houseId);
  const room = insp?.rooms.find(r => r.id === roomId);
  if (!room) { view.innerHTML = '<div class="empty">Room not found.</div>'; return; }
  setTitle(room.name, true);
  const idx = insp.rooms.indexOf(room), next = insp.rooms[idx + 1];
  view.innerHTML = `
    <div class="row"><h2 class="grow">${ROOM_TYPES[room.type]?.e || '📦'} ${esc(room.name)}</h2><button class="btn small" id="r-menu">⋯</button></div>
    <p class="small muted">Tap a condition for each item. Add a note or photo for anything that isn't perfect.</p>
    <div id="items">${room.items.map(it => itemRow(insp, room, it)).join('')}</div>
    <div class="row wrap"><button class="btn" id="r-additem">＋ Add item</button><button class="btn ghost" id="r-allgood">✅ Mark the rest as Good</button></div>
    <label>Room notes<textarea id="r-notes" rows="2" placeholder="General remarks about this room">${esc(room.notes || '')}</textarea></label>
    ${next ? `<a class="btn primary block big" href="#/h/${houseId}/inspect/${next.id}">Next: ${ROOM_TYPES[next.type]?.e || ''} ${esc(next.name)} →</a>` : `<a class="btn primary block big" href="#/h/${houseId}/inspect">Back to all rooms</a>`}`;
  const withRoom = fn => { const x = fresh(insp.id); const r = x.rooms.find(r => r.id === roomId); fn(x, r); save(x); return { x, r }; };
  const redrawItem = itemId => {
    const x = fresh(insp.id), r = x.rooms.find(r => r.id === roomId), it = r.items.find(i => i.id === itemId);
    const el = $(`[data-item="${itemId}"]`, view);
    if (!el) return;
    if (el.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) { // don't wipe what you're typing
      document.activeElement.addEventListener('blur', () => setTimeout(() => redrawItem(itemId), 0), { once: true }); return;
    }
    if (!it) { el.remove(); return; }
    const open = el.classList.contains('open');
    el.outerHTML = itemRow(x, r, it, open);
    bindItem($(`[data-item="${itemId}"]`, view));
  };
  const bindItem = el => {
    const itemId = el.dataset.item;
    const upd = fn => withRoom((x, r) => fn(r.items.find(i => i.id === itemId), x, r));
    $$('[data-c]', el).forEach(b => b.onclick = () => {
      let opened = false;
      upd(it => { it.cond = it.cond === b.dataset.c ? null : b.dataset.c; opened = ISSUE(it.cond) || it.cond === 'fair'; });
      redrawItem(itemId);
      if (opened) $(`[data-item="${itemId}"]`, view)?.classList.add('open'); // prompt for a note/photo
    });
    $('.it-more', el).onclick = () => el.classList.toggle('open');
    $('.it-note', el).onchange = e => upd(it => { it.note = e.target.value.trim(); });
    $('.it-qty', el).onchange = e => upd(it => { it.qty = e.target.value === '' ? null : +e.target.value; });
    const onFiles = async e => {
      const files = [...e.target.files]; e.target.value = '';
      if (!files.length) return;
      const items = await withSigs(files);
      addUploads(items, { target: { coll: 'inspections', id: insp.id, key: itemId, attach: (rec, photo) => { const it = rec.rooms.find(r => r.id === roomId)?.items.find(i => i.id === itemId); if (it) it.photos = [...(it.photos || []), photo]; } } });
      redrawItem(itemId);
    };
    $('.it-cam', el).onchange = onFiles; $('.it-gal', el).onchange = onFiles;
    $$('.it-retry', el).forEach(b => b.onclick = () => { const j = jobsFor('inspections', insp.id, itemId).find(j => j.id === +b.dataset.j); if (j) retry(j); redrawItem(itemId); });
    $$('.it-cancel', el).forEach(b => b.onclick = () => { const j = jobsFor('inspections', insp.id, itemId).find(j => j.id === +b.dataset.j); if (j) cancel(j); redrawItem(itemId); });
    $$('.it-delph', el).forEach(b => b.onclick = async () => {
      if (!(await confirmDlg('Delete this photo?'))) return;
      upd(it => { const [p] = it.photos.splice(+b.dataset.i, 1); deletePhotos([p]); }); redrawItem(itemId);
    });
    $('.it-rename', el).onclick = () => { const n = prompt('Item name', $('.it-name', el).textContent); if (n && n.trim()) { upd(it => { it.name = n.trim(); }); redrawItem(itemId); } };
    $('.it-del', el).onclick = async () => {
      if (!(await confirmDlg(`Remove “${$('.it-name', el).textContent}” from this room?`, 'Remove'))) return;
      withRoom((x, r) => { const i = r.items.findIndex(i => i.id === itemId); const [it] = r.items.splice(i, 1); deletePhotos(it.photos); });
      el.remove();
    };
    hydrate(el);
  };
  $$('[data-item]', view).forEach(bindItem);
  $('#r-notes').onchange = e => withRoom((x, r) => { r.notes = e.target.value.trim(); });
  $('#r-additem').onclick = () => {
    const n = prompt('What item? (e.g. Mirror cabinet, Shoe rack)');
    if (!n || !n.trim()) return;
    const it = newItem(n.trim());
    withRoom((x, r) => r.items.push(it));
    $('#items').insertAdjacentHTML('beforeend', itemRow(fresh(insp.id), room, it, true));
    bindItem($(`[data-item="${it.id}"]`, view));
  };
  $('#r-allgood').onclick = () => {
    let n = 0;
    withRoom((x, r) => r.items.forEach(it => { if (!it.cond && !READING(it.name)) { it.cond = 'good'; n++; } }));
    roomPage(view, houseId, roomId);
    toast(n ? `Marked ${n} item${n === 1 ? '' : 's'} as Good` : 'Nothing left unchecked');
  };
  $('#r-menu').onclick = () => {
    const s = openSheet(`<h3>${esc(room.name)}</h3><button class="btn block" id="rm-ren">✏️ Rename room</button><button class="btn block danger" id="rm-del">🗑 Delete room</button>`);
    $('#rm-ren', s.el).onclick = () => { const n = prompt('Room name', room.name); if (n && n.trim()) { withRoom((x, r) => { r.name = n.trim(); }); s.close(); roomPage(view, houseId, roomId); } };
    $('#rm-del', s.el).onclick = async () => {
      if (!(await confirmDlg(`Delete ${room.name} and its photos?`))) return;
      const x = fresh(insp.id); const r = x.rooms.find(r => r.id === roomId); r.items.forEach(i => deletePhotos(i.photos));
      x.rooms = x.rooms.filter(r => r.id !== roomId); save(x); s.close(); go(`#/h/${houseId}/inspect`);
    };
  };
  // a photo finished uploading in the background
  stopListening?.();
  const onAttached = t => { if (t.coll === 'inspections' && t.id === insp.id && location.hash === `#/h/${houseId}/inspect/${roomId}` && t.key) redrawItem(t.key); };
  listeners.add(onAttached);
  stopListening = () => listeners.delete(onAttached);
}
const listeners = new Set();
let stopListening = null;
on('photo-attached', t => listeners.forEach(f => f(t)));
on('uploads', () => {
  const m = location.hash.match(/^#\/h\/([^/]+)\/inspect\/([^/]+)$/);
  const insp = m && inspectionFor(m[1]);
  if (!insp) return;
  // refresh items whose upload status changed (progress / errors)
  $$('[data-item]').forEach(el => {
    if (el.dataset.ups !== jobsFor('inspections', insp.id, el.dataset.item).map(j => j.status).join()) listeners.forEach(f => f({ coll: 'inspections', id: insp.id, key: el.dataset.item }));
  });
});

function itemRow(insp, room, it, open = false) {
  const ups = jobsFor('inspections', insp.id, it.id);
  const reading = READING(it.name);
  return `<div class="card item ${it.cond ? 'c-' + it.cond : ''} ${open ? 'open' : ''}" data-item="${it.id}" data-ups="${ups.map(j => j.status).join()}">
    <div class="row it-head"><span class="grow it-name">${esc(it.name)}</span>
      ${it.note || it.photos?.length || ups.length ? `<small class="muted">${it.note ? '📝' : ''}${it.photos?.length ? ` 📷${it.photos.length}` : ''}${ups.length ? ' ⬆️' : ''}</small>` : ''}
      <button class="icon it-more" title="Note & photos">${open ? '▴' : '▾'}</button></div>
    <div class="cond">${Object.entries(COND).map(([k, v]) => `<button class="${it.cond === k ? 'on' : ''}" data-c="${k}" style="--cc:${v.c};--cb:${v.bg}">${k === 'na' ? 'N/A' : v.l}</button>`).join('')}</div>
    <div class="it-extra">
      <div class="row"><input class="it-note grow" value="${esc(it.note || '')}" placeholder="${reading ? 'Reading / details, e.g. 04512 kWh, 3 keys' : 'Note, e.g. handle loose, small chip near edge'}">
        <input class="it-qty" type="number" inputmode="numeric" min="0" value="${it.qty ?? ''}" placeholder="Qty" title="How many"></div>
      <div class="photos it-photos">${(it.photos || []).map((p, i) => `<div class="ph"><img class="thumb" data-fid="${esc(p.t || p.f)}" data-full="${esc(p.f)}" alt=""><button class="icon ph-x it-delph" data-i="${i}">✕</button></div>`).join('')}
        ${ups.map(j => `<div class="ph up ${j.status} it-ups"><img class="thumb" src="${j.preview}" alt=""><span class="up-ov">${j.status === 'error' ? `<button class="icon it-retry" data-j="${j.id}">↻</button>` : '<i class="up-spin"></i>'}</span><button class="icon ph-x it-cancel" data-j="${j.id}">✕</button></div>`).join('')}</div>
      <div class="row wrap"><label class="btn small">📷 Photo<input type="file" class="it-cam" accept="image/*" capture="environment" hidden></label>
        <label class="btn small">🖼️ Gallery<input type="file" class="it-gal" accept="image/*" multiple hidden></label>
        <span class="grow"></span><button class="btn small ghost it-rename">Rename</button><button class="btn small ghost danger it-del">Remove</button></div>
    </div></div>`;
}
