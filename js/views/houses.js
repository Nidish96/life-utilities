import { live, get, upsert, remove, cfg, setShared, on } from '../state.js';
import { $, $$, esc, setTitle, openSheet, confirmDlg, toast, photoImg, hydrate, fmtDate, fmtMoney, stars, mapEmbed, mapsLink, md, today, go } from '../ui.js';
import { deletePhotos } from '../media.js';
import { addUploads, cancel, retry, handOff, attachedSince, pendingFor, withSigs } from '../uploads.js';
import { aiReady, aiName, houseReport, reverseGeocode } from '../ai.js';
import { loadLeaflet, pickLocation } from '../geo.js';

const STATUS = {
  to_visit: { l: 'To visit', e: '🗓️' },
  visited: { l: 'Visited', e: '👀' },
  shortlisted: { l: 'Shortlisted', e: '⭐' },
  rejected: { l: 'Rejected', e: '✕' },
  finalized: { l: 'Finalised', e: '🔑' },
};
const CHECKS = ['Parking', 'Power backup', '24h water', 'Lift', 'Gated / security', 'Good sunlight', 'Ventilation', 'Quiet street', 'Pets allowed', 'Near transit', 'Balcony', 'Modular kitchen', 'Wardrobes', 'Gym / pool'];

/* ---------- your landmarks (office, school, family…) ---------- */
export const LM_ICONS = ['🏢', '🏫', '👪', '🚇', '🏋️', '🏥', '🛒', '🌳', '✈️', '⭐'];
const LM_HINT = { '🏢': 'Office', '🏫': 'School', '👪': 'Family', '🚇': 'Metro station', '🏋️': 'Gym', '🏥': 'Hospital', '🛒': 'Groceries', '🌳': 'Park', '✈️': 'Airport', '⭐': 'Favourite spot' };
const landmarks = () => live('landmarks').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
// straight-line ("as the crow flies") distance in km
export function km(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtKm = d => (d < 1 ? `${Math.round(d * 1000 / 10) * 10} m` : `${d < 10 ? d.toFixed(1) : Math.round(d)} km`);
// [{ l, d }] for a house with a location, nearest first
const distances = h => (h.lat && h.lng ? landmarks().filter(l => l.lat && l.lng).map(l => ({ l, d: km(h, l) })) : []);
const distLine = (h, n = 3) => distances(h).slice(0, n).map(({ l, d }) => `${l.icon || '📍'} ${esc(l.name)} ${fmtKm(d)}`).join(' · ');

const priceLine = h => [fmtMoney(h.price) && `${fmtMoney(h.price)}${h.deal === 'rent' ? '/mo' : ''}`, h.bhk, h.area && `${h.area} sq ft`].filter(Boolean).join(' · ');

/* ---------------- list ---------------- */
let filter = 'active', mode = 'list';
export function housesList(view) {
  setTitle('House hunt');
  const all = live('houses');
  const shown = all.filter(h => filter === 'all' || (filter === 'active' ? !['rejected'].includes(h.status) : h.status === filter))
    .sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.visitedOn || '').localeCompare(a.visitedOn || ''));
  view.innerHTML = `
    <div class="chips">
      ${[['active', 'Active'], ...Object.entries(STATUS).map(([k, v]) => [k, `${v.e} ${v.l}`]), ['all', 'All']].map(([k, l]) =>
        `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l} <small>${k === 'all' ? all.length : k === 'active' ? all.filter(h => h.status !== 'rejected').length : all.filter(h => h.status === k).length}</small></button>`).join('')}
    </div>
    <div class="row"><div class="seg"><button class="${mode === 'list' ? 'on' : ''}" data-m="list">☰ List</button><button class="${mode === 'map' ? 'on' : ''}" data-m="map">🗺️ Map</button></div>
      <span class="grow"></span><a class="btn" href="#/houses/report">📄 Summary report</a></div>
    <div id="hbody"></div>
    <a class="fab" href="#/h/new" aria-label="Add house">＋</a>`;
  $$('[data-f]', view).forEach(b => b.onclick = () => { filter = b.dataset.f; housesList(view); });
  $$('[data-m]', view).forEach(b => b.onclick = () => { mode = b.dataset.m; housesList(view); });
  const body = $('#hbody');
  if (mode === 'map') return drawMap(body, shown);
  if (!shown.length) { body.innerHTML = `<div class="empty">No houses here yet. Tap ＋ when you're at a viewing — snap photos, drop the location, jot what you noticed.</div>`; return; }
  body.innerHTML = shown.map(h => `
    <a class="card hcard" href="#/h/${h.id}">
      ${h.photos?.length ? photoImg(h.photos[0], 'hcover') : '<div class="hcover none">🏠</div>'}
      <div class="hinfo"><div class="row"><b class="grow">${esc(h.title || h.address || 'Untitled')}</b><span class="status s-${h.status}">${STATUS[h.status]?.e || ''} ${STATUS[h.status]?.l || ''}</span></div>
      <div class="small">${esc(priceLine(h))}</div>
      <div class="small muted">${esc(h.locality || h.address || '')}</div>
      <div class="small"><span class="stars">${stars(h.rating)}</span> ${h.visitedOn ? '· ' + fmtDate(h.visitedOn) : ''} ${h.photos?.length ? `· 📷 ${h.photos.length}` : ''}</div>
      ${distLine(h) ? `<div class="small muted">${distLine(h)}</div>` : ''}</div>
    </a>`).join('');
  hydrate(body);
}

