// Background photo uploads. Jobs keep running when you leave or save a form; finished photos are
// handed to the form while it's open, or appended to the saved record afterwards.
import { state, get, upsert, emit } from './state.js';
import { compressImage } from './media.js';

const jobs = [];
let seq = 0, running = 0;
const CONCURRENCY = 2;

// A photo's identity, from its content (size + hash of the first 256 KB), so picking the same photo
// again is caught even when the phone gives it a new name or timestamp.
export async function sig(f) {
  try {
    const h = await crypto.subtle.digest('SHA-256', await f.slice(0, 262144).arrayBuffer());
    return f.size + ':' + [...new Uint8Array(h).slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return `${f.name}|${f.size}`; }
}
// Attach signatures to files (done once, before choosing).
export const withSigs = files => Promise.all(files.map(async file => ({ file, sig: await sig(file) })));

export const pendingJobs = () => jobs.filter(j => j.status === 'queued' || j.status === 'working');
const notify = () => { state.uploading = pendingJobs().length; emit('status'); emit('uploads'); };

// owner: { onDone(job), onChange() } while a form is open; target: { coll, id } once saved.
// items: [{ file, sig }] from withSigs()
export function addUploads(items, { owner, target = null, max = 1600 } = {}) {
  const added = items.map(({ file, sig }) => ({
    id: ++seq, file, sig, preview: URL.createObjectURL(file), status: 'queued', stage: 'Waiting…',
    owner, target, max, result: null, error: null, finishedAt: 0,
  }));
  jobs.push(...added);
  notify(); pump();
  return added;
}

function pump() {
  while (running < CONCURRENCY) {
    const job = jobs.find(j => j.status === 'queued');
    if (!job) break;
    running++;
    run(job).finally(() => { running--; notify(); pump(); });
  }
}

async function run(job) {
  job.status = 'working'; job.stage = 'Preparing…'; job.owner?.onChange?.();
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const full = await compressImage(job.file, job.max);
    const thumb = await compressImage(job.file, 420, 0.75);
    if (job.status === 'cancelled') return;
    job.stage = 'Uploading…'; job.owner?.onChange?.();
    const [f, t] = await Promise.all([
      state.backend.putFile(full, `${stamp}_${job.id}.jpg`),
      state.backend.putFile(thumb, `${stamp}_${job.id}_thumb.jpg`),
    ]);
    if (job.status === 'cancelled') { for (const id of [f, t]) state.backend.deleteFile(id).catch(() => {}); return; }
    job.result = { f, t, s: job.sig };
    job.status = 'done'; job.finishedAt = Date.now();
    if (job.target) attachToRecord(job);
    else job.owner?.onDone?.(job);
  } catch (e) {
    if (job.status === 'cancelled') return;
    job.status = 'error'; job.error = e.message || String(e);
  }
  job.owner?.onChange?.();
}

function attachToRecord(job) {
  const r = get(job.target.coll, job.target.id);
  if (!r) { for (const id of [job.result.f, job.result.t]) state.backend.deleteFile(id).catch(() => {}); return; } // record was deleted meanwhile
  if (job.target.attach) job.target.attach(r, job.result); // e.g. a photo for one item inside the record
  else r.photos = [...(r.photos || []), job.result];
  upsert(job.target.coll, r);
  emit('photo-attached', job.target);
}

export function retry(job) { if (job.status === 'error') { job.status = 'queued'; job.error = null; job.stage = 'Waiting…'; notify(); pump(); } }

export function cancel(job) {
  if (job.status === 'queued' || job.status === 'working' || job.status === 'error') job.status = 'cancelled';
  URL.revokeObjectURL(job.preview);
  notify();
}

// When the form saves: everything still running belongs to the saved record from now on.
export function handOff(list, coll, id) {
  for (const j of list) {
    if (j.status === 'queued' || j.status === 'working') { j.target = { coll, id }; j.owner = null; }
    else if (j.status === 'error') cancel(j);
  }
  notify();
}

// Photos a background upload attached to this record after `since` (so a re-opened form doesn't drop them on save).
export const attachedSince = (coll, id, since) => jobs
  .filter(j => j.status === 'done' && j.target && j.target.coll === coll && j.target.id === id && j.finishedAt >= since)
  .map(j => j.result);

// Uploads still running for a saved record.
export const pendingFor = (coll, id) => pendingJobs().filter(j => j.target && j.target.coll === coll && j.target.id === id);
// Uploads (running or failed) aimed at one part of a record, e.g. one inspection item.
export const jobsFor = (coll, id, key) => jobs.filter(j => j.target && j.target.coll === coll && j.target.id === id && j.target.key === key && ['queued', 'working', 'error'].includes(j.status));
