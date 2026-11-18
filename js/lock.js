// App lock: a passcode (and optionally Face ID / fingerprint) screen in front of the app on this device.
// The passcode is never stored, only a salted PBKDF2 hash. This is a privacy lock for the screen:
// it keeps people who pick up your phone out, but it does not encrypt data cached in the browser.
import { $, esc, toast, openSheet } from './ui.js';

const KEY = 'lu.lock', FAIL = 'lu.lockfail';
const ITER = 210000;
export const TIMEOUTS = [[0, 'Immediately'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes']];

const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rand = n => crypto.getRandomValues(new Uint8Array(n));

const read = (k, store = localStorage) => { try { return JSON.parse(store.getItem(k) || 'null'); } catch { return null; } };
export const lockCfg = () => read(KEY);
export const lockOn = () => !!lockCfg()?.hash;
const write = c => (c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY));

async function derive(pass, salt, iter) {
  if (!crypto.subtle) throw new Error('App lock needs a secure (https) connection.');
  const k = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256));
}
export async function checkPass(pass) {
  const c = lockCfg();
  if (!c?.hash) return true;
  const h = await derive(pass, unb64(c.salt), c.iter);
  let diff = h.length ^ c.hash.length; // constant-time compare
  for (let i = 0; i < Math.max(h.length, c.hash.length); i++) diff |= (h.charCodeAt(i) || 0) ^ (c.hash.charCodeAt(i) || 0);
  return diff === 0;
}
export async function setPass(pass, opts = {}) {
  const salt = rand(16);
  const prev = lockCfg() || {};
  write({ timeout: 1, ...prev, ...opts, salt: b64(salt), iter: ITER, hash: await derive(pass, salt, ITER) });
  markUnlocked();
}
export function updateLock(patch) { const c = lockCfg(); if (c) write({ ...c, ...patch }); }
export function disableLock() { write(null); localStorage.removeItem(FAIL); }

/* ---------- Face ID / fingerprint (WebAuthn platform authenticator, checked on this device only) ---------- */
export async function bioAvailable() {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
}
export async function enrollBio() {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: rand(32),
    rp: { name: 'Life Utilities' },
    user: { id: rand(16), name: 'life-utilities', displayName: 'Life Utilities' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000,
  } });
  updateLock({ cred: b64(cred.rawId) });
}
async function bioCheck() {
  const c = lockCfg();
  const a = await navigator.credentials.get({ publicKey: {
    challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(c.cred) }], userVerification: 'required', timeout: 60000,
  } });
  return !!a && a.response.authenticatorData && new DataView(a.response.authenticatorData).getUint8(32) & 0x04; // UV flag
}

/* ---------- locking ---------- */
let locked = false;
const ss = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } } };
function markUnlocked() { ss.set('lu.unlocked', '1'); ss.set('lu.hiddenAt', ''); }
const timeoutMs = () => (lockCfg()?.timeout ?? 1) * 60000;

// A reload in the same tab within the timeout (e.g. the phone dropped the page while you used the camera) stays unlocked.
function graceStillValid() {
  if (ss.get('lu.unlocked') !== '1') return false;
  const at = +ss.get('lu.hiddenAt');
  return !at || (Date.now() - at < timeoutMs() && timeoutMs() > 0);
}

export function lockNow() {
  if (!lockOn() || locked) return;
  locked = true;
  ss.set('lu.unlocked', '');
  document.documentElement.classList.add('locked');
  document.activeElement?.blur?.();
  render();
}
function unlock() {
  locked = false;
  localStorage.removeItem(FAIL);
  markUnlocked();
  document.documentElement.classList.remove('locked');
  $('#lock')?.remove();
}

function failState() { return read(FAIL) || { n: 0, until: 0 }; }
function recordFail() {
  const f = failState(); f.n++;
  if (f.n >= 5) f.until = Date.now() + 30000 * 2 ** Math.min(f.n - 5, 6); // 30s, 1m, 2m … up to 32m
  localStorage.setItem(FAIL, JSON.stringify(f));
  return f;
}

