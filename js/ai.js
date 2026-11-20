// AI calls to Claude or Gemini (direct from the browser with your own key), plus free lookups
// from Wikipedia (pictures), Openverse / Wikimedia Commons (photos) and OpenStreetMap Nominatim (coordinates).
import { cfg } from './state.js';
import { today } from './ui.js';
import { blobToBase64 } from './media.js';
import { shortTitle } from './match.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

// Which AI provider is active: 'claude' or 'gemini'.
export const provider = () => (cfg('provider') === 'gemini' ? 'gemini' : 'claude');
export const aiName = () => (provider() === 'gemini' ? 'Gemini' : 'Claude');
export const aiReady = () => !!(provider() === 'gemini' ? cfg('geminiKey') : cfg('apiKey'));
// tier: 'fast' (sorting, lookups) or 'smart' (bulk import, ideas, reports, bills)
export const modelFor = tier => provider() === 'gemini'
  ? cfg(tier === 'smart' ? 'geminiSmartModel' : 'geminiFastModel')
  : cfg(tier === 'smart' ? 'smartModel' : 'fastModel');

// One entry point for both providers. `content` is a string or an array of
// {type:'text'|'image'|'document', ...} blocks (Claude format); converted for Gemini.
export async function ask(opts) {
  if (!aiReady()) throw new Error(`Add your ${aiName()} API key in Settings to use AI features.`);
  return provider() === 'gemini' ? gemini(opts) : claude(opts);
}

async function claude({ system, content, tier = 'fast', maxTokens = 4096, web = false, webUses = 3 }) {
  const body = { model: modelFor(tier), max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  if (web) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: webUses }];
  const texts = [];
  for (let turn = 0; turn < 4; turn++) {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg('apiKey'),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `Claude API error ${r.status}`);
    texts.push(...(j.content || []).filter(b => b.type === 'text').map(b => b.text));
    if (j.stop_reason === 'pause_turn') { // long web-search turn: let it continue
      body.messages = [...body.messages, { role: 'assistant', content: j.content }];
      continue;
    }
    break;
  }
  return texts.join('\n');
}

async function gemini({ system, content, tier = 'fast', maxTokens = 4096, web = false }) {
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  const parts = blocks.map(b => b.type === 'text'
    ? { text: b.text }
    : { inline_data: { mime_type: b.source.media_type, data: b.source.data } });
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    // newer Gemini models "think" before answering, which uses output tokens too
    generationConfig: { maxOutputTokens: Math.max(maxTokens * 2, 4096) },
  };
  if (web) body.tools = [{ google_search: {} }];
  const r = await fetch(`${GEMINI}/${encodeURIComponent(modelFor(tier))}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg('geminiKey') },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Gemini API error ${r.status}`);
  if (j.promptFeedback?.blockReason) throw new Error('Gemini declined this request: ' + j.promptFeedback.blockReason);
  const cand = j.candidates?.[0];
  const text = (cand?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('\n');
  if (!text) throw new Error('Gemini returned no answer' + (cand?.finishReason ? ` (${cand.finishReason})` : ''));
  return text;
}

export function parseJson(text) {
  const tries = [];
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]).reverse();
  tries.push(...fences);
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  const lastOpen = text.lastIndexOf('\n{');
  if (lastOpen >= 0 && b > lastOpen) tries.push(text.slice(lastOpen + 1, b + 1));
  for (const t of tries) { try { return JSON.parse(t); } catch { /* next */ } }
  return null;
}

