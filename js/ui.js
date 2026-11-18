import { state, cfg } from './state.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const go = h => { location.hash = h; };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

export const CATS = {
  food: { e: '🍜', l: 'Food & drink', c: '#d9573b' },
  place: { e: '📍', l: 'Places', c: '#2f6f62' },
  activity: { e: '🎯', l: 'Activities', c: '#c98a17' },
  dream_vacation: { e: '✈️', l: 'Dream vacations', c: '#3b7dd8' },
  long_held_desire: { e: '🌠', l: 'Long-held desires', c: '#8e5bd6' },
  gift_idea: { e: '🎁', l: 'Gift ideas', c: '#d6457a' },
  hobby: { e: '🎨', l: 'Hobbies', c: '#3aa17e' },
  music: { e: '🎵', l: 'Music', c: '#6b6fd4' },
  movie_tv: { e: '🎬', l: 'Movies & TV', c: '#b0563a' },
  book: { e: '📚', l: 'Books', c: '#8a7537' },
  fashion: { e: '👗', l: 'Style & fashion', c: '#c2588f' },
  dislike: { e: '🚫', l: 'Dislikes & allergies', c: '#a33a3a' },
  important_date: { e: '📅', l: 'Important dates', c: '#4a7a96' },
  other: { e: '💬', l: 'Other', c: '#7b7b7b' },
};
export const cat = k => CATS[k] || CATS.other;
export const catOptions = (sel, withMemory = false) =>
  Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.e} ${v.l}</option>`).join('') +
  (withMemory ? `<option value="memory" ${sel === 'memory' ? 'selected' : ''}>📸 Shared memory</option>` : '');

export function setTitle(t, back = false) {
  $('#title').textContent = t;
  $('#back').style.display = back ? '' : 'none';
  document.title = t === 'Life Utilities' ? t : `${t} · Life Utilities`;
}

export function toast(msg, ms = 2800) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

export function openSheet(html, { onClose, wide } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog"><div class="grab"></div><button class="icon sheet-x" aria-label="Close">✕</button><div class="sheet-body">${html}</div></div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('noscroll');
  const close = () => {
    wrap.remove();
    if (!$('.sheet-wrap')) document.body.classList.remove('noscroll');
    onClose?.();
  };
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  $('.sheet-x', wrap).onclick = close;
  hydrate(wrap);
  return { el: $('.sheet-body', wrap), close };
}

export function confirmDlg(msg, yes = 'Delete') {
  return new Promise(res => {
    const s = openSheet(`<p class="lead">${esc(msg)}</p><div class="row"><button class="btn grow" data-a="no">Cancel</button><button class="btn danger grow" data-a="yes">${esc(yes)}</button></div>`, { onClose: () => res(false) });
    $$('[data-a]', s.el).forEach(b => b.onclick = () => { const v = b.dataset.a === 'yes'; res(v); s.close(); });
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function fmtDate(s) {
  if (!s) return '';
  if (s.startsWith('--')) { const [m, d] = s.slice(2).split('-'); return `${+d} ${MONTHS[+m - 1] || ''}`; }
  const d = new Date(s + 'T00:00');
  return isNaN(d) ? s : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export function daysUntil(b) {
  const m = (b || '').match(/(\d{2})-(\d{2})$/);
  if (!m) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
  if (d < now) d.setFullYear(d.getFullYear() + 1);
  return Math.round((d - now) / 864e5);
}
export function daysFromToday(s) {
  if (!s || s.startsWith('--')) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = new Date(s + 'T00:00');
  return isNaN(d) ? null : Math.round((d - now) / 864e5);
}
export function fmtMoney(n, cur) {
  if (n === null || n === undefined || n === '' || isNaN(+n)) return '';
  const sym = cur || cfg('currency');
  const v = +n;
  if (sym === '₹') {
    if (v >= 1e7) return `₹${(v / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
    if (v >= 1e5) return `₹${(v / 1e5).toFixed(2).replace(/\.?0+$/, '')} L`;
    return '₹' + v.toLocaleString('en-IN');
  }
  return sym + v.toLocaleString();
}

// Currency symbol for a bill/document record (falls back to the app's currency).
const CUR = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$' };
export const docSym = d => CUR[d.currency] || (d.currency && d.currency.length <= 3 && !/^[A-Z]{3}$/.test(d.currency) ? d.currency : cfg('currency'));

export const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
export function colorFor(s) {
  let h = 0; for (const ch of s || '') h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 52%)`;
}
export function avatarHtml(p, size = 44) {
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`;
  if (p?.avatar) return `<img class="avatar" style="${st}" data-fid="${esc(p.avatar.t || p.avatar.f)}" alt="">`;
  return `<span class="avatar" style="${st};background:${colorFor(p?.name)}">${esc(initials(p?.name))}</span>`;
}
export const photoImg = (ph, cls = 'thumb') => `<img class="${cls}" data-fid="${esc(ph.t || ph.f)}" data-full="${esc(ph.f)}" alt="" loading="lazy">`;
export const stars = n => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');

// Fills <img data-fid> with object URLs from the active storage backend.
export function hydrate(root = document) {
  $$('img[data-fid]:not([src])', root).forEach(async img => {
    try { img.src = await state.backend.fileUrl(img.dataset.fid); }
    catch { img.classList.add('broken'); }
  });
}

