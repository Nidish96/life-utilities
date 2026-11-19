// Locations without AI: read coordinates out of pasted links/text, search places, and a pick-on-map sheet.
import { cfg } from './state.js';
import { $, esc, openSheet, toast } from './ui.js';
import { geocode, reverseGeocode } from './ai.js';

export async function loadLeaflet() {
  if (window.L) return;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}

const ok = (lat, lng) => isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const pt = (lat, lng, label) => (ok(+lat, +lng) ? { lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6), label } : null);

/* ---------- Open Location Code ("plus codes", e.g. 7J4VWJ8R+9C or WJ8R+9C Bengaluru) ---------- */
const OLC = '23456789CFGHJMPQRVWX';
function olcDecode(code) {
  const c = code.toUpperCase().replace('+', '').replace(/0+$/, '');
  let lat = -90, lng = -180, latRes = 400, lngRes = 400;
  for (let i = 0; i < Math.min(c.length, 10); i += 2) {
    latRes /= 20; lngRes /= 20;
    lat += OLC.indexOf(c[i]) * latRes; lng += OLC.indexOf(c[i + 1] ?? '2') * lngRes;
  }
  for (let i = 10; i < c.length; i++) { latRes /= 5; lngRes /= 4; const d = OLC.indexOf(c[i]); lat += Math.floor(d / 4) * latRes; lng += (d % 4) * lngRes; }
  return { lat: lat + latRes / 2, lng: lng + lngRes / 2 };
}
function olcPrefix(lat, lng, n) {
  let la = Math.min(Math.max(lat, -90), 89.9999999) + 90, lo = ((lng + 180) % 360 + 360) % 360, res = 20, out = '';
  for (let i = 0; i < n / 2; i++) { const a = Math.floor(la / res), b = Math.floor(lo / res); out += OLC[a] + OLC[b]; la -= a * res; lo -= b * res; res /= 20; }
  return out;
}
function olcRecover(short, ref) {
  const pad = 8 - short.indexOf('+');
  if (pad <= 0) return olcDecode(short);
  const res = 20 ** (2 - pad / 2), half = res / 2;
  const p = olcDecode(olcPrefix(ref.lat, ref.lng, pad) + short);
  if (ref.lat + half < p.lat && p.lat - res >= -90) p.lat -= res; else if (ref.lat - half > p.lat && p.lat + res <= 90) p.lat += res;
  if (ref.lng + half < p.lng) p.lng -= res; else if (ref.lng - half > p.lng) p.lng += res;
  return p;
}
const PLUS = new RegExp(`\\b([${OLC}]{2,8}\\+[${OLC}]{2,})\\b`, 'i');

