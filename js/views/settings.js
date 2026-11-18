import { state, cfg, setLocal, setShared, live, markDirty, flush, emit } from '../state.js';
import { mergeDb, normalize, preloadGoogle } from '../storage.js';
import { $, $$, esc, setTitle, toast, confirmDlg, download, today, go } from '../ui.js';
import { connectDrive, startLocal } from '../connect.js';
import { testKey, provider } from '../ai.js';

export function welcome(view) {
  setTitle('Life Utilities');
  if (cfg('clientId')) preloadGoogle().catch(() => {});
  view.innerHTML = `
    <div class="hero"><div class="logo">✦</div><h2>Your little life OS</h2>
    <p class="muted">Remember what your people love · track house hunts · keep bills & prescriptions safe.</p></div>
    <div class="card">
      <h3>☁️ Keep everything in Google Drive</h3>
      <p class="small">The app creates a folder called <b>${esc(cfg('folderName'))}</b> in your Drive and stores your data and photos there. It can only see files it created. Works on your phone and laptop.</p>
      ${cfg('clientId') ? '' : `<label>Google OAuth Client ID<input id="w-cid" placeholder="1234-abc.apps.googleusercontent.com"></label><p class="hint">One-time setup — see README step 2. Or put it in <code>js/config.js</code> so you never type it again.</p>`}
      <button class="btn primary block" id="w-drive">Connect Google Drive</button>
    </div>
    <div class="card">
      <h3>📱 Just try it on this device</h3>
      <p class="small">Data stays in this browser. You can move it all (photos included) to Drive later from Settings.</p>
      <button class="btn block" id="w-local">Start on this device</button>
    </div>`;
  $('#w-drive').onclick = async () => {
    const cid = $('#w-cid')?.value.trim();
    if (cid) { setLocal('clientId', cid); await preloadGoogle().catch(() => {}); }
    if (!cfg('clientId')) return toast('Paste your Google OAuth Client ID first');
    try { await connectDrive(); go('#/'); emit('route'); } catch (e) { toast(e.message, 6000); }
  };
  $('#w-local').onclick = async () => { await startLocal(); go('#/'); emit('route'); };
}

