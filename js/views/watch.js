// Watchlist: movies & shows you or people you know want to watch, and "what should we watch?" suggestions.
// Works without AI: details come from TVmaze (shows) and the iTunes catalogue (movies), suggestions are scored locally.
import { live, get, upsert, remove } from '../state.js';
import { $, $$, esc, setTitle, openSheet, confirmDlg, toast, today, fmtDate, go } from '../ui.js';
import { findMatch, keywords } from '../match.js';
import { aiReady, aiName, ask, parseJson, wikiSummary } from '../ai.js';

const ME = 'me';
const KIND = { movie: '🎬 Movie', show: '📺 Show' };
const nameOf = id => (id === ME ? 'You' : get('people', id)?.name || 'Someone');
const firstOf = id => nameOf(id).split(' ')[0];
const items = () => live('watch');
const listJoin = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const fmtRun = m => (m ? (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${m}m`) : '');

/* ---------- free title lookup ---------- */
const strip = h => (h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
async function tvmaze(q) {
  try {
    const j = await (await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`)).json();
    return j.slice(0, 5).map(({ show: s }) => ({
      title: s.name, kind: 'show', year: (s.premiered || '').slice(0, 4), genres: s.genres || [], poster: s.image?.medium || s.image?.original || null,
      summary: strip(s.summary).slice(0, 400), runtime: s.averageRuntime || s.runtime || null, network: s.network?.name || s.webChannel?.name || '', link: s.url,
    }));
  } catch { return []; }
}
async function itunes(q) {
  try {
    const j = await (await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=movie&entity=movie&limit=6`)).json();
    return (j.results || []).map(r => ({
      title: r.trackName, kind: 'movie', year: (r.releaseDate || '').slice(0, 4), genres: r.primaryGenreName ? [r.primaryGenreName] : [],
      poster: r.artworkUrl100 ? r.artworkUrl100.replace('100x100', '300x300') : null, summary: strip(r.longDescription || r.shortDescription).slice(0, 400),
      runtime: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 60000) : null, network: '', link: r.trackViewUrl,
    }));
  } catch { return []; }
}
export async function searchTitles(q, kind = '') {
  const [shows, movies] = await Promise.all([kind === 'movie' ? [] : tvmaze(q), kind === 'show' ? [] : itunes(q)]);
  const exact = r => (r.title || '').toLowerCase() === q.toLowerCase().trim() ? 0 : 1;
  let out = [...shows, ...movies].sort((a, b) => exact(a) - exact(b));
  if (!out.length) { // last resort: Wikipedia
    const w = await wikiSummary(q);
    if (w) out = [{ title: q, kind: kind || 'movie', year: '', genres: [], poster: w.image, summary: (w.extract || '').slice(0, 400), runtime: null, network: '', link: w.url }];
  }
  return out.slice(0, 8);
}
// Fill in details for an item added by name only (best guess; "Fix details" lets you pick another match).
async function enrich(it) {
  const list = await searchTitles(it.title, it.kind || '');
  const best = list.find(r => r.title.toLowerCase() === it.title.toLowerCase()) || list[0];
  const cur = get('watch', it.id);
  if (!cur) return;
  upsert('watch', best ? { ...cur, ...meta(best), title: cur.title, metaChecked: true } : { ...cur, metaChecked: true });
}
const meta = r => ({ kind: r.kind, year: r.year, genres: r.genres, poster: r.poster, summary: r.summary, runtime: r.runtime, network: r.network, link: r.link });

/* ---------- things people mentioned (Movies & TV facts) join the list ---------- */
const cleanTitle = t => (t || '').replace(/^(watch(ing)?|see|binge)\s+/i, '').replace(/\s+(movie|film|series|tv show|show|season \d+)$/i, '').trim() || t;
export function syncFromFacts() {
  let added = 0;
  for (const f of live('facts').filter(f => f.category === 'movie_tv' && !f.watchId && !f.done)) {
    const title = cleanTitle(f.title);
    const m = findMatch({ title, category: 'movie_tv' }, items().map(w => ({ ...w, category: 'movie_tv' })));
    let w = m && m.level === 'same' ? get('watch', m.fact.id) : null;
    if (w) { if (!w.wantedBy.includes(f.personId)) upsert('watch', { ...w, wantedBy: [...w.wantedBy, f.personId] }); }
    else { w = upsert('watch', { title, kind: '', wantedBy: [f.personId], status: 'want', notes: f.detail || '', addedFrom: 'note' }); added++; }
    upsert('facts', { ...f, watchId: w.id });
  }
  return added;
}
// keep the person's fact in step when something is marked watched
function markFactsDone(w, done) {
  for (const f of live('facts').filter(f => f.watchId === w.id)) if (!!f.done !== done) upsert('facts', { ...f, done });
}

/* ---------- suggestions (offline scoring) ---------- */
// Genre words someone has said they dislike ("hates horror", "no subtitles"…)
function dislikedWords(ids) {
  const words = new Set();
  for (const f of live('facts').filter(f => f.category === 'dislike' && ids.includes(f.personId))) keywords(`${f.title} ${f.detail || ''}`).forEach(w => words.add(w));
  return words;
}
export function suggest({ withIds, kind = '', mood = '', count = 3 }) {
  const present = withIds.length ? withIds : [ME];
  const avoid = dislikedWords(present.filter(id => id !== ME));
  const scored = [];
  for (const w of items().filter(w => w.status !== 'watched' && (!kind || w.kind === kind))) {
    const wants = w.wantedBy.filter(id => present.includes(id));
    const seen = present.filter(id => (w.watchedBy || []).includes(id));
    if (seen.length === present.length) continue;
    const genres = (w.genres || []).map(g => g.toLowerCase());
    if (mood && !genres.includes(mood.toLowerCase())) continue;
    const clash = genres.filter(g => keywords(g).some(k => avoid.has(k)));
    let score = wants.length * 3 + (wants.length === present.length && present.length > 1 ? 4 : 0) - clash.length * 5 - seen.length * 2;
    score += Math.random() * 2.5; // keep it fresh on every shuffle
    const why = [];
    if (wants.length === present.length && present.length > 1) why.push('🎯 Everyone here wants this');
    else if (wants.length) why.push(`💛 ${listJoin(wants.map(firstOf))} want${wants.length === 1 && wants[0] !== ME ? 's' : ''} to watch it`);
    else if (w.wantedBy.length) why.push(`On the list for ${listJoin(w.wantedBy.map(firstOf))}`);
    if (seen.length) why.push(`👀 ${listJoin(seen.map(firstOf))} ${seen.length === 1 && seen[0] !== ME ? 'has' : 'have'} seen it`);
    if (clash.length) why.push(`⚠️ ${clash.join(', ')} — someone here isn't keen`);
    scored.push({ w, score, why });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, count);
}

/* ---------- page ---------- */
let withIds = [ME], kindF = '', moodF = '', tab = 'want', lastPicks = null;
export function watchPage(view, q = {}) {
  setTitle('Watchlist', true);
  const added = syncFromFacts();
  if (added) toast(`Added ${added} title${added === 1 ? '' : 's'} people mentioned`);
  if (q.with) withIds = [ME, ...q.with.split(',').filter(id => get('people', id))];
  withIds = withIds.filter(id => id === ME || get('people', id));
  const all = items();
  for (const w of all.filter(w => !w.metaChecked).slice(0, 6)) enrich(w); // fetch posters/genres in the background
  const people = live('people').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const wantCounts = id => all.filter(w => w.status !== 'watched' && w.wantedBy.includes(id)).length;
  const peopleChips = [...new Set([...withIds.filter(id => id !== ME), ...people.filter(p => wantCounts(p.id)).map(p => p.id), ...people.slice(0, 6).map(p => p.id)])].slice(0, 12);
  const genres = [...new Set(all.filter(w => w.status !== 'watched').flatMap(w => w.genres || []))].sort();
  const counts = { want: all.filter(w => w.status !== 'watched').length, watched: all.filter(w => w.status === 'watched').length };

  view.innerHTML = `
    <div class="card wpick">
      <h3>🍿 What should we watch?</h3>
      <div class="small muted">Who's watching?</div>
      <div class="chips">${[ME, ...peopleChips].map(id => `<button class="chip ${withIds.includes(id) ? 'on' : ''}" data-w="${id}">${id === ME ? '🙋 Me' : esc(nameOf(id))}${id !== ME && wantCounts(id) ? ` <small>${wantCounts(id)}</small>` : ''}</button>`).join('')}
        ${people.length > peopleChips.length ? '<button class="chip" id="w-more">＋ Someone else</button>' : ''}</div>
      <div class="row wrap"><div class="seg">${[['', 'Any'], ['movie', '🎬 Movie'], ['show', '📺 Show']].map(([k, l]) => `<button class="${kindF === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
        ${genres.length ? `<select id="w-mood" class="grow"><option value="">Any mood</option>${genres.map(g => `<option ${moodF === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>` : ''}</div>
      <button class="btn primary block" id="w-go">🎲 Suggest something</button>
      <div id="w-picks"></div>
      ${aiReady() ? `<button class="btn ghost block" id="w-ai">✨ Fresh ideas from ${aiName()} for ${withIds.length > 1 ? 'us' : 'me'}</button><div id="w-ideas"></div>` : ''}
    </div>
    <div class="row"><div class="tabs grow wtabs"><a href="#" data-t="want" class="${tab === 'want' ? 'on' : ''}">To watch <small>${counts.want}</small></a><a href="#" data-t="watched" class="${tab === 'watched' ? 'on' : ''}">Watched <small>${counts.watched}</small></a></div></div>
    <input type="search" id="w-q" placeholder="Search the list, people, genres…">
    <div id="w-list"></div>
    <button class="fab" id="w-add" aria-label="Add a movie or show">＋</button>`;

  const drawList = () => {
    const qq = $('#w-q').value.toLowerCase();
    const list = items().filter(w => (tab === 'watched') === (w.status === 'watched'))
      .filter(w => !qq || `${w.title} ${(w.genres || []).join(' ')} ${w.wantedBy.map(nameOf).join(' ')} ${w.notes || ''} ${w.platform || ''}`.toLowerCase().includes(qq))
      .sort((a, b) => tab === 'watched' ? (b.watchedOn || '').localeCompare(a.watchedOn || '') : (b.wantedBy.length - a.wantedBy.length) || (b.createdAt || 0) - (a.createdAt || 0));
    $('#w-list').innerHTML = list.map(card).join('') || `<div class="empty">${all.length ? 'Nothing here.' : 'Nothing on the list yet. Tap ＋ to add a movie or show. Anything people mention in your notes (“Meera wants to watch Past Lives”) gets added automatically.'}</div>`;
    $$('[data-wid]', view).forEach(b => b.onclick = () => detail(b.dataset.wid, rerender));
  };
  const rerender = () => watchPage(view);
  const showPicks = picks => {
    lastPicks = picks;
    $('#w-picks').innerHTML = picks.length ? `<div class="wpicks">${picks.map(({ w, why }) => `
      <div class="wsug">${poster(w, 'wsug-p')}<div class="grow"><b>${esc(w.title)}</b>
        <div class="small muted">${[KIND[w.kind], w.year, fmtRun(w.runtime), (w.genres || []).slice(0, 2).join(', ')].filter(Boolean).map(esc).join(' · ')}</div>
        ${why.map(x => `<div class="small">${esc(x)}</div>`).join('')}
        <div class="row wrap"><button class="btn small" data-seen="${w.id}">✓ We watched it</button><button class="btn small ghost" data-wid="${w.id}">Details</button></div></div></div>`).join('')}</div>
      <button class="btn ghost block" id="w-again">🔄 Shuffle again</button>`
      : `<p class="small muted center">${items().some(w => w.status !== 'watched') ? 'Nothing fits those filters — try “Any”.' : 'Add a few titles first.'}</p>`;
    $('#w-again')?.addEventListener('click', run);
    $$('#w-picks [data-seen]').forEach(b => b.onclick = () => markWatched(get('watch', b.dataset.seen), withIds, rerender));
    $$('#w-picks [data-wid]').forEach(b => b.onclick = () => detail(b.dataset.wid, rerender));
  };
  const run = () => showPicks(suggest({ withIds, kind: kindF, mood: moodF }));

  $$('[data-w]', view).forEach(b => b.onclick = () => {
    const id = b.dataset.w;
    withIds = withIds.includes(id) ? withIds.filter(x => x !== id) : [...withIds, id];
    if (!withIds.length) withIds = [ME];
    lastPicks = null; watchPage(view);
  });
  $('#w-more')?.addEventListener('click', () => {
    const s = openSheet(`<h3>Who else is watching?</h3><div class="chips">${people.filter(p => !peopleChips.includes(p.id)).map(p => `<button class="chip" data-p="${p.id}">${esc(p.name)}</button>`).join('')}</div>`);
    $$('[data-p]', s.el).forEach(b => b.onclick = () => { withIds.push(b.dataset.p); s.close(); watchPage(view); });
  });
  $$('[data-k]', view).forEach(b => b.onclick = () => { kindF = b.dataset.k; lastPicks = null; watchPage(view); });
  $('#w-mood')?.addEventListener('change', e => { moodF = e.target.value; lastPicks = null; run(); });
  $('#w-go').onclick = run;
  if (lastPicks) showPicks(lastPicks.map(p => ({ ...p, w: get('watch', p.w.id) })).filter(p => p.w && p.w.status !== 'watched'));
  $('#w-ai')?.addEventListener('click', () => aiIdeas());
  $$('[data-t]', view).forEach(a => a.onclick = e => { e.preventDefault(); tab = a.dataset.t; watchPage(view); });
  $('#w-q').oninput = drawList;
  $('#w-add').onclick = () => addTitle({ wantedBy: withIds.length > 1 ? withIds : [ME] }, rerender);
  drawList();
}

const poster = (w, cls = 'wposter') => (w.poster ? `<img class="${cls}" src="${esc(w.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="${cls} none">${w.kind === 'show' ? '📺' : '🎬'}</span>`);
const card = w => `<button class="card wcard" data-wid="${w.id}">${poster(w)}
  <span class="grow"><b>${esc(w.title)}</b>
    <span class="small muted">${[KIND[w.kind], w.year, fmtRun(w.runtime), (w.genres || []).slice(0, 2).join(', ')].filter(Boolean).map(esc).join(' · ')}</span>
    ${w.status === 'watched'
      ? `<span class="small">✓ Watched ${w.watchedOn ? fmtDate(w.watchedOn) : ''}${(w.watchedBy || []).filter(id => id !== ME).length ? ' with ' + esc(listJoin(w.watchedBy.filter(id => id !== ME).map(firstOf))) : ''}${w.rating ? ' · ' + '★'.repeat(w.rating) : ''}</span>`
      : `<span class="small">${w.wantedBy.length ? '💛 ' + esc(listJoin(w.wantedBy.map(firstOf))) : ''}${w.platform ? ` · 📡 ${esc(w.platform)}` : ''}</span>`}
  </span></button>`;

/* ---------- add ---------- */
export function addTitle(preset = {}, done) {
  const people = live('people').sort((a, b) => a.name.localeCompare(b.name));
  let pick = null, wanted = new Set(preset.wantedBy || [ME]), timer;
  const s = openSheet(`<h3>Add a movie or show</h3>
    <input id="wa-q" placeholder="Title, e.g. Past Lives" value="${esc(preset.title || '')}" autocomplete="off">
    <div id="wa-res" class="wa-res"></div>
    <div class="small muted">Who wants to watch it?</div>
    <div class="chips" id="wa-who">${[ME, ...people.map(p => p.id)].map(id => `<button class="chip ${wanted.has(id) ? 'on' : ''}" data-who="${id}">${id === ME ? '🙋 Me' : esc(nameOf(id))}</button>`).join('')}</div>
    <label>Where to watch <small>(optional)</small><input id="wa-plat" placeholder="Netflix, Prime, cinema…" list="wa-plats"></label>
    <datalist id="wa-plats">${['Netflix', 'Prime Video', 'Disney+ Hotstar', 'JioCinema', 'Apple TV+', 'YouTube', 'Cinema'].map(p => `<option>${p}</option>`).join('')}</datalist>
    <label>Note <small>(optional)</small><input id="wa-note" placeholder="Meera says the ending is wild"></label>
    <button class="btn primary block" id="wa-save" disabled>Add to watchlist</button>`);
  const q = $('#wa-q', s.el), res = $('#wa-res', s.el), save = $('#wa-save', s.el);
  const draw = list => {
    const typed = q.value.trim();
    res.innerHTML = list.map((r, i) => `<button class="wa-r ${pick === r ? 'on' : ''}" data-r="${i}">${poster(r, 'wa-p')}<span><b>${esc(r.title)}</b><small>${[KIND[r.kind], r.year, r.genres.slice(0, 2).join(', ')].filter(Boolean).map(esc).join(' · ')}</small></span></button>`).join('')
      + (typed ? `<button class="wa-r ${pick && pick.typed ? 'on' : ''}" data-typed="1"><span class="wa-p none">✏️</span><span><b>Just add “${esc(typed)}”</b><small>without details</small></span></button>` : '');
    $$('[data-r]', res).forEach(b => b.onclick = () => { pick = list[+b.dataset.r]; save.disabled = false; draw(list); });
    $('[data-typed]', res)?.addEventListener('click', () => { pick = { typed: true, title: typed }; save.disabled = false; draw(list); });
  };
  const lookup = async () => {
    const t = q.value.trim(); pick = null; save.disabled = !t;
    if (t.length < 2) { draw([]); return; }
    res.innerHTML = '<p class="small muted">Searching…</p>';
    const list = await searchTitles(t);
    if (q.value.trim() !== t) return;
    if (!pick) pick = list[0] || { typed: true, title: t };
    save.disabled = false; draw(list);
  };
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(lookup, 450); };
  $$('[data-who]', s.el).forEach(b => b.onclick = () => { const id = b.dataset.who; wanted.has(id) ? wanted.delete(id) : wanted.add(id); b.classList.toggle('on'); });
  save.onclick = () => {
    if (!pick) return;
    const title = pick.typed ? pick.title : pick.title;
    const m = findMatch({ title, category: 'movie_tv' }, items().map(w => ({ ...w, category: 'movie_tv' })));
    const ex = m && m.level === 'same' ? get('watch', m.fact.id) : null;
    if (ex) {
      upsert('watch', { ...ex, wantedBy: [...new Set([...ex.wantedBy, ...wanted])], status: 'want' });
      toast(`Already on the list — added ${[...wanted].map(firstOf).join(', ')}`);
    } else {
      const w = upsert('watch', { title, ...(pick.typed ? { kind: '' } : meta(pick)), metaChecked: !pick.typed, wantedBy: [...wanted], status: 'want',
        platform: $('#wa-plat', s.el).value.trim(), notes: $('#wa-note', s.el).value.trim() });
      if (pick.typed) enrich(w);
      toast(`Added ${title}`);
    }
    s.close(); done?.();
  };
  setTimeout(() => q.focus(), 50);
  if (preset.title) lookup();
}

/* ---------- detail ---------- */
function detail(id, done) {
  const w = get('watch', id);
  if (!w) return;
  const people = live('people').sort((a, b) => a.name.localeCompare(b.name));
  const s = openSheet(`
    <div class="wdet">${poster(w, 'wdet-p')}<div><h2>${esc(w.title)}</h2>
      <div class="small muted">${[KIND[w.kind], w.year, fmtRun(w.runtime), w.network].filter(Boolean).map(esc).join(' · ')}</div>
      ${(w.genres || []).length ? `<div class="chips">${w.genres.map(g => `<span class="chip">${esc(g)}</span>`).join('')}</div>` : ''}</div></div>
    ${w.summary ? `<p class="small">${esc(w.summary)}</p>` : ''}
    ${w.notes ? `<p class="small">📝 ${esc(w.notes)}</p>` : ''}
    <div class="small muted">Wants to watch it</div>
    <div class="chips" id="wd-who">${[ME, ...people.map(p => p.id)].map(pid => `<button class="chip ${w.wantedBy.includes(pid) ? 'on' : ''}" data-who="${pid}">${pid === ME ? '🙋 Me' : esc(nameOf(pid))}</button>`).join('')}</div>
    <label>Where to watch<input id="wd-plat" value="${esc(w.platform || '')}" placeholder="Netflix, Prime…"></label>
    ${w.status === 'watched' ? `<p class="small">✓ Watched ${fmtDate(w.watchedOn)}${(w.watchedBy || []).length ? ' · ' + esc(listJoin(w.watchedBy.map(firstOf))) : ''}${w.rating ? ' · ' + '★'.repeat(w.rating) : ''}</p>` : ''}
    <div class="row wrap">
      ${w.status === 'watched' ? '<button class="btn" id="wd-unwatch">↩︎ Back to “to watch”</button>' : '<button class="btn primary" id="wd-seen">✓ Watched it</button>'}
      <a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(`where to watch ${w.title} ${w.year || ''}`)}">📡 Where to stream</a>
      ${w.link ? `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(w.link)}">ℹ️ More</a>` : ''}
    </div>
    <div class="row wrap"><button class="btn ghost" id="wd-fix">🔎 Fix details</button><span class="grow"></span><button class="btn danger" id="wd-del">🗑</button></div>`,
  { onClose: () => done?.() });
  const save = patch => { Object.assign(w, patch); upsert('watch', w); };
  $$('[data-who]', s.el).forEach(b => b.onclick = () => {
    const pid = b.dataset.who;
    save({ wantedBy: w.wantedBy.includes(pid) ? w.wantedBy.filter(x => x !== pid) : [...w.wantedBy, pid] });
    b.classList.toggle('on');
  });
  $('#wd-plat', s.el).onchange = e => save({ platform: e.target.value.trim() });
  $('#wd-seen', s.el)?.addEventListener('click', () => { s.close(); markWatched(w, withIds, done); });
  $('#wd-unwatch', s.el)?.addEventListener('click', () => { save({ status: 'want', watchedOn: null }); markFactsDone(w, false); s.close(); });
  $('#wd-del', s.el).onclick = async () => { if (await confirmDlg(`Remove “${w.title}” from the watchlist?`, 'Remove')) { remove('watch', w.id); s.close(); } };
  $('#wd-fix', s.el).onclick = async () => {
    const list = await searchTitles(w.title);
    const f = openSheet(`<h3>Which one is it?</h3><div class="wa-res">${list.map((r, i) => `<button class="wa-r" data-r="${i}">${poster(r, 'wa-p')}<span><b>${esc(r.title)}</b><small>${[KIND[r.kind], r.year, r.genres.slice(0, 2).join(', ')].filter(Boolean).map(esc).join(' · ')}</small></span></button>`).join('') || '<p class="muted">No matches found.</p>'}</div>`);
    $$('[data-r]', f.el).forEach(b => b.onclick = () => { save({ ...meta(list[+b.dataset.r]), metaChecked: true }); f.close(); s.close(); toast('Details updated'); });
  };
}

function markWatched(w, present, done) {
  const people = live('people').sort((a, b) => a.name.localeCompare(b.name));
  const sel = new Set(present.length ? present : [ME]);
  let rating = 0;
  const s = openSheet(`<h3>✓ Watched “${esc(w.title)}”</h3>
    <div class="small muted">Who watched?</div>
    <div class="chips">${[ME, ...people.map(p => p.id)].map(id => `<button class="chip ${sel.has(id) ? 'on' : ''}" data-who="${id}">${id === ME ? '🙋 Me' : esc(nameOf(id))}</button>`).join('')}</div>
    <label>When<input type="date" id="ww-d" value="${today()}"></label>
    <div><small class="muted">How was it?</small><div class="rate" id="ww-r">${[1, 2, 3, 4, 5].map(n => `<button data-r="${n}">★</button>`).join('')}</div></div>
    <button class="btn primary block" id="ww-ok">Save</button>`);
  $$('[data-who]', s.el).forEach(b => b.onclick = () => { const id = b.dataset.who; sel.has(id) ? sel.delete(id) : sel.add(id); b.classList.toggle('on'); });
  $$('#ww-r button', s.el).forEach(b => b.onclick = () => { rating = +b.dataset.r === rating ? 0 : +b.dataset.r; $$('#ww-r button', s.el).forEach(x => x.classList.toggle('on', +x.dataset.r <= rating)); });
  $('#ww-ok', s.el).onclick = () => {
    const watchedBy = [...new Set([...(w.watchedBy || []), ...sel])];
    // done for everyone who wanted it and was there? then it's off the list; otherwise it stays for the others
    const left = w.wantedBy.filter(id => !watchedBy.includes(id));
    upsert('watch', { ...w, watchedBy, watchedOn: $('#ww-d', s.el).value || today(), rating: rating || w.rating || 0, status: left.length ? 'want' : 'watched' });
    if (!left.length) markFactsDone(w, true);
    toast(left.length ? `Saved — still on the list for ${listJoin(left.map(firstOf))}` : 'Marked as watched 🍿');
    s.close(); done?.();
  };
}

/* ---------- optional: AI ideas beyond the list ---------- */
async function aiIdeas() {
  const box = $('#w-ideas'); box.innerHTML = '<div class="spinner"></div>';
  const present = withIds;
  const tastes = present.map(id => {
    const wants = items().filter(w => w.wantedBy.includes(id)).map(w => w.title);
    const seen = items().filter(w => (w.watchedBy || []).includes(id)).map(w => `${w.title}${w.rating ? ` (${w.rating}/5)` : ''}`);
    const facts = id === ME ? [] : live('facts').filter(f => f.personId === id && ['movie_tv', 'dislike', 'book', 'music'].includes(f.category)).map(f => `${f.category}: ${f.title}`);
    return `${nameOf(id)} — wants: ${wants.join('; ') || 'none'}; watched: ${seen.join('; ') || 'none'}; ${facts.join('; ')}`;
  }).join('\n');
  try {
    const txt = await ask({ tier: 'smart', maxTokens: 2000,
      system: 'Suggest movies or shows for a group to watch together. Respect dislikes. Prefer things none of them have watched and that are not already on their lists. Return ONLY JSON: {"ideas":[{"title":"","kind":"movie|show","year":"","why":"one line on why it suits this group"}]} with 5 ideas.',
      content: `Watching together:\n${tastes}\n${kindF ? `Type: ${kindF}\n` : ''}${moodF ? `Mood: ${moodF}\n` : ''}` });
    const ideas = parseJson(txt)?.ideas || [];
    box.innerHTML = ideas.map((x, i) => `<div class="idea"><b>${esc(x.title)}</b> <small class="muted">${esc([KIND[x.kind], x.year].filter(Boolean).join(' · '))}</small><p class="small">${esc(x.why || '')}</p><button class="btn small" data-add="${i}">＋ Add to list</button></div>`).join('') || '<p class="small muted">No ideas came back.</p>';
    $$('[data-add]', box).forEach(b => b.onclick = () => addTitle({ title: ideas[+b.dataset.add].title, wantedBy: present }, () => go('#/watch')));
  } catch (e) { box.innerHTML = `<p class="small warn">${esc(e.message)} — the suggestions above still work without AI.</p>`; }
}

// For the person page / home: what this person wants to watch.
export const wantsOf = pid => items().filter(w => w.status !== 'watched' && w.wantedBy.includes(pid));
