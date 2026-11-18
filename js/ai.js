// Claude API calls (direct from the browser with your own key), plus free lookups
// from Wikipedia (pictures) and OpenStreetMap Nominatim (coordinates).
import { cfg } from './state.js';
import { today } from './ui.js';
import { blobToBase64 } from './media.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const aiReady = () => !!cfg('apiKey');

export async function claude({ system, content, model, maxTokens = 4096, web = false, webUses = 3 }) {
  if (!aiReady()) throw new Error('Add your Claude API key in Settings to use AI features.');
  const body = { model: model || cfg('fastModel'), max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
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

export async function extractFacts(text, people, { defaultPerson, model, extraNames = [] } = {}) {
  const profiles = people.map(p => ({ id: p.id, name: p.name, aliases: p.aliases || [], relation: p.relation || undefined }));
  for (const n of extraNames) profiles.push({ id: null, name: n, note: 'new in this import' });
  const content = `Existing profiles: ${JSON.stringify(profiles)}
Default person: ${defaultPerson ? JSON.stringify({ id: defaultPerson.id, name: defaultPerson.name }) : 'none'}
Today: ${today()}

Notes:
"""
${text}
"""`;
  const out = await claude({ system: EXTRACT_SYSTEM, content, model: model || cfg('fastModel'), maxTokens: 8000 });
  const j = parseJson(out);
  if (!j) throw new Error('Could not understand the AI response. Try again.');
  return { items: Array.isArray(j.items) ? j.items : [], updates: Array.isArray(j.person_updates) ? j.person_updates : [] };
}

/* Offline fallback when there's no API key: rough keyword classification. */
const KW = [
  ['dislike', /\b(hates?|dislikes?|allergic|allergy|can'?t stand|cannot stand|doesn'?t (eat|like)|does not (eat|like)|avoids?|lactose|gluten)\b/i],
  ['memory', /\b(we went|we had|we did|together|our trip|we celebrated)\b/i],
  ['important_date', /\b(birthday|anniversary|b'?day)\b/i],
  ['dream_vacation', /\b(dream|bucket list|someday|one day)\b.*\b(visit|go to|travel|trip|see)\b|\b(vacation|holiday) (to|in)\b/i],
  ['long_held_desire', /\b(always wanted|has wanted|dreams? of|wish(es)? (to|she|he))\b/i],
  ['gift_idea', /\b(wants? (a|an|the|to buy)|wish ?list|would love (a|an|to have)|eyeing|needs? a new)\b/i],
  ['food', /\b(eat|food|dish|cuisine|biryani|pizza|pasta|sushi|ramen|noodles?|curry|dosa|idli|chaat|momos?|burger|coffee|tea|chai|cake|dessert|chocolate|ice ?cream|spicy|drink|wine|beer|cocktail|brunch|dinner|lunch|snack|restaurant)\b/i],
  ['place', /\b(cafe|café|park|beach|museum|bar|pub|mall|lake|temple|market|gallery|rooftop)\b/i],
  ['music', /\b(song|band|singer|music|album|concert|playlist)\b/i],
  ['movie_tv', /\b(movie|film|series|show|netflix|anime)\b/i],
  ['book', /\b(book|novel|author|reading)\b/i],
  ['activity', /\b(hiking|trek|swim|dance|yoga|climb|cycling|run|gaming|karaoke|pottery|painting)\b/i],
  ['fashion', /\b(dress|shoes|sneakers|perfume|jewel|watch|bag|style|wear)\b/i],
  ['hobby', /\b(hobby|collects?|plays?|learning)\b/i],
];
export function heuristicExtract(text, people, defaultPerson) {
  const names = [];
  for (const p of people) for (const n of [p.name, ...(p.aliases || [])]) if (n) names.push([n.toLowerCase(), p]);
  const items = [];
  for (const s of text.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(x => x.length > 3)) {
    const low = s.toLowerCase();
    let person = names.find(([n]) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(low))?.[1];
    let personName = person?.name;
    if (!person) {
      const m = s.match(/\b([A-Z][a-z]+)\s+(?:loves?|likes?|said|says|told|wants?|hates?|mentioned|adores?|enjoys?|is|has|dreams?)\b/);
      const seen = names.find(([n]) => new RegExp(`\\b${n}\\b`, 'i').test(s));
      if (seen) { person = seen[1].id ? seen[1] : null; personName = seen[1].name; }
      else if (m && !['I', 'We', 'She', 'He', 'They', 'My', 'It', 'This'].includes(m[1])) { personName = m[1]; names.push([m[1].toLowerCase(), { name: m[1] }]); }
      else if (defaultPerson) { person = defaultPerson; personName = defaultPerson.name; }
    }
    if (!personName) continue;
    const category = (KW.find(([, re]) => re.test(s)) || ['other'])[0];
    items.push({ person: personName, person_id: person?.id || null, category, title: s.replace(/[.!?]$/, '').slice(0, 70), detail: s, tags: [], searchable: ['food', 'place', 'dream_vacation', 'book', 'music', 'movie_tv'].includes(category), date: null });
  }
  return { items, updates: [] };
}

/* ---------- 2. Look something up on the web ---------- */
const enrichSystem = city => `You research one thing a person likes so the user can act on it later (visit, order, buy, book). Use web search to get accurate, current details. The user lives in ${city || 'an unspecified city'} — prefer suggestions there unless the item is clearly elsewhere.

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

export async function enrichItem(fact, person) {
  let e = {};
  if (aiReady()) {
    const txt = await claude({
      system: enrichSystem(cfg('homeCity')),
      content: `Person: ${person?.name || 'friend'}\nCategory: ${fact.category}\nItem: ${fact.title}\nContext: ${fact.detail || ''}`,
      model: cfg('fastModel'), web: true, webUses: 3, maxTokens: 3000,
    });
    e = parseJson(txt) || { summary: txt.slice(0, 400) };
  }
  const wt = e.wikipedia_title || (!aiReady() && fact.searchable ? fact.title : null);
  if (wt) {
    const w = (await wikiSummary(wt)) || (await wikiSearchSummary(wt));
    if (w?.image) { e.image = w.image; e.imageSource = w.url; }
    if (!e.summary && w?.extract) e.summary = w.extract.slice(0, 300);
  }
  if (e.place && !(+e.place.lat && +e.place.lng) && (e.place.address || e.place.name)) {
    const g = await geocode([e.place.name, e.place.address].filter(Boolean).join(', '));
    if (g) { e.place.lat = g.lat; e.place.lng = g.lng; }
  }
  if (fact.category === 'place' && !e.place) {
    const g = await geocode(fact.title + (cfg('homeCity') ? ', ' + cfg('homeCity') : ''));
    if (g) e.place = { name: fact.title, address: g.display, lat: g.lat, lng: g.lng };
  }
  e.at = Date.now();
  return e;
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
  const txt = await claude({ system, content, model: cfg('smartModel'), web, webUses: 4, maxTokens: 3000 });
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
  return claude({ system, content: `My priorities: ${priorities || 'not specified'}\n\nHomes:\n${JSON.stringify(data, null, 1)}`, model: cfg('smartModel'), maxTokens: 6000 });
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
  const txt = await claude({ system: DOC_SYSTEM, content, model: cfg('smartModel'), maxTokens: 3000 });
  const j = parseJson(txt);
  if (!j) throw new Error('Could not read that document.');
  return j;
}

export async function testKey() {
  const t = await claude({ system: 'Reply with the single word OK.', content: 'ping', maxTokens: 10 });
  return t.trim();
}
