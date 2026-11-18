// Background queue that looks up details for facts (2 at a time).
import { state, get, upsert, emit } from './state.js';
import { enrichItem } from './ai.js';

const queue = [];
let running = 0;
const bump = () => { state.busy = queue.length + running; emit('status'); };

export function enqueue(id) {
  const f = get('facts', id);
  if (!f || queue.includes(id)) return;
  f.enrichStatus = 'pending';
  queue.push(id);
  bump(); pump();
}

function pump() {
  while (running < 2 && queue.length) {
    const id = queue.shift();
    running++; bump();
    run(id).finally(() => { running--; bump(); pump(); });
  }
}

async function run(id) {
  const f = get('facts', id);
  if (!f) return;
  try {
    const e = await enrichItem(f, get('people', f.personId));
    const cur = get('facts', id);
    if (cur) { cur.enrichment = e; cur.enrichStatus = 'done'; delete cur.enrichError; upsert('facts', cur); }
  } catch (err) {
    const cur = get('facts', id);
    if (cur) { cur.enrichStatus = 'error'; cur.enrichError = err.message; upsert('facts', cur); }
  }
  emit('fact-updated', id);
}
