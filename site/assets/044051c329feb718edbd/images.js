import { LIMITS } from './definitions.js';
import { BOARD_TEMPLATES, boardAspectRatio, drawBoard } from './boards.js';
import { loadBoardImage } from './board-assets.js';

export { drawBoard } from './boards.js';

// These limits are checked against the encoded header before an image decoder runs.
export const validationLimits = Object.freeze({ imageBytes: LIMITS.imageBytes, pixels: LIMITS.pixels, side: LIMITS.side });

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const INVALID_IMAGE = 'JPEG・PNG・WebPの写真を選んでください。HEICはJPEGに変換してください。';
const HEADER_BYTES = 1024 * 1024;
const INITIAL_HEADER_BYTES = 64 * 1024;
const headers = new WeakMap();
const validated = new WeakMap();
const pendingValidations = new WeakMap();
let imageQueue = Promise.resolve();
function abortIfNeeded(signal) { if (signal?.aborted) throw new DOMException('画像処理を取り消しました。', 'AbortError'); }
// Keep only metadata in caches. A global queue prevents overlapping large decoded bitmaps.
function imageTask(task, signal) {
  const result = imageQueue.then(() => { abortIfNeeded(signal); return task(); });
  imageQueue = result.then(() => undefined, () => undefined);
  return result;
}

function checkDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('写真の大きさを読み取れません。別の写真を選んでください。');
  }
  if (width > validationLimits.side || height > validationLimits.side || width * height > validationLimits.pixels) {
    throw new Error('写真が大きすぎます。一辺16,000px・4,000万画素以下にしてください。');
  }
}

function word(bytes, at) {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

function readDimensions(bytes, totalBytes = bytes.length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 33 && bytes[0] === 0x89 && word(bytes, 1) === 'PNG\r' && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) {
    if (view.getUint32(8) !== 13 || word(bytes, 12) !== 'IHDR') throw new Error(INVALID_IMAGE);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at < bytes.length) {
      if (bytes[at++] !== 0xff) break;
      while (bytes[at] === 0xff) at += 1;
      const marker = bytes[at++];
      if (marker === undefined || marker === 0xda || marker === 0xd9 || marker === 0x00) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (at + 2 > bytes.length) break;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) break;
      if (JPEG_SOF.has(marker)) {
        if (length < 8) break;
        return { width: view.getUint16(at + 5), height: view.getUint16(at + 3) };
      }
      at += length;
    }
    throw new Error('JPEGを読み取れません。写真が壊れていないか確認してください。');
  }
  if (bytes.length >= 20 && word(bytes, 0) === 'RIFF' && word(bytes, 8) === 'WEBP') {
    const end = view.getUint32(4, true) + 8;
    if (end > totalBytes || end < 20) throw new Error(INVALID_IMAGE);
    let at = 12;
    while (at + 8 <= end) {
      const kind = word(bytes, at);
      const length = view.getUint32(at + 4, true);
      const start = at + 8;
      if (start + length > end) break;
      if (start + Math.min(length, 10) > bytes.length) break;
      if (kind === 'VP8X' && length >= 10) {
        return {
          width: 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16),
          height: 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16),
        };
      }
      if (kind === 'VP8 ' && length >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a) {
        return { width: view.getUint16(start + 6, true) & 0x3fff, height: view.getUint16(start + 8, true) & 0x3fff };
      }
      if (kind === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
        return {
          width: 1 + bytes[start + 1] + ((bytes[start + 2] & 0x3f) << 8),
          height: 1 + (bytes[start + 2] >> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 0x0f) << 10),
        };
      }
      at = start + length + (length % 2);
    }
  }
  throw new Error(INVALID_IMAGE);
}

async function imageHeader(blob, signal) {
  if (headers.has(blob)) return headers.get(blob);
  abortIfNeeded(signal);
  const initial = await blob.slice(0, INITIAL_HEADER_BYTES).arrayBuffer();
  abortIfNeeded(signal);
  let header;
  try { header = readDimensions(new Uint8Array(initial), blob.size); }
  catch (error) {
    if (blob.size <= INITIAL_HEADER_BYTES) throw error;
    try { header = readDimensions(new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer()), blob.size); }
    catch (extendedError) {
      if (blob.size <= HEADER_BYTES) throw extendedError;
      // Some JPEGs have unusually large EXIF/ICC data before SOF. Preserve their support.
      header = readDimensions(new Uint8Array(await blob.arrayBuffer()), blob.size);
    }
  }
  abortIfNeeded(signal); checkDimensions(header.width, header.height); headers.set(blob, header);
  return header;
}

