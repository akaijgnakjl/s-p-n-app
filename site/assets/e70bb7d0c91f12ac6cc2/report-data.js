import { USE_CASES } from './definitions.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => Boolean(value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
const fail = message => { throw new Error(message); };
export const STATION_NOTATIONS = Object.freeze(['SP', 'No.', '自由入力', 'KP=']);

/** Item names describe a whole form. Column labels remain fixed for the six known uses. */
export function defaultReportItemName(useCase) {
  if (!own(USE_CASES, useCase)) fail('帳票の用途が不正です。');
  return useCase === '仮BM' ? '仮BM設置' : useCase;
}

function validateItemNames(names) {
  if (!object(names) || Object.keys(names).some(useCase => !own(USE_CASES, useCase))) fail('帳票項目名は定義済みの6用途で指定してください。');
  for (const value of Object.values(names)) {
    validateReportValue(value, '帳票項目名');
    if (!value.trim()) fail('保存する帳票項目名は空欄にできません。既定値へ戻す操作を使用してください。');
  }
}

export function validateReportSettings(project) {
  if (project.reportSettings === undefined) return;
  const settings = project.reportSettings;
  if (!object(settings) || Object.keys(settings).some(key => !['defaults', 'groups'].includes(key))) fail('帳票項目名の設定形式が不正です。');
  if (settings.defaults !== undefined) validateItemNames(settings.defaults);
  if (settings.groups !== undefined) {
    if (!object(settings.groups)) fail('分類別の帳票項目名が不正です。');
    const ids = new Set(project.groups.map(group => group.id));
    for (const [groupId, names] of Object.entries(settings.groups)) {
      if (!ids.has(groupId)) fail('帳票項目名が存在しない分類を参照しています。');
      validateItemNames(names);
    }
  }
}

export function getReportItemNames(project, groupId = null) {
  validateReportSettings(project);
  if (groupId !== null && !project.groups.some(group => group.id === groupId)) fail('帳票項目名の分類が見つかりません。');
  return Object.fromEntries(Object.keys(USE_CASES).map(useCase => [useCase,
    project.reportSettings?.groups?.[groupId]?.[useCase] ?? project.reportSettings?.defaults?.[useCase] ?? defaultReportItemName(useCase)]));
}

export function getReportItemName(project, recordId) {
  const { target } = getReportContext(project, recordId);
  return getReportItemNames(project, target.groupId)[target.useCase];
}

/** Atomic settings edit: an empty value removes only that scope's override. */
export function updateReportItemNames(project, { groupId = null, names } = {}) {
  validateReportSettings(project);
  if (groupId !== null && !project.groups.some(group => group.id === groupId)) fail('帳票項目名の分類が見つかりません。');
  if (!object(names) || Object.keys(names).some(useCase => !own(USE_CASES, useCase))) fail('帳票項目名は定義済みの6用途で指定してください。');
  for (const value of Object.values(names)) validateReportValue(value, '帳票項目名');
  const next = structuredClone(project);
  next.reportSettings ??= { defaults: {}, groups: {} };
  next.reportSettings.defaults ??= {};
  next.reportSettings.groups ??= {};
  const scope = groupId === null ? next.reportSettings.defaults : (next.reportSettings.groups[groupId] ??= {});
  for (const [useCase, value] of Object.entries(names)) {
    if (!value.trim()) delete scope[useCase];
    else scope[useCase] = value;
  }
  if (groupId !== null && !Object.keys(scope).length) delete next.reportSettings.groups[groupId];
  next.updatedAt = new Date().toISOString();
  validateReportSettings(next);
  return next;
}

export function getReportContext(project, recordId) {
  for (const target of project.targets) {
    const record = target.records.find(item => item.id === recordId);
    if (record) return { target, record, group: target.groupId === null ? null : project.groups.find(item => item.id === target.groupId) ?? null };
  }
  fail('調書の作業記録が見つかりません。');
}

export function validateReportValue(value, label = '調書の入力値') {
  if (typeof value !== 'string' || value.length > 300 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(`${label}は300文字以内の文字列にしてください。`);
  return value;
}

function millimeters(value) {
  const raw = String(value ?? '').trim();
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(raw) || raw.length > 30) fail('起点・終点・不施工区間長は小数第3位までの数字で入力してください。');
  const negative = raw.startsWith('-'), [whole, fraction = ''] = raw.replace(/^-/, '').split('.');
  const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('施工区間の数値が大きすぎます。');
  return negative ? -result : result;
}