/* ---------- 1. Pull facts out of free text ---------- */
const EXTRACT_SYSTEM = `You help the user remember what their friends and family tell them. Read the user's notes and pull out every distinct, durable piece of information about a specific person: likes, dislikes, cravings, wishes, plans, dreams, important dates and shared experiences.

Rules:
- One item per distinct thing. "She loves sushi and ramen" → two items.
- "I", "me", "my", "we" refer to the user — never create a profile for the user. Things the user did together with someone become a "memory" item for that person.
- Match people to the existing profiles (by name, nickname or alias, case-insensitive; "Priya S" = "Priya"). If someone is not in the list, use their name as written and set person_id to null.
- If a note names nobody and a default person is given, attribute it to the default person.
- Skip chit-chat and anything not about a person's preferences, wishes, dates or shared memories.
- category — exactly one of: food, place, activity, dream_vacation, long_held_desire, gift_idea, hobby, music, movie_tv, book, fashion, dislike, important_date, other, memory.
  food = dishes, cuisines, drinks, snacks, restaurants loved for their food. place = specific venues/spots/neighbourhoods/cities nearby they love or want to visit. dream_vacation = far-away destinations they dream of. long_held_desire = big life wishes ("always wanted to learn to fly"). gift_idea = things they want to own or hinted at. dislike = dislikes, allergies, dietary restrictions, pet peeves. memory = something the user and that person did together.
- title: 2–6 words, specific and searchable ("Hokkaido miso ramen", not "ramen thing").
- detail: one short sentence that keeps the nuance (who said it, when, conditions).
- searchable: true if looking it up online would help (real dishes, venues, products, destinations, books, artists); false for personal or abstract things.
- date: YYYY-MM-DD when the note gives a date for the item (e.g. when a memory happened), else null.
- person_updates: facts about the person themself — birthday (YYYY-MM-DD, or --MM-DD if the year is unknown), relation to the user (friend, sister, colleague…), nicknames.

Return ONLY JSON, no prose:
{"items":[{"person":"Name","person_id":"id or null","category":"food","title":"…","detail":"…","tags":["…"],"searchable":true,"date":null}],
 "person_updates":[{"person":"Name","person_id":"id or null","birthday":null,"relation":null,"aliases":[]}]}`;

export async function extractFacts(text, people, { defaultPerson, tier = 'fast', extraNames = [] } = {}) {
  const profiles = people.map(p => ({ id: p.id, name: p.name, aliases: p.aliases || [], relation: p.relation || undefined }));
  for (const n of extraNames) profiles.push({ id: null, name: n, note: 'new in this import' });
  const content = `Existing profiles: ${JSON.stringify(profiles)}
Default person: ${defaultPerson ? JSON.stringify({ id: defaultPerson.id, name: defaultPerson.name }) : 'none'}
Today: ${today()}

Notes:
"""
${text}
"""`;
  const out = await ask({ system: EXTRACT_SYSTEM, content, tier, maxTokens: 8000 });
  const j = parseJson(out);
  if (!j) throw new Error('Could not understand the AI response. Try again.');
  return { items: Array.isArray(j.items) ? j.items : [], updates: Array.isArray(j.person_updates) ? j.person_updates : [] };
}