async function decodeImage(blob, signal) {
  abortIfNeeded(signal);
  if (!(blob instanceof Blob) || blob.size < 1) throw new Error('空の写真ファイルは取り込めません。');
  if (blob.size > validationLimits.imageBytes) throw new Error('写真は1枚20MiBまでです。小さくしてから取り込んでください。');
  const header = await imageHeader(blob, signal);
  let decoded;
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      decoded = { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Safari and older browsers may support a format only through HTMLImageElement.
    }
  }
  if (!decoded) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      await new Promise((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener('abort', cancel);
        const cancel = () => { cleanup(); img.src = ''; reject(new DOMException('画像処理を取り消しました。', 'AbortError')); };
        img.onload = () => { cleanup(); resolve(); };
        img.onerror = () => { cleanup(); reject(new Error('写真を表示できません。壊れていないか、形式を確認してください。')); };
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) { cancel(); return; }
        img.src = url;
      });
      decoded = { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => { img.src = ''; URL.revokeObjectURL(url); } };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }
  try {
    abortIfNeeded(signal);
    checkDimensions(decoded.width, decoded.height);
    // EXIF orientation may swap the two sides; a different decoded canvas is invalid.
    const same = decoded.width === header.width && decoded.height === header.height;
    const rotated = decoded.width === header.height && decoded.height === header.width;
    if (!same && !rotated) throw new Error('写真の大きさを正しく読み取れません。別の写真を選んでください。');
    validated.set(blob, { width: decoded.width, height: decoded.height });
    return decoded;
  } catch (error) {
    decoded.close();
    throw error;
  }
}

export async function validateImage(blob, { signal } = {}) {
  abortIfNeeded(signal);
  if (validated.has(blob)) return { ...validated.get(blob) };
  if (!signal && pendingValidations.has(blob)) return { ...await pendingValidations.get(blob) };
  const result = imageTask(async () => {
    if (validated.has(blob)) return { ...validated.get(blob) };
    const decoded = await decodeImage(blob, signal);
    try { return { width: decoded.width, height: decoded.height }; }
    finally { decoded.close(); }
  }, signal);
  if (!signal && blob instanceof Blob) pendingValidations.set(blob, result);
  try { return { ...await result }; }
  finally { if (!signal && blob instanceof Blob) pendingValidations.delete(blob); }
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('このブラウザーでは写真を描画できません。');
  return { canvas, ctx };
}

function jpegBlob(canvas, quality, signal) {
  abortIfNeeded(signal);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (signal?.aborted) { reject(new DOMException('画像処理を取り消しました。', 'AbortError')); return; }
      blob ? resolve(blob) : reject(new Error('写真を書き出せませんでした。端末の空きメモリを確認してください。'));
    }, 'image/jpeg', quality);
  });
}

export async function createThumbnail(blob, { signal } = {}) {
  return imageTask(async () => {
  const decoded = await decodeImage(blob, signal);
  let canvas;
  try {
    const ratio = Math.min(1, 480 / Math.max(decoded.width, decoded.height));
    const drawing = createCanvas(Math.max(1, Math.round(decoded.width * ratio)), Math.max(1, Math.round(decoded.height * ratio)));
    canvas = drawing.canvas;
    drawing.ctx.fillStyle = '#fff';
    drawing.ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawing.ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    return await jpegBlob(canvas, 0.78, signal);
  } finally {
    decoded.close();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
  }, signal);
}

async function preparePhotoInternal(original, photo, signal) {
  if ((photo?.applyBoard === false || !photo?.board) && validated.has(original)) {
    abortIfNeeded(signal);
    return { blob: original, ...validated.get(original) };
  }
  const decoded = await decodeImage(original, signal);
  let canvas;
  try {
    if (photo?.applyBoard === false || !photo?.board) return { blob: original, width: decoded.width, height: decoded.height };
    const aspectRatio = boardAspectRatio(photo.board);
    if (photo.board.templateId !== 'legacy-simple') await loadBoardImage(photo.board.templateId);
    abortIfNeeded(signal);
    const ratio = Math.min(1, 2000 / Math.max(decoded.width, decoded.height));
    const drawing = createCanvas(Math.max(1, Math.round(decoded.width * ratio)), Math.max(1, Math.round(decoded.height * ratio)));
    canvas = drawing.canvas;
    const { ctx } = drawing;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const margin = Math.max(0, Math.min(Math.max(4, Math.round(Math.min(canvas.width, canvas.height) * 0.025)), (canvas.width - 1) / 2, (canvas.height - 1) / 2));
    const legacy = photo.board.templateId === 'legacy-simple';
    const boardWidth = legacy ? Math.min(canvas.width * (canvas.width < canvas.height ? 0.9 : 0.55), canvas.height * 0.52 * aspectRatio,
      canvas.width - margin * 2, (canvas.height - margin * 2) * aspectRatio) : Math.min(canvas.width * .29, canvas.height * aspectRatio);
    const boardHeight = boardWidth / aspectRatio;
    const result = drawBoard(ctx, legacy ? canvas.width - boardWidth - margin : 0, canvas.height - boardHeight - (legacy ? margin : 0), boardWidth, boardHeight, photo.board);
    if (result.overflow) {
      const labels = Object.fromEntries(BOARD_TEMPLATES[photo.board.templateId].fields.map(field => [field.key, field.label]));
      throw new Error(`黒板の文字が収まりません（${result.overflowFields.map(key => labels[key]).join('・')}）。短くしてください。`);
    }
    return { blob: await jpegBlob(canvas, 0.93, signal), width: decoded.width, height: decoded.height };
  } finally {
    decoded.close();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}

/** Output pipeline can validate and compose in one decode, including original-only MMS. */
export async function preparePhoto(original, photo, { signal } = {}) {
  return imageTask(() => preparePhotoInternal(original, photo, signal), signal);
}

export async function composePhoto(original, photo, { signal } = {}) {
  abortIfNeeded(signal);
  if (photo?.applyBoard === false || !photo?.board) return original;
  return (await preparePhoto(original, photo, { signal })).blob;
}
