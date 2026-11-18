import { state, live, get, upsert, remove, on } from '../state.js';
import {
  $, $$, esc, safeUrl, CATS, cat, catOptions, setTitle, openSheet, confirmDlg, toast, avatarHtml, photoImg, hydrate,
  fmtDate, daysUntil, mapEmbed, mapsLink, shuffle, today, go,
} from '../ui.js';
import { uploadPhotos, deletePhotos } from '../media.js';
import { enqueue } from '../enrich.js';
import { aiReady, planIdeas } from '../ai.js';
import { renderCapture } from './capture.js';

/* ---------------- list ---------------- */
export function peopleList(view) {
  setTitle('People');
  const people = live('people').sort((a, b) => a.name.localeCompare(b.name));
  const facts = live('facts');
  view.innerHTML = `
    <div class="row"><input id="ps" class="grow" type="search" placeholder="Search people or interests…"><button class="btn" id="addp">＋ Person</button></div>
    <div id="plist"></div>`;
  const draw = (q = '') => {
    q = q.toLowerCase();
    const hits = people.filter(p => !q || p.name.toLowerCase().includes(q) || (p.aliases || []).join(' ').toLowerCase().includes(q) ||
      facts.some(f => f.personId === p.id && `${f.title} ${f.detail || ''} ${(f.tags || []).join(' ')}`.toLowerCase().includes(q)));
    $('#plist').innerHTML = hits.map(p => personCard(p, facts, q)).join('') ||
      `<div class="empty">${q ? 'No matches.' : 'No one here yet. Tap <b>＋ Person</b>, or use the big ＋ below to capture something someone told you — I\'ll create the profile for you.'}</div>`;
    hydrate(view);
  };
  draw();
  $('#ps').oninput = e => draw(e.target.value);
  $('#addp').onclick = () => editPerson();
}

function personCard(p, facts, q) {
  const fs = facts.filter(f => f.personId === p.id);
  const emojis = [...new Set(fs.map(f => f.category))].slice(0, 7).map(c => cat(c).e).join(' ');
  const d = daysUntil(p.birthday);
  const hit = q && fs.find(f => `${f.title} ${f.detail || ''}`.toLowerCase().includes(q));
  return `<a class="card pcard" href="#/p/${p.id}">${avatarHtml(p)}
    <div class="grow"><div class="name">${esc(p.name)}</div>
    <div class="muted small">${p.relation ? esc(p.relation) + ' · ' : ''}${fs.length} thing${fs.length === 1 ? '' : 's'} ${emojis}</div>
    ${hit ? `<div class="small">${cat(hit.category).e} ${esc(hit.title)}</div>` : ''}</div>
    ${d !== null && d <= 30 ? `<span class="badge">🎂 ${d === 0 ? 'today!' : 'in ' + d + 'd'}</span>` : ''}</a>`;
}