async function drawMap(el, houses) {
  const pts = houses.filter(h => h.lat && h.lng);
  el.innerHTML = `
    <div class="row wrap lm-bar"><button class="btn" id="lm-add">＋ Landmark</button>
      <span class="small muted grow">${landmarks().length ? 'Your places: ' + landmarks().map(l => `<button class="lm-chip" data-lm="${l.id}">${l.icon || '📍'} ${esc(l.name)}</button>`).join(' ') : 'Mark your office, school, family… to see how far each house is.'}</span></div>
    <div id="hmap" class="bigmap"></div>
    ${pts.length < houses.length ? `<p class="hint">${houses.length - pts.length} house(s) have no location yet.</p>` : ''}
    <p class="hint">Distances are straight-line (as the crow flies), not travel time.</p>`;
  try { await loadLeaflet(); } catch { el.innerHTML = '<div class="empty">Map could not load (offline?).</div>'; return; }
  const map = L.map('hmap');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const houseIcon = h => L.divIcon({ className: '', html: `<div class="hpin s-${h.status}">🏠</div>`, iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16] });
  const lmIcon = l => L.divIcon({ className: '', html: `<div class="lmpin">${l.icon || '📍'}<span>${esc(l.name)}</span></div>`, iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -16] });
  const houseMarkers = pts.map(h => L.marker([h.lat, h.lng], { icon: houseIcon(h) }).addTo(map).bindPopup(`<b>${esc(h.title || 'House')}</b><br>${esc(priceLine(h))}${distLine(h, 5) ? `<br><small>${distLine(h, 5)}</small>` : ''}<br><a href="#/h/${h.id}">Open →</a>`));
  const lmLayer = L.layerGroup().addTo(map);
  const lmMarkers = new Map();
  const drawLandmarks = () => {
    lmLayer.clearLayers(); lmMarkers.clear();
    for (const l of landmarks().filter(x => x.lat && x.lng)) {
      const near = pts.map(h => ({ h, d: km(h, l) })).sort((a, b) => a.d - b.d).slice(0, 3);
      const m = L.marker([l.lat, l.lng], { icon: lmIcon(l), zIndexOffset: 1000 }).addTo(lmLayer).bindPopup(`<b>${l.icon || '📍'} ${esc(l.name)}</b>${l.note ? `<br><small>${esc(l.note)}</small>` : ''}
        ${near.length ? `<br><small>Closest: ${near.map(({ h, d }) => `<a href="#/h/${h.id}">${esc(h.title || 'House')}</a> ${fmtKm(d)}`).join(', ')}</small>` : ''}
        <div class="lm-pop"><button data-lme="${l.id}">✏️ Edit</button><button data-lmm="${l.id}">✋ Drag</button><button data-lmp="${l.id}">🔗 Set by link</button><button data-lmd="${l.id}">🗑</button></div>`);
      lmMarkers.set(l.id, m);
    }
  };
  drawLandmarks();
  const all = [...houseMarkers, ...lmMarkers.values()];
  if (all.length) map.fitBounds(L.featureGroup(all).getBounds().pad(0.3), { maxZoom: 15 });
  else map.setView([20.6, 78.9], 4);
  const refresh = () => housesList($('#view')); // redraw list chips + distances

  // adding: search, paste a link/coordinates, use your location, or tap the map — in the picker
  $('#lm-add').onclick = async () => {
    const c = map.getCenter();
    const p = await pickLocation({ title: 'Where is your landmark?', center: all.length ? { lat: c.lat, lng: c.lng } : null });
    if (p) editLandmark({ lat: p.lat, lng: p.lng, name: (p.label || '').split(',')[0].slice(0, 40) }, refresh);
  };

  // landmark popups: edit / move / delete
  map.on('popupopen', e => {
    const box = e.popup.getElement();
    const id = a => box.querySelector(`[${a}]`)?.getAttribute(a);
    box.querySelector('[data-lme]')?.addEventListener('click', () => { map.closePopup(); editLandmark(get('landmarks', id('data-lme')), refresh); });
    box.querySelector('[data-lmd]')?.addEventListener('click', async () => {
      const l = get('landmarks', id('data-lmd'));
      if (await confirmDlg(`Remove the landmark "${l.name}"?`, 'Remove')) { remove('landmarks', l.id); refresh(); }
    });
    box.querySelector('[data-lmp]')?.addEventListener('click', async () => {
      const l = get('landmarks', id('data-lmp')); map.closePopup();
      const p = await pickLocation({ title: `Move ${l.name}`, start: l });
      if (p) { upsert('landmarks', { ...l, lat: p.lat, lng: p.lng }); toast('Moved'); refresh(); }
    });
    box.querySelector('[data-lmm]')?.addEventListener('click', () => {
      const l = get('landmarks', id('data-lmm')), m = lmMarkers.get(l.id);
      map.closePopup(); m.dragging.enable(); toast('Drag the landmark to its new spot', 3500);
      m.once('dragend', () => { const p = m.getLatLng(); m.dragging.disable(); upsert('landmarks', { ...l, lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }); toast('Moved'); refresh(); });
    });
  });
  $$('[data-lm]', el).forEach(b => b.onclick = () => { const m = lmMarkers.get(b.dataset.lm); if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 14)); m.openPopup(); } });
}

