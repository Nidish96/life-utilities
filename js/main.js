import { state, cfg, on, setStatus, readCache, loadFromBackend, flush, isDirty } from './state.js';
import { AuthNeeded } from './storage.js';
import { $, esc, toast, gallery, go } from './ui.js';
import { pendingJobs } from './uploads.js';
import { makeBackend } from './connect.js';
import { home } from './views/home.js';
import { peopleList, personPage } from './views/people.js';
import { addPage, importPage } from './views/capture.js';
import { housesList, houseDetail, houseEdit, houseReportPage } from './views/houses.js';
import { docsList, docDetail, docEdit } from './views/docs.js';
import { reimbList } from './views/reimb.js';
import { initLock } from './lock.js';
import { watchPage } from './views/watch.js';
import { inspectPage, roomPage } from './views/inspect.js';
import { askPage } from './views/ask.js';
import { myHomePage } from './views/myhome.js';
import { welcome, settingsPage } from './views/settings.js';

const routes = [
  [/^\/?$/, home, 'home'],
  [/^\/people$/, peopleList, 'people'],
  [/^\/p\/([^/]+)(?:\/(\w+))?$/, personPage, 'people'],
  [/^\/add$/, addPage, 'add'],
  [/^\/import$/, importPage, 'add'],
  [/^\/houses$/, housesList, 'houses'],
  [/^\/houses\/report$/, houseReportPage, 'houses'],
  [/^\/h\/new$/, v => houseEdit(v, 'new'), 'houses'],
  [/^\/h\/([^/]+)\/edit$/, houseEdit, 'houses'],
  [/^\/h\/([^/]+)\/inspect$/, inspectPage, 'houses'],
  [/^\/h\/([^/]+)\/inspect\/([^/]+)$/, roomPage, 'houses'],
  [/^\/h\/([^/]+)$/, houseDetail, 'houses'],
  [/^\/docs$/, docsList, 'docs'],
  [/^\/reimb$/, reimbList, 'docs'],
  [/^\/d\/new$/, (v, q) => docEdit(v, 'new', q), 'docs'],
  [/^\/d\/([^/]+)\/edit$/, docEdit, 'docs'],
  [/^\/d\/([^/]+)$/, docDetail, 'docs'],
  [/^\/watch$/, watchPage, 'people'],
  [/^\/ask$/, askPage, 'home'],
  [/^\/myhome$/, myHomePage, 'houses'],
  [/^\/settings$/, settingsPage, ''],
];

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, q: Object.fromEntries(new URLSearchParams(qs || '')) };
}

async function route() {
  const { path, q } = parse();
  const view = $('#view');
  document.querySelectorAll('.sheet-wrap').forEach(s => s.remove());
  document.body.classList.remove('noscroll');
  if (!cfg('mode') && path !== '/settings') {
    document.body.classList.add('welcome');
    return welcome(view);
  }
  document.body.classList.remove('welcome');
  for (const [re, fn, tab] of routes) {
    const m = path.match(re);
    if (!m) continue;
    document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
    view.innerHTML = '';
    window.scrollTo(0, 0);
    try { await fn(view, ...m.slice(1).map(x => x && decodeURIComponent(x)), q); }
    catch (e) { console.error(e); view.innerHTML = `<div class="empty">Something went wrong: ${esc(e.message)}</div>`; }
    return;
  }
  go('#/');
}

function renderStatus() {
  const el = $('#sync');
  const s = state.status;
  const local = state.backend?.kind === 'local';
  const busy = (state.uploading ? `⬆️ ${state.uploading} photo${state.uploading === 1 ? '' : 's'} · ` : '') + (state.busy ? `🔎 ${state.busy} · ` : '');
  const map = {
    idle: '', loading: state.statusMsg || '⟳ Loading…', saving: '⟳ Saving…', pending: '• Unsaved',
    saved: local ? '📱 On device' : '✓ Saved', auth: isDirty() ? '🔄 Saved on phone · tap to sync' : '🔄 Tap to resume sync', error: '⚠️ Sync problem',
  };
  el.textContent = busy + (map[s] ?? '');
  el.className = 'pill' + (s === 'error' ? ' warn' : s === 'auth' ? ' soft' : '');
  el.title = s === 'auth' ? 'Google Drive sign-in lasts an hour. The app renews it the next time you tap anything; your changes are kept on this phone meanwhile.' : state.statusMsg || '';
}