export function editPerson(p = null) {
  const isNew = !p;
  p = p ? structuredClone(p) : { name: '', aliases: [], relation: '', birthday: null, notes: '' };
  const yearKnown = p.birthday && !p.birthday.startsWith('--');
  const bdayVal = p.birthday ? (yearKnown ? p.birthday : `2000-${p.birthday.slice(2)}`) : '';
  const s = openSheet(`
    <h2>${isNew ? 'New person' : 'Edit ' + esc(p.name)}</h2>
    <div class="avatar-edit">${avatarHtml(p, 72)}<label class="btn ghost">📷 Photo<input type="file" id="ep-photo" accept="image/*" hidden></label></div>
    <label>Name<input id="ep-name" value="${esc(p.name)}" required></label>
    <label>Nicknames / aliases <small>(comma separated)</small><input id="ep-alias" value="${esc((p.aliases || []).join(', '))}"></label>
    <label>Relation<input id="ep-rel" value="${esc(p.relation || '')}" placeholder="friend, sister, colleague…" list="rels"></label>
    <datalist id="rels"><option>friend</option><option>best friend</option><option>partner</option><option>sister</option><option>brother</option><option>mom</option><option>dad</option><option>colleague</option><option>cousin</option></datalist>
    <div class="row"><label class="grow">Birthday<input type="date" id="ep-bday" value="${bdayVal}"></label>
    <label class="check"><input type="checkbox" id="ep-noyear" ${p.birthday && !yearKnown ? 'checked' : ''}> year unknown</label></div>
    <label>Notes<textarea id="ep-notes" rows="3">${esc(p.notes || '')}</textarea></label>
    <div class="row">${isNew ? '' : '<button class="btn danger" id="ep-del">Delete</button>'}<span class="grow"></span><button class="btn primary" id="ep-save">Save</button></div>`);
  let avatar = p.avatar || null;
  $('#ep-photo', s.el).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    toast('Uploading photo…');
    [avatar] = await uploadPhotos([f], null, 800);
    $('.avatar-edit .avatar', s.el).outerHTML = avatarHtml({ ...p, avatar }, 72);
    hydrate(s.el);
  };
  $('#ep-save', s.el).onclick = () => {
    const name = $('#ep-name', s.el).value.trim();
    if (!name) return toast('Name is required');
    const b = $('#ep-bday', s.el).value;
    p.name = name;
    p.aliases = $('#ep-alias', s.el).value.split(',').map(x => x.trim()).filter(Boolean);
    p.relation = $('#ep-rel', s.el).value.trim();
    p.birthday = b ? ($('#ep-noyear', s.el).checked ? '--' + b.slice(5) : b) : null;
    p.notes = $('#ep-notes', s.el).value;
    p.avatar = avatar;
    const saved = upsert('people', p);
    s.close();
    if (isNew) go('#/p/' + saved.id); else rerender();
  };
  $('#ep-del', s.el)?.addEventListener('click', async () => {
    const n = live('facts').filter(f => f.personId === p.id).length;
    if (!(await confirmDlg(`Delete ${p.name} and their ${n} saved things?`))) return;
    live('facts').filter(f => f.personId === p.id).forEach(f => remove('facts', f.id));
    remove('people', p.id);
    s.close(); go('#/people');
  });
}

/* ---------------- person page ---------------- */
let rerender = () => {};
const TABS = { likes: '💛 Likes', graph: '🕸️ Graph', plan: '🎲 Plan', memories: '📸 Memories' };