function editLandmark(l, done) {
  const isNew = !l.id;
  l = { icon: '🏢', name: '', note: '', ...l };
  const s = openSheet(`<h3>${isNew ? 'New landmark' : 'Edit landmark'}</h3>
    <div class="lm-icons">${LM_ICONS.map(i => `<button class="${l.icon === i ? 'on' : ''}" data-i="${i}" title="${LM_HINT[i]}">${i}</button>`).join('')}</div>
    <label>Name<input id="lm-name" value="${esc(l.name)}" placeholder="${LM_HINT[l.icon] || 'Office'}"></label>
    <label>Note <small>(optional)</small><input id="lm-note" value="${esc(l.note || '')}" placeholder="e.g. 9:30 start, want under 30 min"></label>
    <button class="btn primary block" id="lm-save">${isNew ? 'Add landmark' : 'Save'}</button>`);
  $$('.lm-icons button', s.el).forEach(b => b.onclick = () => {
    l.icon = b.dataset.i;
    $$('.lm-icons button', s.el).forEach(x => x.classList.toggle('on', x === b));
    $('#lm-name', s.el).placeholder = LM_HINT[l.icon];
  });
  $('#lm-save', s.el).onclick = () => {
    l.name = $('#lm-name', s.el).value.trim() || LM_HINT[l.icon];
    l.note = $('#lm-note', s.el).value.trim();
    l.lat = +(+l.lat).toFixed(6); l.lng = +(+l.lng).toFixed(6);
    upsert('landmarks', l); s.close(); toast(isNew ? `Added ${l.name}` : 'Saved'); done?.();
  };
  setTimeout(() => $('#lm-name', s.el)?.focus(), 50);
}

