// Move-in condition report: A4 pages drawn on canvas (works with any language/emoji in your notes),
// shared as one PDF, or as images. Summary + "needs attention" first, then every room with its photos.
import { state } from './state.js';
import { $, $$, esc, openSheet, toast, fmtDate } from './ui.js';
import { ROOM_TYPES, COND, stats } from './views/inspect.js';

const PW = 1240, PH = 1754, M = 80; // A4 at 150 dpi
const C = { ink: '#1f1b16', muted: '#786f64', line: '#e4dccf', accent: '#d9573b', soft: '#f7f3ec' };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const loadImg = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
function wrap(g, text, maxW) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) { const t = line ? line + ' ' + word : word; if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t; }
    out.push(line);
  }
  return out;
}

// A tiny page-layout engine: blocks ask for height; a new page starts when they don't fit.
class Doc {
  constructor(title) { this.pages = []; this.title = title; this.add(); }
  add() {
    const c = document.createElement('canvas'); c.width = PW; c.height = PH;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, PW, PH); g.textBaseline = 'top';
    this.pages.push(c); this.g = g; this.y = M;
    if (this.pages.length > 1) { this.text(this.title, M, M - 44, { size: 18, color: C.muted }); this.y = M + 6; }
  }
  need(h) { if (this.y + h > PH - M - 30) this.add(); }
  font(size, weight = 400) { this.g.font = `${weight} ${size}px ${FONT}`; }
  text(s, x, y, { size = 24, weight = 400, color = C.ink, maxW = PW - 2 * M, lh = 1.35, align = 'left' } = {}) {
    this.font(size, weight); this.g.fillStyle = color; this.g.textAlign = align;
    const lines = wrap(this.g, s, maxW);
    lines.forEach((l, i) => this.g.fillText(l, x, y + i * size * lh));
    this.g.textAlign = 'left';
    return lines.length * size * lh;
  }
  measure(s, size, maxW, weight = 400) { this.font(size, weight); return wrap(this.g, s, maxW).length * size * 1.35; }
  badge(x, y, k, small = false) {
    const v = COND[k]; if (!v) return 0;
    const label = `${v.e === '—' ? '' : v.e + ' '}${v.l}`;
    this.font(small ? 18 : 20, 700); const w = this.g.measureText(label).width + 22, h = small ? 30 : 34;
    this.g.fillStyle = v.bg; rr(this.g, x, y, w, h, h / 2); this.g.fill();
    this.g.fillStyle = v.c; this.g.fillText(label, x + 11, y + (small ? 6 : 7));
    return w;
  }
  finish() {
    const n = this.pages.length;
    this.pages.forEach((c, i) => {
      const g = c.getContext('2d'); g.font = `400 18px ${FONT}`; g.fillStyle = C.muted; g.textBaseline = 'top';
      g.textAlign = 'right'; g.fillText(`Page ${i + 1} of ${n}`, PW - M, PH - M + 20); g.textAlign = 'left';
      g.fillText('Move-in condition report · Life Utilities', M, PH - M + 20);
    });
    return this.pages;
  }
}