function render() {
  $('#lock')?.remove();
  const c = lockCfg();
  const el = document.createElement('div');
  el.id = 'lock';
  el.innerHTML = `
    <form class="lockbox" autocomplete="off">
      <div class="logo">🔒</div>
      <h2>Life Utilities is locked</h2>
      <input type="password" id="lk-pass" placeholder="Passcode" autocomplete="off" aria-label="Passcode" ${c.numeric ? 'inputmode="numeric"' : ''}>
      <p class="small warn" id="lk-msg"></p>
      <button class="btn primary block big" id="lk-go" type="submit">Unlock</button>
      ${c.cred ? '<button class="btn block" id="lk-bio" type="button">👆 Use Face ID / fingerprint</button>' : ''}
      <button class="btn ghost small" id="lk-forgot" type="button">Forgot passcode?</button>
    </form>`;
  document.body.appendChild(el);
  const msg = $('#lk-msg', el), inp = $('#lk-pass', el), go = $('#lk-go', el);
  const waitMsg = () => {
    const left = failState().until - Date.now();
    if (left <= 0) { go.disabled = false; msg.textContent = ''; return false; }
    go.disabled = true; msg.textContent = `Too many tries. Wait ${Math.ceil(left / 1000)}s.`;
    setTimeout(waitMsg, 1000); return true;
  };
  waitMsg();
  $('form', el).onsubmit = async e => {
    e.preventDefault();
    if (waitMsg() || !inp.value) return;
    go.disabled = true;
    if (await checkPass(inp.value)) return unlock();
    const f = recordFail();
    inp.value = ''; go.disabled = false;
    el.querySelector('.lockbox').classList.remove('shake'); void el.offsetWidth; el.querySelector('.lockbox').classList.add('shake');
    msg.textContent = f.n >= 5 ? '' : `Wrong passcode${f.n >= 3 ? ` (${5 - f.n} more before a pause)` : ''}`;
    waitMsg();
  };
  const bio = async () => {
    try { if (await bioCheck()) unlock(); }
    catch (err) { if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') msg.textContent = 'Face ID / fingerprint didn\'t work — use your passcode.'; }
  };
  $('#lk-bio', el)?.addEventListener('click', bio);
  $('#lk-forgot', el).onclick = () => forgot(el);
  if (c.cred && document.visibilityState === 'visible') bio(); // browsers that need a tap will just ignore this
  else setTimeout(() => inp.focus(), 50);
}

function forgot(el) {
  const local = (read('lu.settings') || {}).mode === 'local';
  const box = el.querySelector('.lockbox');
  box.innerHTML = `<div class="logo">🔑</div><h2>Forgot your passcode?</h2>
    <p class="small">The only way back in is to erase this app's data from this phone and start again.</p>
    <p class="small ${local ? 'warn' : 'muted'}">${local
      ? '⚠️ Your data is stored only on this device, so it will be <b>permanently deleted</b>.'
      : 'Your data is safe in Google Drive. You\'ll just sign in again (anything not yet synced from this phone is lost).'}</p>
    <button class="btn danger block" id="lk-erase" type="button">Erase this device</button>
    <button class="btn block" id="lk-back" type="button">Back</button>`;
  $('#lk-back', box).onclick = render;
  $('#lk-erase', box).onclick = async () => {
    if (local && !confirm('Delete everything stored on this device? This cannot be undone.')) return;
    ['lu.settings', 'lu.tok', 'lu.cache', 'lu.dirty', KEY, FAIL].forEach(k => localStorage.removeItem(k));
    try { sessionStorage.clear(); } catch { /* ignore */ }
    try { indexedDB.deleteDatabase('lifeutils'); } catch { /* ignore */ }
    location.hash = '#/'; location.reload();
  };
}

// Call once, before the first render.
export function initLock() {
  if (lockOn() && !graceStillValid()) lockNow();
  else document.documentElement.classList.remove('locked');
  document.addEventListener('visibilitychange', () => {
    if (!lockOn()) return;
    if (document.visibilityState === 'hidden') {
      if (locked) return;
      ss.set('lu.hiddenAt', String(Date.now()));
      if (timeoutMs() === 0) lockNow(); // so the app switcher shows the lock screen, not your data
    } else if (!locked) {
      const at = +ss.get('lu.hiddenAt');
      if (at && Date.now() - at >= timeoutMs()) lockNow();
      else ss.set('lu.hiddenAt', '');
    }
  });
}

