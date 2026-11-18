import { state, cfg, on, setStatus, readCache, loadFromBackend, flush, isDirty } from './state.js';
import { AuthNeeded } from './storage.js';
import { $, esc, toast, gallery, go } from './ui.js';
import { pendingJobs } from './uploads.js';
import { makeBackend, connectDrive } from './connect.js';
import { home } from './views/home.js';
import { peopleList, personPage } from './views/people.js';
import { addPage, importPage } from './views/capture.js';
import { housesList, houseDetail, houseEdit, houseReportPage } from './views/houses.js';
import { docsList, docDetail, docEdit } from './views/docs.js';
import { reimbList } from './views/reimb.js';
import { initLock } from './lock.js';
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
  [/^\/h\/([^/]+)$/, houseDetail, 'houses'],
  [/^\/docs$/, docsList, 'docs'],
  [/^\/reimb$/, reimbList, 'docs'],
  [/^\/d\/new$/, (v, q) => docEdit(v, 'new', q), 'docs'],
  [/^\/d\/([^/]+)\/edit$/, docEdit, 'docs'],
  [/^\/d\/([^/]+)$/, docDetail, 'docs'],
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
    saved: local ? '📱 On device' : '✓ Saved', auth: '⚠️ Tap to reconnect Drive', error: '⚠️ Sync problem',
  };
  el.textContent = busy + (map[s] ?? '');
  el.className = 'pill' + (s === 'auth' || s === 'error' ? ' warn' : '');
  el.title = state.statusMsg || '';
}

$('#sync').addEventListener('click', async () => {
  if (state.status === 'auth') {
    try {
      await connectDrive();
      if (isDirty()) await flush();
      toast('Reconnected ✅');
      route();
    } catch (e) { toast(e.message, 5000); }
  } else if (state.status === 'error') {
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
  if (/^#\/(h|d)\/(new|[^/]+\/edit)/.test(location.hash)) return;
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