async function render(insp, h, opt) {
  const s = stats(insp);
  const doc = new Doc(`${h.title || 'House'} — move-in condition report`);
  const g = () => doc.g;
  // header
  doc.text('MOVE-IN CONDITION REPORT', M, doc.y, { size: 20, weight: 700, color: C.accent }); doc.y += 34;
  doc.y += doc.text(h.title || 'House', M, doc.y, { size: 46, weight: 800, lh: 1.15 }) + 6;
  if (h.address || h.locality) doc.y += doc.text([h.locality, h.address].filter(Boolean).join(' — '), M, doc.y, { size: 22, color: C.muted }) + 4;
  doc.y += 14;
  const meta = [['Inspection date', fmtDate(insp.date)], ['Present', insp.present || '—'], ['Rooms', String(insp.rooms.length)], ['Items checked', `${s.checked} of ${s.total}`]];
  g().fillStyle = C.soft; rr(g(), M, doc.y, PW - 2 * M, 96, 16); g().fill();
  meta.forEach(([k, v], i) => { const x = M + 24 + i * ((PW - 2 * M - 48) / 4); doc.text(k.toUpperCase(), x, doc.y + 18, { size: 16, weight: 600, color: C.muted, maxW: 250 }); doc.text(v, x, doc.y + 44, { size: 24, weight: 600, maxW: 250 }); });
  doc.y += 120;
  // tally
  let tx = M;
  for (const k of ['good', 'fair', 'damaged', 'missing', 'na']) {
    if (!s[k] && k === 'na') continue;
    const v = COND[k]; const label = `${v.e === '—' ? '' : v.e + ' '}${v.l}: ${s[k]}`;
    doc.font(24, 700); const w = g().measureText(label).width + 32;
    g().fillStyle = v.bg; rr(g(), tx, doc.y, w, 46, 23); g().fill(); g().fillStyle = v.c; g().fillText(label, tx + 16, doc.y + 10);
    tx += w + 12;
  }
  doc.y += 70;
  // meter readings & keys (from the "Meters & keys" room)
  const readings = insp.rooms.flatMap(r => r.items.filter(i => /reading|keys|cards|remotes/i.test(i.name) && (i.note || i.qty != null)));
  if (readings.length) {
    doc.y += doc.text('Meter readings & keys', M, doc.y, { size: 28, weight: 700 }) + 8;
    for (const i of readings) { doc.need(40); doc.text(i.name, M, doc.y, { size: 22, color: C.muted, maxW: 500 }); doc.text([i.note, i.qty != null ? `Qty ${i.qty}` : ''].filter(Boolean).join(' · '), M + 520, doc.y, { size: 22, weight: 600, maxW: PW - 2 * M - 520 }); doc.y += 38; }
    doc.y += 16;
  }
  if (insp.notes) { doc.need(80); doc.y += doc.text('Overall notes', M, doc.y, { size: 28, weight: 700 }) + 6; doc.y += doc.text(insp.notes, M, doc.y, { size: 22 }) + 20; }
  // needs attention
  const issues = insp.rooms.flatMap(r => r.items.filter(i => i.cond === 'damaged' || i.cond === 'missing' || (i.cond === 'fair' && (i.note || i.photos?.length))).map(i => ({ r, i })));
  const thumbs = new Map();
  const thumb = async p => { if (!thumbs.has(p.f)) thumbs.set(p.f, await loadImg(await state.backend.fileUrl(p.t || p.f).catch(() => null))); return thumbs.get(p.f); };
  const cover = (img, x, y, w, hh) => { g().save(); rr(g(), x, y, w, hh, 10); g().clip(); if (img) { const k = Math.max(w / img.width, hh / img.height); g().drawImage(img, x + (w - img.width * k) / 2, y + (hh - img.height * k) / 2, img.width * k, img.height * k); } else { g().fillStyle = C.line; g().fillRect(x, y, w, hh); } g().restore(); };
  if (issues.length) {
    doc.need(90);
    doc.y += doc.text(`⚠️ Needs attention (${issues.length})`, M, doc.y, { size: 30, weight: 700, color: '#8a2c22' }) + 10;
    for (const { r, i } of issues) {
      const ph = (i.photos || []).slice(0, 3), photoW = 150;
      const textW = PW - 2 * M - 40 - (ph.length ? ph.length * (photoW + 10) : 0);
      const noteH = i.note ? doc.measure(i.note, 22, textW - 170) : 0;
      const hh = Math.max(ph.length ? photoW * 0.75 + 24 : 0, 70 + noteH);
      doc.need(hh + 12);
      g().strokeStyle = C.line; g().lineWidth = 2; rr(g(), M, doc.y, PW - 2 * M, hh, 14); g().stroke();
      doc.badge(M + 18, doc.y + 18, i.cond, true);
      doc.text(`${r.name} · ${i.name}${i.qty != null ? ` (×${i.qty})` : ''}`, M + 175, doc.y + 18, { size: 24, weight: 700, maxW: textW - 165 });
      if (i.note) doc.text(i.note, M + 175, doc.y + 54, { size: 22, color: C.ink, maxW: textW - 190 });
      for (let k = 0; k < ph.length; k++) cover(await thumb(ph[k]), PW - M - 12 - (ph.length - k) * (photoW + 10) + 10, doc.y + 12, photoW, photoW * 0.75);
      doc.y += hh + 12;
    }
    doc.y += 16;
  } else { doc.need(60); doc.y += doc.text('✅ No damaged or missing items recorded.', M, doc.y, { size: 24, weight: 600, color: '#1d5e3f' }) + 24; }

  // rooms
  for (const r of insp.rooms) {
    const rs = stats({ rooms: [r] });
    doc.need(150);
    g().fillStyle = C.accent; g().fillRect(M, doc.y, 8, 44);
    doc.text(`${ROOM_TYPES[r.type]?.e || '📦'}  ${r.name}`, M + 22, doc.y + 2, { size: 32, weight: 800 });
    doc.text(`${rs.checked}/${rs.total} checked${rs.damaged + rs.missing ? ` · ${rs.damaged + rs.missing} issue${rs.damaged + rs.missing === 1 ? '' : 's'}` : ''}`, PW - M, doc.y + 12, { size: 20, color: C.muted, align: 'right', maxW: 400 });
    doc.y += 62;
    const rows = r.items.filter(i => opt.unchecked || i.cond);
    if (!rows.length) { doc.y += doc.text('Not inspected yet.', M + 12, doc.y, { size: 22, color: C.muted }) + 30; continue; }
    // table
    const colItem = M + 12, colCond = M + 520, colNote = M + 700, noteW = PW - M - colNote - 12;
    g().fillStyle = C.soft; g().fillRect(M, doc.y, PW - 2 * M, 38);
    doc.text('ITEM', colItem, doc.y + 10, { size: 16, weight: 700, color: C.muted }); doc.text('CONDITION', colCond, doc.y + 10, { size: 16, weight: 700, color: C.muted }); doc.text('NOTES', colNote, doc.y + 10, { size: 16, weight: 700, color: C.muted });
    doc.y += 44;
    for (const i of rows) {
      const note = [i.note, i.qty != null ? `Qty ${i.qty}` : '', i.photos?.length ? `📷 ${i.photos.length}` : ''].filter(Boolean).join(' · ');
      const hh = Math.max(46, doc.measure(i.name, 22, 490) + 16, note ? doc.measure(note, 20, noteW) + 16 : 0);
      if (doc.y + hh > PH - M - 30) { doc.add(); doc.text(`${r.name} (continued)`, M, doc.y, { size: 22, weight: 700, color: C.muted }); doc.y += 40; }
      doc.text(i.name, colItem, doc.y + 10, { size: 22, maxW: 490 });
      if (i.cond) doc.badge(colCond, doc.y + 7, i.cond, true); else doc.text('Not checked', colCond, doc.y + 12, { size: 18, color: C.muted });
      if (note) doc.text(note, colNote, doc.y + 11, { size: 20, color: C.ink, maxW: noteW });
      doc.y += hh;
      g().fillStyle = C.line; g().fillRect(M, doc.y - 1, PW - 2 * M, 1);
    }
    if (r.notes) { doc.need(70); doc.y += 10; doc.y += doc.text('📝 ' + r.notes, M + 12, doc.y, { size: 22, maxW: PW - 2 * M - 24 }) + 6; }
    // photos for the room, captioned with the item
    const photos = opt.photos ? r.items.flatMap(i => (i.photos || []).map(p => ({ p, i }))) : [];
    if (photos.length) {
      doc.y += 14;
      const cols = 4, gap = 14, w = (PW - 2 * M - gap * (cols - 1)) / cols, ph = w * 0.75;
      for (let k = 0; k < photos.length; k += cols) {
        doc.need(ph + 40);
        const row = photos.slice(k, k + cols);
        for (let j = 0; j < row.length; j++) {
          const x = M + j * (w + gap);
          cover(await thumb(row[j].p), x, doc.y, w, ph);
          const c = COND[row[j].i.cond];
          doc.text(row[j].i.name, x, doc.y + ph + 6, { size: 17, color: c ? c.c : C.muted, maxW: w });
        }
        doc.y += ph + 36;
      }
    }
    doc.y += 30;
  }
  // signatures
  doc.need(220);
  doc.y += 20;
  doc.text('Agreed as the condition of the property on the date above.', M, doc.y, { size: 22, color: C.muted }); doc.y += 70;
  const sw = (PW - 2 * M - 60) / 2;
  for (const [k, label] of [[0, 'Tenant'], [1, 'Owner / representative']]) {
    const x = M + k * (sw + 60);
    g().fillStyle = C.ink; g().fillRect(x, doc.y + 60, sw, 2);
    doc.text(`${label} — name, signature & date`, x, doc.y + 72, { size: 18, color: C.muted, maxW: sw });
  }
  return doc.finish();
}