/* ---------- keeping Google Drive connected ----------
   Browser-only Google sign-in hands out 1-hour tokens and no refresh token, and a new one can only be requested
   from inside a tap (Google opens a small window). So: renew automatically on your next tap anywhere when the token
   is about to run out or already has — usually that window opens and closes by itself. */
let renewing = false, lastFail = 0;
async function renewDrive({ manual = false } = {}) {
  const b = state.backend;
  if (!b || b.kind !== 'drive' || renewing) return;
  renewing = true;
  const wasAuth = state.status === 'auth';
  try {
    await b.signIn();
    if (!b.folderId) await loadFromBackend();          // first connection this session: load + merge offline edits
    else {
      if (wasAuth) setStatus(isDirty() ? 'pending' : 'saved');
      if (isDirty()) await flush();
    }
    if (manual || wasAuth) toast('Drive synced ✅', 1800);
  } catch (e) {
    lastFail = Date.now(); // e.g. you closed Google's window: don't pop it up again on every tap
    if (manual) toast(e.message, 5000);
    if (!b.hasToken()) setStatus('auth', e.message);
  } finally { renewing = false; }
}
document.addEventListener('click', e => {
  const b = state.backend;
  if (!b || b.kind !== 'drive' || renewing || !cfg('mode')) return;
  if (document.documentElement.classList.contains('locked') || e.target.closest('#sync, #lock')) return;
  const due = state.status === 'auth' || b.expiresIn() < 8 * 60 * 1000; // renew a little before it runs out
  if (due && Date.now() - lastFail > 60000) renewDrive();
}, true);
// notice when the hour is up even if nothing has tried to save yet
setInterval(() => { const b = state.backend; if (b?.kind === 'drive' && !b.hasToken() && state.status !== 'auth' && state.status !== 'idle') setStatus('auth'); }, 60000);

$('#sync').addEventListener('click', async () => {
  if (state.status === 'auth') renewDrive({ manual: true });
  else if (state.status === 'error') {
    toast(state.statusMsg || 'Sync error', 5000);
    flush();
  }
});
$('#back').addEventListener('click', () => (history.length > 1 ? history.back() : go('#/')));
document.addEventListener('click', e => {
  const img = e.target.closest('img[data-full]');
  if (!img || e.target.closest('a')) return;
  e.preventDefault();
  // open every photo in the same strip/grid, starting at the one tapped
  const box = img.closest('[data-gallery], .carousel, .photos, .files') || img.parentElement;
  const imgs = [...box.querySelectorAll('img[data-full]')];
  gallery(imgs.map(x => ({ f: x.dataset.full, t: x.dataset.fid !== x.dataset.full ? x.dataset.fid : null })), Math.max(0, imgs.indexOf(img)));
});

on('status', renderStatus);
on('route', route);
on('remote-change', () => {
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return; // don't wipe a form you're typing in
  if (document.querySelector('.sheet-wrap')) return;
  if (/^#\/(h|d)\/(new|[^/]+\/edit)/.test(location.hash) || /\/inspect\//.test(location.hash)) return;
  route();
});
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', e => {
  if (isDirty() && state.status !== 'auth') { flush(); }
  if (pendingJobs().length) { e.preventDefault(); e.returnValue = ''; } // photos still uploading
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

async function boot() {
  initLock();
  const mode = cfg('mode');
  if (mode) {
    state.backend = makeBackend(mode);
    if (mode === 'drive') {
      const cached = readCache();
      if (cached) state.db = cached;
    }
  }
  route();
  if (!mode) return;
  if (mode === 'drive' && !state.backend.hasToken()) { setStatus('auth', 'Sign in to Google Drive to sync'); renderStatus(); return; }
  try { await loadFromBackend(); }
  catch (e) {
    if (e instanceof AuthNeeded) setStatus('auth', e.message);
    else { setStatus('error', e.message); toast('Could not load: ' + e.message, 6000); }
  }
}
boot();
