import { Zip, ZipPassThrough, UnzipInflate } from 'fflate';
import { LIMITS } from './definitions.js';
import { validateProject, upgradeProject } from './model.js';
import { validateImage as defaultValidateImage } from './images.js';
import { yieldTask } from './task-yield.js';

// Original bytes, JSON, and ZIP structure have independent budgets. ZIP32 is
// sufficient at the supported total; this does not guarantee mobile memory/quota.
const METADATA_BYTES = 2 * 1024 * 1024;
const ENTRY_COUNT = LIMITS.photos + 1;
const MAX_NAME_BYTES = 'originals/'.length + 128 + '.webp'.length;
const DIRECTORY_BYTES = Math.max(512 * 1024, ENTRY_COUNT * (46 + MAX_NAME_BYTES));
// ZIP permits 65535-byte local extras and an end comment. Keep these separate
// from the user's original-byte allowance; the writer itself emits no extras.
const HEADER_BYTES = ENTRY_COUNT * (30 + MAX_NAME_BYTES + 65535 + 16) + DIRECTORY_BYTES + 22 + 65535;
// Bounded compatibility room for DEFLATE expansion; our writer uses STORE.
const COMPRESSION_BYTES = Math.ceil((LIMITS.totalBytes + METADATA_BYTES) / 100) + ENTRY_COUNT * 64;
export const PACKAGE_LIMITS = Object.freeze({
  originalBytes: LIMITS.totalBytes,
  metadataBytes: METADATA_BYTES,
  directoryBytes: DIRECTORY_BYTES,
  headerBytes: HEADER_BYTES,
  compressionBytes: COMPRESSION_BYTES,
  archiveBytes: LIMITS.totalBytes + METADATA_BYTES + HEADER_BYTES + COMPRESSION_BYTES,
  expandedBytes: LIMITS.totalBytes + METADATA_BYTES,
  entries: ENTRY_COUNT,
});
const READ_CHUNK = 64 * 1024;
// Small compressed input chunks also bound an inflater's allocation before ondata runs.
const INFLATE_CHUNK = 4096;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const pause = yieldTask;
const fail = message => { throw new Error(message); };
function abortIfNeeded(signal) { if (signal?.aborted) throw new DOMException('作業ZIPの処理を取り消しました。', 'AbortError'); }
const originalPath = name => /^originals\/[A-Za-z0-9_-]{1,128}\.(jpg|png|webp)$/.test(name);
const entryLimit = name => name === 'project.json' ? PACKAGE_LIMITS.metadataBytes : LIMITS.imageBytes;
const progress = (callback, phase, completed, total, bytes, totalBytes) => callback?.({ phase, completed, total, bytes, totalBytes });

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function updateCRC(crc, data) {
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}

async function readBytes(file, start, length, signal) {
  abortIfNeeded(signal);
  if (start < 0 || length < 0 || start + length > file.size) fail('ZIPが途中で切れているか、構造が不正です。');
  const bytes = new Uint8Array(await file.slice(start, start + length).arrayBuffer());
  abortIfNeeded(signal);
  if (bytes.length !== length) fail('ZIPを最後まで読み込めませんでした。');
  return bytes;
}
const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function checkExtra(bytes) {
  const view = viewOf(bytes);
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) fail('ZIPの追加情報が不正です。');
    const id = view.getUint16(offset, true), size = view.getUint16(offset + 2, true);
    if (id === 1 || offset + 4 + size > bytes.length) fail('ZIP64または不正なZIPには対応していません。');
    offset += 4 + size;
  }
}

