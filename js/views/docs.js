import { state, live, get, upsert, remove, cfg } from '../state.js';
import { $, $$, esc, setTitle, confirmDlg, toast, hydrate, fmtDate, fmtMoney, daysFromToday, today, go } from '../ui.js';
import { compressImage, uploadRaw, deletePhotos } from '../media.js';
import { aiReady, extractDocument } from '../ai.js';

export const DTYPES = {
  bill: { e: '🧾', l: 'Bill / receipt' },
  invoice: { e: '📄', l: 'Invoice' },
  warranty: { e: '🛡️', l: 'Warranty' },
  prescription: { e: '💊', l: 'Prescription' },
  medical_report: { e: '🩺', l: 'Medical report' },
  insurance: { e: '☂️', l: 'Insurance' },
  other: { e: '📁', l: 'Other' },
};
const dt = k => DTYPES[k] || DTYPES.other;
const CUR = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$' };
const sym = d => CUR[d.currency] || (d.currency && d.currency.length <= 3 && !/^[A-Z]{3}$/.test(d.currency) ? d.currency : cfg('currency'));

/* ---------------- list ---------------- */
let tfilter = 'all';
export function docsList(view) {
  setTitle('Bills & docs');
  const all = live('documents').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const year = String(new Date().getFullYear());
  const spent = all.filter(d => (d.date || '').startsWith(year) && ['bill', 'invoice'].includes(d.type) && d.amount && sym(d) === cfg('currency')).reduce((s, d) => s + +d.amount, 0);
  const expiring = all.filter(d => { const n = daysFromToday(d.warrantyUntil); return n !== null && n >= 0 && n <= 60; });
  view.innerHTML = `
    <input type="search" id="ds" placeholder="Search bills, medicines, doctors, stores…">
    <div class="chips">${[['all', 'All'], ...Object.entries(DTYPES).map(([k, v]) => [k, `${v.e} ${v.l}`])].map(([k, l]) => {
      const n = k === 'all' ? all.length : all.filter(d => d.type === k).length;
      return n || k === 'all' ? `<button class="chip ${tfilter === k ? 'on' : ''}" data-t="${k}">${l} <small>${n}</small></button>` : '';
    }).join('')}</div>
    ${spent ? `<p class="muted small">Bills & invoices in ${year}: <b>${fmtMoney(spent)}</b></p>` : ''}
    ${expiring.length ? `<div class="card warnbox">🛡️ Warranty ending soon: ${expiring.map(d => `<a href="#/d/${d.id}">${esc(d.title)} (${fmtDate(d.warrantyUntil)})</a>`).join(', ')}</div>` : ''}
    <div id="dlist"></div>
    <a class="fab" href="#/d/new" aria-label="Add document">＋</a>`;
  const draw = () => {
    const q = $('#ds').value.toLowerCase();
    const list = all.filter(d => (tfilter === 'all' || d.type === tfilter) && (!q || JSON.stringify([d.title, d.vendor, d.doctor, d.patient, d.notes, d.tags, d.items, d.medicines, d.forWhom]).toLowerCase().includes(q)));
    let lastYear = '';
    $('#dlist').innerHTML = list.map(d => {
      const y = (d.date || '').slice(0, 4) || 'Undated';
      const head = y !== lastYear ? `<h3 class="section">${y}</h3>` : ''; lastYear = y;
      const w = daysFromToday(d.warrantyUntil);
      return `${head}<a class="card dcard" href="#/d/${d.id}">${d.files?.[0]?.t ? `<img class="dthumb" data-fid="${esc(d.files[0].t)}" alt="">` : `<span class="dthumb">${dt(d.type).e}</span>`}
        <div class="grow"><b>${esc(d.title || 'Untitled')}</b><div class="small muted">${dt(d.type).e} ${esc(d.vendor || d.doctor || '')} ${d.date ? '· ' + fmtDate(d.date) : ''}${d.forWhom ? ' · for ' + esc(d.forWhom) : ''}</div>
        ${w !== null ? `<div class="small ${w < 0 ? 'muted' : w <= 60 ? 'warn' : ''}">🛡️ ${w < 0 ? 'warranty expired' : 'warranty till ' + fmtDate(d.warrantyUntil)}</div>` : ''}</div>
        ${d.amount ? `<b class="amt">${fmtMoney(d.amount, sym(d))}</b>` : ''}</a>`;
    }).join('') || `<div class="empty">${all.length ? 'No matches.' : 'Nothing here yet. Tap ＋ and snap a bill, invoice or prescription — I\'ll read it and fill in the details.'}</div>`;
    hydrate($('#dlist'));
  };
  draw();
  $('#ds').oninput = draw;
  $$('[data-t]', view).forEach(b => b.onclick = () => { tfilter = b.dataset.t; docsList(view); });
}