function decimalMm(value, digits = 3, trim = false) {
  const negative = value < 0n, absolute = negative ? -value : value;
  const fraction = String(absolute % 1000n).padStart(3, '0').slice(0, digits);
  const suffix = trim ? fraction.replace(/0+$/, '') : fraction;
  return `${negative ? '-' : ''}${absolute / 1000n}${suffix ? `.${suffix}` : ''}`;
}

/** Numeric values remain meters; calculations use exact integer millimeters. */
export function constructionSection(start, end, excluded = '') {
  const values = [start, end, excluded].map(value => String(value ?? '').trim());
  try {
    for (const value of values) if (value !== '') millimeters(value);
    if (values[2] && millimeters(values[2]) < 0n) fail('不施工区間長は0以上で入力してください。');
    if (!values[0] || !values[1]) return { complete: false, length: '', error: '' };
    const [a, b, c] = values.map(value => millimeters(value || '0'));
    if (b < a) fail('終点は起点以上で入力してください。');
    if (c > b - a) fail('不施工区間長が起点から終点までの長さを超えています。');
    const length = b - a - c;
    if (length > BigInt(Number.MAX_SAFE_INTEGER)) fail('施工区間の延長が大きすぎます。');
    const digits = Math.max(...values.map(value => value.split('.')[1]?.length || 0));
    return { complete: true, length: decimalMm(length, digits), lengthMm: Number(length), startMm: Number(a), endMm: Number(b), excludedMm: Number(c), error: '' };
  } catch (error) { return { complete: false, length: '', error: error.message }; }
}

export function validateReportSection(section) {
  if (!object(section) || Object.keys(section).some(key => !['start', 'end', 'excluded', 'notation', 'custom'].includes(key))) fail('施工区間の形式が不正です。');
  for (const key of ['start', 'end']) if (typeof section[key] !== 'string' || section[key].length > 30) fail('施工区間の起点・終点を数字で指定してください。');
  if (section.excluded !== undefined && (typeof section.excluded !== 'string' || section.excluded.length > 30)) fail('不施工区間長が不正です。');
  if (!STATION_NOTATIONS.includes(section.notation)) fail('測点の表示形式が不正です。');
  if (section.custom !== undefined && (typeof section.custom !== 'string' || section.custom.length > 30 || /[\u0000-\u001f\u007f]/.test(section.custom))) fail('自由入力の測点名は30文字以内にしてください。');
  if (section.notation === '自由入力' && !String(section.custom || '').trim()) fail('自由入力の測点名を入力してください。');
  const result = constructionSection(section.start, section.end, section.excluded);
  if (result.error || !result.complete) fail(result.error || '施工区間を指定する場合は起点と終点を入力してください。');
  return section;
}

/** KP= is a prefix for the same meter value, not a conversion to kilometers. */
export function formatStation(value, notation = 'SP', custom = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const mm = millimeters(raw);
  if (!STATION_NOTATIONS.includes(notation)) fail('測点の表示形式が不正です。');
  if (notation === 'No.') {
    const absolute = mm < 0n ? -mm : mm;
    return `No.${mm < 0n ? '-' : ''}${absolute / 100000n}+${decimalMm(absolute % 100000n, 3, true)}`;
  }
  if (notation === '自由入力') return `${String(custom || '測点').trim()} ${raw}`;
  return `${notation === 'KP=' ? 'KP=' : 'SP '}${raw}`;
}

export function sectionLabel(section) {
  if (section === null || section === undefined) return '';
  validateReportSection(section);
  const length = constructionSection(section.start, section.end, section.excluded).length;
  const range = section.notation === 'SP' ? `SP ${section.start.trim()} ～ ${section.end.trim()}` : `${formatStation(section.start, section.notation, section.custom)} ～ ${formatStation(section.end, section.notation, section.custom)}`;
  return `${range}　不施工区間長 ${section.excluded?.trim() || '0'} m　L= ${length} m`;
}

/** Optional additions to schema 2; unknown bounded field keys survive existing saved work. */
export function validateRecordReport(useCase, record) {
  if (!own(USE_CASES, useCase)) fail('調書の用途が不正です。');
  if (record.reportFields !== undefined) {
    if (!object(record.reportFields) || Object.keys(record.reportFields).length > 100) fail('調書の入力項目が不正です。');
    for (const [key, value] of Object.entries(record.reportFields)) {
      if (!key || key.length > 100 || /[\u0000-\u001f\u007f]/.test(key)) fail('調書の項目名が不正です。');
      validateReportValue(value);
      if(useCase==='TS出来形(バリアフリー)'&&['designX','measuredX','designY','measuredY'].includes(key)&&value.trim())millimeters(value.trim());
    }
  }
  if (record.reportSection !== undefined && record.reportSection !== null) validateReportSection(record.reportSection);
  if (record.reportReview !== undefined && record.reportReview !== null) {
    const review = record.reportReview;
    if (!object(review) || typeof review.signature !== 'string' || !/^r1-[a-f0-9]{16}$/.test(review.signature) || typeof review.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(review.reviewedAt) || !Number.isFinite(Date.parse(review.reviewedAt))) fail('調書の確認記録が不正です。');
  }
}

