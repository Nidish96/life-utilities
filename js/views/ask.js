// "Plan something": describe what you want to do; get a detailed, reasoned plan built from everything you've saved.
// Offline planner: understands people (incl. nicknames), goals, timing and budget, orders the stops sensibly,
// and explains every choice. With an AI key, the same context produces a long, written plan you can refine.
import { live, cfg } from '../state.js';
import { $, $$, esc, setTitle, toast, daysUntil, fmtDate, fmtMoney, safeUrl, md, go } from '../ui.js';
import { aiReady, aiName, ask } from '../ai.js';
import { suggest as suggestWatch } from './watch.js';
import { myHome, homeHouse } from './myhome.js';
import { inspectionFor } from './inspect.js';

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9₹\s]/g, ' ');
const INTENT = {
  food: /\b(food|eat|eats|eating|lunch|dinner|breakfast|brunch|snacks?|treat|dessert|sweets?|cake|coffee|chai|hungry|takeaway|order in|meal|biryani|pizza)\b/,
  gift: /\b(present|presents|gift|gifts|surprise|something small|token|flowers?)\b/,
  watch: /\b(movie|movies|film|films|watch|show|series|netflix|binge)\b/,
  outing: /\b(go out|outing|hang ?out|day out|date|walk|trip|explore|somewhere)\b/,
  home: /\b(the house|my house|new house|our house|new place|my place|my home|the flat|new flat|apartment|housewarming|the place)\b/,
  birthday: /\b(birthday|bday|b'day|anniversary)\b/,
};
const WHEN = [
  [/\b(tonight|this evening|evening|after work)\b/, 'evening', 18 * 60],
  [/\b(this afternoon|afternoon|after lunch)\b/, 'afternoon', 14 * 60],
  [/\b(this morning|morning|breakfast)\b/, 'morning', 10 * 60],
  [/\b(night|late)\b/, 'night', 20 * 60],
];

// Who, what, when and how much
export function understand(q) {
  const t = norm(q);
  const people = live('people').filter(p => [p.name, p.name.split(' ')[0], ...(p.aliases || [])].filter(n => n && n.length > 1)
    .some(n => new RegExp(`\\b${norm(n).trim().replace(/\s+/g, '\\s+')}\\b`).test(t)));
  const intents = Object.keys(INTENT).filter(k => INTENT[k].test(t));
  const small = /\b(small|little|simple|cheap|quick|token|nothing big|modest)\b/.test(t);
  const budget = +((t.match(/(?:₹|rs\.?\s?|inr\s?|under\s|below\s|within\s)(\d[\d,]{2,})/) || [])[1] || '').replace(/,/g, '') || null;
  const hours = +((t.match(/\b(\d+(?:\.\d)?)\s*(?:hours?|hrs?)\b/) || [])[1]) || null;
  const day = /\btomorrow\b/.test(t) ? 'tomorrow' : /\b(weekend|saturday|sunday)\b/.test(t) ? 'the weekend' : /\b(today|tonight|now|this)\b/.test(t) ? 'today' : null;
  const w = WHEN.find(([re]) => re.test(t));
  return { people, intents, small, budget, hours, day, part: w?.[1] || null, start: w?.[2] ?? null, veg: /\b(veg|vegetarian|vegan|jain)\b/.test(t) };
}

/* ---------- helpers ---------- */
const first = p => (p ? p.name.split(' ')[0] : 'them');
const enr = f => f.enrichment || {};
const hhmm = m => { m = ((m % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const near = (what, place) => `https://www.google.com/maps/search/${encodeURIComponent(`${what} near ${place}`)}`;
const listJoin = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const quote = f => (f.detail && norm(f.detail).trim() !== norm(f.title).trim() ? `“${f.detail.replace(/\.$/, '')}”` : '');
// "Varshini is craving biryani" stays as is; anything else becomes: Varshini said “…”
function said(f, p) {
  const d = (f.detail || '').trim().replace(/\.$/, '');
  if (!d || norm(d).trim() === norm(f.title).trim()) return '';
  const names = p ? [p.name, p.name.split(' ')[0], ...(p.aliases || [])].map(n => n.toLowerCase()) : [];
  if (names.some(n => d.toLowerCase().startsWith(n + ' ') || d.toLowerCase().startsWith(n + "'"))) return d;
  return `${first(p)} said “${d}”`;
}
const cleanInterest = t => t.replace(/\s+(songs?|music|movies?|films?|books?|shows?)$/i, '');
const ago = ts => { const d = Math.round((Date.now() - ts) / 864e5); return d < 2 ? 'recently' : d < 31 ? `${d} days ago` : `${Math.round(d / 30)} months ago`; };
const SMALL_GIFTS = ['a scented candle', 'a small potted plant', 'a box of good chocolates', 'a bunch of flowers', 'a nice mug', 'a framed photo of you two'];
// Gift ideas from interests when no explicit gift idea is saved
// → { title, search } or null
function giftFromInterest(f) {
  const t = cleanInterest(f.title), lt = t.toLowerCase();
  return ({
    book: { title: `the book “${t}” (or another by the same author)`, search: `${t} book` },
    music: { title: `something ${t}-themed — a vinyl, poster or merch`, search: `${t} merch` },
    hobby: { title: `a small accessory or starter kit for ${lt}`, search: `${lt} supplies shop` },
    activity: { title: `a voucher for a ${lt} session`, search: `${lt} classes` },
    fashion: { title: t, search: t },
    long_held_desire: { title: `something that nudges them towards “${t}”`, search: t },
  })[f.category] || null;
}

/* ---------- the offline planner ---------- */
export function buildPlan(q) {
  const u = understand(q);
  const p = u.people[0], others = u.people.slice(1);
  const pf = p ? live('facts').filter(f => f.personId === p.id) : [];
  const open = pf.filter(f => !f.done).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const avoid = pf.filter(f => f.category === 'dislike');
  const home = homeHouse(), mh = myHome(), insp = home && inspectionFor(home.id);
  const city = cfg('homeCity') || '';
  const goingHome = u.intents.includes('home');
  const destName = goingHome ? (home ? home.locality || home.title : 'the house') : (city || 'your area');
  const area = goingHome && home ? (home.locality || home.address || city) : city || 'me';
  const wantFood = u.intents.includes('food'), wantGift = u.intents.includes('gift') || u.intents.includes('birthday'), wantWatch = u.intents.includes('watch');
  const wantOut = u.intents.includes('outing') || (!wantFood && !wantGift && !wantWatch && !goingHome);
  const missing = [];

  // candidates
  const craving = f => /crav|obsess|dying|lately|recent/i.test(f.detail || '') ? 0 : 1;
  const foods = open.filter(f => f.category === 'food').sort((a, b) => craving(a) - craving(b));
  const dislikeWords = avoid.map(f => f.title.toLowerCase());
  const gifts = [
    ...open.filter(f => f.category === 'gift_idea').map(f => ({ title: f.title, search: f.title, why: said(f, p) || `${first(p)} mentioned wanting it`, f, img: enr(f).image, direct: true })),
    ...open.filter(f => ['book', 'music', 'hobby', 'fashion', 'activity', 'long_held_desire'].includes(f.category)).map(f => { const g = giftFromInterest(f); return g && { ...g, why: `it ties into ${first(p)}'s love of ${cleanInterest(f.title)}${said(f, p) ? ` (${said(f, p)})` : ''}`, f, img: enr(f).image }; }).filter(Boolean),
  ];
  const places = open.filter(f => ['place', 'activity'].includes(f.category));
  const bothWatch = wantWatch || goingHome ? suggestWatch({ withIds: p ? ['me', p.id, ...others.map(o => o.id)] : ['me'], count: 3 }) : [];
  const music = open.filter(f => f.category === 'music');
  const mems = p ? live('memories').filter(m => m.personIds?.includes(p.id)).sort((a, b) => (b.date || '').localeCompare(a.date || '')) : [];
  const bday = p ? daysUntil(p.birthday) : null;
  if (p && wantFood && !foods.length) missing.push(`${first(p)}'s favourite foods`);
  if (p && wantGift && !gifts.length) missing.push(`gift ideas or hobbies for ${first(p)}`);
  if (goingHome && !home) missing.push('which house is yours (open your finalised house → 🏡 Make this my home)');
  if (!p && live('people').length) missing.push(`who it's for — mention them by name (e.g. ${live('people').slice(0, 2).map(x => first(x)).join(' or ')})`);
  if (!city) missing.push('your home city (Settings → About you) for better local searches');

  // timing
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  let start = u.start ?? (u.day === 'today' || !u.day ? Math.max(nowMin + 30, 17 * 60) : 17 * 60);
  start = Math.ceil(start / 15) * 15;
  const when = u.part ? `${u.day === 'tomorrow' ? 'tomorrow ' : u.day === 'the weekend' ? 'at the weekend in the ' : 'this '}${u.part}` : u.day ? (u.day === 'today' ? 'today' : u.day) : 'this evening';

  // the house right now
  const moveIn = mh?.movedIn ? Math.round((new Date(mh.movedIn + 'T00:00') - new Date(now.toDateString())) / 864e5) : null;
  const emptyHouse = goingHome && home && (moveIn === null || moveIn > 0);
  const pendingRepairs = (mh?.repairs || []).filter(r => r.status !== 'fixed');
  const rooms = insp?.rooms.map(r => r.name) || [];

  // build one plan from a choice of food / gift / place / watch
  const make = (title, k) => {
    const food = foods[k % (foods.length || 1)], gift = gifts[k % (gifts.length || 1)], place = places[k % (places.length || 1)];
    const watch = bothWatch[k % (bothWatch.length || 1)]?.w;
    const steps = [], why = [], touches = [];
    let t = start;
    const step = (mins, icon, head, body, links = [], img = null) => { steps.push({ time: hhmm(t), icon, head, body, links, img }); t += mins; };

    // 1. the present (shops first, so you're not carrying hot food around)
    if (wantGift) {
      const g = gift || { title: u.small ? SMALL_GIFTS[k % SMALL_GIFTS.length] : SMALL_GIFTS[(k + 2) % SMALL_GIFTS.length], why: p ? `you haven't saved gift ideas for ${first(p)} yet — this is a safe, thoughtful pick${goingHome ? ' for a new home' : ''}` : 'a safe, thoughtful pick' };
      const store = g.f && enr(g.f).links?.find(l => safeUrl(l.url));
      const size = u.small && gift?.f?.category === 'gift_idea' ? ' Keep it small — the simplest version of it is enough.' : u.budget ? ` Keep it under ${fmtMoney(u.budget)}.` : '';
      step(40, '🎁', `Pick up ${g.title}`, `${g.why[0].toUpperCase() + g.why.slice(1)}.${size} Shops close earlier than restaurants, so do this first.`,
        [{ t: `Where to get it near ${destName}`, u: near(g.search || (g.title.replace(/^(a|an|the) /i, '') + ' shop'), area) }, store && { t: store.title || 'Saved link', u: store.url }].filter(Boolean), g.img);
      why.push(gift ? `🎁 The present comes from something ${first(p)} actually said, which makes it personal even if it's small.` : `🎁 No saved gift idea, so it's a safe pick — note down what ${first(p)} mentions next time.`);
    }
    // 2. an outing spot if that's the goal
    if (wantOut && place) {
      step(90, '📍', `Go to ${place.title}`, `${quote(place) || `It's on ${first(p)}'s list.`} ${enr(place).summary || ''}`.trim(),
        [{ t: 'Directions', u: enr(place).place?.lat ? `https://www.google.com/maps/dir/?api=1&destination=${enr(place).place.lat},${enr(place).place.lng}` : near(place.title, city) }], enr(place).image);
    } else if (wantOut && !wantFood && !goingHome) {
      step(90, '📍', `Head out somewhere ${first(p)} would enjoy`, p ? `No saved places for ${first(p)} yet — a café, a park walk or a market in ${city || 'your area'} are easy wins.` : 'Pick a café, a park or a market nearby.', [{ t: `Things to do in ${city || 'your area'}`, u: `https://www.google.com/search?q=${encodeURIComponent('things to do in ' + (city || 'my area') + ' ' + when)}` }]);
    }
    // 3. food, picked up last and close to where you're going so it's hot
    if (wantFood) {
      const sugs = food ? (enr(food).suggestions || []).filter(s => s.name) : [];
      const sug = sugs[k % (sugs.length || 1)];
      const skip = dislikeWords.length ? ` Ask them to leave out ${listJoin(dislikeWords)} — ${first(p)} doesn't like it.` : '';
      if (food) {
        step(25, '🍜', `Pick up ${food.title}${sug ? ` from ${sug.name}` : ''}`, `${said(food, p) ? `${said(food, p)}. ` : `${first(p)} loves this. `}${goingHome ? `Order ahead and collect it on the way, close to ${destName}, so it's still hot when you arrive.` : 'Order ahead so there\'s no waiting.'}${sug?.price ? ` Around ${sug.price}.` : ''}${skip}${u.veg ? ' Go for the vegetarian version.' : ''}`,
          [sug?.address ? { t: `${sug.name} — ${sug.address}`, u: `https://www.google.com/maps/search/${encodeURIComponent(sug.name + ' ' + sug.address)}` } : null, { t: `“${food.title}” near ${destName}`, u: near(food.title, area) }, { t: 'Order on Swiggy / Zomato', u: `https://www.google.com/search?q=${encodeURIComponent(food.title + ' delivery ' + (area || ''))}` }].filter(Boolean), enr(food).image);
        why.push(`🍜 ${food.title}, because ${said(food, p) ? said(food, p).replace(new RegExp(`^${first(p)} said `), `${first(p)} told you `) : `it's one of ${first(p)}'s saved favourites`}${foods.length > 1 ? ` (other saved favourites: ${foods.filter(x => x !== food).slice(0, 3).map(x => x.title).join(', ')})` : ''}.`);
      } else {
        step(25, '🍜', 'Pick up dinner on the way', `${p ? `You haven't saved ${first(p)}'s food favourites, so go for a crowd-pleaser — biryani, rolls or a good dessert.` : 'Something easy to share works best.'}${skip}`, [{ t: `Top-rated food near ${destName}`, u: near('best food', area) }]);
      }
    }
    // 4. the destination
    if (goingHome) {
      const bits = [];
      if (rooms.length) bits.push(`Give ${first(p)} a little tour — ${listJoin(rooms.filter(r => !/meters/i.test(r)).slice(0, 5))}.`);
      if (gift?.direct && /candle|plant|flower|frame|lamp|art|poster|mug|cushion|diffuser/i.test(gift.title)) bits.push(`Find a spot for the ${gift.title.replace(/^(a|an|the) /i, '').toLowerCase()} together — it'll be the first thing in the new place.`);
      if (emptyHouse) bits.push(`You haven't moved in${moveIn > 0 ? ` (move-in is ${fmtDate(mh.movedIn)})` : ''}, so it's probably empty — eat picnic-style on the floor.`);
      step(90, '🏡', `Arrive at ${home ? home.title : 'the house'}`, bits.join(' ') || `Show ${first(p)} around and enjoy the food together.`,
        home?.lat ? [{ t: 'Directions', u: `https://www.google.com/maps/dir/?api=1&destination=${home.lat},${home.lng}` }] : [], null);
      why.push(home ? `🏡 Food last and close to ${home.locality || 'the house'} so it's hot when you get there; present first because shops close earlier.` : '🏡 Mark your finalised house as “My home” to get the exact address and directions in plans.');
    }
    // 5. a nice way to end it
    if (watch) touches.push(`🍿 End with ${watch.wantedBy.includes('me') ? 'a movie you both want to see' : `something from the watchlist`}: **${watch.title}**${watch.platform ? ` (${watch.platform})` : ''} — ${bothWatch[k % bothWatch.length].why.join('; ')}.`);
    if (music.length) touches.push(`🎵 Have ${music[k % music.length].title} playing when you walk in — it's on ${first(p)}'s list.`);
    if (mems[0]) touches.push(`📸 Bring up “${mems[0].title}”${mems[0].date ? ` from ${fmtDate(mems[0].date)}` : ''} — your last memory together.`);
    if (bday !== null && bday <= 30 && bday > 0) touches.push(`🎂 ${first(p)}'s birthday is in ${bday} days — ${wantGift ? 'keep today\'s present small and save the big one, or call this an early celebration' : 'a good chance for an early celebration'}.`);
    if (bday === 0) touches.push(`🎂 It's ${first(p)}'s birthday today — add a candle on the dessert!`);
    const total = t - start;
    return { title, steps, why, touches, span: `${hhmm(start)} – ${hhmm(t)} (about ${Math.round(total / 30) / 2} h)`, food, gift };
  };

  const plans = [make('Recommended plan', 0)];
  if (foods.length > 1 || gifts.length > 1 || places.length > 1 || bothWatch.length > 1) plans.push(make('Alternative', 1));
  if (foods.length > 2 || gifts.length > 2 || places.length > 2) plans.push(make('Another option', 2));

  // summary paragraph
  const main = plans[0];
  const parts = [];
  if (wantGift) parts.push(`pick up ${main.gift ? main.gift.title : 'a small present'}`);
  if (wantFood) parts.push(`grab ${main.food ? main.food.title : 'food'}${goingHome ? ' on the way' : ''}`);
  if (goingHome) parts.push(`take ${p ? first(p) : 'them'} to ${home ? `${home.title}${home.locality ? ` in ${home.locality}` : ''}` : 'the house'}`);
  const summary = p
    ? `Here's how I'd do it ${when}: ${listJoin(parts) || `spend time with ${first(p)}`}. ${main.why.length ? 'Each choice comes from what you\'ve saved about ' + first(p) + ' — the reasons are below.' : ''}`
    : `Here's a plan for ${when}${parts.length ? `: ${listJoin(parts)}` : ''}.`;

  // checklist
  const check = [];
  if (goingHome) {
    check.push('House keys', 'Phone charged — you may need the torch');
    if (emptyHouse) check.push('A mat or bedsheet to sit on, paper plates, napkins, water bottles, a bin bag');
    if (pendingRepairs.length) check.push(`Heads up on pending repairs: ${pendingRepairs.slice(0, 3).map(r => `${r.title}${r.where ? ` (${r.where})` : ''}`).join(', ')}`);
  }
  if (wantFood && dislikeWords.length) check.push(`Tell the restaurant: no ${listJoin(dislikeWords)}`);
  if (wantGift) check.push('Gift wrap or a small card');
  const notes = [];
  if (bday !== null && bday <= 30) notes.push(`🎂 ${first(p)}'s birthday is ${bday === 0 ? 'today!' : `in ${bday} days`} (${fmtDate('--' + p.birthday.slice(-5))})`);
  if (avoid.length) notes.push(`🚫 ${first(p)} doesn't like: ${avoid.map(f => f.title).join(', ')}`);
  return { u, summary, plans, check, missing, notes };
}

/* ---------- AI: a long, written plan ---------- */
function contextFor(q) {
  const { people } = understand(q);
  const home = homeHouse(), m = myHome(), insp = home && inspectionFor(home.id);
  const now = new Date();
  const who = people.map(p => {
    const fs = live('facts').filter(f => f.personId === p.id);
    const by = {};
    for (const f of fs) (by[f.category] ??= []).push([f.title, f.detail && f.detail !== f.title ? `(${f.detail})` : '', f.done ? '[already done/gifted]' : '', `saved ${ago(f.createdAt || Date.now())}`,
      ...(enr(f).suggestions || []).slice(0, 3).map(s => `place to try: ${s.name}${s.address ? `, ${s.address}` : ''}${s.price ? `, ${s.price}` : ''}`)].filter(Boolean).join(' '));
    return { name: p.name, nicknames: p.aliases, relation: p.relation, birthday: p.birthday, daysUntilBirthday: daysUntil(p.birthday), notes: p.notes, whatIKnow: by,
      recentMemoriesTogether: live('memories').filter(x => x.personIds?.includes(p.id)).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5).map(x => `${x.date}: ${x.title}${x.note ? ` — ${x.note}` : ''}`),
      moviesTheyWantToWatch: live('watch').filter(w => w.status !== 'watched' && w.wantedBy.includes(p.id)).map(w => `${w.title}${w.wantedBy.includes('me') ? ' (I want to see it too)' : ''}`) };
  });
  return {
    now: `${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
    myCity: cfg('homeCity') || null, currency: cfg('currency'),
    myHome: home ? { name: home.title, address: home.address, area: home.locality, coordinates: home.lat ? `${home.lat},${home.lng}` : null,
      moveInDate: m?.movedIn, movedInYet: m?.movedIn ? new Date(m.movedIn) <= now : false, rooms: insp?.rooms.map(r => r.name), pendingRepairs: (m?.repairs || []).filter(r => r.status !== 'fixed').map(r => `${r.title}${r.where ? ` (${r.where})` : ''}`) } : null,
    myLandmarks: live('landmarks').map(l => `${l.name}${l.note ? ` (${l.note})` : ''}`),
    peopleMentioned: who,
    otherPeopleIKnow: people.length ? undefined : live('people').map(p => `${p.name}${p.aliases?.length ? ` aka ${p.aliases.join('/')}` : ''}${p.relation ? ` (${p.relation})` : ''}`).slice(0, 50),
  };
}
const SYSTEM = () => `You are a brilliant, practical friend who plans outings and surprises. The user describes what they want to do; you get everything they've saved about the people involved, their home and their city. Write a detailed, genuinely useful plan — not generic advice.

Rules:
- Ground every choice in the saved context: quote or paraphrase what the person said ("she's been craving biryani lately") and say why it fits. Prefer things not already done/gifted. Strictly respect dislikes, allergies and dietary needs.
- Be concrete and local: name real, well-known places near the user's home area (or city) for food and shopping, with a Google Maps link for each in the form [Name](https://www.google.com/maps/search/?api=1&query=Name+Area+City). If you're not sure a place exists, say "e.g." and give a Maps search link instead.
- Think about logistics: order stops sensibly (shops before they close; hot food picked up last, close to the destination), travel time, opening hours for the day and time given, and whether the user has moved in (an empty flat needs a mat, plates, water).
- Use timing and budget hints from the request; if missing, assume this evening and a sensible budget, and say so.
- Add thoughtful personal touches from their memories, music, movies they both want to watch, birthdays coming up.

Format in Markdown, in this order:
## The plan (recommended) — one short paragraph on the idea and why it suits them.
### Timeline — a numbered list with times; each step: what to do, where (with link), why it fits, rough cost.
### Why this works for <name> — 3–5 bullets citing what you know.
### Budget — a small table: Item | Estimate (${cfg('currency')}).
### If something goes wrong — 2–3 backups (closed shop, running late, rain).
## Two other ways to do it — two shorter alternative plans (4–6 bullets each).
## Checklist — what to carry/arrange.
### Questions that would make this better — up to 3, only if something important is unknown.`;

async function aiPlan(q, history, web) {
  const content = `What I want to do: ${q}\n\nEverything I've saved that might help (JSON):\n${JSON.stringify(contextFor(q)).slice(0, 14000)}`
    + (history.length ? `\n\nYour previous plan:\n${history[history.length - 1].plan}\n\nPlease revise it: ${history[history.length - 1].ask}` : '');
  const req = { system: SYSTEM(), content, tier: 'smart', maxTokens: 5000, web, webUses: 5 };
  try { return await ask(req); }
  catch (e) { if (!web || /quota|exhaust|429|api key|permission|billing/i.test(e.message)) throw e; return ask({ ...req, web: false }); } // web search often fails on free tiers
}

/* ---------- page ---------- */
let state = { q: '', plan: null, ai: null, aiErr: null, history: [] };
export function askPage(view, q = {}) {
  setTitle('Plan something', true);
  if (q.q && q.q !== state.q) state = { q: q.q, plan: null, ai: null, aiErr: null, history: [] };
  view.innerHTML = `
    <div class="card"><form id="ak-f"><label>What do you want to do?<textarea id="ak-q" rows="3" placeholder="e.g. Take Varshu to the house this evening, get her some food and a small present">${esc(state.q)}</textarea></label>
      <p class="hint">Mention who it's for, what you want (food, a present, a movie, the house…), and when or how much if it matters.</p>
      <div class="row wrap"><button class="btn primary grow" type="submit">✨ Plan it</button>${aiReady() ? `<button class="btn grow" type="button" id="ak-ai">🧠 Detailed plan with ${aiName()}</button>` : ''}</div>
      ${aiReady() ? '<label class="check small"><input type="checkbox" id="ak-web" checked> Let it look up real places online</label>' : ''}</form></div>
    <div id="ak-out"></div>`;
  const out = $('#ak-out');
  const draw = () => {
    const P = state.plan;
    if (!P && !state.ai) { out.innerHTML = ''; return; }
    out.innerHTML = `
      ${P && (P.u.people.length || P.u.intents.length) ? `<div class="chips ak-got">${P.u.people.map(p => `<a class="chip" href="#/p/${p.id}">👤 ${esc(p.name)}</a>`).join('')}${P.u.intents.map(i => `<span class="chip">${{ food: '🍜 food', gift: '🎁 present', watch: '🍿 movie', outing: '📍 outing', home: '🏡 the house', birthday: '🎂 birthday' }[i]}</span>`).join('')}${P.u.small ? '<span class="chip">🤏 small</span>' : ''}${P.u.budget ? `<span class="chip">💰 ${fmtMoney(P.u.budget)}</span>` : ''}${P.u.part || P.u.day ? `<span class="chip">🕒 ${esc(P.u.day === 'today' && P.u.part ? 'this ' + P.u.part : [P.u.day, P.u.part].filter(Boolean).join(' '))}</span>` : ''}</div>` : ''}
      ${state.ai ? aiBlock() : ''}
      ${state.aiErr ? `<div class="card warnbox small">${esc(aiName())} couldn't make a plan right now (${esc(state.aiErr.slice(0, 140))}). Here's a detailed plan from your saved notes instead.</div>` : ''}
      ${!state.ai && P ? offlineBlock(P) : ''}
      ${state.ai && P ? `<details class="card"><summary><b>📒 Plan from my saved notes only</b></summary>${offlineBlock(P, true)}</details>` : ''}`;
    $$('[data-copy]', out).forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.closest('[data-copyroot]').innerText.replace(/📋 Copy/g, '').trim()); toast('Copied'); } catch { toast('Could not copy'); } });
    $('#ak-alt')?.addEventListener('click', () => { state.plan.plans.push(state.plan.plans.shift()); draw(); });
    $('#ak-refine')?.addEventListener('submit', e => { e.preventDefault(); const t = $('#ak-refine-q').value.trim(); if (!t) return; state.history.push({ plan: state.ai, ask: t }); runAi(true); });
  };
  const aiBlock = () => `<div class="card plan-ai" data-copyroot>${md(state.ai)}
      <div class="row"><span class="grow small muted">🧠 Written by ${esc(aiName())} from your saved notes${state.history.length ? ` · revised ${state.history.length}×` : ''}</span><button class="btn small ghost" data-copy>📋 Copy</button></div></div>
    <form class="card row" id="ak-refine"><input id="ak-refine-q" class="grow" placeholder="Change something — “she's vegetarian”, “cheaper”, “we only have 2 hours”"><button class="btn" type="submit">Revise</button></form>`;
  const run = () => {
    state.q = $('#ak-q').value.trim(); if (!state.q) return toast('Describe what you want to do');
    state.plan = buildPlan(state.q); state.ai = null; state.aiErr = null; state.history = []; draw();
  };
  const runAi = async refine => {
    if (!refine) { state.q = $('#ak-q').value.trim(); if (!state.q) return toast('Describe what you want to do'); state.history = []; }
    state.plan = buildPlan(state.q); state.aiErr = null;
    const keep = state.ai;
    out.innerHTML = `<div class="card"><div class="spinner"></div><p class="center small muted">${refine ? 'Revising the plan…' : 'Working out a detailed plan from everything you\'ve saved… this can take 20–40 seconds.'}</p></div>`;
    try { state.ai = await aiPlan(state.q, state.history, $('#ak-web')?.checked); }
    catch (e) { state.aiErr = e.message; state.ai = refine ? keep : null; if (refine) state.history.pop(); }
    draw();
  };
  $('#ak-f').onsubmit = e => { e.preventDefault(); run(); };
  $('#ak-ai')?.addEventListener('click', () => runAi(false));
  if (state.plan || state.ai) draw(); else if (state.q) run();
}

function offlineBlock(P, compact = false) {
  const [main, ...alts] = P.plans;
  const planHtml = (pl, big) => `<div class="${big ? '' : 'alt-plan'}">
    <div class="row"><b class="grow">${esc(pl.title)}</b><small class="muted">${esc(pl.span)}</small></div>
    <ol class="timeline">${pl.steps.map(s => `<li>${s.img ? `<img src="${esc(s.img)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : `<span class="tl-e">${s.icon}</span>`}
      <div class="grow"><div><span class="tl-time">${esc(s.time)}</span> <b>${esc(s.head)}</b></div><div class="small">${esc(s.body)}</div>
      ${s.links.map(l => `<a class="small tl-link" target="_blank" rel="noopener" href="${esc(l.u)}">${esc(l.t)} ↗</a>`).join('')}</div></li>`).join('')}</ol>
    ${big && pl.why.length ? `<h4>Why this works</h4><ul class="small">${pl.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${big && pl.touches.length ? `<h4>Little touches</h4><ul class="small">${pl.touches.map(w => `<li>${md(w).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul>` : ''}</div>`;
  return `
    ${P.notes.map(n => `<div class="card ak-note">${esc(n)}</div>`).join('')}
    <div class="card plan" data-copyroot>
      <p>${esc(P.summary)}</p>
      ${planHtml(main, true)}
      ${P.check.length ? `<h4>Checklist</h4><ul class="small checklist">${P.check.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${alts.length ? `<h4>Other ways to do it</h4>${alts.map(a => planHtml(a, false)).join('')}` : ''}
      ${P.missing.length ? `<p class="small muted">💡 Plans get better if you save ${esc(listJoin(P.missing))}.</p>` : ''}
      <div class="row"><span class="grow"></span>${alts.length && !compact ? '<button class="btn small ghost" id="ak-alt">🔄 Switch to another option</button>' : ''}<button class="btn small ghost" data-copy>📋 Copy</button></div>
    </div>`;
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