/* ---------------- detail ---------------- */
export function docDetail(view, id) {
  const d = get('documents', id);
  if (!d) { view.innerHTML = '<div class="empty">Not found.</div>'; return; }
  setTitle(d.title || 'Document', true);
  const w = daysFromToday(d.warrantyUntil);
  view.innerHTML = `
    <div class="files">${(d.files || []).map((f, i) => f.mime === 'application/pdf'
      ? `<button class="card pdf" data-open="${esc(f.f)}">📄 ${esc(f.name || 'PDF ' + (i + 1))}<br><small>Tap to open</small></button>`
      : `<img class="docimg" data-fid="${esc(f.f)}" data-full="${esc(f.f)}" alt="">`).join('')}</div>
    <div class="row"><h2 class="grow">${dt(d.type).e} ${esc(d.title || 'Untitled')}</h2><a class="btn" href="#/d/${id}/edit">✏️ Edit</a></div>
    <div class="grid2 card">
      ${kv('Type', dt(d.type).l)} ${kv('Date', fmtDate(d.date))} ${kv(d.type === 'prescription' || d.type === 'medical_report' ? 'Clinic / hospital' : 'Vendor', d.vendor)}
      ${kv('Amount', d.amount ? fmtMoney(d.amount, sym(d)) : '')} ${kv('For', d.forWhom)} ${kv('Doctor', d.doctor)} ${kv('Patient', d.patient)}
      ${kv('Warranty until', d.warrantyUntil ? `${fmtDate(d.warrantyUntil)}${w !== null ? (w < 0 ? ' (expired)' : ` (${w} days left)`) : ''}` : '')}
      ${kv('Follow-up', fmtDate(d.followUp))} ${kv('Serial no.', d.serialNumber)} ${kv('Policy no.', d.policyNumber)}
    </div>
    ${d.medicines?.length ? `<div class="card"><b>💊 Medicines</b><div class="tablewrap"><table><tr><th>Medicine</th><th>Dose</th><th>When</th><th>For</th></tr>${d.medicines.map(m => `<tr><td>${esc(m.name)}</td><td>${esc(m.dosage || '')}</td><td>${esc(m.frequency || '')}</td><td>${esc(m.duration || '')}</td></tr>`).join('')}</table></div></div>` : ''}
    ${d.items?.length ? `<div class="card"><b>🧾 Items</b><div class="tablewrap"><table><tr><th>Item</th><th>Qty</th><th>Price</th></tr>${d.items.map(m => `<tr><td>${esc(m.name)}</td><td>${esc(m.qty ?? '')}</td><td>${m.price ? fmtMoney(m.price, sym(d)) : ''}</td></tr>`).join('')}</table></div></div>` : ''}
    ${d.notes ? `<div class="card"><b>📝 Notes</b><p class="pre">${esc(d.notes)}</p></div>` : ''}
    ${d.tags?.length ? `<div class="chips">${d.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : ''}
    <button class="btn danger" id="d-del">Delete</button>`;
  $$('[data-open]', view).forEach(b => b.onclick = async () => {
    const win = window.open('', '_blank');
    try { const url = await state.backend.fileUrl(b.dataset.open); if (win) win.location = url; else location.href = url; }
    catch (e) { win?.close(); toast('Could not open: ' + e.message); }
  });
  $('#d-del').onclick = async () => {
    if (!(await confirmDlg('Delete this document and its files?'))) return;
    deletePhotos(d.files); remove('documents', id); go('#/docs');
  };
  hydrate(view);
}
const kv = (k, v) => (v ? `<div><small class="muted">${k}</small><div>${esc(v)}</div></div>` : '');

/* ---------------- add / edit ---------------- */
export function docEdit(view, id) {
  const existing = id && id !== 'new' ? get('documents', id) : null;
  const d = existing ? structuredClone(existing) : { type: 'bill', date: today(), files: [], items: [], medicines: [], tags: [] };
  const fresh = []; // files uploaded in this session, with blobs for AI reading
  let saved = false;
  d.tagsStr = (d.tags || []).join(', ');
  setTitle(existing ? 'Edit document' : 'Add bill or document', true);
  const people = live('people').map(p => p.name);
  const f = (k, label, type = 'text', extra = '') => `<label>${label}<input data-k="${k}" type="${type}" value="${esc(d[k] ?? '')}" ${extra}></label>`;
  view.innerHTML = `
    <div class="card">
      <div class="files edit" id="df"></div>
      <div class="row"><label class="btn grow">📷 Snap<input type="file" id="df-cam" accept="image/*" capture="environment" hidden></label>
      <label class="btn grow">📎 Photos / PDF<input type="file" id="df-gal" accept="image/*,application/pdf" multiple hidden></label></div>
      <div class="row"><small class="muted grow" id="df-status">${aiReady() ? 'Add a photo or PDF and I\'ll fill in the form.' : 'Add a Claude or Gemini API key in Settings to auto-read documents.'}</small>
      ${existing && aiReady() ? '<button class="btn ghost" id="df-reread">✨ Re-read</button>' : ''}</div>
    </div>
    <div class="card">
      <label>Type<select data-k="type">${Object.entries(DTYPES).map(([k, v]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${v.e} ${v.l}</option>`).join('')}</select></label>
      ${f('title', 'Title', 'text', 'placeholder="LG washing machine — Reliance Digital"')}
      <div class="grid2">${f('vendor', 'Vendor / clinic')}${f('date', 'Date', 'date')}
      ${f('amount', 'Amount', 'number', 'inputmode="decimal" step="0.01"')}${f('currency', 'Currency', 'text', 'placeholder="INR"')}
      ${f('forWhom', 'For whom', 'text', 'list="dpeople" placeholder="Me"')}${f('warrantyUntil', 'Warranty until', 'date')}
      ${f('doctor', 'Doctor')}${f('patient', 'Patient')}
      ${f('followUp', 'Follow-up date', 'date')}${f('serialNumber', 'Serial number')}${f('policyNumber', 'Policy number')}</div>
      <datalist id="dpeople"><option>Me</option>${people.map(n => `<option>${esc(n)}</option>`).join('')}</datalist>
      <label>💊 Medicines <small>(one per line: name | dose | when | how long)</small><textarea data-list="medicines" rows="3">${esc((d.medicines || []).map(m => [m.name, m.dosage, m.frequency, m.duration].map(x => x || '').join(' | ')).join('\n'))}</textarea></label>
      <label>🧾 Items <small>(one per line: name | qty | price)</small><textarea data-list="items" rows="3">${esc((d.items || []).map(m => [m.name, m.qty, m.price].map(x => x ?? '').join(' | ')).join('\n'))}</textarea></label>
      <label>Notes<textarea data-k="notes" rows="3">${esc(d.notes || '')}</textarea></label>
      ${f('tagsStr', 'Tags <small>(comma separated)</small>')}
    </div>
    <button class="btn primary block big" id="d-save">Save</button>`;

  const drawFiles = () => {
    $('#df').innerHTML = d.files.map((x, i) => `<div class="ph">${x.mime === 'application/pdf' ? '<span class="pdfthumb">📄 PDF</span>' : `<img class="thumb" data-fid="${esc(x.t || x.f)}" data-full="${esc(x.f)}" alt="">`}<button class="icon ph-x" data-i="${i}">✕</button></div>`).join('');
    $$('#df .ph-x').forEach(b => b.onclick = () => { d.files.splice(+b.dataset.i, 1); drawFiles(); });
    hydrate($('#df'));
  };
  drawFiles();

  const fill = x => {
    const map = { type: x.type, title: x.title, vendor: x.vendor, date: x.date, amount: x.amount, currency: x.currency, warrantyUntil: x.warranty_until, doctor: x.doctor, patient: x.patient, followUp: x.follow_up, serialNumber: x.serial_number, policyNumber: x.policy_number, notes: x.notes };
    for (const [k, v] of Object.entries(map)) {
      const el = $(`[data-k="${k}"]`, view);
      if (el && v !== null && v !== undefined && v !== '' && (!el.value || k === 'type' || el.value === today())) el.value = v;
    }
    if (x.medicines?.length) $('[data-list="medicines"]').value = x.medicines.map(m => [m.name, m.dosage, m.frequency, m.duration].map(v => v || '').join(' | ')).join('\n');
    if (x.items?.length) $('[data-list="items"]').value = x.items.map(m => [m.name, m.qty, m.price].map(v => v ?? '').join(' | ')).join('\n');
    if (x.tags?.length) $('[data-k="tagsStr"]').value = x.tags.join(', ');
  };
  const read = async files => {
    if (!aiReady() || !files.length) return;
    const st = $('#df-status'); st.textContent = '✨ Reading the document…';
    try { fill(await extractDocument(files)); st.textContent = '✅ Filled in — please check the details.'; }
    catch (e) { st.textContent = 'Could not read it: ' + e.message; }
  };
  const onFiles = async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    const st = $('#df-status'); const save = $('#d-save'); save.disabled = true;
    const forAi = [];
    try {
      let i = 0;
      for (const file of files) {
        st.textContent = `Uploading ${++i}/${files.length}…`;
        if (file.type === 'application/pdf') {
          const fid = await uploadRaw(file, file.name);
          const rec = { f: fid, mime: 'application/pdf', name: file.name };
          d.files.push(rec); fresh.push(rec); forAi.push({ blob: file, mime: 'application/pdf' });
        } else {
          const full = await compressImage(file, 2200, 0.85); // keep text legible
          const thumb = await compressImage(file, 420, 0.75);
          const [fid, tid] = await Promise.all([state.backend.putFile(full, `doc-${today()}-${i}.jpg`), state.backend.putFile(thumb, `doc-${today()}-${i}_thumb.jpg`)]);
          const rec = { f: fid, t: tid, mime: 'image/jpeg' };
          d.files.push(rec); fresh.push(rec); forAi.push({ blob: full, mime: 'image/jpeg' });
        }
      }
      drawFiles();
      st.textContent = `${d.files.length} file(s) attached.`;
      await read(forAi);
    } catch (err) { st.textContent = 'Upload failed: ' + err.message; }
    save.disabled = false;
  };
  $('#df-cam').onchange = onFiles; $('#df-gal').onchange = onFiles;
  $('#df-reread')?.addEventListener('click', async () => {
    const st = $('#df-status'); st.textContent = 'Fetching files…';
    const files = [];
    for (const x of d.files.slice(0, 5)) files.push({ blob: await state.backend.fileBlob(x.f), mime: x.mime || 'image/jpeg' });
    await read(files);
  });

  $('#d-save').onclick = () => {
    $$('[data-k]', view).forEach(i => { const k = i.dataset.k; let v = i.value.trim(); if (i.type === 'number') v = v === '' ? null : +v; d[k] = v || (v === 0 ? 0 : null); });
    d.tags = (d.tagsStr || '').split(',').map(x => x.trim()).filter(Boolean); delete d.tagsStr;
    d.medicines = $('[data-list="medicines"]').value.split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a[0]).map(([name, dosage, frequency, duration]) => ({ name, dosage, frequency, duration }));
    d.items = $('[data-list="items"]').value.split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a[0]).map(([name, qty, price]) => ({ name, qty: qty ? +qty || qty : null, price: price ? +price.replace(/[^\d.]/g, '') || null : null }));
    if (!d.title) d.title = [dt(d.type).l, d.vendor].filter(Boolean).join(' — ');
    saved = true;
    const r = upsert('documents', d);
    toast('Saved'); go('#/d/' + r.id);
  };
  const leave = () => { if (!saved) deletePhotos(fresh); window.removeEventListener('hashchange', leave); };
  window.addEventListener('hashchange', leave);
}
