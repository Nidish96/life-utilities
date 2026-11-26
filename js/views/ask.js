// "Plan something": describe what you want to do; get options built from everything you've saved.
// Works offline (people's favourites, gift ideas, dislikes, watchlist, your home…); an AI key adds creative ideas.
import { live, get, cfg } from '../state.js';
import { $, $$, esc, setTitle, toast, daysUntil, fmtDate, shuffle, mapsLink, safeUrl, go } from '../ui.js';
import { aiReady, aiName, ask, parseJson } from '../ai.js';
import { suggest as suggestWatch } from './watch.js';
import { myHome, homeHouse } from './myhome.js';

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
const INTENT = {
  food: /\b(food|eat|eats|eating|lunch|dinner|breakfast|brunch|snacks?|treat|dessert|sweets?|cake|coffee|chai|hungry|takeaway|order in|biryani|pizza)\b/,
  gift: /\b(present|presents|gift|gifts|surprise|something small|token|flowers?)\b/,
  watch: /\b(movie|movies|film|films|watch|show|series|netflix|binge)\b/,
  outing: /\b(go out|outing|hang ?out|day out|date|walk|trip|visit|explore|somewhere|place)\b/,
  home: /\b(the house|my house|new house|our house|new place|my place|my home|the flat|new flat|apartment|housewarming|show (?:her|him|them) the (?:house|place))\b/,
  birthday: /\b(birthday|bday|b'day|anniversary)\b/,
};

// Who and what the request is about
export function understand(q) {
  const t = norm(q);
  const people = live('people').filter(p => [p.name, p.name.split(' ')[0], ...(p.aliases || [])].filter(n => n && n.length > 1).some(n => new RegExp(`\\b${norm(n).trim().replace(/\s+/g, '\\s+')}\\b`).test(t)));
  const intents = Object.keys(INTENT).filter(k => INTENT[k].test(t));
  const small = /\b(small|little|simple|cheap|quick|token)\b/.test(t);
  return { people, intents, small };
}

const pron = p => p ? p.name.split(' ')[0] : 'them';
const enr = f => f.enrichment || {};
const foodLink = (f, near) => (near?.lat ? `https://www.google.com/maps/search/${encodeURIComponent(f.title)}/@${near.lat},${near.lng},14z` : mapsLink({ q: `${f.title} ${cfg('homeCity') || ''}` }));

// Options built only from saved data
function offlinePlans(q) {
  const { people, intents, small } = understand(q);
  const p = people[0];
  const facts = p ? live('facts').filter(f => f.personId === p.id && !f.done) : [];
  const home = homeHouse(), m = myHome();
  const wantFood = intents.includes('food'), wantGift = intents.includes('gift') || intents.includes('birthday'), wantWatch = intents.includes('watch'), wantHome = intents.includes('home');
  const wantOut = intents.includes('outing') || (!wantFood && !wantGift && !wantWatch && !wantHome);
  const foods = facts.filter(f => f.category === 'food');
  const gifts = facts.filter(f => ['gift_idea', 'fashion', 'book', 'hobby'].includes(f.category)).sort((a, b) => (a.category === 'gift_idea' ? 0 : 1) - (b.category === 'gift_idea' ? 0 : 1));
  const places = facts.filter(f => ['place', 'activity'].includes(f.category));
  const avoid = p ? live('facts').filter(f => f.personId === p.id && f.category === 'dislike') : [];
  const notes = [];
  if (p) { const d = daysUntil(p.birthday); if (d !== null && d <= 30) notes.push(`🎂 ${pron(p)}'s birthday is ${d === 0 ? 'today!' : `in ${d} days`} (${fmtDate('--' + p.birthday.slice(-5))})`); }
  if (avoid.length) notes.push(`🚫 Avoid: ${avoid.map(f => f.title).join(', ')}`);
  if (!p && live('people').length) notes.push(`Tip: mention someone by name (e.g. ${live('people').slice(0, 2).map(x => x.name.split(' ')[0]).join(', ')}) to use what you know about them.`);

  const plans = [];
  const fs = shuffle(foods), gs = shuffle(gifts), ps = shuffle(places);
  const watch = wantWatch ? suggestWatch({ withIds: p ? ['me', p.id] : ['me'], count: 3 }) : [];
  const n = Math.max(1, Math.min(3, Math.max(wantFood ? fs.length : 1, wantGift ? gs.length : 1, wantWatch ? watch.length : 1, wantOut ? ps.length : 1)));
  for (let i = 0; i < n; i++) {
    const steps = [];
    if (wantFood) {
      const f = fs[i % (fs.length || 1)];
      if (f) {
        const sug = enr(f).suggestions?.filter(x => x.name)[i % Math.max(1, enr(f).suggestions?.length || 1)];
        steps.push({ icon: '🍜', text: `Pick up ${f.title}${sug ? ` from ${sug.name}` : ''}`, why: f.detail || `${pron(p)} loves it`, link: sug?.address ? mapsLink({ q: `${sug.name} ${sug.address}` }) : foodLink(f, home), linkText: sug?.address ? sug.address : home ? 'Find it near your home' : 'Find nearby', img: enr(f).image });
      } else steps.push({ icon: '🍜', text: p ? `Get food — you haven't saved ${pron(p)}'s favourites yet` : 'Get some food on the way', why: p ? 'Add what they like via ＋ next time it comes up' : '', link: home ? `https://www.google.com/maps/search/food/@${home.lat},${home.lng},15z` : null, linkText: home ? 'Food near your home' : '' });
    }
    if (wantGift) {
      const g = gs[i % (gs.length || 1)];
      if (g) steps.push({ icon: '🎁', text: `${small && g.category !== 'gift_idea' ? 'Something small around ' : 'Get '}${g.title}`, why: g.detail || 'From what they mentioned', link: g.enrichment?.links?.find(l => safeUrl(l.url))?.url || `https://www.google.com/search?q=${encodeURIComponent(g.title + ' buy')}`, linkText: 'Where to buy', img: enr(g).image });
      else steps.push({ icon: '🎁', text: small ? 'A small present — flowers, a plant or a favourite snack' : 'A present', why: p ? `No gift ideas saved for ${pron(p)} yet` : '' });
    }
    if (wantWatch && watch[i % (watch.length || 1)]) { const w = watch[i % watch.length].w; steps.push({ icon: '🍿', text: `Watch ${w.title}`, why: watch[i % watch.length].why.join(' · '), img: w.poster }); }
    if (wantOut && ps.length) { const pl = ps[i % ps.length]; steps.push({ icon: '📍', text: `Go to ${pl.title}`, why: pl.detail || '', link: enr(pl).place?.lat ? mapsLink(enr(pl).place) : mapsLink({ q: pl.title }), linkText: 'Map', img: enr(pl).image }); }
    if (wantHome) steps.push(home ? { icon: '🏡', text: `Head to your home — ${home.title}`, why: [home.locality, m?.movedIn && (daysUntilDate(m.movedIn) > 0 ? `you move in ${fmtDate(m.movedIn)}` : '')].filter(Boolean).join(' · '), link: home.lat ? `https://www.google.com/maps/dir/?api=1&destination=${home.lat},${home.lng}` : mapsLink({ q: home.address }), linkText: 'Directions' }
      : { icon: '🏡', text: 'Head to the house', why: 'Tip: mark your finalised house as “My home” to get directions here' });
    if (steps.length) plans.push({ title: `Option ${i + 1}`, steps });
  }
  return { plans, notes, people, intents };
}
const daysUntilDate = s => Math.round((new Date(s + 'T00:00') - new Date(new Date().toDateString())) / 864e5);

// Everything relevant, compact, for the AI
function contextFor(q) {
  const { people } = understand(q);
  const home = homeHouse(), m = myHome();
  const who = (people.length ? people : []).map(p => {
    const fs = live('facts').filter(f => f.personId === p.id);
    const by = {};
    for (const f of fs) (by[f.category] ??= []).push([f.title, f.detail, f.done ? '(done)' : '', ...(enr(f).suggestions || []).slice(0, 2).map(s => `try: ${s.name}${s.address ? ` @ ${s.address}` : ''}`)].filter(Boolean).join(' — '));
    return { name: p.name, relation: p.relation, birthday: p.birthday, daysToBirthday: daysUntil(p.birthday), notes: p.notes, likes: by,
      memories: live('memories').filter(x => x.personIds?.includes(p.id)).slice(-5).map(x => `${x.date}: ${x.title}`),
      wantsToWatch: live('watch').filter(w => w.status !== 'watched' && w.wantedBy.includes(p.id)).map(w => w.title) };
  });
  return {
    today: new Date().toISOString().slice(0, 10), homeCity: cfg('homeCity') || null, currency: cfg('currency'),
    myHome: home ? { name: home.title, address: home.address, locality: home.locality, lat: home.lat, lng: home.lng, movingInOn: m?.movedIn } : null,
    myLandmarks: live('landmarks').map(l => `${l.name}${l.note ? ` (${l.note})` : ''}`),
    peopleMentioned: who,
    otherPeopleIKnow: people.length ? undefined : live('people').map(p => `${p.name}${p.relation ? ` (${p.relation})` : ''}`).slice(0, 40),
    myWatchlist: live('watch').filter(w => w.status !== 'watched' && w.wantedBy.includes('me')).map(w => w.title).slice(0, 20),
  };
}
async function aiPlans(q, web) {
  const txt = await ask({ tier: 'smart', maxTokens: 3000, web, webUses: 4,
    system: `You are a thoughtful friend helping the user plan something. Use the saved context about the people involved, their likes, dislikes, and the user's home and city. Respect dislikes and allergies strictly. Be specific: name actual dishes, gifts and places from the context first; when you suggest something not in the context, say why it fits${web ? ' and use web search to name real, currently open places near the user\'s home or city' : ''}. Keep it practical (order of steps, timing, rough cost in ${cfg('currency')}).
Return ONLY JSON: {"plans":[{"title":"short name","steps":[{"icon":"one emoji","text":"what to do","why":"why it fits them","link":"url or empty"}],"tip":"optional one line"}],"notes":["optional reminders, e.g. birthday soon, things to avoid"]} with 3 distinct plans.`,
    content: `What I want to do: ${q}\n\nSaved context (JSON):\n${JSON.stringify(contextFor(q)).slice(0, 12000)}` });
  const j = parseJson(txt);
  if (!j?.plans?.length) throw new Error('No ideas came back');
  return j;
}

/* ---------- page ---------- */
let lastQ = '', lastOut = null, lastAi = null;
export function askPage(view, q = {}) {
  setTitle('Plan something', true);
  if (q.q && q.q !== lastQ) { lastQ = q.q; lastOut = null; lastAi = null; }
  view.innerHTML = `
    <div class="card"><form id="ak-f"><label>What do you want to do?<textarea id="ak-q" rows="3" placeholder="e.g. I want to take Varshu to the house but get her some food and a small present">${esc(lastQ)}</textarea></label>
      <div class="row wrap"><button class="btn primary grow" type="submit">✨ Give me options</button>${aiReady() ? `<button class="btn grow" type="button" id="ak-ai">🧠 Ask ${aiName()}</button>` : ''}</div>
      ${aiReady() ? '<label class="check small"><input type="checkbox" id="ak-web"> Let the AI look up current places online</label>' : ''}</form></div>
    <div id="ak-out"></div>`;
  const out = $('#ak-out');
  const render = (res, aiRes, aiErr) => {
    const u = understand(lastQ);
    out.innerHTML = `
      ${u.people.length || u.intents.length ? `<div class="chips ak-got">${u.people.map(p => `<a class="chip" href="#/p/${p.id}">👤 ${esc(p.name)}</a>`).join('')}${u.intents.map(i => `<span class="chip">${{ food: '🍜 food', gift: '🎁 present', watch: '🍿 watch', outing: '📍 outing', home: '🏡 home', birthday: '🎂 birthday' }[i]}</span>`).join('')}</div>` : ''}
      ${(aiRes?.notes?.length ? aiRes.notes : res.notes).map(n => `<div class="card ak-note">${esc(n)}</div>`).join('')}
      ${aiErr ? `<p class="small warn">${esc(aiName())} didn't respond (${esc(aiErr.slice(0, 120))}) — here are options from your saved notes.</p>` : ''}
      ${(aiRes?.plans || res.plans).map((p, i) => planCard(p, i, !!aiRes)).join('') || '<div class="empty">Nothing to suggest yet. Try mentioning a person and what you want (food, a present, a movie, the house…).</div>'}
      <div class="row wrap"><button class="btn ghost grow" id="ak-again">🔄 Other options</button>${aiRes ? '<button class="btn ghost grow" id="ak-local">📒 From my notes only</button>' : ''}</div>`;
    $('#ak-again')?.addEventListener('click', () => aiRes ? runAi() : run());
    $('#ak-local')?.addEventListener('click', run);
    $$('[data-copy]', out).forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.closest('.plan').innerText.replace(/\n?📋 Copy\s*$/, '').trim()); toast('Copied'); } catch { toast('Could not copy'); } });
  };
  const run = () => { lastQ = $('#ak-q').value.trim(); if (!lastQ) return toast('Describe what you want to do'); lastOut = offlinePlans(lastQ); lastAi = null; render(lastOut); };
  const runAi = async () => {
    lastQ = $('#ak-q').value.trim(); if (!lastQ) return toast('Describe what you want to do');
    lastOut = offlinePlans(lastQ);
    out.innerHTML = `<div class="card"><div class="spinner"></div><p class="center small muted">Thinking with everything you've saved…</p></div>`;
    try { lastAi = await aiPlans(lastQ, $('#ak-web')?.checked); render(lastOut, lastAi); }
    catch (e) { lastAi = null; render(lastOut, null, e.message); }
  };
  $('#ak-f').onsubmit = e => { e.preventDefault(); run(); };
  $('#ak-ai')?.addEventListener('click', runAi);
  if (lastOut) render(lastOut, lastAi); else if (lastQ) run();
}

function planCard(p, i, ai) {
  return `<div class="card plan" style="animation-delay:${i * 0.07}s"><div class="row"><b class="grow">${esc(p.title || `Option ${i + 1}`)}</b>${ai ? '<small class="muted">🧠</small>' : ''}</div>
    ${(p.steps || []).map(s => `<div class="pstep">${s.img ? `<img src="${esc(s.img)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : `<span class="pstep-e">${esc(s.icon || '•')}</span>`}
      <div class="grow"><div>${esc(s.text || '')}</div>${s.why ? `<small class="muted">${esc(s.why)}</small>` : ''}${safeUrl(s.link) ? `<div><a class="small" target="_blank" rel="noopener" href="${esc(s.link)}">${esc(s.linkText || 'Open link')} ↗</a></div>` : ''}</div></div>`).join('')}
    ${p.tip ? `<p class="small">💡 ${esc(p.tip)}</p>` : ''}
    <div class="row"><span class="grow"></span><button class="btn small ghost" data-copy>📋 Copy</button></div></div>`;
}

// small card for Home
export function askCard() {
  return `<form class="card ask-card" id="ask-home"><b>✨ Plan something</b>
    <div class="row"><input id="ask-home-q" class="grow" placeholder="Take Varshu to the house with food & a small present…" autocomplete="off"><button class="btn primary" type="submit">Go</button></div></form>`;
}
export function bindAskCard(root) {
  const f = $('#ask-home', root); if (!f) return;
  f.onsubmit = e => { e.preventDefault(); const q = $('#ask-home-q', root).value.trim(); go(q ? `#/ask?q=${encodeURIComponent(q)}` : '#/ask'); };
}
