import { LIMITS } from './definitions.js';

const DATABASE_NAME = 'field-photo-handoff';
const DATABASE_VERSION = 2;
const CURRENT = 'current';
const SESSION_CURRENT = 'session-current';
const UNINITIALIZED = Symbol('uninitialized revision');
const revisionOf = metadata => metadata?.revision ?? metadata?.savedAt ?? null;
const ALL_STORES = ['metadata', 'originals', 'viewState', 'drafts'];
const SESSION_STORES = ['metadata', 'viewState', 'drafts'];
export const SESSION_MAX_BYTES = 2 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const plainObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const aborted = () => new DOMException('端末内の一時保存を取り消しました。', 'AbortError');
const abortIfNeeded = signal => { if (signal?.aborted) throw aborted(); };

function conflict(message = '別のタブで更新されました。作業ZIPを保存してから再読み込みしてください。') {
  const error = new Error(message); error.name = 'StorageConflictError'; return error;
}
function sessionToken(marker) {
  if (marker === undefined || marker === null) return null;
  // Invalid auxiliary records can be replaced after a successful load without
  // silently authorizing a write over a different tab's newer valid session.
  try { return JSON.stringify(marker); } catch { return 'invalid-session-marker'; }
}
function sessionSnapshot(session) {
  if (!plainObject(session) || Object.keys(session).some(key => !['view', 'drafts'].includes(key)) || !Object.hasOwn(session, 'view') || !Object.hasOwn(session, 'drafts') || ![session.view, session.drafts].every(value => value === null || plainObject(value))) {
    throw new Error('画面状態と下書きの保存形式が正しくありません。');
  }
  let nodes = 0;
  const ancestors = new Set();
  function check(value, depth) {
    if (++nodes > 100000 || depth > 64) throw new Error('画面状態と下書きが複雑すぎて保存できません。');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || !Array.isArray(value) && !plainObject(value) || ancestors.has(value)) throw new Error('画面状態と下書きにはJSONで保存できる値を指定してください。');
    if (Array.isArray(value) && (Object.keys(value).length !== value.length || Object.keys(value).some(key => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) throw new Error('画面状態と下書きの形式が正しくありません。');
    ancestors.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !property.enumerable || !Object.hasOwn(property, 'value')) throw new Error('画面状態と下書きの形式が正しくありません。');
      check(property.value, depth + 1);
    }
    ancestors.delete(value);
  }
  check(session, 0);
  const json = JSON.stringify(session);
  if (new TextEncoder().encode(json).length > SESSION_MAX_BYTES) throw new Error('画面状態と下書きの合計は2MiB以内にしてください。');
  return JSON.parse(json);
}

function restoredSession(metadata, marker, view, drafts, readError) {
  if (readError) return { session: null, sessionIssue: `画面状態と下書きを読み込めませんでした。${readError}` };
  if (marker === undefined && view === undefined && drafts === undefined) return { session: null, sessionIssue: null };
  try {
    const projectId = metadata.project.id, businessRevision = revisionOf(metadata);
    if (!plainObject(marker) || marker.projectId !== projectId || marker.businessRevision !== businessRevision || !validId(marker.revision) || typeof marker.hasSession !== 'boolean' || typeof marker.savedAt !== 'string' || !Number.isFinite(Date.parse(marker.savedAt))) throw new Error('工事と画面状態の版が一致しません。');
    if (!marker.hasSession) {
      if (view !== undefined || drafts !== undefined) throw new Error('削除済みの下書きが残っています。');
      return { session: null, sessionIssue: null };
    }
    for (const row of [view, drafts]) if (!plainObject(row) || row.projectId !== projectId || row.businessRevision !== businessRevision || row.sessionRevision !== marker.revision || !Object.hasOwn(row, 'value')) throw new Error('画面状態と下書きが工事と一致しません。');
    return { session: sessionSnapshot({ view: view.value, drafts: drafts.value }), sessionIssue: null };
  } catch (error) {
    return { session: null, sessionIssue: `画面状態と下書きに不整合があるため復元しませんでした。${error.message}` };
  }
}

function databaseError(error) {
  if (error?.name === 'AbortError') return error;
  if (error?.name === 'QuotaExceededError') return new Error('端末の空き容量が足りません。作業ZIPを保存し、空きを増やしてください。');
  return error instanceof Error ? error : new Error('端末に保存できませんでした。作業ZIPを保存してからやり直してください。');
}

