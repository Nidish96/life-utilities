// Storage backends: Google Drive (the real backend) and this-device-only (IndexedDB).
// Both expose: init(), hasToken(), loadDb(), saveDb(db) -> {db, changed}, putFile(blob, name) -> id,
// fileBlob(id), fileUrl(id), deleteFile(id).

export const COLLECTIONS = ['people', 'facts', 'memories', 'houses', 'documents', 'landmarks', 'watch', 'inspections', 'homes'];
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const emptyDb = () => ({ version: 1, people: [], facts: [], memories: [], houses: [], documents: [], landmarks: [], watch: [], inspections: [], homes: [], settings: {}, settingsUpdatedAt: 0 });

export function normalize(db) {
  const e = emptyDb();
  for (const c of COLLECTIONS) e[c] = Array.isArray(db?.[c]) ? db[c] : [];
  e.settings = db?.settings && typeof db.settings === 'object' ? db.settings : {};
  e.settingsUpdatedAt = db?.settingsUpdatedAt || 0;
  return e;
}

// Per-record "last write wins" merge. Deletions are soft (deleted:true) so they merge too.
// On a tie, b wins (pass the local copy as b).
export function mergeDb(a, b) {
  a = normalize(a); b = normalize(b);
  const out = emptyDb();
  for (const c of COLLECTIONS) {
    const m = new Map();
    for (const r of [...a[c], ...b[c]]) {
      const ex = m.get(r.id);
      if (!ex || (r.updatedAt || 0) >= (ex.updatedAt || 0)) m.set(r.id, r);
    }
    out[c] = [...m.values()];
  }
  const bNewer = (b.settingsUpdatedAt || 0) >= (a.settingsUpdatedAt || 0);
  out.settings = bNewer ? b.settings : a.settings;
  out.settingsUpdatedAt = Math.max(a.settingsUpdatedAt || 0, b.settingsUpdatedAt || 0);
  return out;
}

export class AuthNeeded extends Error {
  constructor(m) { super(m); this.name = 'AuthNeeded'; }
}

/* ---------------- Google Drive ---------------- */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
let gisPromise = null;

