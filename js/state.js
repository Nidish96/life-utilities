import { CONFIG } from './config.js';
import { emptyDb, mergeDb, normalize, uid, AuthNeeded } from './storage.js';

const DEFAULTS = {
  fastModel: 'claude-haiku-5-5',
  smartModel: 'claude-sonnet-5-5',
  homeCity: '',
  currency: '₹',
  folderName: CONFIG.driveFolderName || 'LifeUtilities',
  clientId: CONFIG.googleClientId || '',
};

// Device settings live in localStorage; shared settings live in db.settings (synced via Drive).
let local = {};
try { local = JSON.parse(localStorage.getItem('lu.settings') || '{}'); } catch { /* ignore */ }

export const state = { db: emptyDb(), backend: null, status: 'idle', statusMsg: '', busy: 0 };

const listeners = {};
export const on = (e, f) => (listeners[e] ??= []).push(f);
export const emit = (e, d) => (listeners[e] || []).forEach(f => f(d));

export function cfg(k) {
  const l = local[k];
  if (l !== undefined && l !== '') return l;
  const s = state.db.settings?.[k];
  if (s !== undefined && s !== '') return s;
  return DEFAULTS[k];
}
export function setLocal(k, v) {
  if (v === undefined || v === null || v === '') delete local[k]; else local[k] = v;
  localStorage.setItem('lu.settings', JSON.stringify(local));
}
export function setShared(k, v) {
  state.db.settings = { ...state.db.settings, [k]: v };
  state.db.settingsUpdatedAt = Date.now();
  scheduleSave();
}

export function setStatus(s, msg = '') { state.status = s; state.statusMsg = msg; emit('status'); }

export const live = c => state.db[c].filter(r => !r.deleted);
export const get = (c, id) => state.db[c].find(r => r.id === id && !r.deleted);

export function upsert(c, rec) {
  const now = Date.now();
  if (!rec.id) { rec.id = uid(); rec.createdAt = now; }
  rec.updatedAt = now;
  const i = state.db[c].findIndex(r => r.id === rec.id);
  if (i >= 0) state.db[c][i] = rec; else state.db[c].push(rec);
  scheduleSave();
  return rec;
}
export function remove(c, id) {
  const r = state.db[c].find(x => x.id === id);
  if (r) { r.deleted = true; r.updatedAt = Date.now(); scheduleSave(); }
}

let timer = null, saving = false;
let dirty = localStorage.getItem('lu.dirty') === '1';
export const isDirty = () => dirty;

function cache() {
  try {
    localStorage.setItem('lu.cache', JSON.stringify(state.db));
    localStorage.setItem('lu.dirty', dirty ? '1' : '0');
  } catch { /* storage full — Drive remains the source of truth */ }
}
export function readCache() {
  try { const c = localStorage.getItem('lu.cache'); return c ? normalize(JSON.parse(c)) : null; } catch { return null; }
}
export function markDirty() { dirty = true; cache(); }

export function scheduleSave() {
  dirty = true; cache();
  if (state.status !== 'auth') setStatus('pending');
  clearTimeout(timer);
  timer = setTimeout(flush, 1200);
}

export async function flush() {
  if (!state.backend || saving || !dirty) return;
  saving = true; dirty = false; setStatus('saving');
  try {
    const res = await state.backend.saveDb(state.db);
    if (res.changed) { state.db = mergeDb(res.db, state.db); emit('remote-change'); }
    cache();
    setStatus(dirty ? 'pending' : 'saved');
  } catch (e) {
    dirty = true; cache();
    if (e instanceof AuthNeeded) setStatus('auth', e.message);
    else setStatus('error', e.message);
  } finally {
    saving = false;
    if (dirty && state.status === 'pending') { clearTimeout(timer); timer = setTimeout(flush, 1200); }
  }
}

export async function loadFromBackend() {
  setStatus('loading');
  await state.backend.init();
  const remote = await state.backend.loadDb();
  state.db = dirty ? mergeDb(remote, state.db) : remote;
  cache();
  setStatus('saved');
  if (dirty) await flush();
  emit('remote-change');
}
