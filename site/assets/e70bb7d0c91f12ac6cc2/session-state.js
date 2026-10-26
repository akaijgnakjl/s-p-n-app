import { USE_CASES } from './definitions.js';
import { BOARD_FIELD_KEYS, createBoard } from './boards.js';

/** Session metadata is local UI state, never a source of business review/approval. */
export const SESSION_LIMITS = Object.freeze({
  totalBytes: 2 * 1024 * 1024, nameChars: 300, draftTextChars: 10_000,
  pasteBytes: 1024 * 1024, disclosureKeys: 100, disclosureKeyChars: 120,
  selectedRecordIds: 4000, scroll: 2_000_000, entryScan: 20_000,
});

const encoder = new TextEncoder();
const MODES = ['field', 'organize', 'report', 'output', 'handoff'];
const USES = Object.keys(USE_CASES);
const REPORT_USES = USES.filter(name => USE_CASES[name].reportColumns.length);
const POISON = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function plain(value) {
  if (!value || typeof value !== 'object') return false;
  try { const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }
  catch { return false; }
}
function get(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && own(descriptor, 'value') ? descriptor.value : undefined;
}
const poisoned = value => Object.keys(value).some(key => POISON.has(key));
const encodedSize = value => encoder.encode(JSON.stringify(value)).byteLength;
const text = (value, maximum, multiline = true) => typeof value === 'string' && value.length <= maximum &&
  !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value);
const arrayValues = value => Array.from({ length: value.length }, (_, index) => get(value, String(index)));
function isoDateTime(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) return null;
  const midnight = Date.parse(`${match[1]}T00:00:00Z`), timestamp = Date.parse(value);
  if (!Number.isFinite(midnight) || !Number.isFinite(timestamp) || new Date(midnight).toISOString().slice(0, 10) !== match[1]) return null;
  return new Date(timestamp).toISOString();
}

// Count raw JSON without invoking getters or toJSON. Stop at the byte/depth/work limits.
function rawSize(value) {
  let bytes = 0, nodes = 0;
  const ancestors = new Set();
  function add(count) { bytes += count; if (bytes > SESSION_LIMITS.totalBytes) throw new Error('oversize'); }
  function visit(item, depth = 0) {
    if (++nodes > 200_000 || depth > 20) throw new Error('structure');
    if (typeof item === 'string') { add(encodedSize(item)); return; }
    if (item === null || typeof item === 'boolean' || typeof item === 'number') { add(encodedSize(item)); return; }
    if (typeof item !== 'object') throw new Error('structure');
    if (ancestors.has(item)) throw new Error('structure');
    if (!Array.isArray(item) && !plain(item)) { add(2); return; }
    ancestors.add(item); add(2);
    if (Array.isArray(item)) {
      if (item.length > SESSION_LIMITS.entryScan) throw new Error('structure');
      for (let index = 0; index < item.length; index++) {
        if (index) add(1);
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor) add(4);
        else if (!own(descriptor, 'value')) throw new Error('structure');
        else visit(descriptor.value, depth + 1);
      }
    } else {
      const keys = Object.keys(item);
      if (keys.length > SESSION_LIMITS.entryScan) throw new Error('structure');
      let count = 0;
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!own(descriptor, 'value') || (key === 'toJSON' && typeof descriptor.value === 'function')) throw new Error('structure');
        if (descriptor.value === undefined || typeof descriptor.value === 'function' || typeof descriptor.value === 'symbol') continue;
        if (count++) add(1);
        add(encodedSize(key) + 1); visit(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(item);
  }
  visit(value); return bytes;
}