/* Offline fallback when there's no API key: rough keyword classification. */
const KW = [
  ['dislike', /\b(hates?|dislikes?|allergic|allergy|can'?t stand|cannot stand|doesn'?t (eat|like)|does not (eat|like)|avoids?|lactose|gluten)\b/i],
  ['memory', /\b(we went|we had|we did|together|our trip|we celebrated)\b/i],
  ['important_date', /\b(birthday|anniversary|b'?day)\b/i],
  ['movie_tv', /\b(wants?|wanna|dying|keen|has|have|need|needs|should|must) (to )?(watch|binge)\b|\b(watch|watching|binge|binging|see) (the )?(new )?(movie|film|series|show|season)\b|\bwatchlist\b/i],
  ['dream_vacation', /\b(dream|bucket list|someday|one day)\b.*\b(visit|go to|travel|trip|see)\b|\b(vacation|holiday) (to|in)\b/i],
  ['long_held_desire', /\b(always wanted|has wanted|dreams? of|wish(es)? (to|she|he))\b/i],
  ['gift_idea', /\b(wants? (a|an|the|to buy)|wish ?list|would love (a|an|to have)|eyeing|needs? a new)\b/i],
  ['food', /\b(eat|eats|food|dish|cuisine|craving|craves|hungry|tasty|delicious|recipe|bake|baking|cook|biryani|pizza|pasta|sushi|ramen|noodles?|curry|dosa|idli|chaat|momos?|burgers?|coffee|tea|chai|cakes?|dessert|chocolates?|ice ?cream|spicy|drink|wine|beer|cocktails?|brunch|dinner|lunch|breakfast|snacks?|restaurant|corn ?dogs?|tacos?|burritos?|dumplings?|bao|kimchi|tteokbokki|bbq|barbecue|pancakes?|waffles?|donuts?|doughnuts?|croissants?|cheesecake|boba|bubble tea|matcha|latte|cappuccino|mangoe?s?|paneer|butter chicken|samosas?|falafel|shawarma|hummus|steak|salad|soup|pho|pad thai|dim sum|kebabs?|fries|cheese|bread|cookies?|brownies?|gelato|smoothie|juice|seafood|prawns?|fish|chicken|mutton|vegan|vegetarian)\b/i],
  ['place', /\b(cafe|café|park|beach|museum|bar|pub|mall|lake|temple|market|gallery|rooftop)\b/i],
  ['music', /\b(songs?|bands?|singers?|music|albums?|concerts?|playlists?|swift|bts)\b/i],
  ['movie_tv', /\b(movies?|films?|series|shows?|netflix|anime|k-?dramas?|sitcoms?)\b/i],
  ['book', /\b(books?|novels?|authors?|reading|kindle)\b/i],
  ['activity', /\b(hiking|trek|swim|dance|yoga|climb|cycling|run|gaming|karaoke|pottery|painting)\b/i],
  ['fashion', /\b(dress|shoes|sneakers|perfume|jewel|watch|bag|style|wear)\b/i],
  ['hobby', /\b(hobby|collects?|plays?|learning)\b/i],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// "3 Feb", "3rd of February 1994", "Feb 3", "February 3rd, 1994" → YYYY-MM-DD or --MM-DD
export function parseDate(s) {
  let m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}\\b,?\\s*(\\d{4})?`, 'i'));
  let d, mo, y;
  if (m) { d = +m[1]; mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; y = m[3]; }
  else if ((m = s.match(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b,?\\s*(\\d{4})?`, 'i')))) { mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; d = +m[2]; y = m[3]; }
  if (!mo || !d || d > 31) return null;
  const md = `${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return y ? `${y}-${md}` : `--${md}`;
}

const RELATIONS = 'best friend|friend|sister|brother|colleague|coworker|cousin|mom|mum|mother|dad|father|partner|wife|husband|girlfriend|boyfriend|boss|neighbou?r|aunt|uncle|niece|nephew|grandma|grandpa|roommate|flatmate';
const PRONOUN_START = /^(she|he|they|her|his|their|them)\b/i;

export function heuristicExtract(text, people, defaultPerson) {
  const names = [];
  for (const p of people) for (const n of [p.name, ...(p.aliases || [])]) if (n) names.push([n.toLowerCase(), p]);
  const items = [], updates = new Map();
  const update = (person, personName, patch) => {
    const k = (person?.id || personName).toLowerCase();
    updates.set(k, { person: personName, person_id: person?.id || null, birthday: null, relation: null, aliases: [], ...(updates.get(k) || {}), ...patch });
  };
  // "my sister Meera" / "Meera, my colleague"
  for (const m of text.matchAll(new RegExp(`\\b[Mm]y (${RELATIONS})\\s+([A-Z][a-z]+)|\\b([A-Z][a-z]+),? (?:is )?[Mm]y (${RELATIONS})\\b`, 'g'))) {
    const name = m[2] || m[3], rel = (m[1] || m[4]).toLowerCase();
    const known = names.find(([n]) => n === name.toLowerCase());
    if (!known) names.push([name.toLowerCase(), { name }]);
    update(known?.[1]?.id ? known[1] : null, known?.[1]?.name || name, { relation: rel });
  }
  // split into sentences, and "…, and she said…" clauses
  const parts = text.split(/(?<=[.!?])\s+|\n+|;\s+|,\s+(?:and|but)\s+(?=(?:she|he|they|her|his|their)\b)/i).map(x => x.trim()).filter(x => x.length > 3);
  let last = null;
  for (const s of parts) {
    const low = s.toLowerCase();
    let person = names.find(([n]) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(low))?.[1];
    let personName = person?.name;
    if (person && !person.id) person = null;
    if (!personName) {
      const m = s.match(/\b([A-Z][a-z]+)(?:'s)?\s+(?:loves?|likes?|said|says|told|wants?|hates?|mentioned|adores?|enjoys?|is|has|been|dreams?|always|really|can't|doesn't|never)\b/);
      if (PRONOUN_START.test(s) && last) ({ person, personName } = last);
      else if (m && !['I', 'We', 'She', 'He', 'They', 'My', 'It', 'This', 'That', 'There', 'Her', 'His'].includes(m[1])) { personName = m[1]; names.push([m[1].toLowerCase(), { name: m[1] }]); }
      else if (defaultPerson) { person = defaultPerson; personName = defaultPerson.name; }
    }
    if (!personName) continue;
    last = { person, personName };
    const nameList = [personName, ...(person?.aliases || [])];
    if (/\b(birthday|b'?day|born)\b/i.test(s)) {
      const d = parseDate(s);
      if (d) { update(person, personName, { birthday: d }); continue; }
    }
    if (new RegExp(`^\\W*(?:${nameList.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})?,? (?:is )?my (${RELATIONS})\\W*$`, 'i').test(s)) continue; // only a relation
    const category = (KW.find(([, re]) => re.test(s)) || ['other'])[0];
    // "wants to watch The Bear on Hulu" → "The Bear" (keep the title as written)
    const watchT = category === 'movie_tv' && (s.match(/\b(?:watch|watching|binge|see)\s+(?:the (?:movie|film|show|series)\s+)?(.+?)(?:\s+(?:on|with|this|next|together|soon|someday|sometime|again|tonight|later)\b.*)?[.!?]*$/i) || [])[1];
    const title = watchT ? watchT.replace(/\s+(movie|film|series|show)$/i, '').replace(/^["“']|["”']$/g, '').trim() : shortTitle(s, [...nameList, ...RELATIONS.split('|'), 'my'], true);
    items.push({ person: personName, person_id: person?.id || null, category, title, detail: s.replace(/^(and|but)\s+/i, ''), tags: [], searchable: !['memory', 'important_date', 'dislike'].includes(category), date: null });
  }
  return { items, updates: [...updates.values()] };
}

/* ---------- 2. Look something up on the web ---------- */
const enrichSystem = city => `You research one thing a person likes so the user can act on it later (visit, order, buy, book). Use web search (Google Search when available) to get accurate, current details. The user lives in ${city || 'an unspecified city'} — prefer suggestions there unless the item is clearly elsewhere.