export function settingsPage(view) {
  setTitle('Settings', true);
  const b = state.backend;
  const mode = cfg('mode');
  const count = live('people').length + live('facts').length + live('houses').length + live('documents').length + live('memories').length;
  view.innerHTML = `
    <div class="card">
      <h3>☁️ Storage</h3>
      <p>${mode === 'drive' ? `Google Drive, folder <b>${esc(cfg('folderName'))}</b> — ${b?.hasToken() ? '✅ connected' : '⚠️ needs reconnecting'}` : mode === 'local' ? '📱 This device only' : 'Not set up'}</p>
      ${b?.folderUrl?.() ? `<a class="btn ghost" target="_blank" rel="noopener" href="${b.folderUrl()}">Open folder in Drive</a>` : ''}
      ${mode === 'drive' ? `<button class="btn" id="s-reconnect">🔄 Reconnect Drive</button>` : ''}
      ${mode === 'local' ? `<label>Google OAuth Client ID<input id="s-cid" value="${esc(cfg('clientId'))}"></label>
        <button class="btn primary" id="s-todrive">Move my data to Google Drive</button>` : ''}
      <details><summary class="small muted">Advanced</summary>
        <label>Google OAuth Client ID<input id="s-cid2" value="${esc(cfg('clientId'))}"></label>
        <label>Drive folder name<input id="s-folder" value="${esc(cfg('folderName'))}"></label>
        <button class="btn" id="s-adv">Save</button></details>
    </div>
    <div class="card">
      <h3>✨ AI assistant</h3>
      <p class="small">Sorts what you type, looks things up on the web, suggests ideas, reads bills and writes house reports. Pick one provider. Keys are stored on this device${mode === 'drive' ? ' (and optionally in your private Drive folder so your other devices get them)' : ''} and are only ever sent to that provider.</p>
      <div class="seg block" id="s-prov"><button data-p="claude" class="${provider() === 'claude' ? 'on' : ''}">Claude</button><button data-p="gemini" class="${provider() === 'gemini' ? 'on' : ''}">Gemini</button></div>
      <div id="s-claude" ${provider() === 'claude' ? '' : 'hidden'}>
        <label>Claude API key <small>(<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">get one</a>)</small><input id="s-key" type="password" value="${esc(cfg('apiKey') || '')}" placeholder="sk-ant-…" autocomplete="off"></label>
        <div class="grid2"><label>Fast model <small>(sorting, lookups)</small><input id="s-fast" value="${esc(cfg('fastModel'))}"></label>
        <label>Smart model <small>(import, ideas, reports, bills)</small><input id="s-smart" value="${esc(cfg('smartModel'))}"></label></div>
      </div>
      <div id="s-gemini" ${provider() === 'gemini' ? '' : 'hidden'}>
        <label>Gemini API key <small>(<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">get one in Google AI Studio</a>)</small><input id="s-gkey" type="password" value="${esc(cfg('geminiKey') || '')}" placeholder="AIza…" autocomplete="off"></label>
        <div class="grid2"><label>Fast model <small>(sorting, lookups)</small><input id="s-gfast" value="${esc(cfg('geminiFastModel'))}"></label>
        <label>Smart model <small>(import, ideas, reports, bills)</small><input id="s-gsmart" value="${esc(cfg('geminiSmartModel'))}"></label></div>
        <p class="hint">The <code>-latest</code> names always point to Google's newest Flash models. You can put a specific model here instead, e.g. <code>gemini-3.8-flash</code>.</p>
      </div>
      ${mode === 'drive' ? `<label class="check"><input type="checkbox" id="s-sync" ${state.db.settings.apiKey || state.db.settings.geminiKey ? 'checked' : ''}> Sync keys to my other devices via my Drive folder</label>` : ''}
      <div class="row"><button class="btn primary" id="s-savekey">Save</button><button class="btn" id="s-test">Test</button><span id="s-testout" class="small"></span></div>
    </div>
    <div class="card">
      <h3>🏠 About you</h3>
      <div class="grid2"><label>Home city <small>(for local suggestions)</small><input id="s-city" value="${esc(cfg('homeCity'))}" placeholder="Bengaluru"></label>
      <label>Currency symbol<input id="s-cur" value="${esc(cfg('currency'))}"></label></div>
      <button class="btn" id="s-savepers">Save</button>
    </div>
    <div class="card">
      <h3>💾 Backup</h3>
      <p class="small">${count} records. Export downloads everything except photos as one JSON file. Import merges a backup into what's here.</p>
      <div class="row wrap"><button class="btn" id="s-export">⬇ Export JSON</button><label class="btn">⬆ Import JSON<input type="file" id="s-import" accept=".json,application/json" hidden></label></div>
    </div>
    <div class="card">
      <h3>This device</h3>
      <button class="btn danger" id="s-forget">Sign out & forget this device</button>
      <p class="hint">Removes the saved key, sign-in and cached data from this browser. Your Drive data is untouched.</p>
    </div>`;

  $('#s-reconnect')?.addEventListener('click', async () => { try { await connectDrive(); toast('Connected'); settingsPage(view); } catch (e) { toast(e.message, 5000); } });
  $('#s-todrive')?.addEventListener('click', async () => {
    const cid = $('#s-cid').value.trim(); if (cid) setLocal('clientId', cid);
    if (!cfg('clientId')) return toast('Add your Google OAuth Client ID first');
    try { await preloadGoogle(); await connectDrive({ migrate: true }); toast('Moved to Google Drive ✅'); settingsPage(view); }
    catch (e) { toast(e.message, 6000); }
  });
  $('#s-adv').onclick = () => { setLocal('clientId', $('#s-cid2').value.trim()); setLocal('folderName', $('#s-folder').value.trim()); toast('Saved — reload the app to apply'); };
  let prov = provider();
  $$('#s-prov button').forEach(btn => btn.onclick = () => {
    prov = btn.dataset.p;
    $$('#s-prov button').forEach(x => x.classList.toggle('on', x === btn));
    $('#s-claude').hidden = prov !== 'claude'; $('#s-gemini').hidden = prov !== 'gemini';
  });
  $('#s-savekey').onclick = () => {
    const key = $('#s-key').value.trim(), gkey = $('#s-gkey').value.trim();
    setLocal('apiKey', key); setLocal('geminiKey', gkey);
    setShared('provider', prov);
    const sync = $('#s-sync')?.checked;
    if (mode === 'drive') { setShared('apiKey', sync ? key : ''); setShared('geminiKey', sync ? gkey : ''); }
    setShared('fastModel', $('#s-fast').value.trim()); setShared('smartModel', $('#s-smart').value.trim());
    setShared('geminiFastModel', $('#s-gfast').value.trim()); setShared('geminiSmartModel', $('#s-gsmart').value.trim());
    toast('Saved');
  };
  $('#s-test').onclick = async () => {
    $('#s-savekey').click();
    const out = $('#s-testout'); out.textContent = 'Testing…';
    try { await testKey(); out.textContent = '✅ Works'; } catch (e) { out.textContent = '❌ ' + e.message; }
  };
  $('#s-savepers').onclick = () => { setShared('homeCity', $('#s-city').value.trim()); setShared('currency', $('#s-cur').value.trim() || '₹'); toast('Saved'); };
  $('#s-export').onclick = () => {
    const db = structuredClone(state.db); delete db.settings.apiKey; delete db.settings.geminiKey;
    download(`life-utilities-backup-${today()}.json`, JSON.stringify(db, null, 1));
  };
  $('#s-import').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const incoming = normalize(JSON.parse(await f.text()));
      state.db = mergeDb(incoming, state.db);
      markDirty(); await flush(); emit('remote-change'); toast('Imported ✅'); settingsPage(view);
    } catch (err) { toast('Import failed: ' + err.message, 5000); }
  };
  $('#s-forget').onclick = async () => {
    if (!(await confirmDlg('Forget this device? Unsynced changes will be lost.', 'Forget'))) return;
    state.backend?.signOut?.();
    ['lu.settings', 'lu.tok', 'lu.cache', 'lu.dirty'].forEach(k => localStorage.removeItem(k));
    location.hash = '#/'; location.reload();
  };
}
