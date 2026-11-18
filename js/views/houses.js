import { live, get, upsert, remove, cfg, setShared } from '../state.js';
import { $, $$, esc, setTitle, openSheet, confirmDlg, toast, photoImg, hydrate, fmtDate, fmtMoney, stars, mapEmbed, mapsLink, md, today, go } from '../ui.js';
import { uploadPhotos, deletePhotos } from '../media.js';
import { aiReady, houseReport, geocode, reverseGeocode } from '../ai.js';

const STATUS = {
  to_visit: { l: 'To visit', e: '🗓️' },
  visited: { l: 'Visited', e: '👀' },
  shortlisted: { l: 'Shortlisted', e: '⭐' },
  rejected: { l: 'Rejected', e: '✕' },
  finalized: { l: 'Finalised', e: '🔑' },
};
const CHECKS = ['Parking', 'Power backup', '24h water', 'Lift', 'Gated / security', 'Good sunlight', 'Ventilation', 'Quiet street', 'Pets allowed', 'Near transit', 'Balcony', 'Modular kitchen', 'Wardrobes', 'Gym / pool'];

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
  if (!shown.length) { body.innerHTML = `<div class="empty">No houses here yet. Tap ＋ when you're at a viewing — snap photos, drop the location, jot what you noticed.</div>`; return; }
  if (mode === 'map') return drawMap(body, shown);
  body.innerHTML = shown.map(h => `
    <a class="card hcard" href="#/h/${h.id}">
      ${h.photos?.length ? photoImg(h.photos[0], 'hcover') : '<div class="hcover none">🏠</div>'}
      <div class="hinfo"><div class="row"><b class="grow">${esc(h.title || h.address || 'Untitled')}</b><span class="status s-${h.status}">${STATUS[h.status]?.e || ''} ${STATUS[h.status]?.l || ''}</span></div>
      <div class="small">${esc(priceLine(h))}</div>
      <div class="small muted">${esc(h.locality || h.address || '')}</div>
      <div class="small"><span class="stars">${stars(h.rating)}</span> ${h.visitedOn ? '· ' + fmtDate(h.visitedOn) : ''} ${h.photos?.length ? `· 📷 ${h.photos.length}` : ''}</div></div>
    </a>`).join('');
  hydrate(body);
}