What to find, by category:
- place: the exact venue — full address and coordinates, opening hours if easy to find.
- food: what the dish is, and 2–3 well-reviewed places to try it near the user.
- activity / hobby: 2–3 ways or places to do it near the user.
- dream_vacation: best time to go, 2–3 highlights, typical trip length.
- gift_idea / fashion / book / music / movie_tv: exactly what it is and 2–3 places to buy, watch or listen, with typical price.
- long_held_desire: 2–3 concrete ways the user could help make it happen.
- dislike: what to watch out for (e.g. foods that commonly contain the allergen).

Return ONLY JSON:
{"summary":"1–2 sentences","place":{"name":"","address":"","lat":0,"lng":0} or null,"wikipedia_title":"exact English Wikipedia article title that would have a good representative picture, or null","suggestions":[{"name":"","why":"","address":"","url":"","price":""}],"links":[{"title":"","url":""}]}
Only include URLs you actually found. Be concise.`;

// AI lookup first (if a key is set); if that fails or there's no key, fall back to free sources so you
// still get a summary, contextual photos, a map pin and handy search links.
export async function enrichItem(fact, person) {
  let e = {};
  if (aiReady()) {
    const req = {
      system: enrichSystem(cfg('homeCity')),
      content: `Person: ${person?.name || 'friend'}\nCategory: ${fact.category}\nItem: ${fact.title}\nContext: ${fact.detail || ''}`,
      tier: 'fast', web: true, webUses: 3, maxTokens: 3000,
    };
    try {
      let txt;
      try { txt = await ask(req); }
      catch (err) {
        // Web search (Google Search grounding) is often what fails on free tiers; try once without it,
        // unless the key itself is out of quota / invalid.
        if (/quota|rate|exhaust|429|api key|permission|billing/i.test(err.message)) throw err;
        txt = await ask({ ...req, web: false });
      }
      e = parseJson(txt) || { summary: txt.slice(0, 400) };
      e.mode = 'ai';
    } catch (err) {
      e = { mode: 'free', aiError: err.message };
    }
  } else e.mode = 'free';

  const free = e.mode === 'free';
  const q = searchTerms(fact, person);
  const wt = e.wikipedia_title || (free ? q : null);
  if (wt) {
    const w = (await wikiSummary(wt)) || (await wikiSearchSummary(wt));
    if (w?.image) { e.image = w.image; e.imageSource = w.url; }
    if (!e.summary && w?.extract) e.summary = w.extract.slice(0, 300);
    if (free && w?.url) e.wikiUrl = w.url;
  }
  // A strip of contextual photos (free, openly licensed), for both AI and free lookups.
  const photos = await findPhotos(q, fact.category);
  if (photos.length) {
    e.photos = photos;
    if (!e.image) { e.image = photos[0].src; e.imageSource = photos[0].page; }
  }
  if (e.place && !(+e.place.lat && +e.place.lng) && (e.place.address || e.place.name)) {
    const g = await geocode([e.place.name, e.place.address].filter(Boolean).join(', '));
    if (g) { e.place.lat = g.lat; e.place.lng = g.lng; }
  }
  if (fact.category === 'place' && !e.place) {
    const g = await geocode(q + (cfg('homeCity') ? ', ' + cfg('homeCity') : '')) || await geocode(q);
    if (g) e.place = { name: fact.title, address: g.display, lat: g.lat, lng: g.lng };
  }
  if (free) e.links = [...(e.links || []), ...searchLinks(q, fact.category)];
  e.at = Date.now();
  return e;
}

// Turn a fact into a short search phrase. Titles from the no-AI sorter can be whole sentences
// ("Meera's been obsessed with Korean corn dogs"), so strip names and filler words.
export function searchTerms(fact, person) {
  return shortTitle(fact.title, [person?.name, ...(person?.aliases || [])]);
}

const PHOTO_HINT = { food: 'food', dream_vacation: 'landscape', place: '', activity: '', hobby: '' };
export async function findPhotos(q, category, n = 6) {
  if (!q) return [];
  const hinted = PHOTO_HINT[category] && !q.toLowerCase().includes(PHOTO_HINT[category]) ? `${q} ${PHOTO_HINT[category]}` : q;
  let out = await openverse(hinted, n);
  if (out.length < 3 && hinted !== q) out = [...out, ...(await openverse(q, n))];
  if (out.length < 3) out = [...out, ...(await commonsPhotos(q, n))];
  const seen = new Set();
  return out.filter(p => p.src && !seen.has(p.src) && seen.add(p.src)).slice(0, n);
}
async function openverse(q, n) {
  try {
    const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${n}&mature=false`);
    if (!r.ok) return [];
    return ((await r.json()).results || []).map(x => ({
      src: x.thumbnail || x.url, full: x.url, page: x.foreign_landing_url || x.url,
      credit: [x.creator, x.license ? `CC ${String(x.license).toUpperCase()}` : ''].filter(Boolean).join(' · '), via: 'Openverse',
    }));
  } catch { return []; }
}
async function commonsPhotos(q, n) {
  try {
    const r = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=${n}&prop=imageinfo&iiprop=url&iiurlwidth=480&format=json&origin=*`);
    const pages = Object.values((await r.json())?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    return pages.map(p => p.imageinfo?.[0]).filter(Boolean).map(i => ({ src: i.thumburl || i.url, full: i.url, page: i.descriptionurl, credit: '', via: 'Wikimedia Commons' }));
  } catch { return []; }
}

export function searchLinks(q, category) {
  const city = cfg('homeCity');
  const enc = encodeURIComponent;
  const links = [];
  if (['food', 'place', 'activity', 'hobby'].includes(category)) links.push({ title: `📍 Find "${q}"${city ? ' near ' + city : ' nearby'} on Google Maps`, url: `https://www.google.com/maps/search/${enc(q + (city ? ' near ' + city : ''))}` });
  if (['music', 'movie_tv'].includes(category)) links.push({ title: `▶️ "${q}" on YouTube`, url: `https://www.youtube.com/results?search_query=${enc(q)}` });
  if (category === 'book') links.push({ title: `📚 "${q}" on Goodreads`, url: `https://www.goodreads.com/search?q=${enc(q)}` });
  if (['gift_idea', 'fashion'].includes(category)) links.push({ title: `🛍️ Shop for "${q}"`, url: `https://www.google.com/search?tbm=shop&q=${enc(q)}` });
  if (category === 'dream_vacation') links.push({ title: `✈️ Travel guide for ${q}`, url: `https://en.wikivoyage.org/w/index.php?search=${enc(q)}` });
  links.push({ title: `🖼️ More pictures of "${q}"`, url: `https://www.google.com/search?tbm=isch&q=${enc(q)}` });
  links.push({ title: `🔎 Search the web for "${q}"`, url: `https://www.google.com/search?q=${enc(q + (city && ['food', 'place', 'activity'].includes(category) ? ' ' + city : ''))}` });
  return links;
}

export async function wikiSummary(title) {
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.trim().replace(/ /g, '_'))}`);
    if (!r.ok) return null;
    const j = await r.json();
    if (j.type === 'disambiguation') return null;
    return { image: j.thumbnail?.source || j.originalimage?.source || null, url: j.content_urls?.desktop?.page, extract: j.extract };
  } catch { return null; }
}
async function wikiSearchSummary(q) {
  try {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=1&format=json&origin=*`);
    const t = (await r.json())?.query?.search?.[0]?.title;
    return t ? wikiSummary(t) : null;
  } catch { return null; }
}
export async function geocode(q) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
    const j = await r.json();
    if (j[0]) return { lat: +j[0].lat, lng: +j[0].lon, display: j[0].display_name };
  } catch { /* offline */ }
  return null;
}
export async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' } });
    return (await r.json())?.display_name || null;
  } catch { return null; }
}

