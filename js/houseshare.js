// Share one house as a single, easy-to-read page: an image (best for WhatsApp) or a PDF with clickable links,
// plus a text caption with the Google Maps link. Everything is drawn here on a canvas, no server involved.
import { state } from './state.js';
import { $, $$, esc, openSheet, toast, fmtMoney, fmtDate } from './ui.js';

const W = 1080, PAD = 56;
const C = { bg: '#f7f3ec', card: '#ffffff', ink: '#1f1b16', muted: '#786f64', line: '#e9e1d5', accent: '#d9573b', soft: '#fbe5dd', yes: '#1d5e3f', no: '#8a2c22' };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const mapsUrl = h => (h.lat && h.lng ? `https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}` : h.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.address)}` : '');
const fmtKm = d => (d < 1 ? `${Math.round(d * 100) * 10} m` : `${d < 10 ? d.toFixed(1) : Math.round(d)} km`);

/* ---------- caption / copy text ---------- */
export function shareText(h, ctx, opt) {
  const L = [];
  L.push(`🏠 ${h.title || 'House'}`);
  if (ctx.priceLine) L.push(ctx.priceLine);
  const extra = [h.floor && `Floor ${h.floor}`, h.furnishing, h.facing && `${h.facing} facing`, h.availableFrom && `available ${fmtDate(h.availableFrom)}`].filter(Boolean).join(' · ');
  if (extra) L.push(extra);
  if (h.locality || h.address) L.push(`📍 ${[h.locality, h.address].filter(Boolean).join(' — ')}`);
  if (mapsUrl(h)) L.push(`🗺️ ${mapsUrl(h)}`);
  if (ctx.distances.length) L.push(`📏 ${ctx.distances.map(({ l, d }) => `${l.icon || '📍'} ${l.name} ${fmtKm(d)}`).join(' · ')}`);
  if (opt.rating && h.rating) L.push(`⭐ My rating: ${h.rating}/5`);
  if (opt.pros && h.pros) L.push(`👍 ${h.pros.replace(/\s*\n\s*/g, '; ')}`);
  if (opt.pros && h.cons) L.push(`👎 ${h.cons.replace(/\s*\n\s*/g, '; ')}`);
  if (opt.notes && h.notes) L.push(`📝 ${h.notes.replace(/\s*\n\s*/g, '; ')}`);
  if (opt.contact && (h.contactName || h.contactPhone)) L.push(`👤 ${[h.contactName, h.contactRole && `(${h.contactRole})`, h.contactPhone].filter(Boolean).join(' ')}`);
  if (h.listingUrl) L.push(`🔗 ${h.listingUrl}`);
  return L.join('\n');
}

/* ---------- drawing helpers ---------- */
const loadImg = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
function cover(g, img, x, y, w, h, r = 18) {
  g.save(); rr(g, x, y, w, h, r); g.clip();
  if (img) { const s = Math.max(w / img.width, h / img.height); g.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s); }
  else { g.fillStyle = C.line; g.fillRect(x, y, w, h); }
  g.restore();
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
function wrap(g, text, maxW) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? line + ' ' + word : word;
      if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
function text(g, s, x, y, { size = 30, weight = 400, color = C.ink, maxW = W - 2 * PAD, lh = 1.35, max = 99 } = {}) {
  g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textBaseline = 'top';
  let lines = wrap(g, s, maxW);
  if (lines.length > max) { lines = lines.slice(0, max); lines[max - 1] = lines[max - 1].replace(/\s*\S*$/, '') + '…'; }
  lines.forEach((l, i) => g.fillText(l, x, y + i * size * lh));
  return lines.length * size * lh;
}

/* ---------- little map: OpenStreetMap tiles + house + landmarks ---------- */
const lon2x = (lng, z) => (lng + 180) / 360 * 256 * 2 ** z;
const lat2y = (lat, z) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 256 * 2 ** z;
async function drawMap(g, x, y, w, h, house, lms) {
  const pts = [house, ...lms.map(d => d.l)];
  let z = 16;
  for (; z > 9; z--) {
    const xs = pts.map(p => lon2x(p.lng, z)), ys = pts.map(p => lat2y(p.lat, z));
    if (Math.max(...xs) - Math.min(...xs) < w - 120 && Math.max(...ys) - Math.min(...ys) < h - 120) break;
  }
  const xs = pts.map(p => lon2x(p.lng, z)), ys = pts.map(p => lat2y(p.lat, z));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const left = cx - w / 2, top = cy - h / 2;
  g.save(); rr(g, x, y, w, h, 18); g.clip(); g.fillStyle = '#e8e4dc'; g.fillRect(x, y, w, h);
  const tiles = [];
  for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w) / 256); tx++)
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h) / 256); ty++) tiles.push({ tx, ty });
  const imgs = await Promise.all(tiles.map(t => loadImg(`https://tile.openstreetmap.org/${z}/${((t.tx % 2 ** z) + 2 ** z) % 2 ** z}/${t.ty}.png`)));
  tiles.forEach((t, i) => imgs[i] && g.drawImage(imgs[i], x + t.tx * 256 - left, y + t.ty * 256 - top));
  const at = p => [x + lon2x(p.lng, z) - left, y + lat2y(p.lat, z) - top];
  for (const { l } of lms) {
    const [px, py] = at(l);
    g.fillStyle = C.accent; rr(g, px - 24, py - 24, 48, 48, 12); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 4; g.stroke();
    g.font = `26px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(l.icon || '📍', px, py + 1);
    g.font = `700 20px ${FONT}`; const tw = g.measureText(l.name).width + 16;
    g.fillStyle = '#fff'; rr(g, px - tw / 2, py + 30, tw, 30, 8); g.fill(); g.fillStyle = C.ink; g.fillText(l.name, px, py + 46);
  }
  const [hx, hy] = at(house);
  g.fillStyle = C.ink; g.beginPath(); g.arc(hx, hy, 30, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 5; g.stroke();
  g.font = `30px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🏠', hx, hy + 2);
  g.textAlign = 'right'; g.textBaseline = 'bottom'; g.font = `16px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.85)';
  const a = '© OpenStreetMap contributors'; const aw = g.measureText(a).width; g.fillRect(x + w - aw - 16, y + h - 26, aw + 16, 26); g.fillStyle = C.muted; g.fillText(a, x + w - 8, y + h - 5);
  g.restore(); g.textAlign = 'left';
  return imgs.some(Boolean);
}

/* ---------- the page ---------- */
async function render(h, ctx, opt) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = 6000;
  const g = cv.getContext('2d');
  g.fillStyle = C.bg; g.fillRect(0, 0, W, cv.height);
  const links = []; // {x,y,w,h,url} for the PDF
  let y = PAD;
  // header
  g.font = `700 22px ${FONT}`; const sw = g.measureText(ctx.status || 'House').width + 32;
  g.fillStyle = C.accent; rr(g, PAD, y, sw, 40, 20); g.fill();
  text(g, ctx.status || 'House', PAD + 16, y + 8, { size: 22, weight: 700, color: '#fff', maxW: 400 });
  if (h.rating && opt.rating) text(g, '★'.repeat(h.rating) + '☆'.repeat(5 - h.rating), W - PAD - 190, y + 2, { size: 32, color: '#e3a21a', maxW: 200 });
  y += 58;
  y += text(g, h.title || 'House', PAD, y, { size: 54, weight: 800, lh: 1.15, max: 3 }) + 6;
  if (ctx.priceLine) y += text(g, ctx.priceLine, PAD, y, { size: 36, weight: 700, color: C.accent }) + 4;
  if (h.locality || h.address) y += text(g, '📍 ' + [h.locality, h.address].filter(Boolean).join(' — '), PAD, y, { size: 26, color: C.muted, max: 3 });
  y += 26;
  // photos: one big + up to four small
  const photos = (h.photos || []).slice(0, 5);
  if (photos.length) {
    const urls = await Promise.all(photos.map(p => state.backend.fileUrl(p.f).catch(() => null)));
    const imgs = await Promise.all(urls.map(loadImg));
    const iw = W - 2 * PAD;
    cover(g, imgs[0], PAD, y, iw, 560); y += 572;
    const rest = imgs.slice(1);
    if (rest.length) {
      const n = rest.length, gap = 12, tw = (iw - gap * (n - 1)) / n, th = n === 1 ? 420 : n === 2 ? 300 : 210;
      rest.forEach((im, i) => cover(g, im, PAD + i * (tw + gap), y, tw, th, 14));
      y += th + 12;
    }
    if ((h.photos || []).length > 5) y += text(g, `+ ${(h.photos.length - 5)} more photos`, PAD, y, { size: 22, color: C.muted });
    y += 18;
  }
  // details grid
  const facts = [
    ['Price', fmtMoney(h.price) && fmtMoney(h.price) + (h.deal === 'rent' ? ' / month' : '')],
    [h.deal === 'rent' ? 'Deposit' : 'Booking', fmtMoney(h.deposit)], ['Maintenance', fmtMoney(h.maintenance) && fmtMoney(h.maintenance) + ' / mo'],
    ['Config', h.bhk], ['Area', h.area && `${h.area} sq ft`], ['Floor', h.floor], ['Furnishing', h.furnishing], ['Facing', h.facing],
    ['Available', h.availableFrom && fmtDate(h.availableFrom)], ['Visited', h.visitedOn && fmtDate(h.visitedOn)],
  ].filter(([, v]) => v);
  if (facts.length) {
    const cols = 3, cw = (W - 2 * PAD - 40) / cols, rows = Math.ceil(facts.length / cols), ch = 86;
    g.fillStyle = C.card; rr(g, PAD, y, W - 2 * PAD, rows * ch + 30, 20); g.fill();
    facts.forEach(([k, v], i) => {
      const fx = PAD + 20 + (i % cols) * cw, fy = y + 18 + Math.floor(i / cols) * ch;
      text(g, k.toUpperCase(), fx, fy, { size: 18, weight: 600, color: C.muted, maxW: cw - 10 });
      text(g, v, fx, fy + 26, { size: 28, weight: 600, maxW: cw - 10, max: 1 });
    });
    y += rows * ch + 30 + 24;
  }
  // map + distances
  if (h.lat && h.lng) {
    const mh = ctx.distances.length ? 460 : 380;
    const ok = await drawMap(g, PAD, y, W - 2 * PAD, mh, h, ctx.distances);
    if (!ok) { g.fillStyle = C.muted; text(g, 'Map preview unavailable offline', PAD + 20, y + 20, { size: 22, color: C.muted }); }
    y += mh + 14;
    const url = mapsUrl(h);
    g.fillStyle = C.soft; rr(g, PAD, y, W - 2 * PAD, 64, 16); g.fill();
    text(g, '🗺️ Open in Google Maps', PAD + 20, y + 15, { size: 28, weight: 700, color: C.accent });
    text(g, `${h.lat.toFixed(5)}, ${h.lng.toFixed(5)}`, W - PAD - 290, y + 19, { size: 22, color: C.muted, maxW: 280 });
    links.push({ x: PAD, y, w: W - 2 * PAD, h: 64, url });
    y += 82;
  }
  if (ctx.distances.length) {
    y += text(g, '📏 Distance from places that matter', PAD, y, { size: 30, weight: 700 }) + 10;
    for (const { l, d } of ctx.distances) {
      g.fillStyle = C.card; rr(g, PAD, y, W - 2 * PAD, 62, 14); g.fill();
      text(g, `${l.icon || '📍'}  ${l.name}`, PAD + 20, y + 14, { size: 28, maxW: W - 2 * PAD - 220, max: 1 });
      g.textAlign = 'right'; text(g, fmtKm(d), W - PAD - 20, y + 14, { size: 28, weight: 700, maxW: 200 }); g.textAlign = 'left';
      y += 72;
    }
    y += text(g, 'Straight-line distances', PAD, y, { size: 20, color: C.muted }) + 18;
  }
  // checklist
  const checks = Object.entries(h.checks || {});
  if (checks.length) {
    y += text(g, '✅ Checklist', PAD, y, { size: 30, weight: 700 }) + 12;
    let cx = PAD, rowH = 52;
    g.font = `600 24px ${FONT}`;
    for (const [k, v] of checks) {
      const label = `${v ? '✓' : '✕'} ${k}`, tw = g.measureText(label).width + 32;
      if (cx + tw > W - PAD) { cx = PAD; y += rowH + 8; }
      g.fillStyle = v ? '#e2f3ea' : '#f9e3e1'; rr(g, cx, y, tw, rowH, 26); g.fill();
      g.fillStyle = v ? C.yes : C.no; g.font = `600 24px ${FONT}`; g.textBaseline = 'middle'; g.fillText(label, cx + 16, y + rowH / 2);
      cx += tw + 8;
    }
    y += rowH + 28;
  }
  // pros / cons / notes
  const block = (title, body, color) => {
    if (!body) return;
    g.font = `400 26px ${FONT}`;
    const lines = wrap(g, body, W - 2 * PAD - 40).slice(0, 10);
    const bh = 56 + lines.length * 35 + 16;
    g.fillStyle = C.card; rr(g, PAD, y, W - 2 * PAD, bh, 18); g.fill();
    g.fillStyle = color; g.fillRect(PAD, y + 16, 6, bh - 32);
    text(g, title, PAD + 24, y + 16, { size: 26, weight: 700 });
    text(g, lines.join('\n'), PAD + 24, y + 54, { size: 26, lh: 1.35 });
    y += bh + 16;
  };
  if (opt.pros) { block('👍 Good', h.pros, C.yes); block('👎 Not so good', h.cons, C.no); }
  if (opt.notes) block('📝 Notes', h.notes, C.muted);
  if (opt.contact && (h.contactName || h.contactPhone)) block('👤 Contact', [h.contactName, h.contactRole && `(${h.contactRole})`, h.contactPhone].filter(Boolean).join(' '), C.accent);
  if (h.listingUrl) {
    g.fillStyle = C.soft; rr(g, PAD, y, W - 2 * PAD, 60, 16); g.fill();
    text(g, '🔗 View the listing', PAD + 20, y + 14, { size: 26, weight: 700, color: C.accent });
    links.push({ x: PAD, y, w: W - 2 * PAD, h: 60, url: h.listingUrl });
    y += 76;
  }
  y += text(g, `Shared from Life Utilities · ${fmtDate(new Date().toISOString().slice(0, 10))}`, PAD, y + 6, { size: 20, color: C.muted }) + PAD;
  // crop to content
  const out = document.createElement('canvas'); out.width = W; out.height = Math.ceil(y);
  out.getContext('2d').drawImage(cv, 0, 0);
  return { canvas: out, links };
}

let jsPdfP = null;
const loadJsPdf = () => (jsPdfP ??= new Promise((res, rej) => {
  if (window.jspdf) return res(window.jspdf);
  const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  s.onload = () => res(window.jspdf); s.onerror = () => { jsPdfP = null; rej(new Error('Could not load the PDF maker (offline?)')); }; document.head.appendChild(s);
}));
async function toPdf({ canvas, links }) {
  const { jsPDF } = await loadJsPdf();
  const pdf = new jsPDF({ unit: 'px', format: [canvas.width, canvas.height], hotfixes: ['px_scaling'], compress: true });
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.86), 'JPEG', 0, 0, canvas.width, canvas.height);
  for (const l of links) pdf.link(l.x, l.y, l.w, l.h, { url: l.url });
  return pdf.output('blob');
}

const slug = s => (s || 'house').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'house';
async function shareOrSave(file, textBody, title) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title, text: textBody }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  try { await navigator.clipboard.writeText(textBody); toast('Saved the file — the summary text (with map link) is copied too', 4500); }
  catch { toast('Saved the file', 3000); }
  return 'saved';
}

// ctx: { priceLine, status, distances: [{ l, d }] }
export function shareHouse(h, ctx) {
  const opt = { pros: true, rating: true, notes: false, contact: false };
  let current = null, url = null;
  const s = openSheet(`<h3>Share this house</h3>
    <div class="row wrap share-opts">
      <label class="check"><input type="checkbox" data-o="pros" checked> Pros & cons</label>
      <label class="check"><input type="checkbox" data-o="rating" checked> My rating</label>
      <label class="check"><input type="checkbox" data-o="notes"> My notes</label>
      <label class="check"><input type="checkbox" data-o="contact"> Owner / broker contact</label>
    </div>
    <div class="share-prev" id="sh-prev"><div class="spinner"></div><p class="center small muted">Making the page…</p></div>
    <div class="row wrap share-btns">
      <button class="btn primary grow" id="sh-img" disabled>🖼️ Share image</button>
      <button class="btn grow" id="sh-pdf" disabled>📄 Share PDF</button>
      <button class="btn grow" id="sh-txt">💬 Copy text</button>
    </div>
    <p class="hint">The image is easiest to read in WhatsApp; the PDF keeps the Google Maps and listing links clickable. Both come with a short text caption that includes the map link.</p>`,
  { onClose: () => url && URL.revokeObjectURL(url) });
  const draw = async () => {
    $('#sh-img', s.el).disabled = $('#sh-pdf', s.el).disabled = true;
    current = await render(h, ctx, opt);
    const blob = await new Promise(r => current.canvas.toBlob(r, 'image/jpeg', 0.88));
    current.blob = blob;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    $('#sh-prev', s.el).innerHTML = `<img src="${url}" alt="Preview of the shared page">`;
    $('#sh-img', s.el).disabled = $('#sh-pdf', s.el).disabled = false;
  };
  $$('[data-o]', s.el).forEach(c => c.onchange = () => { opt[c.dataset.o] = c.checked; draw(); });
  $('#sh-img', s.el).onclick = async () => {
    await shareOrSave(new File([current.blob], `${slug(h.title)}.jpg`, { type: 'image/jpeg' }), shareText(h, ctx, opt), h.title);
  };
  $('#sh-pdf', s.el).onclick = async () => {
    const b = $('#sh-pdf', s.el); b.disabled = true; b.textContent = 'Making PDF…';
    try { await shareOrSave(new File([await toPdf(current)], `${slug(h.title)}.pdf`, { type: 'application/pdf' }), shareText(h, ctx, opt), h.title); }
    catch (e) { toast(e.message, 4000); }
    b.disabled = false; b.textContent = '📄 Share PDF';
  };
  $('#sh-txt', s.el).onclick = async () => {
    const t = shareText(h, ctx, opt);
    try { await navigator.clipboard.writeText(t); toast('Copied — paste it into any chat'); }
    catch { if (navigator.share) navigator.share({ text: t }).catch(() => {}); else toast('Could not copy'); }
  };
  draw().catch(e => { $('#sh-prev', s.el).innerHTML = `<p class="warn small">Could not make the page: ${esc(e.message)}</p>`; });
}
