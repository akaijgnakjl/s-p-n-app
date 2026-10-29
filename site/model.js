import { USE_CASES, PENDING_USE_CASES, GROUP_KINDS, LIMITS } from './definitions.js';
import { createBoard, validateBoard } from './boards.js';
import { validateSchema1Project } from './compat/schema1.js';
import { validateRecordReport, validateReportSettings, validateReportSection } from './report-data.js';
import { validateDateMetadata, validateRecordDates } from './dates.js';
import { formatByteLimit } from './limits.js';
export { USE_CASES, PENDING_USE_CASES, GROUP_KINDS, LIMITS } from './definitions.js';

const FORMAT = 'survey-photo-note';
const TYPES = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
const STATUSES = new Set(['missing', 'taken', 'retake', 'unnecessary']);
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const fail = message => { throw new Error(message); };
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const normalizedName = value => value.normalize('NFC').toLowerCase();
function text(value, label, { max = 300, required = false, multiline = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) fail(`${label}は${max}文字以内で入力してください`);
  return value;
}
function inputName(value, label, max = 300) { return text(value, label, { max, required: true, multiline: label === '工事名' || label === 'グループ名' }).trim(); }
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
function checkId(value, ids, label) { if (!validId(value) || ids.has(value)) fail(`${label}のデータが重複しているか、正しくありません`); ids.add(value); }
function checkTimestamp(value, label) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label}が正しくありません`); }
function checkDate(value, label) { if (value === '') return; if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail(`${label}は年月日で指定してください`); }
function localDate() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function rejectKeys(value, keys) { if (keys.some(key => own(value, key))) fail('古い形式の項目が残っています。旧データとして読み込んでください'); }
function useCaseDefinition(useCase) { if (!own(USE_CASES, useCase)) fail(PENDING_USE_CASES.includes(useCase) ? '現場写真は未定義のため登録できません' : '用途を選択してください'); return USE_CASES[useCase]; }
function defaultNote(useCase, category) {
  if (useCase === '基準点') return category === '検測' ? '基準点検測状況' : '基準点設置状況';
  if (useCase === '仮BM') return '仮ベンチ設置箇所';
  if (useCase === '現密') return `現場密度試験\n${category}`;
  if (useCase === 'コア密') return `切取供試体密度試験\n${category}`;
  return useCase === 'MMS' ? '' : `${useCase}撮影`;
}
function makeRecord(project, target, category, templateId = USE_CASES[target.useCase].defaultBoardTemplate) {
  const definition = USE_CASES[target.useCase]; if (!definition.categories.includes(category)) fail('この用途で使用できる区分を選択してください');
  const group = target.groupId === null ? null : project.groups.find(item => item.id === target.groupId), mms = target.useCase === 'MMS';
  if (mms && templateId !== null) fail('MMSには電子黒板を付けません');
  return { id: uid(), category, boardDefaults: mms ? null : createBoard(templateId, { job: project.name, route: group?.kind === '路線' ? group.name : '', location: group && group.kind !== '路線' ? group.name : '', point: ['現密','コア密'].includes(target.useCase) ? '' : target.name, note: defaultNote(target.useCase, category), date: localDate() }), applyBoardDefault: !mms, boardNoteMode: ['現密', 'コア密'].includes(target.useCase) ? 'auto' : 'manual', reportFields: {}, slots: definition.slots.map(name => ({ name, status: 'missing', reason: '', activePhotoId: null, photoIds: [] })) };
}
function findTarget(project, targetId) { const target = project.targets.find(item => item.id === targetId); if (!target) fail('記録対象が見つかりません'); return target; }
export function getContext(project, recordId) { for (const target of project.targets) { const record = target.records.find(item => item.id === recordId); if (record) return { target, record, group: target.groupId === null ? null : project.groups.find(item => item.id === target.groupId) ?? null }; } fail('作業記録が見つかりません'); }
function slotContext(project, recordId, slotName) { const context = getContext(project, recordId); const slot = context.record.slots.find(item => item.name === slotName); if (!slot) fail('この作業記録にその撮影枠はありません'); return { ...context, slot }; }
function checkImageMetadata(photo) {
  if(photo.boardRevisions!==undefined){
    if(!Array.isArray(photo.boardRevisions))fail('黒板の訂正履歴が正しくありません');
    for(const revision of photo.boardRevisions){if(!object(revision)||typeof revision.applyBoard!=='boolean')fail('黒板の訂正履歴が正しくありません');checkTimestamp(revision.changedAt,'黒板の訂正日時');if(revision.board!==null)validateBoard(revision.board);}
  }
  if (photo.boardNoteMode !== undefined && !['auto', 'manual'].includes(photo.boardNoteMode)) fail('写真の黒板文言の設定が正しくありません');
  if (!own(TYPES, photo.type)) fail('写真はJPEG・PNG・WebPを指定してください'); text(photo.originalName, '元写真のファイル名', { max: 1000, required: true });
  if (!Number.isSafeInteger(photo.size) || photo.size <= 0 || photo.size > LIMITS.imageBytes) fail('写真は1枚20MiB以下にしてください');
  if (![photo.width, photo.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= LIMITS.side) || photo.width * photo.height > LIMITS.pixels) fail('写真は4000万画素以下・一辺16000px以下にしてください');
  if (photo.originalPath !== `originals/${photo.id}.${TYPES[photo.type]}`) fail('原本の保存場所が正しくありません'); checkTimestamp(photo.importedAt, '写真の取り込み日時'); checkDate(photo.workDate, '写真の作業日'); validateDateMetadata(photo);
  if (typeof photo.applyBoard !== 'boolean') fail('黒板の合成設定が正しくありません'); if (photo.board !== null) validateBoard(photo.board); if (photo.applyBoard && photo.board === null) fail('黒板を合成する写真に黒板の内容がありません');
}

/** New provenance fields are optional; legacy sourceId values are opaque and unchanged. */
function validateImportRegistry(project, groups, ids) {
  const registry = new Set();
  if (project.baseImports === undefined) return registry;
  // Current imports add one group per appended source; the first source may be ungrouped.
  if (!Array.isArray(project.baseImports) || project.baseImports.length > LIMITS.groups + 1) fail('旧データの出所一覧が正しくありません');
  for (const entry of project.baseImports) {
    if (!object(entry)) fail('旧データの出所情報が正しくありません');
    checkId(entry.id, ids, '旧データの出所'); registry.add(entry.id);
    if (typeof entry.fingerprint !== 'string' || !/^sha256-[a-f0-9]{64}$/.test(entry.fingerprint)) fail('旧データの出所情報が正しくありません');
    checkTimestamp(entry.importedAt, '旧データの出所登録日時');
    if (entry.groupId !== null && !groups.has(entry.groupId)) fail('旧データの出所のグループが見つかりません');
    if (!object(entry.sourceJob) || !own(entry.sourceJob, 'name') || !own(entry.sourceJob, 'route')) fail('旧データの出所の工事情報が正しくありません');
    text(entry.sourceJob.name, '旧データの出所工事名', { max: 100, required: true, multiline: true });
    text(entry.sourceJob.route, '旧データの出所路線名', { max: 300, multiline: true });
    if (entry.sourceJob.date !== undefined) checkDate(entry.sourceJob.date, '旧データの出所日付');
  }
  return registry;
}

function validateSourceReference(value, registry) {
  if (value.sourceImportId !== undefined && (!validId(value.sourceImportId) || !registry.has(value.sourceImportId))) fail('旧データの出所が見つかりません');
  if (value.sourceRegisteredAt !== undefined) checkTimestamp(value.sourceRegisteredAt, '旧データの登録日時');
}

/** Current schema only. Conversion is explicit at ZIP and IndexedDB boundaries. */
export function validateProject(project) {
  if (!object(project) || project.format !== FORMAT || project.schemaVersion !== 2) fail('この作業ファイルの形式・バージョンには対応していません'); rejectKeys(project, ['routes']);
  text(project.appVersion, 'アプリのバージョン', { max: 30, required: true }); text(project.name, '工事名', { max: 100, required: true, multiline: true }); checkTimestamp(project.createdAt, '工事の作成日時'); checkTimestamp(project.updatedAt, '工事の更新日時');
  if (!Array.isArray(project.groups) || project.groups.length > LIMITS.groups) fail('グループは50以内にしてください'); if (!Array.isArray(project.targets) || project.targets.length > LIMITS.targets) fail('記録対象は2000以内にしてください'); if (!Array.isArray(project.photos) || project.photos.length > LIMITS.photos) fail(`写真は履歴を含め${LIMITS.photos}枚以内にしてください`);
  const ids = new Set(), groups = new Map(), groupNames = new Set(), targetNames = new Map(), records = new Map(), photoOwners = new Map(); checkId(project.id, ids, '工事');
  for (const group of project.groups) {
    if(group.reportSection!=null)validateReportSection(group.reportSection);
    if (!object(group) || !GROUP_KINDS.includes(group.kind)) fail('グループの種類が正しくありません'); rejectKeys(group, ['points']); checkId(group.id, ids, 'グループ'); text(group.name, 'グループ名', { max: 300, required: true, multiline: true });
    const name = `${group.kind}\0${normalizedName(group.name.trim())}`; if (groupNames.has(name)) fail('同じ種類に同名のグループがあります'); groupNames.add(name); groups.set(group.id, group);
  }
  const sourceImports = validateImportRegistry(project, groups, ids);
  for (const target of project.targets) {
    if (!object(target)) fail('記録対象のデータが正しくありません'); rejectKeys(target, ['subject', 'routeId', 'pointId']); checkId(target.id, ids, '対象'); const definition = useCaseDefinition(target.useCase); text(target.name, definition.nameLabel, { max: 300, required: true });
    validateSourceReference(target, sourceImports);
    if (target.groupId !== null && !groups.has(target.groupId)) fail('記録対象のグループが見つかりません'); if (!targetNames.has(target.groupId)) targetNames.set(target.groupId, new Set());
    const names = targetNames.get(target.groupId), name = normalizedName(target.name.trim()); if (names.has(name)) fail('同じグループに同名の記録対象があります'); names.add(name);
    if (!Array.isArray(target.records) || !target.records.length) fail('記録対象に作業記録がありません'); const categories = new Set();
    for (const record of target.records) {
      if (!object(record)) fail('作業記録のデータが正しくありません'); rejectKeys(record, ['phase']); checkId(record.id, ids, '作業記録');
      validateSourceReference(record, sourceImports);
      if (!definition.categories.includes(record.category) || categories.has(record.category)) fail('区分が正しくないか、重複しています'); categories.add(record.category);
      validateRecordReport(target.useCase, record); validateRecordDates(record);
      if (record.boardNoteMode !== undefined && !['auto', 'manual'].includes(record.boardNoteMode)) fail('次回用黒板の文言設定が正しくありません');
      if (record.applyBoardDefault !== undefined && typeof record.applyBoardDefault !== 'boolean') fail('次回用黒板の合成設定が正しくありません');
      if (target.useCase === 'MMS') { if (record.boardDefaults !== null || record.applyBoardDefault === true) fail('MMSには電子黒板を付けません'); } else validateBoard(record.boardDefaults);
      if (!Array.isArray(record.slots) || record.slots.length !== definition.slots.length) fail('撮影枠が足りないか、重複しています'); const seenSlots = new Set();
      for (const slot of record.slots) {
        if (!object(slot) || !definition.slots.includes(slot.name) || seenSlots.has(slot.name) || !STATUSES.has(slot.status)) fail('撮影枠か撮影状態が正しくありません'); seenSlots.add(slot.name); text(slot.reason, '状態の理由', { max: 1000, multiline: true }); if (!Array.isArray(slot.photoIds)) fail('写真履歴が正しくありません');
        if (slot.status === 'unnecessary' && !slot.reason.trim()) fail('撮影不要の理由を入力してください');
        if (slot.status === 'taken') { if (!validId(slot.activePhotoId) || !slot.photoIds.includes(slot.activePhotoId) || slot.reason !== '') fail('撮影済みの採用写真か理由が正しくありません'); } else if (slot.activePhotoId !== null) fail('撮影済み以外の撮影枠に採用写真は設定できません');
        for (const photoId of slot.photoIds) { if (!validId(photoId) || photoOwners.has(photoId)) fail('写真履歴が重複しているか、正しくありません'); photoOwners.set(photoId, { target, record, slot }); }
      }
      records.set(record.id, { target, record });
    }
  }
  let totalBytes = 0; const referencedPhotos = new Set();
  for (const photo of project.photos) {
    if (!object(photo)) fail('写真のデータが正しくありません'); rejectKeys(photo, ['routeId', 'pointId', 'groupId']); checkId(photo.id, ids, '写真'); checkImageMetadata(photo); totalBytes += photo.size; if (totalBytes > LIMITS.totalBytes) fail(`原本の合計は${formatByteLimit()}以内にしてください`);
    validateSourceReference(photo, sourceImports);
    const values = [photo.targetId, photo.recordId, photo.slot];
    if (values.every(value => value === null)) { if (photoOwners.has(photo.id) || photo.applyBoard || photo.board !== null) fail('分類待ちの写真には所属や黒板を設定できません'); continue; }
    if (values.some(value => typeof value !== 'string' || !value)) fail('写真の所属はすべて指定するか、すべて未分類にしてください'); const owner = photoOwners.get(photo.id), context = records.get(photo.recordId);
    if (!context || !owner || context.target.id !== photo.targetId || owner.record.id !== photo.recordId || owner.slot.name !== photo.slot) fail('写真の所属と撮影枠が一致しません'); if ((context.target.useCase === 'MMS'||(context.target.useCase==='TS出来形(バリアフリー)'&&photo.slot==='スマホスクリーンショット')) && photo.applyBoard) fail('MMS写真には黒板を合成しません'); referencedPhotos.add(photo.id);
  }
  if (referencedPhotos.size !== photoOwners.size) fail('写真履歴にある原本が見つかりません'); validateReportSettings(project); return project;
}

/** Validate old ownership first; do not silently repair conflicting route/point references. */
export function upgradeProject(raw) {
  if (!object(raw) || raw.format !== FORMAT || ![1, 2].includes(raw.schemaVersion)) fail('この作業ファイルの形式・バージョンには対応していません');
  if (raw.schemaVersion === 2) { const copy = structuredClone(raw); validateProject(copy); return copy; } validateSchema1Project(raw);
  const source = structuredClone(raw), { routes, ...rest } = source, groups = [], targets = [];
  for (const route of routes) {
    const { points, ...group } = route; groups.push({ ...group, kind: '路線' });
    for (const point of points) {
      const { subject, records, ...target } = point;
      targets.push({ ...target, useCase: subject, groupId: route.id, records: records.map(record => {
        const { phase, boardDefaults, ...remaining } = record;
        return { ...remaining, category: phase, boardDefaults: subject === 'MMS' ? null : createBoard('legacy-simple', boardDefaults), applyBoardDefault: subject === 'MMS' ? false : record.applyBoardDefault ?? true };
      }) });
    }
  }
  const photos = source.photos.map(photo => { const { routeId, pointId, groupId, ...remaining } = photo; return { ...remaining, targetId: pointId, board: photo.board === null ? null : createBoard('legacy-simple', photo.board) }; });
  const result = { ...rest, schemaVersion: 2, appVersion: '0.2.0', groups, targets, photos }; validateProject(result); return result;
}

export function createProject(name) { const value = inputName(name, '工事名', 100), timestamp = now(); return { format: FORMAT, schemaVersion: 2, appVersion: '0.9.9', id: uid(), name: value, createdAt: timestamp, updatedAt: timestamp, groups: [], targets: [], photos: [] }; }
export function addGroup(project, { kind, name } = {}) {
  validateProject(project); if (!GROUP_KINDS.includes(kind)) fail('グループの種類を選択してください'); const value = inputName(name, 'グループ名'); if (project.groups.length >= LIMITS.groups) fail('グループは50以内にしてください'); if (project.groups.some(group => group.kind === kind && normalizedName(group.name.trim()) === normalizedName(value))) fail('同じ種類に同名のグループがあります');
  const group = { id: uid(), kind, name: value }; project.groups.push(group); project.updatedAt = now(); return group;
}
export function addTargets(project, { useCase, groupId = null, name = '', prefix = '', count = 1, category, templateId } = {}) {
  validateProject(project); const definition = useCaseDefinition(useCase); if (groupId !== null && !project.groups.some(group => group.id === groupId)) fail('グループが見つかりません'); if (!Number.isSafeInteger(count) || count < 1 || project.targets.length + count > LIMITS.targets) fail('記録対象は工事全体で2000以内です。追加数は1以上にしてください');
  const chosenCategory = category ?? definition.categories[0], existing = project.targets.filter(target => target.groupId === groupId); let names;
  if (count === 1) { const value = inputName(name, definition.nameLabel); if (existing.some(target => normalizedName(target.name.trim()) === normalizedName(value))) fail('同じグループに同名の記録対象があります'); names = [value]; }
  else {
    const start = prefix === '' ? definition.autoNamePrefix : inputName(prefix, '接頭辞', 30), pattern = new RegExp(`^${normalizedName(start).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`); let number = 0;
    for (const target of existing) { const match = pattern.exec(normalizedName(target.name)); if (match) { const suffix = Number(match[1]); if (!Number.isSafeInteger(suffix)) fail('既存の管理名の連番が大きすぎます'); number = Math.max(number, suffix); } } if (!Number.isSafeInteger(number + count)) fail('管理名の連番が上限を超えています'); names = Array.from({ length: count }, (_, index) => `${start}${number + index + 1}`);
  }
  const created = names.map(value => { const target = { id: uid(), name: value, useCase, groupId, records: [] }; target.records.push(makeRecord(project, target, chosenCategory, templateId === undefined ? definition.defaultBoardTemplate : templateId)); return target; }); project.targets.push(...created); project.updatedAt = now(); return created;
}
export function addRecord(project, targetId, category) { validateProject(project); const target = findTarget(project, targetId); if (target.records.some(record => record.category === category)) fail('この記録対象には同じ区分の作業記録が既にあります'); const record = makeRecord(project, target, category); target.records.push(record); project.updatedAt = now(); return record; }
export function addPhoto(project, recordId, slotName, metadata) {
  validateProject(project); if (!object(metadata)) fail('写真のデータがありません'); const unassigned = recordId === null && slotName === null, context = unassigned ? null : slotContext(project, recordId, slotName), id = metadata.id ?? uid();
  const allIds = [project.id, ...project.groups.map(group => group.id), ...project.targets.flatMap(target => [target.id, ...target.records.map(record => record.id)]), ...project.photos.map(photo => photo.id)]; if (!validId(id) || allIds.includes(id)) fail('写真のデータが重複しているか、正しくありません');
  const workDate = metadata.workDate ?? '', mms = context?.target.useCase === 'MMS'||(context?.target.useCase==='TS出来形(バリアフリー)'&&slotName==='スマホスクリーンショット'), defaultBoard = context && !mms ? structuredClone(context.record.boardDefaults) : null;
  if (defaultBoard) { if (['現密', 'コア密'].includes(context.target.useCase) && context.record.boardNoteMode !== 'manual') defaultBoard.values.note = `${defaultBoard.values.note}\n${slotName}`; }
  const photo = { id, targetId: context?.target.id ?? null, recordId: context?.record.id ?? null, slot: unassigned ? null : slotName, originalPath: metadata.originalPath ?? `originals/${id}.${TYPES[metadata.type] ?? ''}`, originalName: metadata.originalName, type: metadata.type, size: metadata.size, width: metadata.width, height: metadata.height, importedAt: metadata.importedAt ?? now(), workDate, board: metadata.board === undefined ? defaultBoard : structuredClone(metadata.board), applyBoard: metadata.applyBoard ?? Boolean(context && !mms && context.record.applyBoardDefault !== false), boardNoteMode: metadata.boardNoteMode ?? context?.record.boardNoteMode ?? 'manual' };
  for (const key of ['workDateStatus','captureSource','capturedAt']) if (metadata[key] !== undefined) photo[key]=metadata[key];
  checkImageMetadata(photo); if ((mms || unassigned) && (photo.applyBoard || photo.board !== null)) fail('MMS・分類待ちの写真には黒板を付けられません'); if (project.photos.length >= LIMITS.photos) fail(`写真は履歴を含め${LIMITS.photos}枚以内にしてください`); if (project.photos.reduce((sum, item) => sum + item.size, 0) + photo.size > LIMITS.totalBytes) fail(`原本の合計は${formatByteLimit()}以内にしてください`);
  project.photos.push(photo); if (context) { context.slot.photoIds.push(id); context.slot.activePhotoId = id; context.slot.status = 'taken'; context.slot.reason = ''; } project.updatedAt = now(); return photo;
}
export function setSlotStatus(project, recordId, slotName, status, reason = '') { validateProject(project); const { slot } = slotContext(project, recordId, slotName); if (!STATUSES.has(status)) fail('撮影状態が正しくありません'); const value = text(reason, '状態の理由', { max: 1000, multiline: true }).trim(); if (status === 'unnecessary' && !value) fail('撮影不要の理由を入力してください'); if (status === 'taken' && !slot.activePhotoId) fail('撮影済みにするには採用写真を選択してください'); slot.status = status; slot.reason = status === 'taken' ? '' : value; if (status !== 'taken') slot.activePhotoId = null; project.updatedAt = now(); }
export function setActivePhoto(project, recordId, slotName, photoId) { validateProject(project); const { slot } = slotContext(project, recordId, slotName); if (!slot.photoIds.includes(photoId)) fail('この撮影枠の履歴から採用写真を選択してください'); slot.activePhotoId = photoId; slot.status = 'taken'; slot.reason = ''; project.updatedAt = now(); }
/** Shared by progress and output: a stored history is never implicitly adopted. */
export function getSlotState(project, recordId, slotName) {
  const { slot } = slotContext(project, recordId, slotName);
  const history = slot.photoIds.map(id => {
    const photo = project.photos.find(item => item.id === id);
    if (!photo) fail('撮影枠の写真が見つかりません');
    return photo;
  });
  const photo = slot.status === 'taken' ? history.find(item => item.id === slot.activePhotoId) : null;
  if (slot.status === 'taken' && !photo) fail('撮影枠の採用写真が見つかりません');
  return { name: slot.name, status: slot.status, reason: slot.reason, photo: photo || null, history, complete: slot.status === 'taken' || slot.status === 'unnecessary' };
}
export function summarize(project, groupId) {
  if (groupId !== undefined && groupId !== null && !project.groups.some(group => group.id === groupId)) fail('グループが見つかりません'); const targets = groupId === undefined ? project.targets : project.targets.filter(target => target.groupId === groupId), result = { targets: targets.length, records: 0, total: 0, taken: 0, unnecessary: 0, missing: 0, complete: 0 };
  for (const target of targets) for (const record of target.records) { result.records++; let complete = true; for (const slot of record.slots) { const state = getSlotState(project, record.id, slot.name); result.total++; if (state.status === 'taken') result.taken++; else if (state.status === 'unnecessary') result.unnecessary++; else result.missing++; if (!state.complete) complete = false; } if (complete) result.complete++; } return result;
}