/* ---------- 3. Ideas for a person ---------- */
export async function planIdeas(person, facts, memories, intent, extra, web) {
  const grouped = {};
  for (const f of facts) (grouped[f.category] ??= []).push(f.title + (f.detail ? ` — ${f.detail}` : '') + (f.done ? ' (already done/gifted)' : ''));
  const system = `You are a thoughtful friend helping the user plan something for ${person.name}. Use what's known about them below${web ? ', and web search for specific, current options near the user' : ''}. Be specific, never generic. Never suggest anything that clashes with their dislikes or allergies, and don't repeat things already done or gifted. The user lives in ${cfg('homeCity') || 'an unspecified city'}; currency ${cfg('currency')}.
Return ONLY JSON: {"ideas":[{"title":"","why":"which of their interests this draws on","how":"concrete next step — where to go / what to buy / what to book, with price if known","url":""}]}
Give 5 varied ideas, from easy to special.`;
  const content = `Occasion / goal: ${intent}
Extra constraints: ${extra || 'none'}
${person.birthday ? `Birthday: ${person.birthday}\n` : ''}Relation: ${person.relation || 'friend'}
What I know about ${person.name}:
${JSON.stringify(grouped, null, 1)}
Recent shared memories: ${memories.slice(0, 8).map(m => m.title).join('; ') || 'none'}`;
  const txt = await ask({ system, content, tier: 'smart', web, webUses: 4, maxTokens: 3000 });
  return parseJson(txt)?.ideas || [];
}