export function preloadGoogle() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = res;
      s.onerror = () => { gisPromise = null; rej(new Error('Could not load Google sign-in. Check your connection.')); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

export class DriveBackend {
  constructor({ clientId, folderName }) {
    this.kind = 'drive';
    this.clientId = clientId;
    this.folderName = folderName || 'LifeUtilities';
    this.urlCache = new Map();
    try {
      const t = JSON.parse(localStorage.getItem('lu.tok') || 'null');
      if (t && t.exp > Date.now() + 60000) { this.token = t.token; this.exp = t.exp; }
    } catch { /* ignore */ }
    preloadGoogle().catch(() => {});
  }

  hasToken() { return !!this.token && Date.now() < this.exp - 60000; }
  // ms until the access token runs out (0 if none). Browser-only Google sign-in gives 1-hour tokens and no refresh token.
  expiresIn() { return this.token ? Math.max(0, this.exp - Date.now()) : 0; }

  // Call from a tap/click so the Google popup isn't blocked. requestAccessToken must run synchronously inside
  // the tap, so the token client is created once and reused. With the account remembered (login_hint) and consent
  // already given, Google's window usually closes by itself without asking anything.
  async signIn() {
    if (!this.clientId) throw new Error('Add your Google OAuth Client ID first (Settings or js/config.js).');
    if (!window.google?.accounts?.oauth2) await preloadGoogle();
    if (this.pending) return this.pending;
    this.pending = new Promise((res, rej) => {
      this.waiters = { res, rej };
      if (!this.client) {
        this.client = google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          scope: SCOPE,
          callback: r => {
            const w = this.waiters; this.waiters = null;
            if (r.error) return w?.rej(new Error(r.error_description || r.error));
            this.token = r.access_token;
            this.exp = Date.now() + (+r.expires_in || 3600) * 1000;
            localStorage.setItem('lu.tok', JSON.stringify({ token: this.token, exp: this.exp }));
            w?.res();
            if (!localStorage.getItem('lu.ghint')) this.rememberAccount();
          },
          error_callback: e => { const w = this.waiters; this.waiters = null; w?.rej(new Error(e?.type === 'popup_closed' ? 'Google sign-in was closed' : e?.message || e?.type || 'Google sign-in was cancelled')); },
        });
      }
      const hint = localStorage.getItem('lu.ghint');
      this.client.requestAccessToken({ prompt: '', ...(hint ? { login_hint: hint } : {}) });
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  // Remember which Google account this is (kept on this device only), so renewing doesn't show the account chooser.
  async rememberAccount() {
    try {
      const j = await (await this.req(`${API}/about?fields=user(emailAddress)`)).json();
      if (j.user?.emailAddress) localStorage.setItem('lu.ghint', j.user.emailAddress);
    } catch { /* not important */ }
  }

  signOut() {
    if (this.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(this.token, () => {});
    this.token = null; localStorage.removeItem('lu.tok'); localStorage.removeItem('lu.ghint');
  }

  async req(url, opts = {}) {
    if (!this.hasToken()) throw new AuthNeeded('Google Drive sign-in needed');
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + this.token } });
    if (r.status === 401) { this.token = null; localStorage.removeItem('lu.tok'); throw new AuthNeeded('Google Drive session expired'); }
    if (!r.ok) { const t = await r.text(); throw new Error('Drive ' + r.status + ': ' + t.slice(0, 200)); }
    return r;
  }

  async findOrCreateFolder(name, parent) {
    const q = [`name='${name.replace(/'/g, "\\'")}'`, "mimeType='application/vnd.google-apps.folder'", 'trashed=false', parent ? `'${parent}' in parents` : null].filter(Boolean).join(' and ');
    const j = await (await this.req(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`)).json();
    if (j.files?.length) return j.files[0].id;
    const body = { name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) };
    const c = await (await this.req(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    return c.id;
  }

  async init() {
    this.folderId = await this.findOrCreateFolder(this.folderName);
    this.mediaId = await this.findOrCreateFolder('media', this.folderId);
    const q = `name='db.json' and '${this.folderId}' in parents and trashed=false`;
    const j = await (await this.req(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`)).json();
    if (j.files?.length) this.dbId = j.files[0].id;
    else {
      const r = await this.upload(new Blob([JSON.stringify(emptyDb())], { type: 'application/json' }), 'db.json', this.folderId);
      this.dbId = r.id; this.version = r.version;
    }
  }

  async upload(blob, name, parent) {
    const meta = { name, parents: [parent], mimeType: blob.type || 'application/octet-stream' };
    const fd = new FormData();
    fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    fd.append('file', blob);
    return (await this.req(`${UP}/files?uploadType=multipart&fields=id,version`, { method: 'POST', body: fd })).json();
  }

  async loadDb() {
    const m = await (await this.req(`${API}/files/${this.dbId}?fields=version`)).json();
    const db = await (await this.req(`${API}/files/${this.dbId}?alt=media`)).json();
    this.version = m.version;
    return normalize(db);
  }

  async saveDb(db) {
    const m = await (await this.req(`${API}/files/${this.dbId}?fields=version`)).json();
    let merged = db, changed = false;
    if (this.version && m.version !== this.version) {
      // Another device saved since we last loaded: merge record-by-record.
      const remote = await (await this.req(`${API}/files/${this.dbId}?alt=media`)).json();
      merged = mergeDb(remote, db); changed = true;
    }
    const r = await this.req(`${UP}/files/${this.dbId}?uploadType=media&fields=version`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(merged),
    });
    this.version = (await r.json()).version;
    return { db: merged, changed };
  }

  async putFile(blob, name) { return (await this.upload(blob, name, this.mediaId)).id; }
  async fileBlob(id) { return (await this.req(`${API}/files/${id}?alt=media`)).blob(); }
  fileUrl(id) {
    if (!this.urlCache.has(id)) {
      const p = this.fileBlob(id).then(b => URL.createObjectURL(b));
      p.catch(() => this.urlCache.delete(id));
      this.urlCache.set(id, p);
    }
    return this.urlCache.get(id);
  }
  // Moves to Drive trash (recoverable for 30 days) rather than deleting outright.
  async deleteFile(id) {
    await this.req(`${API}/files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  }
  folderUrl() { return this.folderId ? `https://drive.google.com/drive/folders/${this.folderId}` : null; }
}

/* ---------------- This device only (IndexedDB) ---------------- */
function openIdb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('lifeutils', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('files'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export class LocalBackend {
  constructor() { this.kind = 'local'; this.dbp = openIdb(); this.urlCache = new Map(); }
  async tx(store, mode, fn) {
    const d = await this.dbp;
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      t.oncomplete = () => res(rq?.result);
      t.onerror = () => rej(t.error);
    });
  }
  async init() {}
  hasToken() { return true; }
  async loadDb() { return normalize(await this.tx('kv', 'readonly', s => s.get('db'))); }
  async saveDb(db) { await this.tx('kv', 'readwrite', s => s.put(JSON.parse(JSON.stringify(db)), 'db')); return { db, changed: false }; }
  async putFile(blob) { const id = 'l_' + uid(); await this.tx('files', 'readwrite', s => s.put(blob, id)); return id; }
  async fileBlob(id) { return this.tx('files', 'readonly', s => s.get(id)); }
  fileUrl(id) {
    if (!this.urlCache.has(id)) {
      const p = this.fileBlob(id).then(b => { if (!b) throw new Error('missing'); return URL.createObjectURL(b); });
      p.catch(() => this.urlCache.delete(id));
      this.urlCache.set(id, p);
    }
    return this.urlCache.get(id);
  }
  async deleteFile(id) { await this.tx('files', 'readwrite', s => s.delete(id)); }
  folderUrl() { return null; }
}