async function loadLeaflet() {
  if (window.L) return;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function drawMap(el, houses) {
  const pts = houses.filter(h => h.lat && h.lng);
  el.innerHTML = `<div id="hmap" class="bigmap"></div>${pts.length < houses.length ? `<p class="hint">${houses.length - pts.length} house(s) have no location yet.</p>` : ''}`;
  if (!pts.length) { $('#hmap').outerHTML = '<div class="empty">No locations saved yet.</div>'; return; }
  try { await loadLeaflet(); } catch { el.innerHTML = '<div class="empty">Map could not load (offline?).</div>'; return; }
  const map = L.map('hmap');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const markers = pts.map(h => L.marker([h.lat, h.lng]).addTo(map).bindPopup(`<b>${esc(h.title || 'House')}</b><br>${esc(priceLine(h))}<br><a href="#/h/${h.id}">Open →</a>`));
  map.fitBounds(L.featureGroup(markers).getBounds().pad(0.3), { maxZoom: 15 });
}

/* ---------------- detail ---------------- */
export function houseDetail(view, id) {
  const h = get('houses', id);
  if (!h) { view.innerHTML = '<div class="empty">House not found.</div>'; return; }
  setTitle(h.title || 'House', true);
  const checks = Object.entries(h.checks || {});
  view.innerHTML = `
    ${h.photos?.length ? `<div class="carousel">${h.photos.map(ph => photoImg(ph, 'cimg')).join('')}</div>` : ''}
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
const kv = (k, v, raw) => (v ? `<div><small class="muted">${k}</small><div>${raw ? v : esc(v)}</div></div>` : '');

/* ---------------- add / edit ---------------- */
export function houseEdit(view, id) {
  const existing = id && id !== 'new' ? get('houses', id) : null;
  const h = existing ? structuredClone(existing) : { status: 'visited', deal: cfg('lastDeal') || 'rent', visitedOn: today(), photos: [], checks: {}, rating: 0 };
  const added = [];
  let saved = false;
  setTitle(existing ? 'Edit house' : 'New house', true);
  const f = (k, label, type = 'text', extra = '') => `<label>${label}<input data-k="${k}" type="${type}" value="${esc(h[k] ?? '')}" ${extra}></label>`;
  view.innerHTML = `
    <div class="card">
      <div class="photos edit" id="hp"></div>
      <div class="row"><label class="btn grow">📷 Camera<input type="file" id="hp-cam" accept="image/*" capture="environment" hidden></label>
      <label class="btn grow">🖼️ Gallery<input type="file" id="hp-gal" accept="image/*" multiple hidden></label></div>
      <small class="muted" id="hp-status"></small>
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
      <div class="row wrap"><button class="btn" id="loc-here">📍 I'm here now</button><button class="btn" id="loc-find">🔎 Find address on map</button></div>
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

  const drawPhotos = () => {
    $('#hp').innerHTML = h.photos.map((ph, i) => `<div class="ph">${photoImg(ph)}${i === 0 ? '<span class="cover">cover</span>' : `<button class="icon ph-star" data-i="${i}" title="Make cover">★</button>`}<button class="icon ph-x" data-i="${i}">✕</button></div>`).join('');
    $$('#hp .ph-x').forEach(b => b.onclick = () => { h.photos.splice(+b.dataset.i, 1); drawPhotos(); });
    $$('#hp .ph-star').forEach(b => b.onclick = () => { const [p] = h.photos.splice(+b.dataset.i, 1); h.photos.unshift(p); drawPhotos(); });
    hydrate($('#hp'));
  };
  drawPhotos();
  const onFiles = async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    const st = $('#hp-status'); const save = $('#h-save'); save.disabled = true;
    try {
      const ph = await uploadPhotos(files, (i, n) => st.textContent = `Uploading ${i}/${n}…`);
      h.photos.push(...ph); added.push(...ph); st.textContent = `${h.photos.length} photo(s)`; drawPhotos();
    } catch (err) { st.textContent = 'Upload failed: ' + err.message; }
    save.disabled = false;
  };
  $('#hp-cam').onchange = onFiles; $('#hp-gal').onchange = onFiles;
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
    const q = [$('[data-k="address"]').value, $('[data-k="locality"]').value, cfg('homeCity')].filter(Boolean).join(', ');
    if (!q) return toast('Type an address or locality first');
    const g = await geocode(q);
    if (g) { setLoc(g.lat, g.lng); toast('Found it'); } else toast('Could not find that address');
  };
  $('#h-save').onclick = () => {
    $$('[data-k]', view).forEach(i => { const k = i.dataset.k; let v = i.value.trim(); if (i.type === 'number') v = v === '' ? null : +v; h[k] = v; });
    if (!h.title) h.title = [h.bhk, h.locality].filter(Boolean).join(' in ') || 'Untitled house';
    setShared('lastDeal', h.deal);
    saved = true;
    const r = upsert('houses', h);
    toast('Saved'); go('#/h/' + r.id);
  };
  // discard photos uploaded for an unsaved form
  const leave = () => { if (!saved) deletePhotos(added); window.removeEventListener('hashchange', leave); };
  window.addEventListener('hashchange', leave);
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
      <div class="row wrap"><button class="btn primary" id="gen" ${aiReady() ? '' : 'disabled'}>✨ Write report with Claude</button><button class="btn" onclick="window.print()">🖨️ Print / save PDF</button></div>
      ${aiReady() ? '' : '<p class="hint">Add a Claude API key in Settings for the written analysis. The comparison table below works without it.</p>'}
    </div>
    <div id="ai-report">${last ? `<div class="card report"><small class="muted">Generated ${fmtDate(last.date)}</small>${md(last.text)}</div>` : ''}</div>
    <div id="static-report"></div>`;
  const drawStatic = () => {
    const hs = all.filter(h => sel.has(h.id));
    $('#static-report').innerHTML = hs.length ? `
      <h3 class="section">Side by side</h3>
      <div class="tablewrap card"><table><tr><th>Home</th><th>Price</th><th>Config</th><th>Area</th><th>₹/sqft</th><th>Rating</th><th>Checklist</th><th>Status</th></tr>
      ${hs.map(h => { const c = Object.values(h.checks || {}); return `<tr><td><a href="#/h/${h.id}">${esc(h.title)}</a><br><small>${esc(h.locality || '')}</small></td><td>${fmtMoney(h.price)}${h.deal === 'rent' ? '/mo' : ''}</td><td>${esc(h.bhk || '')}</td><td>${h.area || ''}</td>
        <td>${h.price && h.area && h.deal !== 'rent' ? fmtMoney(Math.round(h.price / h.area)) : h.price && h.area ? (h.price / h.area).toFixed(1) : ''}</td><td class="stars">${stars(h.rating)}</td>
        <td>${c.length ? `${c.filter(Boolean).length}/${c.length} ✓` : ''}</td><td>${STATUS[h.status]?.l || ''}</td></tr>`; }).join('')}</table></div>
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
      const text = await houseReport(hs, prio);
      setShared('lastHouseReport', { date: today(), text });
      out.innerHTML = `<div class="card report"><small class="muted">Generated ${fmtDate(today())}</small>${md(text)}</div>`;
    } catch (e) { out.innerHTML = `<div class="card warn">${esc(e.message)}</div>`; }
  };
}