export function personPage(view, id, tab = 'likes', q = {}) {
  const p = get('people', id);
  if (!p) { view.innerHTML = '<div class="empty">Person not found.</div>'; return; }
  if (!TABS[tab]) tab = 'likes';
  rerender = () => personPage(view, id, tab, q);
  setTitle(p.name, true);
  const d = daysUntil(p.birthday);
  view.innerHTML = `
    <div class="phead">${avatarHtml(p, 64)}
      <div class="grow"><h2>${esc(p.name)}</h2>
      <div class="muted small">${[p.relation && esc(p.relation), p.birthday && `🎂 ${fmtDate(p.birthday)}${d !== null ? ` (${d === 0 ? 'today!' : 'in ' + d + ' days'})` : ''}`].filter(Boolean).join(' · ')}</div></div>
      <button class="icon" id="pedit" title="Edit">✏️</button></div>
    ${p.notes ? `<p class="muted small">${esc(p.notes)}</p>` : ''}
    <div class="tabs">${Object.entries(TABS).map(([t, l]) => `<a href="#/p/${id}/${t}" class="${t === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="ptab"></div>
    <button class="fab" id="padd" aria-label="Add">＋</button>`;
  $('#pedit').onclick = () => editPerson(p);
  const el = $('#ptab');
  ({ likes: likesTab, graph: graphTab, plan: planTab, memories: memoriesTab })[tab](el, p, q);
  $('#padd').onclick = () => {
    if (tab === 'memories') return editMemory(null, p.id);
    const s = openSheet(`<h2>Add for ${esc(p.name)}</h2><div id="sheet-cap"></div>`);
    renderCapture($('#sheet-cap', s.el), { personId: p.id, onSaved: () => setTimeout(() => { s.close(); rerender(); }, 900) });
  };
  hydrate(view);
}
on('fact-updated', () => { if (location.hash.startsWith('#/p/') && !document.querySelector('.sheet-wrap')) rerender(); });

function factCard(f) {
  const e = f.enrichment || {};
  return `<button class="fact ${f.done ? 'done' : ''}" data-fid-fact="${f.id}">
    ${e.image ? `<img src="${esc(e.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="femoji" style="--c:${cat(f.category).c}">${cat(f.category).e}</span>`}
    <span class="ftext"><b>${esc(f.title)}</b><small>${esc(f.detail || e.summary || '')}</small></span>
    ${f.enrichStatus === 'pending' ? '<span class="fstat">⏳</span>' : f.done ? '<span class="fstat">✓</span>' : ''}</button>`;
}
const bindFacts = el => $$('[data-fid-fact]', el).forEach(b => b.onclick = () => factSheet(b.dataset.fidFact));

function likesTab(el, p) {
  const fs = live('facts').filter(f => f.personId === p.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const avoid = fs.filter(f => f.category === 'dislike');
  const pending = fs.filter(f => f.searchable && !f.enrichment && f.enrichStatus !== 'pending');
  if (!fs.length) { el.innerHTML = `<div class="empty">Nothing saved for ${esc(p.name)} yet. Tap ＋ and type what they told you.</div>`; return; }
  el.innerHTML = `
    ${avoid.length ? `<div class="card avoid"><b>🚫 Avoid:</b> ${avoid.map(f => `<a href="#" data-fid-fact="${f.id}">${esc(f.title)}</a>`).join(' · ')}</div>` : ''}
    ${pending.length && aiReady() ? `<button class="btn ghost block" id="enrich-all">🔎 Look up details for ${pending.length} item${pending.length === 1 ? '' : 's'}</button>` : ''}
    ${Object.keys(CATS).filter(c => c !== 'dislike').map(c => {
      const list = fs.filter(f => f.category === c);
      return list.length ? `<details class="catgroup" open><summary>${cat(c).e} ${cat(c).l} <small>${list.length}</small></summary><div class="facts">${list.map(factCard).join('')}</div></details>` : '';
    }).join('')}`;
  bindFacts(el);
  $$('.avoid a', el).forEach(a => a.addEventListener('click', e => e.preventDefault()));
  $('#enrich-all', el)?.addEventListener('click', () => { pending.forEach(f => enqueue(f.id)); toast(`Looking up ${pending.length} items…`); rerender(); });
}

export function factSheet(id) {
  const f = get('facts', id);
  if (!f) return;
  const e = f.enrichment || {};
  const person = get('people', f.personId);
  const s = openSheet(`
    ${e.image ? `<div class="fact-hero"><img src="${esc(e.image)}" alt="" referrerpolicy="no-referrer"></div>` : ''}
    <span class="chip on" style="--c:${cat(f.category).c}">${cat(f.category).e} ${cat(f.category).l}</span>
    <h2>${esc(f.title)}</h2>
    <p>${esc(f.detail || '')}</p>
    <p class="muted small">${person ? `For <a href="#/p/${person.id}">${esc(person.name)}</a> · ` : ''}added ${fmtDate(new Date(f.createdAt).toISOString().slice(0, 10))}${f.tags?.length ? ' · ' + f.tags.map(t => '#' + esc(t)).join(' ') : ''}</p>
    ${e.summary ? `<p>${esc(e.summary)}</p>` : ''}
    ${e.place ? `<div class="place"><b>📍 ${esc(e.place.name || '')}</b><br><small>${esc(e.place.address || '')}</small>
      ${mapEmbed(e.place.lat, e.place.lng)}
      <a class="btn ghost" target="_blank" rel="noopener" href="${mapsLink({ lat: e.place.lat, lng: e.place.lng, q: `${e.place.name || ''} ${e.place.address || ''}` })}">Open in Google Maps</a></div>` : ''}
    ${e.suggestions?.length ? `<h4>Ideas & places</h4><ul class="sugs">${e.suggestions.map(x => `<li><b>${esc(x.name)}</b>${x.price ? ` · ${esc(x.price)}` : ''}${x.why ? `<br><small>${esc(x.why)}</small>` : ''}
      <div class="small">${x.address ? `<a target="_blank" rel="noopener" href="${mapsLink({ q: `${x.name} ${x.address}` })}">📍 ${esc(x.address)}</a> ` : ''}${safeUrl(x.url) ? `<a target="_blank" rel="noopener" href="${esc(x.url)}">🔗 link</a>` : ''}</div></li>`).join('')}</ul>` : ''}
    ${e.links?.filter(l => safeUrl(l.url)).length ? `<h4>Links</h4><ul class="links">${e.links.filter(l => safeUrl(l.url)).map(l => `<li><a target="_blank" rel="noopener" href="${esc(l.url)}">${esc(l.title || l.url)}</a></li>`).join('')}</ul>` : ''}
    ${e.imageSource ? `<p class="small muted">Picture: <a href="${esc(e.imageSource)}" target="_blank" rel="noopener">Wikipedia</a></p>` : ''}
    ${f.enrichStatus === 'error' ? `<p class="small warn">Lookup failed: ${esc(f.enrichError || '')}</p>` : ''}
    ${f.enrichStatus === 'pending' ? `<p class="small muted">⏳ Looking up details…</p>` : ''}
    <div class="row wrap">
      <button class="btn" id="f-done">${f.done ? '↩︎ Not done yet' : '✓ Done / gifted'}</button>
      <button class="btn" id="f-enrich">🔎 ${e.at ? 'Refresh details' : 'Look up details'}</button>
      <button class="btn" id="f-edit">✏️ Edit</button>
      <button class="btn danger" id="f-del">🗑</button>
    </div>`);
  $('#f-done', s.el).onclick = () => { f.done = !f.done; upsert('facts', f); s.close(); rerender(); };
  $('#f-enrich', s.el).onclick = () => { enqueue(f.id); toast('Looking it up…'); s.close(); rerender(); };
  $('#f-del', s.el).onclick = async () => { if (await confirmDlg(`Delete "${f.title}"?`)) { remove('facts', f.id); s.close(); rerender(); } };
  $('#f-edit', s.el).onclick = () => { s.close(); editFact(f); };
}

function editFact(f) {
  const people = live('people').sort((a, b) => a.name.localeCompare(b.name));
  const s = openSheet(`<h2>Edit</h2>
    <label>Title<input id="ef-t" value="${esc(f.title)}"></label>
    <label>Category<select id="ef-c">${catOptions(f.category)}</select></label>
    <label>Details<textarea id="ef-d" rows="3">${esc(f.detail || '')}</textarea></label>
    <label>Tags <small>(comma separated)</small><input id="ef-tags" value="${esc((f.tags || []).join(', '))}"></label>
    <label>Person<select id="ef-p">${people.map(p => `<option value="${p.id}" ${p.id === f.personId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    ${f.enrichment?.image ? '<label class="check"><input type="checkbox" id="ef-noimg"> Remove the picture</label>' : ''}
    <button class="btn primary block" id="ef-save">Save</button>`);
  $('#ef-save', s.el).onclick = () => {
    f.title = $('#ef-t', s.el).value.trim() || f.title;
    f.category = $('#ef-c', s.el).value;
    f.detail = $('#ef-d', s.el).value;
    f.tags = $('#ef-tags', s.el).value.split(',').map(x => x.trim()).filter(Boolean);
    f.personId = $('#ef-p', s.el).value;
    if ($('#ef-noimg', s.el)?.checked) { delete f.enrichment.image; delete f.enrichment.imageSource; }
    upsert('facts', f); s.close(); rerender();
  };
}

/* ---------------- interest graph ---------------- */
function graphTab(el, p) {
  const fs = live('facts').filter(f => f.personId === p.id);
  if (!fs.length) { el.innerHTML = '<div class="empty">Add a few things first and the graph will grow here.</div>'; return; }
  const cats = Object.keys(CATS).filter(c => fs.some(f => f.category === c));
  const C = 500, R1 = 170, R2 = 330;
  const weights = cats.map(c => Math.max(1.4, fs.filter(f => f.category === c).length));
  const total = weights.reduce((a, b) => a + b, 0);
  let a0 = -Math.PI / 2;
  let edges = '', nodes = '', labels = '';
  cats.forEach((c, ci) => {
    const span = (weights[ci] / total) * Math.PI * 2;
    const mid = a0 + span / 2;
    const cx = C + R1 * Math.cos(mid), cy = C + R1 * Math.sin(mid);
    const col = cat(c).c;
    edges += `<line x1="${C}" y1="${C}" x2="${cx}" y2="${cy}" stroke="${col}" stroke-width="4" opacity=".5"/>`;
    const list = fs.filter(f => f.category === c);
    list.forEach((f, i) => {
      const ang = a0 + span * (i + 0.5) / list.length;
      const r = R2 + (list.length > 5 && i % 2 ? 55 : 0);
      const x = C + r * Math.cos(ang), y = C + r * Math.sin(ang);
      edges += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${col}" stroke-width="1.5" opacity=".45"/>`;
      const right = Math.cos(ang) >= 0;
      const t = f.title.length > 16 ? f.title.slice(0, 15) + '…' : f.title;
      nodes += `<g class="gnode" data-fid-fact="${f.id}"><circle cx="${x}" cy="${y}" r="${f.enrichment?.image ? 20 : 13}" fill="${col}" ${f.done ? 'opacity=".45"' : ''}/>
        ${f.enrichment?.image ? `<clipPath id="cp${f.id}"><circle cx="${x}" cy="${y}" r="14"/></clipPath><image href="${esc(f.enrichment.image)}" x="${x - 14}" y="${y - 14}" width="28" height="28" clip-path="url(#cp${f.id})" preserveAspectRatio="xMidYMid slice"/>` : ''}
        <text x="${x + (right ? 22 : -22)}" y="${y + 10}" text-anchor="${right ? 'start' : 'end'}" class="glabel">${esc(t)}</text></g>`;
    });
    labels += `<g><circle cx="${cx}" cy="${cy}" r="30" fill="${col}"/><text x="${cx}" y="${cy + 9}" text-anchor="middle" font-size="26">${cat(c).e}</text>
      <text x="${cx}" y="${cy + 50}" text-anchor="middle" class="gcat">${esc(cat(c).l)}</text></g>`;
    a0 += span;
  });
  const center = `<circle cx="${C}" cy="${C}" r="46" fill="var(--ink)"/><text x="${C}" y="${C + 9}" text-anchor="middle" font-size="26" fill="var(--bg)" font-weight="700">${esc(p.name.split(' ')[0].slice(0, 8))}</text>`;
  el.innerHTML = `<div class="graph card"><svg id="gsvg" viewBox="-180 -20 1360 1040" xmlns="http://www.w3.org/2000/svg">${edges}${labels}${nodes}${center}</svg>
    <div class="gctl"><button class="icon" data-z="0.8">＋</button><button class="icon" data-z="1.25">－</button><button class="icon" data-z="0">⤾</button></div></div>
    <div class="legend">${cats.map(c => `<span><i style="background:${cat(c).c}"></i>${cat(c).l} (${fs.filter(f => f.category === c).length})</span>`).join('')}</div>
    <p class="hint">Tap a dot for details · drag to move · pinch or use ＋/－ to zoom.</p>`;
  bindFacts(el);
  panZoom($('#gsvg', el), el);
}

function panZoom(svg, root) {
  const init = [-180, -20, 1360, 1040];
  let vb = [...init];
  const set = () => svg.setAttribute('viewBox', vb.join(' '));
  const zoom = (k, cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2) => {
    const w = Math.min(2400, Math.max(250, vb[2] * k)), h = w * init[3] / init[2];
    vb = [cx - (cx - vb[0]) * w / vb[2], cy - (cy - vb[1]) * h / vb[3], w, h]; set();
  };
  $$('[data-z]', root).forEach(b => b.onclick = () => { const k = +b.dataset.z; if (!k) { vb = [...init]; set(); } else zoom(k); });
  const pts = new Map(); let last = null, lastDist = null, moved = false;
  svg.addEventListener('pointerdown', e => { pts.set(e.pointerId, e); last = e; moved = false; });
  svg.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, e);
    const scale = vb[2] / svg.clientWidth;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (lastDist) zoom(lastDist / d);
      lastDist = d; moved = true;
    } else if (last) {
      const dx = e.clientX - last.clientX, dy = e.clientY - last.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (moved) { vb[0] -= dx * scale; vb[1] -= dy * scale; set(); svg.setPointerCapture?.(e.pointerId); }
      last = e;
    }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) lastDist = null; last = null; };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);
  svg.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });
}