// Read a location out of whatever was pasted. Returns { lat, lng, label? }, or { query } to search for,
// or { error } when it can't be read (e.g. a short link the browser isn't allowed to open).
export async function parseLocation(raw, ref) {
  const text = (raw || '').trim();
  if (!text) return null;
  let s = text; try { s = decodeURIComponent(text); } catch { /* keep raw */ }
  const name = (s.match(/\/maps\/place\/([^/@?]+)/) || [])[1]?.replace(/\+/g, ' ').trim();
  let m;
  // Google Maps: exact place pin (!3d…!4d…) beats the viewport centre (@lat,lng)
  if ((m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/))) return pt(m[1], m[2], name);
  if ((m = s.match(/[?&](?:q|query|ll|sll|daddr|destination|center|coordinate|address)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/))) return pt(m[1], m[2], name);
  if ((m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/))) return pt(m[1], m[2], name);
  if ((m = s.match(/[?&]mlat=(-?\d+\.\d+)&mlon=(-?\d+\.\d+)/))) return pt(m[1], m[2]);
  if ((m = s.match(/#map=\d+\/(-?\d+\.\d+)\/(-?\d+\.\d+)/))) return pt(m[1], m[2]);
  if ((m = s.match(/geo:(-?\d+\.\d+),(-?\d+\.\d+)/))) return pt(m[1], m[2]);
  // 12°58'42.2"N 77°38'26.9"E
  if ((m = s.match(/(\d{1,3})°\s*(\d{1,2})['′]\s*([\d.]+)(?:["″]|'')?\s*([NS])[\s,]+(\d{1,3})°\s*(\d{1,2})['′]\s*([\d.]+)(?:["″]|'')?\s*([EW])/i))) {
    const dms = (d, mi, se, h) => (+d + +mi / 60 + +se / 3600) * (/[SW]/i.test(h) ? -1 : 1);
    return pt(dms(m[1], m[2], m[3], m[4]), dms(m[5], m[6], m[7], m[8]));
  }
  // 12.9784, 77.6408  (also "12.9784° N, 77.6408° E")
  if ((m = s.match(/(-?\d{1,2}\.\d{3,})\s*°?\s*([NS])?\s*[,\s]\s*(-?\d{1,3}\.\d{3,})\s*°?\s*([EW])?/i))) {
    return pt(+m[1] * (/s/i.test(m[2] || '') ? -1 : 1), +m[3] * (/w/i.test(m[4] || '') ? -1 : 1));
  }
  // plus codes; a short one needs a nearby place ("WJ8R+9C Bengaluru") or your home city
  if ((m = s.match(PLUS))) {
    const code = m[1].toUpperCase();
    if (code.indexOf('+') === 8) { const p = olcDecode(code); return pt(p.lat, p.lng); }
    const rest = s.replace(m[0], '').replace(/^[\s,]+|[\s,]+$/g, '');
    const near = (rest && await geocode(rest)) || (cfg('homeCity') && await geocode(cfg('homeCity'))) || ref;
    if (!near) return { error: 'That plus code needs a town after it, e.g. “WJ8R+9C Bengaluru”.' };
    const p = olcRecover(code, near); return pt(p.lat, p.lng);
  }
  if (/maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs/i.test(s)) {
    // Shared from the Google Maps app: the text before the link is usually the place name and address
    const lines = s.replace(/https?:\/\/\S+/g, '').split(/\n+| · /).map(l => l.trim()).filter(Boolean);
    if (lines.join(' ').length > 3) return { query: lines.join(' '), alts: [lines.slice(1).join(', '), lines[0]].filter(Boolean) };
    return { error: 'Short Google Maps links can’t be opened from here. Open the link, then copy the full address-bar link (or the coordinates) and paste that instead.' };
  }
  if (name) return { query: name };
  if (/^https?:\/\//i.test(s)) return { error: 'Couldn’t find a location in that link.' };
  return { query: s };
}

/* ---------- place search: Photon (fuzzy, good with names) + Nominatim, biased to where you are ---------- */
let biasP = null;
async function bias() {
  if (!biasP) biasP = (cfg('homeCity') ? geocode(cfg('homeCity')) : Promise.resolve(null)).catch(() => null);
  return biasP;
}
export async function searchPlaces(q, near) {
  near = near || await bias();
  const out = [];
  const photon = fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en${near ? `&lat=${near.lat}&lon=${near.lng}` : ''}`)
    .then(r => r.json()).then(j => (j.features || []).map(f => {
      const p = f.properties || {};
      return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], name: p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city,
        address: [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street, p.district || p.locality, p.city, p.state, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') };
    })).catch(() => []);
  const vb = near ? `&viewbox=${near.lng - 0.4},${near.lat + 0.4},${near.lng + 0.4},${near.lat - 0.4}` : '';
  const nomi = fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=0${vb}&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } })
    .then(r => r.json()).then(j => j.map(x => ({ lat: +x.lat, lng: +x.lon, name: x.display_name.split(',')[0], address: x.display_name.split(',').slice(1, 5).join(',').trim() }))).catch(() => []);
  for (const r of [...await photon, ...await nomi]) {
    if (!r.name || !ok(r.lat, r.lng)) continue;
    if (out.some(o => Math.abs(o.lat - r.lat) < 0.001 && Math.abs(o.lng - r.lng) < 0.001)) continue; // ~100 m apart = same place
    out.push(r);
  }
  return out.slice(0, 8);
}

/* ---------- pick-on-map sheet ---------- */
// Resolves to { lat, lng, label } or null if closed.
export function pickLocation({ title = 'Set location', start = null, query = '', center = null } = {}) {
  return new Promise(resolve => {
    let done = false, pin = start && start.lat ? { lat: start.lat, lng: start.lng, label: start.label } : null, map, marker;
    const s = openSheet(`<h3>${esc(title)}</h3>
      <form class="row" id="pl-f" autocomplete="off"><input id="pl-q" class="grow" value="${esc(query)}" placeholder="Search, or paste a Google Maps link / coordinates" enterkeyhint="search"><button class="btn" type="submit">🔎</button></form>
      <div class="small" id="pl-msg"></div>
      <div id="pl-res" class="pl-res"></div>
      <div id="pl-map" class="pickmap"></div>
      <p class="hint">Tap the map or drag the pin to fine-tune.</p>
      <div class="row"><button class="btn" id="pl-here" type="button">📍 I'm here</button><span class="grow"></span><button class="btn primary" id="pl-ok" type="button" disabled>Use this spot</button></div>
      <details class="hint"><summary>How to copy a place from Google Maps</summary>
        <p><b>Phone:</b> press and hold on the map to drop a pin. The coordinates (like <code>12.9784, 77.6408</code>) appear in the search box at the top. Tap them to copy, then paste them here. You can also open a place, tap <b>Share → Copy link</b> and paste that.</p>
        <p><b>Computer:</b> right-click the spot and click the coordinates at the top of the menu to copy them, or copy the link from the address bar.</p></details>`,
    { onClose: () => { if (!done) resolve(null); } });
    const msg = (t, cls = 'muted') => { const el = $('#pl-msg', s.el); el.className = 'small ' + cls; el.textContent = t; };
    const setPin = (p, fly = true) => {
      pin = p; $('#pl-ok', s.el).disabled = false;
      if (!map) return;
      if (!marker) { marker = L.marker([p.lat, p.lng], { draggable: true }).addTo(map); marker.on('dragend', () => { const ll = marker.getLatLng(); pin = { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) }; msg('📍 Pin moved'); }); }
      else marker.setLatLng([p.lat, p.lng]);
      if (fly) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16));
    };
    const showResults = list => {
      $('#pl-res', s.el).innerHTML = list.map((r, i) => `<button type="button" data-r="${i}"><b>${esc(r.name)}</b><small>${esc(r.address || '')}</small></button>`).join('');
      s.el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
        const r = list[+b.dataset.r]; setPin({ lat: r.lat, lng: r.lng, label: [r.name, r.address].filter(Boolean).join(', ') });
        s.el.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x === b)); msg(`📍 ${r.name}`);
      });
    };
    let pasted = null; // keeps line breaks from the clipboard (a one-line box drops them)
    const run = async () => {
      const q = (pasted ?? $('#pl-q', s.el).value).trim(); pasted = null; if (!q) return;
      msg('Looking…'); showResults([]);
      const ctr = map ? map.getCenter() : null;
      const r = await parseLocation(q, ctr && { lat: ctr.lat, lng: ctr.lng });
      if (!r) return msg('');
      if (r.error) return msg(r.error, 'warn');
      if (r.lat) { setPin(r); return msg(`✅ Got it from what you pasted${r.label ? ': ' + r.label : ''} — check the pin.`, ''); }
      let list = [];
      // nothing for the whole thing? try shorter pieces: "Shop, 12 Main Rd, Area" → "12 Main Rd, Area" → "Shop"
      const parts = r.query.split(',').map(x => x.trim()).filter(Boolean);
      const tries = [r.query, ...(r.alts || []), ...(parts.length > 1 ? [parts.slice(1).join(', '), parts.slice(-3).join(', '), parts[0]] : [])];
      for (const q2 of [...new Set(tries)]) { list = await searchPlaces(q2, ctr && { lat: ctr.lat, lng: ctr.lng }); if (list.length) break; }
      if (!list.length) return msg('No matches. Try a nearby landmark or area name, paste a Google Maps link or coordinates, or just tap the map.', 'warn');
      msg(list.length === 1 ? 'Found one match:' : `Pick the right one (${list.length} matches):`);
      showResults(list);
      if (list.length === 1) s.el.querySelector('[data-r="0"]').click();
    };
    $('#pl-f', s.el).onsubmit = e => { e.preventDefault(); run(); };
    $('#pl-q', s.el).addEventListener('paste', e => {
      const t = e.clipboardData?.getData('text');
      if (t && /\n/.test(t.trim())) { e.preventDefault(); pasted = t; $('#pl-q', s.el).value = t.trim().replace(/\s*\n+\s*/g, ' · '); }
      setTimeout(run, 0);
    });
    $('#pl-here', s.el).onclick = () => {
      if (!navigator.geolocation) return toast('Location not available on this device');
      msg('Getting your location…');
      navigator.geolocation.getCurrentPosition(p => { setPin({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }); msg(`📍 Your location (±${Math.round(p.coords.accuracy)} m)`); },
        err => msg('Could not get location: ' + err.message, 'warn'), { enableHighAccuracy: true, timeout: 15000 });
    };
    $('#pl-ok', s.el).onclick = async () => {
      if (!pin) return;
      done = true; const out = { ...pin };
      s.close();
      if (!out.label) out.label = await reverseGeocode(out.lat, out.lng).catch(() => null);
      resolve(out);
    };
    loadLeaflet().then(async () => {
      if (!document.body.contains(s.el)) return;
      map = L.map($('#pl-map', s.el), { zoomControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      const c = pin || center || await bias();
      map.setView(c ? [c.lat, c.lng] : [20.6, 78.9], pin ? 16 : c ? 12 : 4);
      if (pin) setPin(pin, false);
      map.on('click', e => { setPin({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }, false); msg('📍 Pin dropped — drag to adjust'); });
      setTimeout(() => map.invalidateSize(), 300);
    }).catch(() => { $('#pl-map', s.el).outerHTML = '<p class="small warn">The map couldn’t load (offline?). You can still paste coordinates or a link.</p>'; });
    if (query) run();
  });
}