function defaults() {
  return {
    view: {
      mode: 'field', activeGroupId: '__all__', activeTargetId: '', activeRecordId: '',
      useCaseFilter: '', onlyMissing: false, reportUseCase: '基準点', activeCaptureSlot: '',
      organize: { query: '', useCase: '', category: '', slot: '', status: '', dateStatus: '', reportStatus: '', onlyMissing: false, groupId: '__all__' },
      disclosures: [], drawerPhotoId: '', scroll: { x: 0, y: 0, target: 0, targetList: 0, drawer: 0 },
      output: { groupId: '__all__', useCase: '', edition: 'draft', selectedIds: [], initialized: false },
      zipDirty: true, lastExportAt: null,
    },
    drafts: { names: [], reports: [], boards: [], pendingPaste: null },
  };
}

export function createSession(project) {
  const { view, drafts } = sanitizeSession(project, null);
  return { view, drafts };
}

/** Restore valid entries independently. Callers must block LIVE persistence on 下書き: issues. */
export function sanitizeSession(project, raw) {
  const { view, drafts } = defaults();
  const issues = [], issueCounts = { '表示': 0, '下書き': 0 };
  let hasInvalidDrafts = false;
  function issue(kind, message) {
    if (kind === '下書き') hasInvalidDrafts = true;
    const count = issueCounts[kind]++;
    if (count < 100) issues.push(`${kind}: ${message}`);
    else if (count === 100) issues.push(`${kind}: ほかにも復元できない項目があります。保存前の値を確認してください。`);
  }
  const result = () => ({ view, drafts, issues, hasInvalidDrafts });
  if (raw === undefined || raw === null) return result();
  if (!plain(raw) || poisoned(raw)) { issue('下書き', '一時作業の形式が正しくありません。'); return result(); }
  try { rawSize(raw); }
  catch (error) { issue('下書き', error.message === 'oversize' ? '一時作業全体が2MiBを超えています。値は切り詰めず、復元できる項目だけを保持しました。' : '一時作業に保存できない構造・深さ・項目数があります。'); }
  if (get(raw, 'projectId') !== undefined && get(raw, 'projectId') !== project?.id) {
    issue('下書き', '別の工事の一時作業は復元できません。'); return result();
  }

  const groups = new Set((project?.groups ?? []).map(group => group.id));
  const targets = new Map(), records = new Map();
  for (const target of project?.targets ?? []) {
    targets.set(target.id, target);
    for (const record of target.records) records.set(record.id, { target, record });
  }
  const photos = new Set((project?.photos ?? []).map(photo => photo.id));
  function enumeration(source, key, allowed, fallback, label) {
    const value = get(source, key);
    if (value === undefined) return fallback;
    if (allowed.includes(value)) return value;
    issue('表示', `${label}を既定値へ戻しました。`); return fallback;
  }
  function boolean(source, key, fallback, label) {
    const value = get(source, key);
    if (value === undefined) return fallback;
    if (typeof value === 'boolean') return value;
    issue('表示', `${label}を既定値へ戻しました。`); return fallback;
  }
  function group(source, key, fallback = '__all__') {
    const value = get(source, key);
    if (value === undefined) return fallback;
    if (value === '__all__' || value === '' || (typeof value === 'string' && groups.has(value))) return value;
    issue('表示', '存在しない所属の表示条件を解除しました。'); return fallback;
  }
  function id(source, key, index, label) {
    const value = get(source, key);
    if (value === undefined || value === '' || value === null) return '';
    if (typeof value === 'string' && index.has(value)) return value;
    issue('表示', `${label}の参照が見つからないため解除しました。`); return '';
  }
  function entries(value, kind, label) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) { issue(kind, `${label}の一覧形式が正しくありません。`); return []; }
    if (value.length > SESSION_LIMITS.entryScan) issue(kind, `${label}の項目数が上限を超えています。超過分は復元しません。`);
    return Array.from({ length: Math.min(value.length, SESSION_LIMITS.entryScan) }, (_, index) => get(value, String(index)));
  }

  const inputView = get(raw, 'view');
  if (inputView !== undefined && inputView !== null && (!plain(inputView) || poisoned(inputView))) issue('表示', '画面状態の形式が正しくないため既定値へ戻しました。');
  else if (inputView) {
    view.mode = enumeration(inputView, 'mode', MODES, view.mode, '作業画面');
    view.activeGroupId = group(inputView, 'activeGroupId');
    view.activeTargetId = id(inputView, 'activeTargetId', targets, '対象');
    view.activeRecordId = id(inputView, 'activeRecordId', records, '作業記録');
    if (view.activeRecordId) {
      const owner = records.get(view.activeRecordId).target.id;
      if (!view.activeTargetId) view.activeTargetId = owner;
      else if (owner !== view.activeTargetId) { view.activeRecordId = ''; issue('表示', '対象と一致しない作業記録を解除しました。'); }
    }
    view.useCaseFilter = enumeration(inputView, 'useCaseFilter', ['', ...USES], '', '用途の表示条件');
    view.onlyMissing = boolean(inputView, 'onlyMissing', false, '不足の表示条件');
    view.reportUseCase = enumeration(inputView, 'reportUseCase', REPORT_USES, '基準点', '調書の用途');
    view.activeCaptureSlot = enumeration(inputView, 'activeCaptureSlot', ['', ...(records.get(view.activeRecordId)?.record.slots.map(slot => slot.name) ?? [])], '', '撮影枠');
    view.drawerPhotoId = id(inputView, 'drawerPhotoId', photos, '写真の詳細');
    view.zipDirty = boolean(inputView, 'zipDirty', true, 'ZIPの変更状態');
    const exported = get(inputView, 'lastExportAt');
    if (exported !== undefined && exported !== null) {
      const normalized = isoDateTime(exported);
      if (normalized) view.lastExportAt = normalized;
      else { view.zipDirty = true; issue('表示', 'ZIP保存日時が不正なため保存状態を未確認へ戻しました。'); }
    }

    const organize = get(inputView, 'organize');
    if (organize !== undefined && organize !== null) {
      if (!plain(organize) || poisoned(organize)) issue('表示', '写真整理の表示条件を既定値へ戻しました。');
      else {
        const query = get(organize, 'query');
        if (query !== undefined) {
          if (text(query, 300, false)) view.organize.query = query;
          else issue('表示', '検索語が不正なため解除しました。');
        }
        view.organize.useCase = enumeration(organize, 'useCase', ['', ...USES], '', '写真整理の用途');
        const definitions = view.organize.useCase ? [USE_CASES[view.organize.useCase]] : Object.values(USE_CASES);
        view.organize.category = enumeration(organize, 'category', ['', ...new Set(definitions.flatMap(definition => definition.categories))], '', '写真整理の区分');
        view.organize.slot = enumeration(organize, 'slot', ['', ...new Set(definitions.flatMap(definition => definition.slots))], '', '写真整理の種類');
        view.organize.status = enumeration(organize, 'status', ['', 'taken', 'history', 'missing', 'retake', 'unnecessary', 'unassigned'], '', '写真整理の状態');
        view.organize.dateStatus = enumeration(organize, 'dateStatus', ['', 'needs-confirmation', 'confirmed', 'unconfirmed', 'legacy'], '', '作業日の表示条件');
        view.organize.reportStatus = enumeration(organize, 'reportStatus', ['', 'unreviewed', 'reviewed', 'stale'], '', '調書の表示条件');
        view.organize.onlyMissing = boolean(organize, 'onlyMissing', false, '写真整理の不足条件');
        view.organize.groupId = group(organize, 'groupId');
      }
    }
    const disclosureKeys = new Set();
    for (const entry of entries(get(inputView, 'disclosures'), '表示', '開閉状態')) {
      const key = get(entry, '0'), expanded = get(entry, '1');
      if (!Array.isArray(entry) || entry.length !== 2 || typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_:-]{0,119}$/.test(key) || POISON.has(key) || typeof expanded !== 'boolean' || disclosureKeys.has(key)) { issue('表示', '不正または重複した開閉状態を除外しました。'); continue; }
      if (view.disclosures.length >= SESSION_LIMITS.disclosureKeys) { issue('表示', '開閉状態は100件以内で復元します。'); break; }
      disclosureKeys.add(key); view.disclosures.push([key, expanded]);
    }
    const scroll = get(inputView, 'scroll');
    if (scroll !== undefined && scroll !== null) {
      if (!plain(scroll) || poisoned(scroll)) issue('表示', 'スクロール位置を既定値へ戻しました。');
      else for (const key of Object.keys(view.scroll)) {
        const value = get(scroll, key);
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) issue('表示', '不正なスクロール位置を解除しました。');
        else { view.scroll[key] = Math.min(value, SESSION_LIMITS.scroll); if (value > SESSION_LIMITS.scroll) issue('表示', 'スクロール位置を復元上限に調整しました。'); }
      }
    }
    const output = get(inputView, 'output');
    if (output !== undefined && output !== null) {
      if (!plain(output) || poisoned(output)) issue('表示', '出力範囲を既定値へ戻しました。');
      else {
        view.output.groupId = group(output, 'groupId');
        view.output.useCase = enumeration(output, 'useCase', ['', ...USES], '', '出力の用途');
        view.output.edition = enumeration(output, 'edition', ['draft', 'final'], 'draft', '出力の版');
        view.output.initialized = boolean(output, 'initialized', false, '出力範囲の選択状態');
        const selected = new Set();
        for (const recordId of entries(get(output, 'selectedIds'), '表示', '出力記録')) {
          if (typeof recordId !== 'string' || !records.has(recordId) || selected.has(recordId)) { issue('表示', '不正または重複した出力記録を除外しました。'); continue; }
          if (selected.size >= SESSION_LIMITS.selectedRecordIds) { issue('表示', '出力記録は4000件以内で復元します。'); break; }
          selected.add(recordId); view.output.selectedIds.push(recordId);
        }
      }
    }
  }

  let bytes = encodedSize({ view, drafts });
  function append(key, entry) {
    const cost = encodedSize(entry) + (drafts[key].length ? 1 : 0);
    if (bytes + cost > SESSION_LIMITS.totalBytes) { issue('下書き', `${key}の一部が一時作業全体の2MiB上限を超えるため復元できません。値は切り詰めていません。`); return; }
    drafts[key].push(entry); bytes += cost;
  }
  const inputDrafts = get(raw, 'drafts');
  if (inputDrafts === undefined || inputDrafts === null) return result();
  if (!plain(inputDrafts) || poisoned(inputDrafts)) { issue('下書き', '編集中の値の形式が正しくありません。'); return result(); }
  function draftEntries(key, validate) {
    const seen = new Set();
    for (const entry of entries(get(inputDrafts, key), '下書き', key)) {
      const id = get(entry, '0'), value = get(entry, '1');
      if (!Array.isArray(entry) || entry.length !== 2 || typeof id !== 'string' || seen.has(id)) { issue('下書き', `${key}に不正または重複した項目があります。`); continue; }
      seen.add(id);
      try { append(key, [id, validate(id, value)]); }
      catch (error) { issue('下書き', `${key}の項目を復元できません（${error.message}）。`); }
    }
  }
  draftEntries('names', (targetId, value) => {
    if (!targets.has(targetId) || !text(value, SESSION_LIMITS.nameChars, false)) throw new Error('対象の参照または300文字上限が不正');
    return value;
  });
  draftEntries('reports', (idKey, value) => {
    const at = idKey.indexOf(':'), recordId = idKey.slice(0, at), key = idKey.slice(at + 1), context = records.get(recordId);
    if (at < 1 || !context || !USE_CASES[context.target.useCase].reportColumns.some(column => column.key === key) || !text(value, SESSION_LIMITS.draftTextChars)) throw new Error('調書の参照・項目または10000文字上限が不正');
    return value;
  });
  draftEntries('boards', (recordId, value) => {
    const context = records.get(recordId);
    if (!context || context.target.useCase === 'MMS' || !plain(value) || poisoned(value) || typeof get(value, 'applyBoard') !== 'boolean' || !['auto', 'manual'].includes(get(value, 'noteMode'))) throw new Error('黒板の参照・合成設定が不正、またはMMS');
    const board = get(value, 'board');
    if (!plain(board) || poisoned(board) || Object.keys(board).some(key => !['templateId', 'values', 'legacyColor'].includes(key))) throw new Error('黒板の構造が不正');
    const values = get(board, 'values');
    if (!plain(values) || poisoned(values) || Object.keys(values).some(key => !BOARD_FIELD_KEYS.includes(key))) throw new Error('黒板に許可されていない項目');
    const legacyColor = get(board, 'legacyColor');
    const normalized = createBoard(get(board, 'templateId'), {}, legacyColor === undefined ? {} : { legacyColor });
    for (const key of Object.keys(values)) {
      const field = get(values, key);
      if (!text(field, SESSION_LIMITS.draftTextChars)) throw new Error('黒板の値または10000文字上限が不正');
      normalized.values[key] = field;
    }
    return { board: normalized, applyBoard: get(value, 'applyBoard'), noteMode: get(value, 'noteMode') };
  });
  const paste = get(inputDrafts, 'pendingPaste');
  if (paste !== undefined && paste !== null) {
    try {
      if (!plain(paste) || poisoned(paste) || get(paste, 'projectId') !== project?.id) throw new Error('工事の参照が不正');
      const settings = get(paste, 'settings');
      if (!plain(settings) || poisoned(settings)) throw new Error('貼り付け設定が不正');
      const inputRecords = get(settings, 'recordIds'), inputKeys = get(settings, 'keys');
      if (!Array.isArray(inputRecords) || !inputRecords.length || inputRecords.length > SESSION_LIMITS.selectedRecordIds) throw new Error('貼り付け先の記録が不正');
      const recordIds = arrayValues(inputRecords);
      if (new Set(recordIds).size !== recordIds.length || recordIds.some(recordId => typeof recordId !== 'string' || !records.has(recordId))) throw new Error('貼り付け先の記録が不正');
      if (!Array.isArray(inputKeys) || !inputKeys.length || inputKeys.length > 20) throw new Error('貼り付け先の調書項目が不正');
      const keys = arrayValues(inputKeys);
      if (new Set(keys).size !== keys.length || keys.some(key => typeof key !== 'string' || !recordIds.every(recordId => USE_CASES[records.get(recordId).target.useCase].reportColumns.some(column => column.key === key)))) throw new Error('貼り付け先の調書項目が不正');
      const startRow = get(settings, 'startRow') ?? 0, startCol = get(settings, 'startCol') ?? 0;
      if (!Number.isSafeInteger(startRow) || !Number.isSafeInteger(startCol) || startRow < 0 || startCol < 0 || startRow >= recordIds.length || startCol >= keys.length) throw new Error('貼り付け開始セルが不正');
      const value = get(paste, 'text') ?? get(settings, 'text');
      if (!text(value, SESSION_LIMITS.pasteBytes) || encoder.encode(value).byteLength > SESSION_LIMITS.pasteBytes) throw new Error('貼り付けテキストの1MiB上限が不正');
      const normalized = { projectId: project.id, settings: { recordIds: [...recordIds], keys: [...keys], startRow, startCol }, text: value };
      const cost = encodedSize(normalized) - 4;
      if (bytes + cost > SESSION_LIMITS.totalBytes) throw new Error('一時作業全体の2MiB上限を超過、値は切り詰めていません');
      drafts.pendingPaste = normalized;
    } catch (error) { issue('下書き', `貼り付けの下書きを復元できません（${error.message}）。`); }
  }
  return result();
}