/* ---------------- planner ---------------- */
const INTENTS = {
  birthday: { e: '🎂', l: 'Birthday', cats: ['gift_idea', 'long_held_desire', 'activity', 'food', 'place', 'hobby', 'dream_vacation', 'fashion', 'book', 'music'] },
  gift: { e: '🎁', l: 'Gift', cats: ['gift_idea', 'hobby', 'fashion', 'book', 'music', 'movie_tv', 'long_held_desire'] },
  food: { e: '🍽️', l: 'Food', cats: ['food'] },
  outing: { e: '🗺️', l: 'Go out', cats: ['place', 'activity', 'food', 'music'] },
  surprise: { e: '🎲', l: 'Surprise me', cats: null },
};
export { INTENTS };

function planTab(el, p, q) {
  let intent = INTENTS[q.i] ? q.i : 'birthday';
  const fs = live('facts').filter(f => f.personId === p.id);
  const avoid = fs.filter(f => f.category === 'dislike');
  const draw = () => {
    const I = INTENTS[intent];
    const pool = fs.filter(f => !f.done && !['dislike', 'important_date'].includes(f.category) && (!I.cats || I.cats.includes(f.category)));
    const picks = shuffle(pool).slice(0, 3);
    const d = daysUntil(p.birthday);
    el.innerHTML = `
      <div class="chips">${Object.entries(INTENTS).map(([k, v]) => `<button class="chip ${k === intent ? 'on' : ''}" data-i="${k}">${v.e} ${v.l}</button>`).join('')}</div>
      ${intent === 'birthday' && d !== null ? `<p class="lead">🎂 ${esc(p.name)}'s birthday is ${d === 0 ? '<b>today</b>' : `in <b>${d} days</b>`} (${fmtDate(p.birthday)}).</p>` : ''}
      ${avoid.length ? `<div class="card avoid"><b>🚫 Avoid:</b> ${avoid.map(f => esc(f.title)).join(' · ')}</div>` : ''}
      <div class="spins">${picks.map(f => {
        const e = f.enrichment || {};
        const sug = e.suggestions?.length ? e.suggestions[Math.floor(Math.random() * e.suggestions.length)] : null;
        return `<button class="spin card" data-fid-fact="${f.id}" style="--c:${cat(f.category).c}">
          ${e.image ? `<img src="${esc(e.image)}" alt="" referrerpolicy="no-referrer">` : `<span class="spin-emoji">${cat(f.category).e}</span>`}
          <span class="spin-body"><small>${cat(f.category).e} ${cat(f.category).l}</small><b>${esc(f.title)}</b><span>${esc(f.detail || '')}</span>
          ${sug ? `<span class="sug">👉 Try: ${esc(sug.name)}${sug.price ? ' · ' + esc(sug.price) : ''}</span>` : ''}</span></button>`;
      }).join('') || `<div class="empty">Nothing saved for this yet. Capture a few things ${esc(p.name)} likes and they'll show up here.</div>`}</div>
      ${pool.length > 3 ? `<button class="btn primary block big" id="reshuffle">🔀 Shuffle (${pool.length} options)</button>` : ''}
      <div class="card">
        <h3>✨ Fresh ideas from Claude</h3>
        <input id="pl-extra" placeholder="Budget, date, constraints… (optional)">
        <label class="check"><input type="checkbox" id="pl-web" checked> Search the web for current options near me</label>
        <button class="btn block" id="pl-go" ${aiReady() ? '' : 'disabled'}>Get ideas for: ${I.e} ${I.l}</button>
        ${aiReady() ? '' : '<p class="hint">Add a Claude API key in Settings to enable.</p>'}
        <div id="pl-out"></div>
      </div>`;
    $$('[data-i]', el).forEach(b => b.onclick = () => { intent = b.dataset.i; history.replaceState(null, '', `#/p/${p.id}/plan?i=${intent}`); draw(); });
    $('#reshuffle', el)?.addEventListener('click', draw);
    bindFacts(el);
    $('#pl-go', el).onclick = async () => {
      const out = $('#pl-out', el); const btn = $('#pl-go', el);
      btn.disabled = true; out.innerHTML = '<div class="spinner"></div>';
      try {
        const mem = live('memories').filter(m => (m.personIds || []).includes(p.id)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const ideas = await planIdeas(p, fs, mem, `${I.l}`, $('#pl-extra', el).value, $('#pl-web', el).checked);
        out.innerHTML = ideas.map(x => `<div class="idea"><b>${esc(x.title)}</b><p>${esc(x.how || '')}</p><small class="muted">${esc(x.why || '')}</small>${safeUrl(x.url) ? ` <a class="small" href="${esc(x.url)}" target="_blank" rel="noopener">🔗</a>` : ''}</div>`).join('') || '<p>No ideas came back — try again.</p>';
      } catch (e) { out.innerHTML = `<p class="warn">${esc(e.message)}</p>`; }
      btn.disabled = false;
    };
  };
  draw();
}

/* ---------------- memories ---------------- */
function memoriesTab(el, p) {
  const ms = live('memories').filter(m => (m.personIds || []).includes(p.id)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  el.innerHTML = ms.length ? `<div class="timeline">${ms.map(memoryCard).join('')}</div>` :
    `<div class="empty">No memories yet. Tap ＋ to add a photo from your last outing or a moment you want to keep.</div>`;
  $$('[data-mem]', el).forEach(b => b.onclick = () => editMemory(get('memories', b.dataset.mem), p.id));
  hydrate(el);
}
export function memoryCard(m) {
  const others = (m.personIds || []).map(id => get('people', id)).filter(Boolean);
  return `<div class="mem card"><div class="mem-date">${fmtDate(m.date)}</div>
    <div class="row"><b class="grow">${esc(m.title || 'Memory')}</b><button class="icon" data-mem="${m.id}" title="Edit">✏️</button></div>
    ${m.note ? `<p>${esc(m.note)}</p>` : ''}
    ${m.photos?.length ? `<div class="photos">${m.photos.map(ph => photoImg(ph)).join('')}</div>` : ''}
    <div class="small muted">with ${others.map(o => `<a href="#/p/${o.id}/memories">${esc(o.name)}</a>`).join(', ')}</div></div>`;
}

export function editMemory(m, presetPersonId) {
  const isNew = !m;
  m = m ? structuredClone(m) : { title: '', note: '', date: today(), photos: [], personIds: presetPersonId ? [presetPersonId] : [] };
  const added = [];
  const people = live('people').sort((a, b) => a.name.localeCompare(b.name));
  const s = openSheet(`<h2>${isNew ? 'New memory' : 'Edit memory'}</h2>
    <div class="photos edit" id="em-photos"></div>
    <label class="btn ghost block">📷 Add photos<input type="file" id="em-file" accept="image/*" multiple hidden></label>
    <label>What happened?<input id="em-t" value="${esc(m.title)}" placeholder="Sunset at Nandi Hills"></label>
    <label>Date<input type="date" id="em-d" value="${esc(m.date || '')}"></label>
    <label>Note<textarea id="em-n" rows="3" placeholder="The little details you'll want to remember">${esc(m.note || '')}</textarea></label>
    <div class="muted small">With</div>
    <div class="chips" id="em-people">${people.map(p => `<button class="chip ${m.personIds.includes(p.id) ? 'on' : ''}" data-p="${p.id}">${esc(p.name)}</button>`).join('')}</div>
    <div class="row">${isNew ? '' : '<button class="btn danger" id="em-del">Delete</button>'}<span class="grow"></span><button class="btn primary" id="em-save">Save</button></div>`,
  { onClose: () => { if (!saved) deletePhotos(added); } });
  let saved = false;
  const drawPhotos = () => {
    $('#em-photos', s.el).innerHTML = m.photos.map((ph, i) => `<div class="ph">${photoImg(ph)}<button class="icon ph-x" data-i="${i}">✕</button></div>`).join('');
    $$('.ph-x', s.el).forEach(b => b.onclick = () => { m.photos.splice(+b.dataset.i, 1); drawPhotos(); });
    hydrate(s.el);
  };
  drawPhotos();
  $('#em-file', s.el).onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    const btn = $('#em-save', s.el); btn.disabled = true;
    try {
      const ph = await uploadPhotos(files, (i, n) => btn.textContent = `Uploading ${i}/${n}…`);
      m.photos.push(...ph); added.push(...ph); drawPhotos();
    } catch (err) { toast('Upload failed: ' + err.message, 5000); }
    btn.disabled = false; btn.textContent = 'Save';
  };
  $$('#em-people .chip', s.el).forEach(b => b.onclick = () => {
    const id = b.dataset.p;
    m.personIds = m.personIds.includes(id) ? m.personIds.filter(x => x !== id) : [...m.personIds, id];
    b.classList.toggle('on');
  });
  $('#em-save', s.el).onclick = () => {
    m.title = $('#em-t', s.el).value.trim();
    m.date = $('#em-d', s.el).value;
    m.note = $('#em-n', s.el).value;
    if (!m.personIds.length) return toast('Pick at least one person');
    if (!m.title && !m.photos.length) return toast('Add a title or a photo');
    saved = true; upsert('memories', m); s.close(); rerender();
  };
  $('#em-del', s.el)?.addEventListener('click', async () => {
    if (!(await confirmDlg('Delete this memory and its photos?'))) return;
    deletePhotos(m.photos); remove('memories', m.id); saved = true; s.close(); rerender();
  });
}

export function setRerender(fn) { rerender = fn; }