export async function lightbox(fid) {
  const s = openSheet(`<div class="lightbox"><div class="spinner"></div></div>`, { wide: true });
  try {
    const url = await state.backend.fileUrl(fid);
    $('.lightbox', s.el).innerHTML = `<img src="${url}" alt=""><a class="btn" href="${url}" download="photo.jpg">⬇ Download</a>`;
  } catch (e) { $('.lightbox', s.el).textContent = 'Could not load photo: ' + e.message; }
}

// Full-screen photo viewer: swipe (or ← →) through a set of photos, double-tap to zoom.
// photos: [{ f: fullFileId, t?: thumbFileId }]
export function gallery(photos, start = 0) {
  if (!photos.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'gal';
  wrap.setAttribute('role', 'dialog');
  wrap.innerHTML = `<div class="gal-top"><span class="gal-n"></span><span class="grow"></span>
      <a class="gal-btn" id="gal-dl" download="photo.jpg" aria-label="Download">⬇</a><button class="gal-btn" id="gal-x" aria-label="Close">✕</button></div>
    <div class="gal-track">${photos.map((p, i) => `<div class="gal-slide" data-i="${i}"><img alt="" draggable="false"></div>`).join('')}</div>
    ${photos.length > 1 ? '<button class="gal-nav prev" aria-label="Previous">‹</button><button class="gal-nav next" aria-label="Next">›</button>' : ''}`;
  document.body.appendChild(wrap);
  document.body.classList.add('noscroll');
  const track = $('.gal-track', wrap), slides = $$('.gal-slide', wrap);
  const loaded = new Set();
  const load = async i => {
    if (i < 0 || i >= photos.length || loaded.has(i)) return;
    loaded.add(i);
    const img = $('img', slides[i]);
    try {
      if (photos[i].t) img.src = await state.backend.fileUrl(photos[i].t); // quick preview
      const full = await state.backend.fileUrl(photos[i].f);
      img.src = full;
      if (i === cur) $('#gal-dl', wrap).href = full;
    } catch { slides[i].classList.add('broken'); }
  };
  let cur = -1;
  const show = i => {
    i = Math.max(0, Math.min(photos.length - 1, i));
    if (i === cur) return;
    cur = i;
    $('.gal-n', wrap).textContent = `${i + 1} / ${photos.length}`;
    [i, i + 1, i - 1, i + 2].forEach(load);
    const src = $('img', slides[i]).src; if (src) $('#gal-dl', wrap).href = src;
    slides.forEach(s => s.classList.remove('zoom'));
  };
  const go = i => track.scrollTo({ left: Math.max(0, Math.min(photos.length - 1, i)) * track.clientWidth, behavior: 'smooth' });
  track.addEventListener('scroll', () => show(Math.round(track.scrollLeft / track.clientWidth)), { passive: true });
  const close = () => { wrap.remove(); document.removeEventListener('keydown', key); if (!$('.sheet-wrap')) document.body.classList.remove('noscroll'); };
  const key = e => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') go(cur + 1); else if (e.key === 'ArrowLeft') go(cur - 1); };
  document.addEventListener('keydown', key);
  $('#gal-x', wrap).onclick = close;
  $('.prev', wrap)?.addEventListener('click', () => go(cur - 1));
  $('.next', wrap)?.addEventListener('click', () => go(cur + 1));
  slides.forEach(s => s.addEventListener('dblclick', e => {
    const z = !s.classList.contains('zoom');
    s.classList.toggle('zoom', z);
    if (z) { const img = $('img', s); requestAnimationFrame(() => { s.scrollLeft = (img.offsetWidth - s.clientWidth) * (e.offsetX / s.clientWidth); s.scrollTop = (img.offsetHeight - s.clientHeight) * (e.offsetY / s.clientHeight); }); }
  }));
  requestAnimationFrame(() => { track.scrollLeft = start * track.clientWidth; show(start); });
}

export const mapsLink = ({ lat, lng, q }) =>
  lat && lng ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q || '')}`;
export function mapEmbed(lat, lng) {
  if (!lat || !lng) return '';
  const d = 0.006;
  return `<iframe class="map" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${+lng + d},${+lat + d}&layer=mapnik&marker=${lat},${lng}"></iframe>`;
}

export function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Minimal, escape-first Markdown renderer (headings, lists, tables, bold/italic, links).
export function md(src) {
  const inline = s => s
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  let html = '', list = null, table = [];
  const endList = () => { if (list) { html += `</${list}>`; list = null; } };
  const endTable = () => {
    if (!table.length) return;
    const rows = table.filter(r => !/^\|?\s*:?-{2,}/.test(r));
    html += '<div class="tablewrap"><table>' + rows.map((r, i) =>
      '<tr>' + r.replace(/^\||\|$/g, '').split('|').map(c => `<${i ? 'td' : 'th'}>${inline(c.trim())}</${i ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table></div>';
    table = [];
  };
  for (const raw of esc(src || '').split('\n')) {
    const l = raw.trimEnd(); let m;
    if (/^\s*\|/.test(l)) { endList(); table.push(l.trim()); continue; }
    endTable();
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { endList(); const n = Math.min(m[1].length + 1, 5); html += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { endList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { endList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()) endList();
    else { endList(); html += `<p>${inline(l)}</p>`; }
  }
  endList(); endTable();
  return html;
}

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
