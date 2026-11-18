// Smart capture ("Priya said she's craving ramen…") and bulk import of a big text dump.
import { state, live, get, upsert, cfg } from '../state.js';
import { $, $$, esc, setTitle, toast, catOptions, cat, CATS, today, go } from '../ui.js';
import { aiReady, extractFacts, heuristicExtract } from '../ai.js';
import { enqueue } from '../enrich.js';
import { uploadRaw } from '../media.js';

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* ---------- saving reviewed items ---------- */
export function saveItems(items, updates = [], source = 'capture') {
  const byName = new Map();
  live('people').forEach(p => [p.name, ...(p.aliases || [])].forEach(n => n && byName.set(norm(n), p.id)));
  const resolve = it => {
    if (it.personId && get('people', it.personId)) return it.personId;
    const k = norm(it.person);
    if (!k) return null;
    if (byName.has(k)) return byName.get(k);
    const p = upsert('people', { name: it.person.trim(), aliases: [], relation: '', birthday: null, notes: '' });
    byName.set(k, p.id);
    return p.id;
  };
  let n = 0;
  const people = new Set();
  for (const it of items.filter(i => i.keep)) {
    const pid = resolve(it);
    if (!pid) continue;
    people.add(pid);
    if (it.category === 'memory') {
      upsert('memories', { personIds: [pid], title: it.title, note: it.detail || '', date: it.date || today(), photos: [] });
    } else {
      const f = upsert('facts', { personId: pid, category: it.category, title: it.title, detail: it.detail || '', tags: it.tags || [], searchable: !!it.searchable, date: it.date || null, source });
      if (it.enrich) enqueue(f.id);
    }
    n++;
  }
  for (const u of updates.filter(u => u.keep)) {
    const p = get('people', resolve(u));
    if (!p) continue;
    if (u.birthday && !p.birthday) p.birthday = u.birthday;
    if (u.relation && !p.relation) p.relation = u.relation;
    if (u.aliases?.length) p.aliases = [...new Set([...(p.aliases || []), ...u.aliases])];
    upsert('people', p);
  }
  return { n, people: [...people] };
}