let jsPdfP = null;
const loadJsPdf = () => (jsPdfP ??= new Promise((res, rej) => {
  if (window.jspdf) return res(window.jspdf);
  const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  s.onload = () => res(window.jspdf); s.onerror = () => { jsPdfP = null; rej(new Error('Could not load the PDF maker (offline?)')); }; document.head.appendChild(s);
}));
const toBlob = c => new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
const slug = s => (s || 'house').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'house';
async function share(files, title) {
  if (navigator.canShare?.({ files })) {
    try { await navigator.share({ files, title }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  for (const f of files) { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  toast(files.length > 1 ? `Saved ${files.length} files` : 'Saved');
}

export function exportInspection(insp, h) {
  const opt = { photos: true, unchecked: false };
  let pages = [];
  const s = openSheet(`<h3>📄 Move-in report</h3>
    <div class="row wrap"><label class="check"><input type="checkbox" data-o="photos" checked> Include photos</label><label class="check"><input type="checkbox" data-o="unchecked"> Include unchecked items</label></div>
    <div class="share-prev rep-prev" id="rp-prev"><div class="spinner"></div><p class="center small muted">Building the report…</p></div>
    <div class="row wrap share-btns"><button class="btn primary grow" id="rp-pdf" disabled>📄 Share PDF</button><button class="btn grow" id="rp-img" disabled>🖼️ Share as images</button></div>
    <p class="hint">A4 pages: summary and anything that needs attention first, then each room with its photos, and signature lines at the end. Print it or send it to your owner.</p>`);
  const draw = async () => {
    $('#rp-pdf', s.el).disabled = $('#rp-img', s.el).disabled = true;
    pages = await render(insp, h, opt);
    const urls = await Promise.all(pages.map(async c => URL.createObjectURL(await toBlob(c))));
    $('#rp-prev', s.el).innerHTML = `<p class="small muted center">${pages.length} page${pages.length === 1 ? '' : 's'}</p>` + urls.map(u => `<img src="${u}" alt="">`).join('');
    $('#rp-pdf', s.el).disabled = $('#rp-img', s.el).disabled = false;
  };
  $$('[data-o]', s.el).forEach(c => c.onchange = () => { opt[c.dataset.o] = c.checked; draw(); });
  $('#rp-pdf', s.el).onclick = async () => {
    const b = $('#rp-pdf', s.el); b.disabled = true; b.textContent = 'Making PDF…';
    try {
      const { jsPDF } = await loadJsPdf();
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
      pages.forEach((c, i) => { if (i) pdf.addPage(); pdf.addImage(c.toDataURL('image/jpeg', 0.82), 'JPEG', 0, 0, 210, 297); });
      await share([new File([pdf.output('blob')], `move-in-report-${slug(h.title)}.pdf`, { type: 'application/pdf' })], `Move-in report — ${h.title || 'House'}`);
    } catch (e) { toast(e.message, 4000); }
    b.disabled = false; b.textContent = '📄 Share PDF';
  };
  $('#rp-img', s.el).onclick = async () => {
    const files = await Promise.all(pages.map(async (c, i) => new File([await toBlob(c)], `move-in-report-${slug(h.title)}-${i + 1}.jpg`, { type: 'image/jpeg' })));
    await share(files, `Move-in report — ${h.title || 'House'}`);
  };
  draw().catch(e => { $('#rp-prev', s.el).innerHTML = `<p class="warn small">Could not build the report: ${esc(e.message)}</p>`; });
}