/** Read only the small directory and headers first. Do not trust their size/CRC claims. */
async function inspectArchive(file, { signal, onProgress } = {}) {
  abortIfNeeded(signal);
  if (!(file instanceof Blob) || file.size < 22 || file.size > PACKAGE_LIMITS.archiveBytes) fail('作業ZIPの容量が対応範囲を超えているか、空のファイルです。');
  const tailStart = Math.max(0, file.size - 65557), tail = await readBytes(file, tailStart, file.size - tailStart, signal), tailView = viewOf(tail);
  let end = -1;
  for (let offset = tail.length - 22; offset >= 0; offset--) {
    if (tailView.getUint32(offset, true) === 0x06054b50 && offset + 22 + tailView.getUint16(offset + 20, true) === tail.length) { end = offset; break; }
  }
  if (end < 0) fail('ZIPの終端が見つかりません。');
  const count = tailView.getUint16(end + 10, true), directorySize = tailView.getUint32(end + 12, true), directoryOffset = tailView.getUint32(end + 16, true);
  if (tailView.getUint16(end + 4, true) || tailView.getUint16(end + 6, true) || tailView.getUint16(end + 8, true) !== count || !count || count > PACKAGE_LIMITS.entries || directorySize > PACKAGE_LIMITS.directoryBytes || directoryOffset + directorySize !== tailStart + end) fail('ZIPの件数・サイズ・構造が対応範囲を超えています。');
  const directory = await readBytes(file, directoryOffset, directorySize, signal), view = viewOf(directory), entries = new Map();
  let offset = 0, expanded = 0, originalsBytes = 0, payloadBytes = 0;
  for (let index = 0; index < count; index++) {
    abortIfNeeded(signal);
    if (offset + 46 > directory.length || view.getUint32(offset, true) !== 0x02014b50) fail('ZIPの一覧情報が不正です。');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true), compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true), localOffset = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > directory.length || nameLength > MAX_NAME_BYTES || flags & ~0x080e || ![0, 8].includes(method) || view.getUint16(offset + 34, true)) fail('暗号化・分割ZIPまたは未対応のZIPです。');
    const name = decoder.decode(directory.subarray(offset + 46, offset + 46 + nameLength));
    if (name !== 'project.json' && !originalPath(name)) fail('ZIPに許可されていないパスがあります。');
    if (entries.has(name)) fail('ZIP内のファイル名が重複しています。');
    if (!size || size > entryLimit(name) || (method === 0 && compressed !== size)) fail('ZIP内のファイル容量が上限を超えているか、不正です。');
    checkExtra(directory.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength));
    expanded += size;
    payloadBytes += compressed;
    if (name !== 'project.json') originalsBytes += size;
    if (expanded > PACKAGE_LIMITS.expandedBytes || originalsBytes > LIMITS.totalBytes) fail('ZIP展開後の合計容量が上限を超えています。');
    entries.set(name, { name, flags, method, crc, compressed, size, localOffset });
    offset = next;
  }
  if (offset !== directory.length || !entries.has('project.json')) fail('ZIP内のproject.jsonまたは一覧情報が不正です。');
  if (payloadBytes > expanded + PACKAGE_LIMITS.compressionBytes || file.size - payloadBytes > PACKAGE_LIMITS.headerBytes) fail('ZIPの圧縮データまたは付加情報が上限を超えています。');
  // Check local headers too: prevent a second hidden/duplicate entry and conflicting names.
  let cursor = 0, inspected = 0;
  for (const entry of [...entries.values()].sort((a, b) => a.localOffset - b.localOffset)) {
    abortIfNeeded(signal);
    if (entry.localOffset !== cursor) fail('ZIPに重複・欠落したファイル領域があります。');
    const header = viewOf(await readBytes(file, cursor, 30, signal));
    if (header.getUint32(0, true) !== 0x04034b50 || header.getUint16(6, true) !== entry.flags || header.getUint16(8, true) !== entry.method) fail('ZIPの見出しが一覧情報と一致しません。');
    const nameLength = header.getUint16(26, true), extraLength = header.getUint16(28, true);
    const names = await readBytes(file, cursor + 30, nameLength + extraLength, signal);
    if (decoder.decode(names.subarray(0, nameLength)) !== entry.name) fail('ZIPのファイル名が一致しません。');
    checkExtra(names.subarray(nameLength));
    entry.dataOffset = cursor + 30 + names.length;
    cursor = entry.dataOffset + entry.compressed;
    if (cursor > directoryOffset) fail('ZIPの写真データが途中で切れています。');
    if (entry.flags & 8) {
      const descriptorBytes = await readBytes(file, cursor, Math.min(16, directoryOffset - cursor), signal), descriptor = viewOf(descriptorBytes);
      const skip = descriptorBytes.length >= 4 && descriptor.getUint32(0, true) === 0x08074b50 ? 4 : 0;
      if (descriptorBytes.length < skip + 12 || descriptor.getUint32(skip, true) !== entry.crc || descriptor.getUint32(skip + 4, true) !== entry.compressed || descriptor.getUint32(skip + 8, true) !== entry.size) fail('ZIPの検査情報が一致しません。');
      cursor += skip + 12;
    } else if (header.getUint32(14, true) !== entry.crc || header.getUint32(18, true) !== entry.compressed || header.getUint32(22, true) !== entry.size) fail('ZIPのサイズ・検査情報が一致しません。');
    progress(onProgress, 'inspect', ++inspected, count, cursor, file.size);
  }
  if (cursor !== directoryOffset) fail('ZIP内に不明なデータがあります。');
  return entries;
}

