// Offline text matching: keywords, fuzzy similarity and duplicate detection. No AI needed.

export const STOP = new Set(('a an the and or but of to for in on at with from by about into is are was were be been being has have had do does did ' +
  'she he they her his their them i me my we our you your it its this that these those really very so just also always never someday one day ' +
  'loves love loved loving likes like liked wants want wanted wishes wish said says told mentioned obsessed crazy craving craves enjoys enjoy adores adore ' +
  'would could should will can try trying tried go going went get getting some lot lots much more most favourite favorite new ' +
  'lately recently these days nowadays dream dreams dreaming learn learning maybe hates hate dislikes allergic thing things stuff kind sort ' +
  "she's he's they're it's i've she'd he'd they'd i'd don't doesn't can't cannot not no yes again still ever good great nice amazing best " +
  'big little bit lot place places food foods eat eating ate drink drinking see visit visiting do doing make take buy own having stand cannot').split(' '));

const stem = w => {
  w = w.replace(/['’]s$/, '');
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ches|shes|xes|sses|oes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
};

// Meaningful words of a text, normalised ("Korean corn dogs!" → ['korean', 'corn', 'dog']).
export function keywords(text, extraStop = []) {
  const extra = new Set(extraStop.flatMap(n => (n || '').toLowerCase().split(/\s+/)));
  return [...new Set((text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9'’\s-]/g, ' ').split(/[\s-]+/)
    .filter(w => w && !STOP.has(w) && !extra.has(w.replace(/['’]s$/, '')) && !/^\d+$/.test(w))
    .map(stem).filter(w => w.length > 1 && !STOP.has(w)))];
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
// "biriyani" ≈ "biryani", "capuccino" ≈ "cappuccino"
const near = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && lev(a, b) <= (Math.min(a.length, b.length) >= 8 ? 2 : 1));

// How alike two keyword lists are: containment (share of the shorter one found in the other) and jaccard.
export function similarity(A, B) {
  if (!A.length || !B.length) return { containment: 0, jaccard: 0, shared: 0 };
  const [small, big] = A.length <= B.length ? [A, B] : [B, A];
  const shared = small.filter(w => big.some(x => near(w, x))).length;
  return { containment: shared / small.length, jaccard: shared / (A.length + B.length - shared), shared };
}

// Find the closest existing fact for a new item. Returns null or
// { fact, level: 'same' | 'similar' | 'conflict' } — conflict = one is a dislike and the other isn't.
export function findMatch(item, facts, names = []) {
  const A = keywords(item.title, names);
  const normT = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let best = null;
  for (const f of facts) {
    const exact = normT(f.title) === normT(item.title);
    const B = keywords(f.title, names);
    const s = similarity(A, B);
    const score = exact ? 2 : s.containment + s.jaccard;
    if (!exact && !(s.shared >= 1 && s.containment >= 0.6)) continue;
    const strong = exact || (s.containment === 1 && s.jaccard >= 0.6);
    // a looser match only counts within the same category, or against a dislike (to flag conflicts)
    if (!strong && item.category && f.category !== item.category && item.category !== 'dislike' && f.category !== 'dislike') continue;
    if (!best || score > best.score) best = { fact: f, score, s, exact };
  }
  if (!best) return null;
  const isDislike = c => c === 'dislike';
  if (item.category && isDislike(item.category) !== isDislike(best.fact.category)) return { fact: best.fact, level: 'conflict' };
  const same = best.exact || (best.s.containment === 1 && best.s.jaccard >= 0.6);
  return { fact: best.fact, level: same ? 'same' : 'similar' };
}

// A short, searchable title from a whole sentence ("Meera has been obsessed with Korean corn dogs lately" → "Korean corn dogs").
// force: always strip filler (for sentences); otherwise only titles longer than 5 words are trimmed.
export function shortTitle(sentence, names = [], force = false) {
  const s = (sentence || '').trim().replace(/[.!?]+$/, '');
  if (!force && s.split(/\s+/).length <= 5) return s;
  const extra = new Set(names.flatMap(n => (n || '').toLowerCase().split(/\s+/)));
  const words = s.replace(/[“”"().,!?;:]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w.replace(/['’]s$/i, ''))
    .filter(w => !STOP.has(w.toLowerCase()) && !extra.has(w.toLowerCase()) && !/^\d+$/.test(w));
  const t = words.slice(0, 5).join(' ');
  return t ? t[0].toUpperCase() + t.slice(1) : s.slice(0, 60);
}
