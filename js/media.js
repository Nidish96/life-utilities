import { state } from './state.js';

async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Unsupported image'));
      img.src = URL.createObjectURL(file);
    });
  }
}

// Resize to fit `max` px on the long side and re-encode as JPEG (keeps Drive usage small).
export async function compressImage(file, max = 1600, q = 0.82) {
  const src = await decode(file);
  const w = src.width, h = src.height;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', q));
}

// Returns [{f: fullFileId, t: thumbFileId}]
export async function uploadPhotos(files, onProgress, max = 1600) {
  const out = [];
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  let i = 0;
  for (const file of files) {
    const full = await compressImage(file, max);
    const thumb = await compressImage(file, 420, 0.75);
    const [f, t] = await Promise.all([
      state.backend.putFile(full, `${stamp}_${i}.jpg`),
      state.backend.putFile(thumb, `${stamp}_${i}_thumb.jpg`),
    ]);
    out.push({ f, t });
    onProgress?.(++i, files.length);
  }
  return out;
}

export async function uploadRaw(file, name) {
  return state.backend.putFile(file, name || file.name || 'file');
}

export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

export async function deletePhotos(photos) {
  for (const p of photos || []) {
    for (const id of [p.f, p.t]) if (id) state.backend.deleteFile(id).catch(() => {});
  }
}
