// Choosing / switching storage, and moving on-device data into Drive.
import { state, cfg, setLocal, setStatus, loadFromBackend, markDirty, flush, emit } from './state.js';
import { DriveBackend, LocalBackend, mergeDb, normalize } from './storage.js';

export function makeBackend(mode) {
  return mode === 'drive' ? new DriveBackend({ clientId: cfg('clientId'), folderName: cfg('folderName') }) : new LocalBackend();
}

export async function startLocal() {
  setLocal('mode', 'local');
  state.backend = new LocalBackend();
  await loadFromBackend();
}

// Must be triggered by a tap (Google's popup).
export async function connectDrive({ migrate = false } = {}) {
  const drive = state.backend?.kind === 'drive' ? state.backend : makeBackend('drive');
  await drive.signIn();
  const prev = state.backend;
  if (migrate && prev?.kind === 'local') {
    setStatus('loading', 'Moving your data to Drive…');
    await drive.init();
    const remote = await drive.loadDb();
    let json = JSON.stringify(state.db);
    const ids = [...new Set(json.match(/"l_[a-z0-9]+"/g) || [])].map(s => s.slice(1, -1));
    let i = 0;
    for (const id of ids) {
      const blob = await prev.fileBlob(id);
      if (blob) json = json.replaceAll(`"${id}"`, `"${await drive.putFile(blob, id + (blob.type === 'application/pdf' ? '.pdf' : '.jpg'))}"`);
      setStatus('loading', `Moving photos to Drive ${++i}/${ids.length}…`);
    }
    state.db = mergeDb(remote, normalize(JSON.parse(json)));
    state.backend = drive;
    setLocal('mode', 'drive');
    markDirty();
    await flush();
    emit('remote-change');
    return;
  }
  state.backend = drive;
  setLocal('mode', 'drive');
  await loadFromBackend();
}