/* ---------------- detail ---------------- */
export function houseDetail(view, id) {
  const h = get('houses', id);
  if (!h) { view.innerHTML = '<div class="empty">House not found.</div>'; return; }
  setTitle(h.title || 'House', true);
  const checks = Object.entries(h.checks || {});
  view.innerHTML = `
    ${h.photos?.length ? `<div class="carousel" data-gallery>${h.photos.map(ph => photoImg(ph, 'cimg')).join('')}</div>
      <p class="small muted center">📷 ${h.photos.length} photo${h.photos.length === 1 ? '' : 's'} · swipe, or tap one to view full screen</p>` : ''}
    ${pendingFor('houses', id).length ? `<div class="card upbox"><b>⬆️ ${pendingFor('houses', id).length} photo${pendingFor('houses', id).length === 1 ? '' : 's'} still uploading…</b><div class="small muted">They'll appear here as each one finishes.</div></div>` : ''}
    <div class="row"><h2 class="grow">${esc(h.title || 'Untitled')}</h2><a class="btn" href="#/h/${id}/edit">✏️ Edit</a></div>
    <div class="chips">${Object.entries(STATUS).map(([k, v]) => `<button class="chip ${h.status === k ? 'on' : ''}" data-s="${k}">${v.e} ${v.l}</button>`).join('')}</div>
    <div class="grid2 card">
      ${kv('Price', fmtMoney(h.price) && fmtMoney(h.price) + (h.deal === 'rent' ? ' / month' : ''))}
      ${kv(h.deal === 'rent' ? 'Deposit' : 'Booking amount', fmtMoney(h.deposit))}
      ${kv('Maintenance', fmtMoney(h.maintenance) && fmtMoney(h.maintenance) + '/mo')}
      ${kv('Config', h.bhk)} ${kv('Area', h.area && `${h.area} sq ft`)}
      ${kv('Price / sq ft', h.price && h.area && h.deal !== 'rent' ? fmtMoney(Math.round(h.price / h.area)) : '')}
      ${kv('Floor', h.floor)} ${kv('Furnishing', h.furnishing)} ${kv('Facing', h.facing)}
      ${kv('Available from', fmtDate(h.availableFrom))} ${kv('Visited', fmtDate(h.visitedOn))}
      ${kv('Rating', h.rating ? `<span class="stars">${stars(h.rating)}</span>` : '', true)}
    </div>
    ${checks.length ? `<div class="chips">${checks.map(([k, v]) => `<span class="chip ${v ? 'yes' : 'no'}">${v ? '✓' : '✕'} ${esc(k)}</span>`).join('')}</div>` : ''}
    ${h.pros ? `<div class="card"><b>👍 Pros</b><p class="pre">${esc(h.pros)}</p></div>` : ''}
    ${h.cons ? `<div class="card"><b>👎 Cons</b><p class="pre">${esc(h.cons)}</p></div>` : ''}
    ${h.notes ? `<div class="card"><b>📝 Notes</b><p class="pre">${esc(h.notes)}</p></div>` : ''}
    ${h.address || h.lat ? `<div class="card"><b>📍 ${esc(h.locality || 'Location')}</b><p class="small">${esc(h.address || '')}</p>${mapEmbed(h.lat, h.lng)}
      <a class="btn ghost" target="_blank" rel="noopener" href="${mapsLink({ lat: h.lat, lng: h.lng, q: h.address })}">Open in Google Maps</a></div>` : ''}
    ${distances(h).length ? `<div class="card"><b>📏 From your landmarks</b> <small class="muted">straight-line</small>
      <div class="lm-dist">${distances(h).sort((a, b) => a.d - b.d).map(({ l, d }) => `<div class="row"><span class="grow">${l.icon || '📍'} ${esc(l.name)}</span><b>${fmtKm(d)}</b>
        <a class="btn ghost small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=${h.lat},${h.lng}&destination=${l.lat},${l.lng}">Route</a></div>`).join('')}</div></div>`
      : h.lat && !landmarks().length ? `<p class="hint">Tip: add your office, school or family as landmarks on the 🗺️ Map to see distances here.</p>` : ''}
    ${h.contactName || h.contactPhone ? `<div class="card row"><span class="grow">👤 ${esc(h.contactName || '')} ${h.contactRole ? `<small class="muted">(${esc(h.contactRole)})</small>` : ''}</span>
      ${h.contactPhone ? `<a class="btn" href="tel:${esc(h.contactPhone)}">📞</a><a class="btn" target="_blank" rel="noopener" href="https://wa.me/${esc(h.contactPhone.replace(/\D/g, ''))}">💬</a>` : ''}</div>` : ''}
    ${h.listingUrl ? `<p><a target="_blank" rel="noopener" href="${esc(h.listingUrl)}">🔗 Listing</a></p>` : ''}
    <button class="btn danger" id="h-del">Delete house</button>`;
  $$('[data-s]', view).forEach(b => b.onclick = () => { h.status = b.dataset.s; upsert('houses', h); houseDetail(view, id); });
  $('#h-del').onclick = async () => {
    if (!(await confirmDlg('Delete this house and its photos?'))) return;
    deletePhotos(h.photos); remove('houses', id); go('#/houses');
  };
  hydrate(view);
}
on('photo-attached', t => {
  if (t.coll !== 'houses' || location.hash !== '#/h/' + t.id || document.querySelector('.sheet-wrap, .gal')) return;
  const view = document.getElementById('view'), x = view.querySelector('.carousel')?.scrollLeft || 0, y = window.scrollY;
  houseDetail(view, t.id);
  const c = view.querySelector('.carousel'); if (c) c.scrollLeft = x; window.scrollTo(0, y);
});
on('uploads', () => {
  const m = location.hash.match(/^#\/h\/([^/]+)$/);
  if (m && !document.querySelector('.sheet-wrap, .gal') && !pendingFor('houses', m[1]).length) document.querySelector('.upbox')?.remove();
});
const kv = (k, v, raw) => (v ? `<div><small class="muted">${k}</small><div>${raw ? v : esc(v)}</div></div>` : '');

/* ---------------- add / edit ---------------- */
export function houseEdit(view, id) {
  const existing = id && id !== 'new' ? get('houses', id) : null;
  const h = existing ? structuredClone(existing) : { status: 'visited', deal: cfg('lastDeal') || 'rent', visitedOn: today(), photos: [], checks: {}, rating: 0 };
  const added = [];      // photos uploaded while this form is open
  const mine = [];       // upload jobs started from this form
  const openedAt = Date.now();
  let saved = false;
  setTitle(existing ? 'Edit house' : 'New house', true);
  const f = (k, label, type = 'text', extra = '') => `<label>${label}<input data-k="${k}" type="${type}" value="${esc(h[k] ?? '')}" ${extra}></label>`;
  view.innerHTML = `
    <div class="card">
      <div id="hp-prog"></div>
      <div class="photos edit" id="hp"></div>
      <div class="row"><label class="btn grow">📷 Camera<input type="file" id="hp-cam" accept="image/*" capture="environment" hidden></label>
      <label class="btn grow">🖼️ Gallery<input type="file" id="hp-gal" accept="image/*" multiple hidden></label></div>
    </div>
    <div class="card">
      ${f('title', 'Name it', 'text', 'placeholder="e.g. 2BHK near Indiranagar metro"')}
      <div class="seg block" id="deal"><button data-d="rent" class="${h.deal === 'rent' ? 'on' : ''}">Rent</button><button data-d="buy" class="${h.deal === 'buy' ? 'on' : ''}">Buy</button></div>
      <div class="grid2">${f('price', `Price (${cfg('currency')}) <small id="price-hint"></small>`, 'number', 'inputmode="numeric"')}${f('deposit', 'Deposit / booking', 'number', 'inputmode="numeric"')}
      ${f('maintenance', 'Maintenance / mo', 'number', 'inputmode="numeric"')}${f('bhk', 'Config', 'text', 'placeholder="2BHK" list="bhks"')}
      ${f('area', 'Area (sq ft)', 'number', 'inputmode="numeric"')}${f('floor', 'Floor', 'text', 'placeholder="3 of 7"')}
      <label>Furnishing<select data-k="furnishing">${['', 'Unfurnished', 'Semi-furnished', 'Fully furnished'].map(o => `<option ${h.furnishing === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
      <label>Facing<select data-k="facing">${['', 'North', 'East', 'South', 'West', 'North-East', 'North-West', 'South-East', 'South-West'].map(o => `<option ${h.facing === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
      ${f('visitedOn', 'Visited on', 'date')}${f('availableFrom', 'Available from', 'date')}</div>
      <datalist id="bhks"><option>1RK</option><option>1BHK</option><option>2BHK</option><option>3BHK</option><option>4BHK</option><option>Villa</option></datalist>
      <label>Status<select data-k="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${h.status === k ? 'selected' : ''}>${v.e} ${v.l}</option>`).join('')}</select></label>
      <div><small class="muted">Your rating</small><div class="rate" id="rate">${[1, 2, 3, 4, 5].map(n => `<button data-r="${n}" class="${n <= h.rating ? 'on' : ''}">★</button>`).join('')}</div></div>
    </div>
    <div class="card">
      <b>📍 Location</b>
      ${f('locality', 'Area / locality', 'text', 'placeholder="Indiranagar"')}
      <label>Address<textarea data-k="address" rows="2">${esc(h.address || '')}</textarea></label>
      <div class="row wrap"><button class="btn" id="loc-here">📍 I'm here now</button><button class="btn" id="loc-find">🗺️ Search / paste a link</button></div>
      <p class="hint">Paste a Google Maps link or coordinates, search a place, or drop a pin on the map.</p>
      <div id="loc-map">${mapEmbed(h.lat, h.lng)}</div>
    </div>
    <div class="card"><b>Checklist</b> <small class="muted">tap: ✓ yes → ✕ no → unknown</small>
      <div class="chips" id="checks">${CHECKS.map(c => chk(c, h.checks[c])).join('')}</div></div>
    <div class="card">
      <label>👍 Pros<textarea data-k="pros" rows="3" placeholder="Bright living room, quiet lane…">${esc(h.pros || '')}</textarea></label>
      <label>👎 Cons<textarea data-k="cons" rows="3" placeholder="Damp patch in bedroom, no cross-ventilation…">${esc(h.cons || '')}</textarea></label>
      <label>📝 Notes<textarea data-k="notes" rows="3">${esc(h.notes || '')}</textarea></label>
    </div>
    <div class="card"><div class="grid2">${f('contactName', 'Contact name')}${f('contactRole', 'Owner / broker', 'text', 'list="roles"')}${f('contactPhone', 'Phone', 'tel')}${f('listingUrl', 'Listing link', 'url')}</div>
      <datalist id="roles"><option>Owner</option><option>Broker</option><option>Builder</option><option>Society manager</option></datalist></div>
    <button class="btn primary block big" id="h-save">Save house</button>`;

  const background = existing ? pendingFor('houses', existing.id) : []; // still uploading from an earlier save
  const active = () => mine.filter(j => j.status !== 'cancelled' && j.status !== 'done');
  const drawProgress = () => {
    const batch = mine.filter(j => j.status !== 'cancelled'), bg = background.filter(j => j.status === 'queued' || j.status === 'working');
    const done = batch.filter(j => j.status === 'done').length, failed = batch.filter(j => j.status === 'error').length;
    const busy = batch.length - done - failed;
    $('#hp-prog').innerHTML = busy || failed || bg.length ? `<div class="upbox">
      ${busy ? `<div class="row"><b class="grow">⬆️ Uploading ${done + 1 > batch.length ? batch.length : done + 1} of ${batch.length - failed}</b><span class="small muted">${done} done</span></div>
        <div class="bar"><span style="width:${Math.round(done / Math.max(1, batch.length - failed) * 100)}%"></span></div>
        <div class="small muted">You can save now — the rest keep uploading in the background.</div>` : ''}
      ${failed ? `<div class="small warn">⚠️ ${failed} photo${failed === 1 ? '' : 's'} failed — tap ↻ on ${failed === 1 ? 'it' : 'them'} to retry.</div>` : ''}
      ${bg.length ? `<div class="small muted">⬆️ ${bg.length} photo${bg.length === 1 ? '' : 's'} from earlier still uploading in the background.</div>` : ''}</div>`
      : batch.length && done ? `<div class="small muted">✅ ${done} photo${done === 1 ? '' : 's'} uploaded</div>` : '';
  };
  const drawPhotos = () => {
    $('#hp').innerHTML = h.photos.map((ph, i) => `<div class="ph">${photoImg(ph)}${i === 0 ? '<span class="cover">cover</span>' : `<button class="icon ph-star" data-i="${i}" title="Make cover">★</button>`}<button class="icon ph-x" data-i="${i}">✕</button></div>`).join('') +
      active().map(j => `<div class="ph up ${j.status}"><img class="thumb" src="${j.preview}" alt="">
        <span class="up-ov">${j.status === 'error' ? `<button class="icon up-retry" data-j="${j.id}" title="${esc(j.error || '')}">↻</button>` : `<i class="up-spin"></i><small>${j.status === 'queued' ? 'Waiting' : esc(j.stage.replace('…', ''))}</small>`}</span>
        <button class="icon ph-x" data-j="${j.id}" title="Cancel">✕</button></div>`).join('');
    $$('#hp .ph-x[data-i]').forEach(b => b.onclick = () => { h.photos.splice(+b.dataset.i, 1); drawPhotos(); });
    $$('#hp .ph-x[data-j]').forEach(b => b.onclick = () => { cancel(mine.find(j => j.id === +b.dataset.j)); drawPhotos(); });
    $$('#hp .up-retry').forEach(b => b.onclick = () => { retry(mine.find(j => j.id === +b.dataset.j)); drawPhotos(); });
    $$('#hp .ph-star').forEach(b => b.onclick = () => { const [p] = h.photos.splice(+b.dataset.i, 1); h.photos.unshift(p); drawPhotos(); });
    hydrate($('#hp'));
    drawProgress();
  };
  let pending = 0;
  const owner = {
    onDone: j => { if (saved) return; h.photos.push(j.result); added.push(j.result); },
    onChange: () => { if (saved || !document.body.contains($('#hp') || null)) return; cancelAnimationFrame(pending); pending = requestAnimationFrame(drawPhotos); },
  };
  for (const j of background) j.owner = { onChange: () => { if (!saved && $('#hp')) drawProgress(); } };
  drawPhotos();
  // Skip photos already in this house or already picked in this session.
  const known = () => new Set([...h.photos.map(p => p.s), ...mine.filter(j => j.status !== 'cancelled').map(j => j.sig), ...background.map(j => j.sig)].filter(Boolean));
  const start = items => { if (items.length) { mine.push(...addUploads(items, { owner })); drawPhotos(); } };
  $('#hp-cam').onchange = async e => {
    const items = await withSigs([...e.target.files]); e.target.value = '';
    const fresh = items.filter(i => !known().has(i.sig));
    if (items.length && !fresh.length) toast('That photo is already added');
    start(fresh);
  };
  $('#hp-gal').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    const items = await withSigs(files), k = known();
    if (items.length === 1 && !k.has(items[0].sig)) return start(items);
    choosePhotos(items, k, start);
  };
  $$('#deal button').forEach(b => b.onclick = () => { h.deal = b.dataset.d; $$('#deal button').forEach(x => x.classList.toggle('on', x === b)); priceHint(); });
  const priceHint = () => { const v = $('[data-k="price"]').value; $('#price-hint').textContent = v ? `= ${fmtMoney(v)}${h.deal === 'rent' ? '/mo' : ''}` : ''; };
  $('[data-k="price"]').addEventListener('input', priceHint); priceHint();
  $$('#rate button').forEach(b => b.onclick = () => { h.rating = +b.dataset.r === h.rating ? 0 : +b.dataset.r; $$('#rate button').forEach(x => x.classList.toggle('on', +x.dataset.r <= h.rating)); });
  const bindChecks = () => $$('#checks .chip').forEach(b => b.onclick = () => {
    const k = b.dataset.c, v = h.checks[k];
    if (v === true) h.checks[k] = false; else if (v === false) delete h.checks[k]; else h.checks[k] = true;
    b.outerHTML = chk(k, h.checks[k]); bindChecks();
  });
  bindChecks();
  const setLoc = (lat, lng) => { h.lat = +(+lat).toFixed(6); h.lng = +(+lng).toFixed(6); $('#loc-map').innerHTML = mapEmbed(h.lat, h.lng); };
  $('#loc-here').onclick = () => {
    if (!navigator.geolocation) return toast('Location not available on this device');
    toast('Getting your location…');
    navigator.geolocation.getCurrentPosition(async pos => {
      setLoc(pos.coords.latitude, pos.coords.longitude);
      const addr = $('[data-k="address"]');
      if (!addr.value) { const a = await reverseGeocode(h.lat, h.lng); if (a) addr.value = a; }
    }, err => toast('Could not get location: ' + err.message, 4000), { enableHighAccuracy: true, timeout: 15000 });
  };
  $('#loc-find').onclick = async () => {
    const addr = $('[data-k="address"]'), loc = $('[data-k="locality"]');
    const p = await pickLocation({ title: 'Where is this house?', start: h.lat ? { lat: h.lat, lng: h.lng } : null, query: h.lat ? '' : [addr.value.split('\n')[0], loc.value].filter(Boolean).join(', ') });
    if (!p) return;
    setLoc(p.lat, p.lng);
    if (!addr.value && p.label) addr.value = p.label;
    toast('Location set');
  };
  $('#h-save').onclick = () => {
    $$('[data-k]', view).forEach(i => { const k = i.dataset.k; let v = i.value.trim(); if (i.type === 'number') v = v === '' ? null : +v; h[k] = v; });
    if (!h.title) h.title = [h.bhk, h.locality].filter(Boolean).join(' in ') || 'Untitled house';
    setShared('lastDeal', h.deal);
    if (existing) { const have = new Set(h.photos.map(p => p.f)); h.photos.push(...attachedSince('houses', existing.id, openedAt).filter(p => !have.has(p.f))); }
    saved = true;
    const r = upsert('houses', h);
    const still = active().filter(j => j.status !== 'error');
    handOff(mine, 'houses', r.id);
    toast(still.length ? `Saved — ${still.length} photo${still.length === 1 ? '' : 's'} still uploading in the background` : 'Saved', still.length ? 4000 : 2800);
    go('#/h/' + r.id);
  };
  // leaving without saving: stop uploads and discard photos uploaded for this form
  const leave = () => {
    if (!saved) { mine.forEach(cancel); deletePhotos(added); }
    for (const j of background) if (j.owner && !j.owner.onDone) j.owner = null;
    window.removeEventListener('hashchange', leave);
  };
  window.addEventListener('hashchange', leave);
}
// Pick which of the selected photos to upload; ones already added are marked and unticked.
function choosePhotos(picked, known, start) {
  const items = picked.map(x => ({ ...x, url: URL.createObjectURL(x.file), dupe: known.has(x.sig) }));
  const seen = new Set();
  for (const it of items) { if (seen.has(it.sig)) it.dupe = true; seen.add(it.sig); it.on = !it.dupe; }
  const s = openSheet(`<h3>Choose photos</h3><p class="small muted" id="cp-sub"></p>
    <div class="pick">${items.map((it, i) => `<button class="pick-i ${it.on ? 'on' : ''} ${it.dupe ? 'dupe' : ''}" data-i="${i}"><img src="${it.url}" alt=""><span class="pick-c">✓</span>${it.dupe ? '<small>Already added</small>' : ''}</button>`).join('')}</div>
    <div class="row pick-bar"><button class="btn ghost" id="cp-all">Select all</button><button class="btn ghost" id="cp-none">None</button><span class="grow"></span><button class="btn primary" id="cp-go"></button></div>`,
  { wide: false, onClose: () => setTimeout(() => items.forEach(it => URL.revokeObjectURL(it.url)), 1000) });
  const upd = () => {
    const n = items.filter(i => i.on).length, d = items.filter(i => i.dupe).length;
    $('#cp-go', s.el).textContent = n ? `⬆️ Upload ${n} photo${n === 1 ? '' : 's'}` : 'Nothing selected';
    $('#cp-go', s.el).disabled = !n;
    $('#cp-sub', s.el).textContent = `${n} of ${items.length} selected — tap a photo to include or leave it out.${d ? ` ${d} already added, so left out.` : ''}`;
    $$('.pick-i', s.el).forEach(b => b.classList.toggle('on', items[+b.dataset.i].on));
  };
  $$('.pick-i', s.el).forEach(b => b.onclick = () => { const it = items[+b.dataset.i]; it.on = !it.on; upd(); });
  $('#cp-all', s.el).onclick = () => { items.forEach(i => i.on = !i.dupe); upd(); };
  $('#cp-none', s.el).onclick = () => { items.forEach(i => i.on = false); upd(); };
  $('#cp-go', s.el).onclick = () => { const pick = items.filter(i => i.on).map(({ file, sig }) => ({ file, sig })); s.close(); start(pick); };
  upd();
}

const chk = (c, v) => `<button class="chip ${v === true ? 'yes' : v === false ? 'no' : ''}" data-c="${esc(c)}">${v === true ? '✓ ' : v === false ? '✕ ' : ''}${esc(c)}</button>`;

/* ---------------- report ---------------- */
export function houseReportPage(view) {
  setTitle('House report', true);
  const all = live('houses').sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const sel = new Set(all.filter(h => h.status !== 'rejected').map(h => h.id));
  const last = cfg('lastHouseReport');
  view.innerHTML = `
    <div class="card noprint">
      <b>Include</b>
      <div class="chips" id="rsel">${all.map(h => `<button class="chip ${sel.has(h.id) ? 'on' : ''}" data-id="${h.id}">${esc(h.title || 'Untitled')}</button>`).join('') || '<span class="muted">No houses yet.</span>'}</div>
      <label>What matters most to you?<input id="prio" value="${esc(cfg('housePriorities') || '')}" placeholder="Budget under ₹45k, <30 min to office, lots of light, pet friendly"></label>
      <div class="row wrap"><button class="btn primary" id="gen" ${aiReady() ? '' : 'disabled'}>✨ Write report with ${aiName()}</button><button class="btn" onclick="window.print()">🖨️ Print / save PDF</button></div>
      ${aiReady() ? '' : '<p class="hint">Add a Claude or Gemini API key in Settings for the written analysis. The comparison table below works without it.</p>'}
    </div>
    <div id="ai-report">${last ? `<div class="card report"><small class="muted">Generated ${fmtDate(last.date)}</small>${md(last.text)}</div>` : ''}</div>
    <div id="static-report"></div>`;
  const lms = landmarks().filter(l => l.lat && l.lng).slice(0, 4);
  const drawStatic = () => {
    const hs = all.filter(h => sel.has(h.id));
    $('#static-report').innerHTML = hs.length ? `
      <h3 class="section">Side by side</h3>
      <div class="tablewrap card"><table><tr><th>Home</th><th>Price</th><th>Config</th><th>Area</th><th>₹/sqft</th><th>Rating</th><th>Checklist</th>${lms.map(l => `<th>${l.icon || '📍'} ${esc(l.name)}</th>`).join('')}<th>Status</th></tr>
      ${hs.map(h => { const c = Object.values(h.checks || {}); return `<tr><td><a href="#/h/${h.id}">${esc(h.title)}</a><br><small>${esc(h.locality || '')}</small></td><td>${fmtMoney(h.price)}${h.deal === 'rent' ? '/mo' : ''}</td><td>${esc(h.bhk || '')}</td><td>${h.area || ''}</td>
        <td>${h.price && h.area && h.deal !== 'rent' ? fmtMoney(Math.round(h.price / h.area)) : h.price && h.area ? (h.price / h.area).toFixed(1) : ''}</td><td class="stars">${stars(h.rating)}</td>
        <td>${c.length ? `${c.filter(Boolean).length}/${c.length} ✓` : ''}</td>${lms.map(l => `<td>${h.lat && h.lng ? fmtKm(km(h, l)) : ''}</td>`).join('')}<td>${STATUS[h.status]?.l || ''}</td></tr>`; }).join('')}</table></div>
      ${lms.length ? '<p class="hint">Landmark distances are straight-line.</p>' : ''}
      ${hs.map(h => `<div class="card rhouse"><div class="row"><b class="grow">${esc(h.title)}</b><span class="stars">${stars(h.rating)}</span></div>
        <div class="small">${esc(priceLine(h))} · ${esc(h.locality || h.address || '')}</div>
        ${h.photos?.length ? `<div class="photos">${h.photos.slice(0, 4).map(ph => photoImg(ph)).join('')}</div>` : ''}
        <div class="grid2 small">${h.pros ? `<div><b>👍</b> <span class="pre">${esc(h.pros)}</span></div>` : ''}${h.cons ? `<div><b>👎</b> <span class="pre">${esc(h.cons)}</span></div>` : ''}</div></div>`).join('')}` : '';
    hydrate($('#static-report'));
  };
  drawStatic();
  $$('#rsel .chip').forEach(b => b.onclick = () => { const id = b.dataset.id; sel.has(id) ? sel.delete(id) : sel.add(id); b.classList.toggle('on'); drawStatic(); });
  $('#gen').onclick = async () => {
    const hs = all.filter(h => sel.has(h.id));
    if (!hs.length) return toast('Pick at least one house');
    const prio = $('#prio').value; setShared('housePriorities', prio);
    const out = $('#ai-report'); out.innerHTML = '<div class="card"><div class="spinner"></div><p class="center muted">Comparing houses…</p></div>';
    try {
      const text = await houseReport(hs.map(h => ({ ...h, distancesToMyLandmarks: distances(h).map(({ l, d }) => `${l.name}: ${fmtKm(d)} straight-line`) })), prio);
      setShared('lastHouseReport', { date: today(), text });
      out.innerHTML = `<div class="card report"><small class="muted">Generated ${fmtDate(today())}</small>${md(text)}</div>`;
    } catch (e) { out.innerHTML = `<div class="card warn">${esc(e.message)}</div>`; }
  };
}