/** Immutable whole-project snapshot; originals are stored byte-for-byte without compression. */
export async function exportWorkPackage(project, originals, { onProgress, signal } = {}) {
  abortIfNeeded(signal);
  const snapshot = structuredClone(project);
  validateProject(snapshot);
  if (!(originals instanceof Map)) fail('工事情報と元写真の件数が一致しません。');
  // Blob is immutable; copying this small map also freezes which originals this snapshot uses.
  const sourceOriginals = new Map(originals);
  if (sourceOriginals.size !== snapshot.photos.length) fail('工事情報と元写真の件数が一致しません。');
  for (const photo of snapshot.photos) {
    const blob = sourceOriginals.get(photo.id);
    if (!(blob instanceof Blob) || blob.size !== photo.size || blob.type !== photo.type) fail(`元写真が見つからないか、容量・形式が一致しません：${photo.originalName}`);
  }
  const bundleId = crypto.randomUUID(), exportedAt = new Date().toISOString();
  const metadata = encoder.encode(JSON.stringify({ ...snapshot, bundleId, exportedAt }));
  if (metadata.length > PACKAGE_LIMITS.metadataBytes) fail('工事情報が2MiBを超えています。');
  const chunks = [];
  let generated = 0, finished = false, streamError, currentInput;
  const zip = new Zip((error, chunk, final) => {
    if (error) { streamError = error; return; }
    generated += chunk.length;
    if (generated > PACKAGE_LIMITS.archiveBytes) { streamError = new Error('作業ZIPの容量が上限を超えています。'); return; }
    // ZipPassThrough emits the exact uncompressed input chunk. Keep its immutable
    // Blob slice instead of retaining every temporary Uint8Array in the archive.
    chunks.push(currentInput?.bytes === chunk ? currentInput.blob : chunk);
    if (final) finished = true;
  });
  try {
    const metaEntry = new ZipPassThrough('project.json'); zip.add(metaEntry); metaEntry.push(metadata, true);
    let completed = 0, bytes = 0;
    const totalBytes = snapshot.photos.reduce((sum, photo) => sum + photo.size, 0);
    progress(onProgress, 'export', completed, snapshot.photos.length, bytes, totalBytes);
    abortIfNeeded(signal);
    for (const photo of snapshot.photos) {
      abortIfNeeded(signal);
      const entry = new ZipPassThrough(photo.originalPath); zip.add(entry);
      const blob = sourceOriginals.get(photo.id);
      for (let offset = 0; offset < blob.size; offset += READ_CHUNK) {
        const length = Math.min(READ_CHUNK, blob.size - offset);
        currentInput = { bytes: await readBytes(blob, offset, length, signal), blob: blob.slice(offset, offset + length) };
        entry.push(currentInput.bytes, offset + READ_CHUNK >= blob.size);
        currentInput = null;
        if (streamError) throw streamError;
        if ((offset + length) % (1024 * 1024) === 0) {
          progress(onProgress, 'export', completed, snapshot.photos.length, bytes + offset + length, totalBytes);
          await pause(); abortIfNeeded(signal);
        }
      }
      bytes += photo.size; completed++;
      progress(onProgress, 'export', completed, snapshot.photos.length, bytes, totalBytes);
      await pause(); abortIfNeeded(signal);
    }
    zip.end();
    if (streamError) throw streamError;
    if (!finished) fail('ZIPの生成が完了しませんでした。');
    abortIfNeeded(signal);
    const blob = new Blob(chunks, { type: 'application/zip' });
    const name = snapshot.name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').slice(0, 60).trim() || '工事';
    const local = new Date(exportedAt);
    const pad = value => String(value).padStart(2, '0');
    const stamp = `${local.getFullYear()}${pad(local.getMonth() + 1)}${pad(local.getDate())}-${pad(local.getHours())}${pad(local.getMinutes())}${pad(local.getSeconds())}`;
    return { blob, filename: `${name}_作業データ_${stamp}_${bundleId.slice(0, 8)}.zip`, bundleId };
  } finally {
    zip.terminate(); currentInput = null; chunks.length = 0; sourceOriginals.clear();
  }
}

async function manifestProject(blob, entries) {
  let project;
  try { project = JSON.parse(decoder.decode(new Uint8Array(await blob.arrayBuffer()))); }
  catch { fail('project.jsonの文字コードまたはJSONが不正です。'); }
  project = upgradeProject(project);
  if (typeof project.bundleId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(project.bundleId) || typeof project.exportedAt !== 'string' || !Number.isFinite(Date.parse(project.exportedAt))) fail('作業ZIPの書き出し情報が不正です。');
  const paths = new Set(project.photos.map(photo => photo.originalPath));
  if (paths.size !== project.photos.length || entries.size !== paths.size + 1 || [...entries.keys()].some(name => name !== 'project.json' && !paths.has(name))) fail('工事情報にない元写真、または欠けた元写真があります。');
  for (const photo of project.photos) {
    const entry = entries.get(photo.originalPath), type = TYPES[photo.originalPath.split('.').pop()];
    if (!entry || entry.size !== photo.size || type !== photo.type) fail('工事情報と元写真の容量・形式が一致しません。');
  }
  return project;
}