export function reportMissingFields(project, recordId) {
  const { target, record } = getReportContext(project, recordId);
  return USE_CASES[target.useCase].reportColumns.filter(column => !column.optional && column.key !== 'remarks' && !String(record.reportFields?.[column.key] || '').trim()).map(column => column.label);
}

export function reportSignature(project, recordId) {
  const { target, record, group } = getReportContext(project, recordId);
  const fields = Object.entries(record.reportFields || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const payload = JSON.stringify([project.id, project.name, target.id, target.name, target.useCase, target.groupId, group ? [group.kind, group.name] : null, record.id, record.category, fields, effectiveReportSection(project,recordId), getReportItemName(project, recordId)]);
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(payload)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return `r1-${hash.toString(16).padStart(16, '0')}`;
}

export function reportReviewState(project, recordId) {
  const { target, record } = getReportContext(project, recordId);
  if (target.useCase === 'MMS') return 'reviewed';
  if (!record.reportReview) return 'unreviewed';
  return record.reportReview.signature === reportSignature(project, recordId) ? 'reviewed' : 'stale';
}

/** A route's shared section overrides, but never deletes, older per-record sections. */
export function effectiveReportSection(project,recordId){
  const {record,group}=getReportContext(project,recordId);
  return group&&own(group,'reportSection')?group.reportSection:record.reportSection??null;
}

/** Reference TS form: meter inputs, signed millimeter differences and rounded planar distance. */
export function tsMeasurements(fields={}){
  const read=key=>String(fields[key]??'').trim();
  try{
    if(['designX','measuredX','designY','measuredY'].some(key=>!read(key)))return null;
    const dx=Number(millimeters(read('measuredX'))-millimeters(read('designX')));
    const dy=Number(millimeters(read('measuredY'))-millimeters(read('designY')));
    return {dx,dy,d:Math.round(Math.hypot(dx,dy))};
  }catch{return null;}
}

export function tsReportCells(context){
  if(context.tsCells)return context.tsCells;
  const f=context.record.reportFields||{},m=tsMeasurements(f);
  return [`${f.station||context.targetName}${f.side?` (${f.side})`:''}`,f.designX,f.measuredX,m?.dx??'—',f.designY,f.measuredY,m?.dy??'—',m?.dx??'—',m?.dy??'—',m?.d??'—'].map(value=>String(value??''));
}
export function tsCellLines(value){
  return String(value).split('\n').flatMap(paragraph=>{const lines=[];let line='',width=0;for(const character of Array.from(paragraph)){const size=/[\x20-\x7e]/.test(character)&&!/[WM@%]/.test(character) ? 0.6 : 1;if(line&&width+size>7){lines.push(line);line='';width=0;}line+=character;width+=size;}lines.push(line);return lines;});
}
export function tsRowHeight(context){return Math.max(3.8,...tsReportCells(context).map(value=>tsCellLines(value).length*3.3+.7));}

/** Excel-style quoted TSV, including embedded tabs/newlines and a trailing line terminator. */
export function parseReportPaste(value) {
  if (typeof value !== 'string' || value.length > 2 * 1024 * 1024) fail('貼り付け内容が大きすぎるか、文字列ではありません。');
  const input = value.replace(/\r\n?/g, '\n'), rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; };
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '\t') pushCell();
    else if (char === '\n') { pushCell(); rows.push(row); row = []; }
    else if (char === '"' && cell === '' && !closed) quoted = true;
    else { if (closed) fail('貼り付けた表の引用符が不正です。'); cell += char; }
  }
  if (quoted) fail('貼り付けた表の引用符が閉じられていません。');
  if (row.length || cell || !input.endsWith('\n')) { pushCell(); rows.push(row); }
  if (!rows.length || rows.some(item => item.length !== rows[0].length)) fail('貼り付ける表は行ごとの列数を揃えてください。');
  for (const values of rows) for (const entry of values) validateReportValue(entry, '貼り付けるセル');
  return rows;
}