function snapshot(project, originals) {
  if (!project || typeof project !== 'object' || !Array.isArray(project.photos) || !(originals instanceof Map)) {
    throw new Error('保存する工事データと写真の形式が正しくありません。');
  }
  if (project.photos.length > LIMITS.photos) throw new Error(`保存する原本は履歴を含め${LIMITS.photos}枚以内にしてください。`);
  const copy = typeof structuredClone === 'function' ? structuredClone(project) : JSON.parse(JSON.stringify(project));
  if (!validId(copy.id)) throw new Error('保存する工事のデータが正しくありません。');
  const files = new Map(originals);
  const ids = new Set();
  let bytes = 0;
  for (const photo of copy.photos) {
    if (!photo || !validId(photo.id) || ids.has(photo.id) || !(files.get(photo.id) instanceof Blob)) {
      throw new Error('原本と写真の情報が一致しません。');
    }
    const blob = files.get(photo.id);
    if (!Number.isSafeInteger(photo.size) || photo.size < 1 || photo.size > LIMITS.imageBytes || photo.size !== blob.size || photo.type !== blob.type) throw new Error('原本の容量・形式が一致しないか、1枚の上限を超えています。');
    bytes += photo.size;
    if (bytes > LIMITS.totalBytes) throw new Error(`保存する原本の合計は${LIMITS.totalBytes.toLocaleString('ja-JP')}bytes以内にしてください。`);
    ids.add(photo.id);
  }
  if (ids.size !== files.size) throw new Error('原本と写真の情報の数が一致しません。');
  for (const [id, blob] of files) {
    if (typeof id !== 'string' || !(blob instanceof Blob) || blob.size < 1) throw new Error('保存する写真の原本が正しくありません。');
  }
  return { project: copy, originals: files };
}