async function extractEntry(file, entry, state, { onProgress, signal }) {
  let crc = 0xffffffff, size = 0, final = false;
  const accept = data => {
    size += data.length; state.bytes += data.length;
    if (entry.name !== 'project.json') state.originalsBytes += data.length;
    if (size > entry.size || size > entryLimit(entry.name) || state.bytes > PACKAGE_LIMITS.expandedBytes || state.originalsBytes > LIMITS.totalBytes) fail('ZIP展開中の実容量が上限を超えました。');
    crc = updateCRC(crc, data);
  };
  const notify = async () => {
    progress(onProgress, 'import', state.completed, state.count, state.bytes, state.totalBytes);
    await pause(); abortIfNeeded(signal); state.yieldBytes = state.bytes;
  };
  let blob;
  if (entry.method === 0) {
    for (let offset = 0; offset < entry.size; offset += READ_CHUNK) {
      const chunk = await readBytes(file, entry.dataOffset + offset, Math.min(READ_CHUNK, entry.size - offset), signal);
      accept(chunk);
      if (state.bytes - state.yieldBytes >= 1024 * 1024) await notify();
      abortIfNeeded(signal);
    }
    blob = file.slice(entry.dataOffset, entry.dataOffset + entry.size, entry.name === 'project.json' ? 'application/json' : TYPES[entry.name.split('.').pop()]);
    final = true;
  } else {
    // Inflate just this entry. Stored originals in a mixed archive still stay
    // Blob slices, and at most one compressed image's bounded output is buffered.
    const inflater = new UnzipInflate(), parts = [];
    let failure, compressedSinceYield = 0;
    inflater.ondata = (error, data, last) => {
      if (failure) return;
      if (error) { failure = error; return; }
      try { accept(data); parts.push(data); if (last) final = true; }
      catch (error) { failure = error; }
    };
    try {
      for (let offset = 0; offset < entry.compressed; offset += READ_CHUNK) {
        const bytes = await readBytes(file, entry.dataOffset + offset, Math.min(READ_CHUNK, entry.compressed - offset), signal);
        for (let part = 0; part < bytes.length; part += INFLATE_CHUNK) {
          const end = Math.min(part + INFLATE_CHUNK, bytes.length);
          inflater.push(bytes.subarray(part, end), offset + end === entry.compressed);
          if (failure) throw failure;
          abortIfNeeded(signal); compressedSinceYield += end - part;
          if (state.bytes - state.yieldBytes >= 1024 * 1024 || compressedSinceYield >= 1024 * 1024) { await notify(); compressedSinceYield = 0; }
        }
      }
      blob = new Blob(parts, { type: entry.name === 'project.json' ? 'application/json' : TYPES[entry.name.split('.').pop()] });
    } finally { parts.length = 0; inflater.ondata = null; }
  }
  if (!final || size !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) fail('ZIPの写真または工事情報が破損しています（CRC・容量不一致）。');
  state.completed++; await notify();
  return blob;
}

/** Stored originals remain Blob slices; compressed inputs use bounded streaming inflation. */
export async function importWorkPackage(file, { onProgress, validateImage = defaultValidateImage, signal } = {}) {
  abortIfNeeded(signal);
  const entries = await inspectArchive(file, { signal, onProgress });
  const originals = new Map();
  try {
    const state = { completed: 0, count: entries.size, bytes: 0, originalsBytes: 0, yieldBytes: 0, totalBytes: [...entries.values()].reduce((sum, entry) => sum + entry.size, 0) };
    // Even when the manifest is compressed or physically last in the archive,
    // reject its schema/ownership before scanning or inflating image payloads.
    const metadata = await extractEntry(file, entries.get('project.json'), state, { onProgress, signal });
    const project = await manifestProject(metadata, entries);
    for (const photo of project.photos) {
      abortIfNeeded(signal);
      const blob = await extractEntry(file, entries.get(photo.originalPath), state, { onProgress, signal });
      if (!blob || blob.size !== photo.size || blob.type !== photo.type) fail('工事情報と元写真の容量・形式が一致しません。');
      const dimensions = await validateImage(blob, { signal });
      abortIfNeeded(signal);
      if (dimensions.width !== photo.width || dimensions.height !== photo.height) fail('工事情報と元写真の寸法が一致しません。');
      originals.set(photo.id, blob);
      progress(onProgress, 'validate', originals.size, project.photos.length, originals.size, project.photos.length);
      await pause();
    }
    abortIfNeeded(signal);
    progress(onProgress, 'import', entries.size, entries.size, file.size, file.size);
    abortIfNeeded(signal);
    return { project, originals, bundleId: project.bundleId };
  } catch (error) { originals.clear(); throw error; }
  finally { entries.clear(); }
}