/* ---------- settings card ---------- */
export async function lockSettingsHtml() {
  const c = lockCfg(), bio = await bioAvailable();
  if (!c?.hash) return `
    <p class="small">Ask for a passcode when you open the app on this device.</p>
    <div class="grid2"><label>New passcode<input type="password" id="lk-new" autocomplete="new-password"></label>
    <label>Repeat it<input type="password" id="lk-new2" autocomplete="new-password"></label></div>
    <button class="btn primary" id="lk-enable">🔒 Turn on app lock</button>`;
  return `
    <p class="small">✅ On for this device.</p>
    <label>Lock the app<select id="lk-timeout">${TIMEOUTS.map(([m, l]) => `<option value="${m}" ${c.timeout === m ? 'selected' : ''}>${esc(l)} after I leave it</option>`).join('')}</select></label>
    ${bio ? `<label class="check"><input type="checkbox" id="lk-bio-on" ${c.cred ? 'checked' : ''}> Unlock with Face ID / fingerprint</label>` : ''}
    <div class="row wrap"><button class="btn" id="lk-change">Change passcode</button><button class="btn" id="lk-now">Lock now</button><button class="btn danger" id="lk-off">Turn off</button></div>`;
}

// Sheet that asks for the current passcode (and a new one when changing it).
function ask(change) {
  return new Promise(res => {
    const s = openSheet(`<h3>${change ? 'Change passcode' : 'Turn off app lock'}</h3><form autocomplete="off">
      <label>Current passcode<input type="password" id="ap-cur" autocomplete="off"></label>
      ${change ? `<label>New passcode<input type="password" id="ap-new" autocomplete="new-password"></label>
      <label>Repeat new passcode<input type="password" id="ap-new2" autocomplete="new-password"></label>` : ''}
      <p class="small warn" id="ap-msg"></p>
      <button class="btn primary block" type="submit">${change ? 'Change' : 'Turn off'}</button></form>`, { onClose: () => res(null) });
    const q = sel => s.el.querySelector(sel);
    q('form').onsubmit = async e => {
      e.preventDefault();
      const next = q('#ap-new')?.value;
      if (change && next.length < 4) return (q('#ap-msg').textContent = 'Use at least 4 characters');
      if (change && next !== q('#ap-new2').value) return (q('#ap-msg').textContent = 'The new passcodes don\'t match');
      if (!(await checkPass(q('#ap-cur').value))) return (q('#ap-msg').textContent = 'Current passcode is wrong');
      res({ next }); s.close();
    };
    setTimeout(() => q('#ap-cur').focus(), 50);
  });
}

export function wireLockSettings(root, rerender) {
  const q = s => root.querySelector(s);
  q('#lk-enable')?.addEventListener('click', async () => {
    const a = q('#lk-new').value, b = q('#lk-new2').value;
    if (a.length < 4) return toast('Use at least 4 characters');
    if (a !== b) return toast('The two passcodes don\'t match');
    try { await setPass(a, { numeric: /^\d+$/.test(a) }); } catch (e) { return toast(e.message, 5000); }
    toast('App lock is on 🔒');
    if (await bioAvailable() && confirm('Also unlock with Face ID / fingerprint?')) {
      try { await enrollBio(); toast('Face ID / fingerprint added'); } catch { toast('Skipped Face ID / fingerprint'); }
    }
    rerender();
  });
  q('#lk-timeout')?.addEventListener('change', e => { updateLock({ timeout: +e.target.value }); toast('Saved'); });
  q('#lk-bio-on')?.addEventListener('change', async e => {
    if (e.target.checked) {
      try { await enrollBio(); toast('Face ID / fingerprint added'); } catch { e.target.checked = false; toast('Couldn\'t set up Face ID / fingerprint'); }
    } else { updateLock({ cred: null }); toast('Face ID / fingerprint unlock off'); }
  });
  q('#lk-now')?.addEventListener('click', lockNow);
  q('#lk-change')?.addEventListener('click', async () => {
    const r = await ask(true);
    if (!r) return;
    await setPass(r.next, { numeric: /^\d+$/.test(r.next) });
    toast('Passcode changed');
  });
  q('#lk-off')?.addEventListener('click', async () => {
    const r = await ask(false);
    if (!r) return;
    disableLock(); toast('App lock is off'); rerender();
  });
}