/** One active work package; originals are immutable and stored separately from editable metadata. */
export async function openStorage() {
  if (!globalThis.indexedDB) throw new Error('このブラウザーでは端末に保存できません。');
  const db = await new Promise((resolve, reject) => {
    let request;
    try { request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION); }
    catch (error) { reject(databaseError(error)); return; }
    let settled = false;
    request.onupgradeneeded = () => {
      const result = request.result;
      if (!result.objectStoreNames.contains('metadata')) result.createObjectStore('metadata');
      if (!result.objectStoreNames.contains('originals')) result.createObjectStore('originals');
      if (!result.objectStoreNames.contains('viewState')) result.createObjectStore('viewState');
      if (!result.objectStoreNames.contains('drafts')) result.createObjectStore('drafts');
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => { if (!settled) { settled = true; reject(databaseError(request.error)); } };
    request.onblocked = () => {
      if (!settled) {
        settled = true;
        reject(new Error('別のタブで使用中です。他のタブを閉じて再読み込みしてください。'));
      }
    };
  });
  let available = true;
  let tail = Promise.resolve();
  let expectedRevision = UNINITIALIZED;
  let expectedSessionRevision = UNINITIALIZED;
  db.onversionchange = () => { available = false; db.close(); };
  db.onclose = () => { available = false; };

  // Queue our own operations, but recover the queue after a failed transaction.
  function enqueue(operation, { signal } = {}) {
    const result = tail.then(() => {
      abortIfNeeded(signal);
      if (!available) throw new Error('端末への保存が中断されました。作業ZIPを保存して再読み込みしてください。');
      return operation();
    });
    // A fulfilled load() contains every Blob reference. The serialization tail
    // must retain only completion, not that potentially 1GB result snapshot.
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  function transaction(mode, work, stores = ALL_STORES, { signal } = {}) {
    return new Promise((resolve, reject) => {
      let tx;
      try { abortIfNeeded(signal); tx = db.transaction(stores, mode); }
      catch (error) { reject(databaseError(error)); return; }
      let value;
      let workError;
      const detach = () => signal?.removeEventListener('abort', onSignalAbort);
      const onSignalAbort = () => {
        workError = aborted();
        // If commit already won, oncomplete reports success; do not claim that
        // a committed write was canceled merely because abort() is now too late.
        try { tx.abort(); } catch { /* A completed transaction cannot be aborted. */ }
      };
      signal?.addEventListener('abort', onSignalAbort, { once: true });
      tx.oncomplete = () => { detach(); resolve(value); };
      tx.onabort = () => { detach(); reject(databaseError(workError || tx.error)); };
      tx.onerror = () => { /* The abort event reports the final transaction error. */ };
      try {
        work(tx, result => { value = result; }, error => {
          workError = error;
          try { tx.abort(); } catch { reject(databaseError(error)); }
        });
      } catch (error) {
        workError = error;
        try { tx.abort(); } catch { reject(databaseError(error)); }
      }
    });
  }

  function checkRevision(metadata) {
    if (expectedRevision !== UNINITIALIZED && expectedRevision !== revisionOf(metadata)) {
      throw conflict();
    }
  }
  function checkSessionRevision(marker) {
    if (expectedSessionRevision !== UNINITIALIZED && expectedSessionRevision !== sessionToken(marker)) throw conflict('別のタブで下書きが更新されました。編集内容を控えてから再読み込みしてください。');
  }
  function writeSession(tx, projectId, businessRevision, session, { clear = false } = {}) {
    const marker = { projectId, businessRevision, revision: crypto.randomUUID(), savedAt: new Date().toISOString(), hasSession: session !== null };
    const viewStore = tx.objectStore('viewState'), draftStore = tx.objectStore('drafts');
    if (clear || session === null) { viewStore.clear(); draftStore.clear(); }
    if (session !== null) {
      const reference = { projectId, businessRevision, sessionRevision: marker.revision };
      viewStore.put({ ...reference, value: session.view }, projectId);
      draftStore.put({ ...reference, value: session.drafts }, projectId);
    }
    tx.objectStore('metadata').put(marker, SESSION_CURRENT);
    return sessionToken(marker);
  }

  function saveSnapshot(data, replace, bundleId, session, options) {
    return transaction('readwrite', (tx, setResult, fail) => {
      const metadata = tx.objectStore('metadata');
      const files = tx.objectStore('originals');
      const oldMetadata = metadata.get(CURRENT);
      const oldSession = metadata.get(SESSION_CURRENT);
      let metadataDone = false, sessionDone = false;
      oldMetadata.onsuccess = () => { metadataDone = true; finish(); };
      oldSession.onsuccess = () => { sessionDone = true; finish(); };
      function finish() {
        if (!metadataDone || !sessionDone) return;
        try {
          const previous = oldMetadata.result;
          // The read and comparison share the write transaction. Do not clear or
          // schedule any mutation until this instance's loaded snapshot is current.
          checkRevision(previous);
          checkSessionRevision(oldSession.result);
          const revision = crypto.randomUUID();
          if (replace) {
            files.clear();
            for (const [id, blob] of data.originals) files.put(blob, id);
          } else {
            const keys = files.getAllKeys();
            keys.onsuccess = () => {
              try {
                const existing = new Set(keys.result);
                for (const id of existing) if (!data.originals.has(id)) files.delete(id);
                // Editing a board or assignment never rewrites unchanged original blobs.
                for (const [id, blob] of data.originals) if (!existing.has(id)) files.put(blob, id);
              } catch (error) { fail(error); }
            };
          }
          metadata.put({ project: data.project, bundleId: replace ? bundleId : (previous?.bundleId ?? null), savedAt: new Date().toISOString(), revision }, CURRENT);
          const sessionRevision = writeSession(tx, data.project.id, revision, session, { clear: true });
          setResult({ revision, sessionRevision });
        } catch (error) { fail(error); }
      }
    }, ALL_STORES, options).then(({ revision, sessionRevision }) => { expectedRevision = revision; expectedSessionRevision = sessionRevision; });
  }

  return {
    get available() { return available; },
    load(options = {}) {
      return enqueue(() => transaction('readonly', (tx, setResult, fail) => {
        const originals = new Map();
        let metadata;
        let filesDone = false;
        let metadataDone = false;
        let marker, markerDone = false, view, drafts, viewDone = false, draftsDone = false, sessionReadError = '';
        const auxiliary = (request, assign) => {
          request.onsuccess = () => { assign(request.result); finish(); };
          request.onerror = event => {
            event.preventDefault(); event.stopPropagation();
            sessionReadError = request.error?.message || '原因不明のエラーです。';
            assign(undefined); finish();
          };
        };
        const readAuxiliary = (store, key, assign) => {
          try { auxiliary(tx.objectStore(store).get(key), assign); }
          catch (error) { sessionReadError = error.message; assign(undefined); finish(); }
        };
        readAuxiliary('metadata', SESSION_CURRENT, value => { marker = value; markerDone = true; });
        const request = tx.objectStore('metadata').get(CURRENT);
        request.onsuccess = () => {
          metadata = request.result; metadataDone = true;
          if (validId(metadata?.project?.id)) {
            readAuxiliary('viewState', metadata.project.id, value => { view = value; viewDone = true; });
            readAuxiliary('drafts', metadata.project.id, value => { drafts = value; draftsDone = true; });
          } else { viewDone = draftsDone = true; }
          finish();
        };
        const cursor = tx.objectStore('originals').openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (item) { originals.set(item.key, item.value); item.continue(); }
          else { filesDone = true; finish(); }
        };
        function finish() {
          if (!filesDone || !metadataDone || !markerDone || !viewDone || !draftsDone) return;
          if (!metadata) {
            if (originals.size) fail(new Error('端末内の写真に対応する工事データがありません。作業ZIPを読み込んでください。'));
            else setResult({ data: null, revision: null, sessionRevision: sessionToken(marker) });
            return;
          }
          try {
            const data = snapshot(metadata.project, originals);
            const session = restoredSession(metadata, marker, view, drafts, sessionReadError);
            setResult({ data: { ...data, bundleId: metadata.bundleId ?? null, ...session }, revision: revisionOf(metadata), sessionRevision: sessionToken(marker) });
          } catch (error) { fail(error); }
        }
      }, ALL_STORES, options).then(result => {
        // A failed read/validation must never authorize overwriting a newer tab.
        expectedRevision = result.revision;
        expectedSessionRevision = result.sessionRevision;
        return result.data;
      }), options);
    },
    save(project, originals, session, options = {}) {
      let data, sessionData;
      try { abortIfNeeded(options.signal); data = snapshot(project, originals); sessionData = session === undefined || session === null ? null : sessionSnapshot(session); } catch (error) { return Promise.reject(error); }
      return enqueue(() => saveSnapshot(data, false, null, sessionData, options), options).finally(() => data.originals.clear());
    },
    replace(project, originals, bundleId = null, session, options = {}) {
      let data, sessionData;
      try {
        abortIfNeeded(options.signal);
        data = snapshot(project, originals);
        sessionData = session === undefined || session === null ? null : sessionSnapshot(session);
        if (bundleId !== null && (typeof bundleId !== 'string' || !bundleId)) throw new Error('作業ZIPの情報が正しくありません。');
      } catch (error) { return Promise.reject(error); }
      return enqueue(() => saveSnapshot(data, true, bundleId, sessionData, options), options).finally(() => data.originals.clear());
    },
    saveSession(projectId, session, options = {}) {
      let data;
      try {
        abortIfNeeded(options.signal);
        if (!validId(projectId)) throw new Error('画面状態を保存する工事のIDが不正です。');
        data = sessionSnapshot(session);
      } catch (error) { return Promise.reject(error); }
      return enqueue(() => transaction('readwrite', (tx, setResult, fail) => {
        const metadata = tx.objectStore('metadata'), current = metadata.get(CURRENT), previousSession = metadata.get(SESSION_CURRENT);
        let projectDone = false, sessionDone = false;
        current.onsuccess = () => { projectDone = true; finish(); };
        previousSession.onsuccess = () => { sessionDone = true; finish(); };
        function finish() {
          if (!projectDone || !sessionDone) return;
          try {
            if (!current.result || current.result.project?.id !== projectId) throw conflict('開いている工事が変わりました。再読み込みしてください。');
            if (expectedRevision === UNINITIALIZED || expectedSessionRevision === UNINITIALIZED) throw conflict('保存済みの作業を読み込んでから画面状態を保存してください。');
            checkRevision(current.result); checkSessionRevision(previousSession.result);
            setResult(writeSession(tx, projectId, revisionOf(current.result), data));
          } catch (error) { fail(error); }
        }
      }, SESSION_STORES, options).then(revision => { expectedSessionRevision = revision; }), options);
    },
    clear(options = {}) {
      return enqueue(() => transaction('readwrite', (tx, setResult, fail) => {
        const metadata = tx.objectStore('metadata');
        const current = metadata.get(CURRENT);
        const currentSession = metadata.get(SESSION_CURRENT);
        let currentDone = false, sessionDone = false;
        current.onsuccess = () => { currentDone = true; finish(); };
        currentSession.onsuccess = () => { sessionDone = true; finish(); };
        function finish() {
          if (!currentDone || !sessionDone) return;
          try {
            checkRevision(current.result);
            checkSessionRevision(currentSession.result);
            metadata.clear();
            tx.objectStore('originals').clear();
            tx.objectStore('viewState').clear(); tx.objectStore('drafts').clear();
            setResult(null);
          } catch (error) { fail(error); }
        }
      }, ALL_STORES, options).then(revision => { expectedRevision = revision; expectedSessionRevision = null; }), options);
    },
  };
}