/* ---------- 4. House-hunt report ---------- */
export async function houseReport(houses, priorities) {
  const system = `You help the user compare homes they've seen while house hunting. Write a clear, honest report in Markdown:
## Top picks — ranked shortlist (up to 3) with one-line reasons.
## Comparison — a Markdown table: Home | Price | Size | Area/location | Rating | Biggest plus | Biggest minus.
## Home by home — a short paragraph each: what stood out, pros, cons, red flags, and questions still to ask.
## Next steps — what to do now.
Weigh the user's priorities heavily. Use the currency symbol ${cfg('currency')}. Never invent facts; turn missing information into questions to ask.`;
  const data = houses.map(h => {
    const { photos, id, createdAt, updatedAt, deleted, ...rest } = h;
    return { ...rest, photoCount: (photos || []).length };
  });
  return ask({ system, content: `My priorities: ${priorities || 'not specified'}\n\nHomes:\n${JSON.stringify(data, null, 1)}`, tier: 'smart', maxTokens: 6000 });
}

/* ---------- 5. Read a bill / prescription ---------- */
const DOC_SYSTEM = `Read this document (bill, invoice, receipt, warranty card, insurance policy, prescription or medical report) and extract the key fields. Return ONLY JSON:
{"type":"bill|invoice|prescription|warranty|insurance|medical_report|other","title":"short human title, e.g. 'Samsung 55\\" TV — Croma' or 'Dr Rao — fever prescription'","vendor":"store / company / hospital or clinic","date":"YYYY-MM-DD","amount":number or null,"currency":"INR|USD|…","items":[{"name":"","qty":1,"price":0}],"warranty_until":"YYYY-MM-DD or null (work it out from purchase date + warranty period if stated)","serial_number":null,"policy_number":null,"doctor":null,"patient":null,"medicines":[{"name":"","dosage":"","frequency":"","duration":""}],"follow_up":"YYYY-MM-DD or null","notes":"anything important: return window, claim steps, diagnosis, instructions","tags":[]}
Use null for anything not present. Dates must be YYYY-MM-DD.`;

export async function extractDocument(files) {
  const content = [];
  for (const f of files.slice(0, 5)) {
    const data = await blobToBase64(f.blob);
    if (f.mime === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
    else content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
  }
  content.push({ type: 'text', text: `Extract the fields. Today is ${today()}.` });
  const txt = await ask({ system: DOC_SYSTEM, content, tier: 'smart', maxTokens: 3000 });
  const j = parseJson(txt);
  if (!j) throw new Error('Could not read that document.');
  return j;
}

export async function testKey() {
  const t = await ask({ system: 'Reply with the single word OK.', content: 'ping', maxTokens: 50 });
  return t.trim();
}