function personSelect(it, newNames) {
  const people = live('people').sort((a, b) => a.name.localeCompare(b.name));
  const match = it.personId && get('people', it.personId) ? it.personId : people.find(p => [p.name, ...(p.aliases || [])].some(n => norm(n) === norm(it.person)))?.id;
  if (match) it.personId = match;
  const news = [...new Set([...(match ? [] : [it.person]), ...newNames])].filter(Boolean);
  return `<select class="psel">${people.map(p => `<option value="id:${p.id}" ${p.id === match ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    ${news.map(n => `<option value="new:${esc(n)}" ${!match && n === it.person ? 'selected' : ''}>＋ New: ${esc(n)}</option>`).join('')}
    <option value="ask">＋ Someone else…</option></select>`;
}
function bindPersonSelect(sel, it, onNew) {
  sel.onchange = () => {
    const v = sel.value;
    if (v === 'ask') {
      const name = prompt('Name of the person?');
      if (name) { it.person = name.trim(); it.personId = null; onNew?.(); }
      else sel.selectedIndex = 0;
      return;
    }
    if (v.startsWith('id:')) { it.personId = v.slice(3); it.person = get('people', it.personId)?.name; }
    else { it.personId = null; it.person = v.slice(4); }
  };
}

/* ---------- quick capture ---------- */
export function renderCapture(el, { personId, text = '', onSaved } = {}) {
  const people = live('people');
  const recent = [...people].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
  let who = personId || '';
  el.innerHTML = `
  <div class="card capture">
    <div class="chips" id="cap-who">
      <button class="chip ${!who ? 'on' : ''}" data-p="">✨ Auto-detect</button>
      ${recent.map(p => `<button class="chip ${p.id === who ? 'on' : ''}" data-p="${p.id}">${esc(p.name)}</button>`).join('')}
      ${personId && !recent.find(p => p.id === personId) ? `<button class="chip on" data-p="${personId}">${esc(get('people', personId)?.name)}</button>` : ''}
    </div>
    <textarea id="cap-text" rows="4" placeholder="What did someone tell you?&#10;e.g. Ananya has been craving proper Hokkaido ramen, and she's always wanted to see the northern lights. Her birthday is 14 March.">${esc(text)}</textarea>
    <div class="row">
      <button class="btn icon-btn" id="cap-mic" title="Dictate" hidden>🎤</button>
      <a class="btn ghost" href="#/import">📥 Paste a big dump</a>
      <span class="grow"></span>
      <button class="btn primary" id="cap-go">Sort it out ✨</button>
    </div>
    ${aiReady() ? '' : `<p class="hint">No Claude API key yet — I'll use simple keyword sorting. Add a key in <a href="#/settings">Settings</a> for smart sorting and web lookups.</p>`}
  </div>
  <div id="cap-review"></div>`;

  $$('#cap-who .chip', el).forEach(b => b.onclick = () => {
    who = b.dataset.p;
    $$('#cap-who .chip', el).forEach(x => x.classList.toggle('on', x === b));
  });

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const mic = $('#cap-mic', el); mic.hidden = false;
    let rec = null;
    mic.onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = navigator.language || 'en-IN'; rec.interimResults = false; rec.continuous = true;
      rec.onresult = e => {
        const ta = $('#cap-text', el);
        for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) ta.value += (ta.value ? ' ' : '') + e.results[i][0].transcript;
      };
      rec.onend = () => { rec = null; mic.classList.remove('rec'); };
      rec.start(); mic.classList.add('rec');
    };
  }

  $('#cap-go', el).onclick = async () => {
    const txt = $('#cap-text', el).value.trim();
    if (!txt) return toast('Type or dictate something first');
    const btn = $('#cap-go', el); btn.disabled = true; btn.textContent = 'Thinking…';
    try {
      const def = who ? get('people', who) : null;
      const res = aiReady() ? await extractFacts(txt, live('people'), { defaultPerson: def }) : heuristicExtract(txt, live('people'), def);
      if (!res.items.length && !res.updates.length) toast("Couldn't find anything about a person in that. Pick who it's about and try again.");
      else review($('#cap-review', el), res, () => {
        $('#cap-text', el).value = '';
        onSaved?.();
      });
    } catch (e) { toast(e.message, 5000); }
    finally { btn.disabled = false; btn.textContent = 'Sort it out ✨'; }
  };
}

function review(el, { items, updates }, done) {
  items.forEach(it => { it.keep = true; it.personId = it.person_id || null; it.enrich = aiReady() && !!it.searchable && it.category !== 'memory'; if (!CATS_OK(it.category)) it.category = 'other'; });
  updates.forEach(u => { u.keep = true; u.personId = u.person_id || null; });
  const draw = () => {
    const newNames = [...new Set(items.filter(i => !i.personId).map(i => i.person))];
    el.innerHTML = `<h3 class="section">Check & save <small>${items.length} item${items.length === 1 ? '' : 's'}</small></h3>
    ${items.map((it, i) => `
      <div class="card rv ${it.keep ? '' : 'off'}" data-i="${i}">
        <div class="row"><span class="rv-emoji">${it.category === 'memory' ? '📸' : cat(it.category).e}</span>${personSelect(it, newNames)}<button class="icon rv-x" title="Skip">${it.keep ? '✕' : '↺'}</button></div>
        <select class="csel">${catOptions(it.category, true)}</select>
        <input class="ttl" value="${esc(it.title)}" placeholder="Short title">
        <textarea class="dtl" rows="2" placeholder="Details">${esc(it.detail || '')}</textarea>
        ${it.category !== 'memory' ? `<label class="check"><input type="checkbox" class="enr" ${it.enrich ? 'checked' : ''} ${aiReady() ? '' : 'disabled'}> Look up details online (picture, location, places to try)</label>` : ''}
      </div>`).join('')}
    ${updates.map((u, i) => `<label class="card check upd"><input type="checkbox" data-u="${i}" ${u.keep ? 'checked' : ''}> Update <b>${esc(u.person)}</b>: ${[u.birthday && `🎂 ${esc(u.birthday)}`, u.relation && esc(u.relation), u.aliases?.length && `aka ${esc(u.aliases.join(', '))}`].filter(Boolean).join(' · ')}</label>`).join('')}
    <button class="btn primary block" id="rv-save">Save ${items.filter(i => i.keep).length} item(s)</button>`;
    $$('.rv', el).forEach(card => {
      const it = items[+card.dataset.i];
      bindPersonSelect($('.psel', card), it, draw);
      $('.csel', card).onchange = e => { it.category = e.target.value; draw(); };
      $('.ttl', card).oninput = e => it.title = e.target.value;
      $('.dtl', card).oninput = e => it.detail = e.target.value;
      const en = $('.enr', card); if (en) en.onchange = e => it.enrich = e.target.checked;
      $('.rv-x', card).onclick = () => { it.keep = !it.keep; draw(); };
    });
    $$('[data-u]', el).forEach(c => c.onchange = () => updates[+c.dataset.u].keep = c.checked);
    $('#rv-save', el).onclick = () => {
      const { n, people } = saveItems(items, updates);
      const names = people.map(id => get('people', id)?.name).filter(Boolean);
      el.innerHTML = `<div class="card ok">✅ Saved ${n} item${n === 1 ? '' : 's'} for ${people.map(id => `<a href="#/p/${id}">${esc(get('people', id)?.name)}</a>`).join(', ')}.
        ${items.some(i => i.keep && i.enrich) ? '<br><small>Looking up details in the background…</small>' : ''}</div>`;
      toast(`Saved for ${names.join(', ')}`);
      done?.();
    };
  };
  draw();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const CATS_OK = c => c === 'memory' || Object.hasOwn(CATS, c);

export function addPage(view, _a, _b, q) {
  setTitle('Capture', true);
  const wrap = document.createElement('div');
  view.appendChild(wrap);
  renderCapture(wrap, { personId: q?.p, text: q?.t || '' });
  setTimeout(() => $('#cap-text', view)?.focus(), 50);
}

/* ---------- bulk import ---------- */
function chunk(text, size = 6000) {
  const out = []; let cur = '';
  for (const line of text.split('\n')) {
    if (cur.length + line.length > size && cur) { out.push(cur); cur = ''; }
    if (line.length > size) { for (let i = 0; i < line.length; i += size) out.push(line.slice(i, i + size)); continue; }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function importPage(view) {
  setTitle('Bulk import', true);
  view.innerHTML = `
  <div class="card">
    <p>Paste everything you've jotted down about people — notes, chats, lists, any format. I'll sift through it, sort each thing into the right person and category, and let you check it before saving.</p>
    <textarea id="im-text" rows="10" placeholder="Paste your dump here…"></textarea>
    <div class="row wrap">
      <label class="btn ghost">📄 Load a .txt / .md file<input type="file" id="im-file" accept=".txt,.md,.csv,.json,text/*" hidden></label>
      <span class="grow"></span>
      <button class="btn primary" id="im-go">Sift through it ✨</button>
    </div>
    <p class="hint" id="im-info"></p>
  </div>
  <div id="im-progress"></div>
  <div id="im-review"></div>`;
  const ta = $('#im-text', view);
  const info = () => {
    const n = chunk(ta.value).length;
    $('#im-info', view).textContent = ta.value ? `${ta.value.length.toLocaleString()} characters → ${n} batch${n === 1 ? '' : 'es'}${aiReady() ? ` (${n} Claude call${n === 1 ? '' : 's'} with ${cfg('smartModel')})` : ' (keyword sorting — add an API key for smart sorting)'}` : '';
  };
  ta.oninput = info;
  $('#im-file', view).onchange = async e => { const f = e.target.files[0]; if (f) { ta.value = await f.text(); info(); } };

  $('#im-go', view).onclick = async () => {
    const text = ta.value.trim();
    if (!text) return toast('Paste something first');
    const parts = chunk(text);
    const prog = $('#im-progress', view);
    const btn = $('#im-go', view); btn.disabled = true;
    let done = 0; const all = { items: [], updates: [] }; const errors = [];
    const extraNames = new Set();
    const tick = () => prog.innerHTML = `<div class="card"><div class="bar"><span style="width:${Math.round(done / parts.length * 100)}%"></span></div><small>Sifted ${done} of ${parts.length} batches · found ${all.items.length} things${errors.length ? ` · ${errors.length} batch(es) failed` : ''}</small></div>`;
    tick();
    const work = async idx => {
      try {
        const r = aiReady()
          ? await extractFacts(parts[idx], live('people'), { model: cfg('smartModel'), extraNames: [...extraNames] })
          : heuristicExtract(parts[idx], live('people'), null);
        r.items.forEach(i => { i.source = 'import'; if (!i.person_id && i.person) extraNames.add(i.person); });
        all.items.push(...r.items); all.updates.push(...r.updates);
      } catch (e) { errors.push(e.message); }
      done++; tick();
    };
    let next = 0;
    await Promise.all([0, 1].map(async () => { while (next < parts.length) await work(next++); }));
    btn.disabled = false;
    if (errors.length) toast('Some batches failed: ' + errors[0], 6000);
    // keep a copy of the raw dump next to your data, just in case
    uploadRaw(new Blob([text], { type: 'text/plain' }), `import-${today()}.txt`).catch(() => {});
    bulkReview($('#im-review', view), all);
  };
}

function bulkReview(el, { items, updates }) {
  // de-duplicate within the dump, and flag things already saved
  const existing = new Set(live('facts').map(f => f.personId + '|' + norm(f.title)));
  const seen = new Set();
  items = items.filter(it => {
    const k = norm(it.person) + '|' + norm(it.title);
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  const people = live('people');
  const findP = name => people.find(p => [p.name, ...(p.aliases || [])].some(n => norm(n) === norm(name)));
  const groups = new Map();
  for (const it of items) {
    if (!CATS_OK(it.category)) it.category = 'other';
    const p = (it.person_id && get('people', it.person_id)) || findP(it.person);
    const key = p ? 'id:' + p.id : 'new:' + norm(it.person);
    if (!groups.has(key)) groups.set(key, { key, name: p ? p.name : it.person, personId: p?.id || null, items: [], updates: [] });
    it.dupe = p && existing.has(p.id + '|' + norm(it.title));
    it.keep = !it.dupe;
    groups.get(key).items.push(it);
  }
  for (const u of updates) {
    const p = (u.person_id && get('people', u.person_id)) || findP(u.person);
    const key = p ? 'id:' + p.id : 'new:' + norm(u.person);
    if (!groups.has(key)) groups.set(key, { key, name: p ? p.name : u.person, personId: p?.id || null, items: [], updates: [] });
    u.keep = true; groups.get(key).updates.push(u);
  }
  const G = [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  const allPeople = people.sort((a, b) => a.name.localeCompare(b.name));

  el.innerHTML = `<h3 class="section">Review <small>${items.length} things · ${G.length} people</small></h3>
  <p class="hint">Uncheck anything wrong, fix categories, or point a group at an existing profile. Grey items look like things you've already saved.</p>
  ${G.map((g, gi) => `
    <details class="card group" open data-g="${gi}">
      <summary><b>${esc(g.name)}</b> <small>${g.items.length} items</small></summary>
      <div class="row"><span class="muted">Save to:</span>
        <select class="gsel">${g.personId ? '' : `<option value="new">＋ New profile "${esc(g.name)}"</option>`}
        ${allPeople.map(p => `<option value="${p.id}" ${p.id === g.personId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        <option value="skip">Skip this person</option></select></div>
      ${g.updates.map(u => `<div class="muted small">↳ ${[u.birthday && `🎂 ${esc(u.birthday)}`, u.relation && esc(u.relation), u.aliases?.length && 'aka ' + esc(u.aliases.join(', '))].filter(Boolean).join(' · ')}</div>`).join('')}
      ${g.items.map((it, ii) => `
        <div class="bi ${it.dupe ? 'dupe' : ''}" data-ii="${ii}">
          <input type="checkbox" class="bk" ${it.keep ? 'checked' : ''}>
          <select class="bc">${catOptions(it.category, true)}</select>
          <div class="grow"><input class="bt" value="${esc(it.title)}"><div class="small muted">${esc(it.detail || '')}</div></div>
        </div>`).join('')}
    </details>`).join('')}
  <div class="card">
    <label class="check"><input type="checkbox" id="bk-enrich" ${aiReady() ? '' : 'disabled'}> Also look up details online for foods, places, trips, books… (one extra Claude call each)</label>
    <button class="btn primary block" id="bk-save">Save checked items</button>
  </div>`;

  $$('.group', el).forEach(gEl => {
    const g = G[+gEl.dataset.g];
    $('.gsel', gEl).onchange = e => { g.target = e.target.value; gEl.classList.toggle('off', g.target === 'skip'); };
    $$('.bi', gEl).forEach(row => {
      const it = g.items[+row.dataset.ii];
      $('.bk', row).onchange = e => it.keep = e.target.checked;
      $('.bc', row).onchange = e => it.category = e.target.value;
      $('.bt', row).oninput = e => it.title = e.target.value;
    });
  });
  $('#bk-save', el).onclick = () => {
    const enrich = $('#bk-enrich', el).checked;
    const flat = [], ups = [];
    for (const g of G) {
      const t = g.target ?? (g.personId || 'new');
      if (t === 'skip') continue;
      for (const it of g.items) flat.push({ ...it, personId: t === 'new' ? null : t, person: t === 'new' ? g.name : get('people', t)?.name, enrich: enrich && it.searchable && it.category !== 'memory' });
      for (const u of g.updates) ups.push({ ...u, personId: t === 'new' ? null : t, person: t === 'new' ? g.name : get('people', t)?.name });
    }
    const { n, people: ps } = saveItems(flat, ups, 'import');
    toast(`Saved ${n} items across ${ps.length} people`);
    go('#/people');
  };
}
