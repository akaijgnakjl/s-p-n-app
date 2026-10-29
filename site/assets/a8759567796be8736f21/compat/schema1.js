// Frozen schema-1 definitions. New category names must not reinterpret existing files.
import { LIMITS as CURRENT_LIMITS } from '../definitions.js';
const LIMITS = { ...CURRENT_LIMITS, points: CURRENT_LIMITS.targets, routes: CURRENT_LIMITS.groups };
const SUBJECTS = {
  '基準点': { phases: ['新設', '検測'], slots: ['遠景', '近景'] },
  '仮BM': { phases: ['新設'], slots: ['遠景', '近景'] },
  '現密': { phases: ['路体', '路床', '置換層', '凍上抑制層', '下層路盤工', '歩道路盤工'], slots: ['残砂質量測定', '湿潤土質量測定', '試料乾燥状況'] },
  'コア密': { phases: ['表層工', '基層工', '中間層', '上層路盤工', '舗道舗装工'], slots: ['空中質量測定', '水中質量測定', '表乾質量測定'] },
  '縁石': { phases: ['通常'], slots: ['全景', '詳細'] },
  'MMS': { phases: ['通常'], slots: ['前', '後'] }
};

const FORMAT = 'survey-photo-note';
const SCHEMA_VERSION = 1;
const TYPES = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
const STATUSES = new Set(['missing', 'taken', 'retake', 'unnecessary']);
const BOARD_KEYS = ['job', 'route', 'point', 'note', 'date'];
const fail = message => { throw new Error(message); };
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const normalizedName = value => value.normalize('NFC').toLowerCase();

function text(value, label, { max = 300, required = false, multiline = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) ||
      (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) {
    fail(`${label}が不正です${max ? `（${max}文字以内）` : ''}`);
  }
  return value;
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

function checkId(value, ids, label) {
  if (!validId(value) || ids.has(value)) fail(`${label}のIDが不正または重複しています`);
  ids.add(value);
}

function checkTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(`${label}が不正です`);
  }
}

function checkDate(value, label, allowEmpty = true) {
  if (value === '' && allowEmpty) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    fail(`${label}は年月日で指定してください`);
  }
}

function checkBoard(board, label) {
  if (!object(board) || BOARD_KEYS.some(key => !own(board, key)) || Object.keys(board).some(key => !BOARD_KEYS.includes(key))) fail(`${label}が不正です`);
  for (const key of BOARD_KEYS) text(board[key], `${label}の${key}`, { max: 1000, multiline: true });
  checkDate(board.date, `${label}の日付`);
}

function checkImageMetadata(photo) {
  if (!own(TYPES, photo.type)) fail('写真はJPEG・PNG・WebPを指定してください');
  text(photo.originalName, '元写真のファイル名', { max: 1000, required: true });
  if (!Number.isSafeInteger(photo.size) || photo.size <= 0 || photo.size > LIMITS.imageBytes) fail('写真は1枚20MiB以下にしてください');
  if (![photo.width, photo.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= LIMITS.side) || photo.width * photo.height > LIMITS.pixels) {
    fail('写真は4000万画素以下・一辺16000px以下にしてください');
  }
  if (photo.originalPath !== `originals/${photo.id}.${TYPES[photo.type]}`) fail('元写真の保存パスが不正です');
  checkTimestamp(photo.importedAt, '写真の取り込み日時');
  checkDate(photo.workDate, '写真の作業日');
  if (typeof photo.applyBoard !== 'boolean') fail('黒板の合成指定が不正です');
  if (photo.board !== null) checkBoard(photo.board, '写真の黒板');
  if (photo.applyBoard && photo.board === null) fail('黒板を合成する写真には黒板データが必要です');
}

/** 保存・受け渡し共通の構造検証。Blob本体のデコードやバイト照合は呼出側が行う。 */
export function validateSchema1Project(project) {
  if (!object(project) || project.format !== FORMAT || project.schemaVersion !== SCHEMA_VERSION) fail('対応していない作業ファイルの形式またはバージョンです');
  text(project.appVersion, 'アプリのバージョン', { max: 30, required: true });
  text(project.name, '工事名', { max: 100, required: true, multiline: true });
  checkTimestamp(project.createdAt, '工事の作成日時');
  checkTimestamp(project.updatedAt, '工事の更新日時');
  if (!Array.isArray(project.routes) || project.routes.length > LIMITS.routes) fail('路線数が不正です（最大50路線）');
  if (!Array.isArray(project.photos) || project.photos.length > LIMITS.photos) fail(`写真数が不正です（最大${LIMITS.photos}枚）`);
  const ids = new Set();
  checkId(project.id, ids, '工事');
  const routes = new Map(), points = new Map(), records = new Map(), routeNames = new Set(), photoOwners = new Map();
  let pointCount = 0;
  for (const route of project.routes) {
    if (!object(route)) fail('路線が不正です');
    checkId(route.id, ids, '路線');
    text(route.name, '路線名', { max: 300, required: true, multiline: true });
    const routeName = normalizedName(route.name.trim());
    if (routeNames.has(routeName)) fail('同じ工事に同名の路線があります');
    routeNames.add(routeName); routes.set(route.id, route);
    if (!Array.isArray(route.points)) fail('点の一覧が不正です');
    const pointNames = new Set();
    for (const point of route.points) {
      pointCount++;
      if (pointCount > LIMITS.points) fail('点は工事全体で2000点以内にしてください');
      if (!object(point)) fail('点が不正です');
      checkId(point.id, ids, '点');
      text(point.name, '点名', { max: 300, required: true });
      const name = normalizedName(point.name.trim());
      if (pointNames.has(name)) fail('同じ路線に同名の点があります');
      pointNames.add(name);
      if (!own(SUBJECTS, point.subject)) fail('撮影対象が不正です');
      if (!Array.isArray(point.records) || !point.records.length) fail('点には作業記録が必要です');
      points.set(point.id, { route, point });
      const phases = new Set();
      for (const record of point.records) {
        if (!object(record)) fail('作業記録が不正です');
        checkId(record.id, ids, '作業記録');
        if (!SUBJECTS[point.subject].phases.includes(record.phase) || phases.has(record.phase)) fail('作業状況が不正または重複しています');
        phases.add(record.phase);
        checkBoard(record.boardDefaults, '作業記録の黒板初期値');
        const slotNames = SUBJECTS[point.subject].slots;
        if (!Array.isArray(record.slots) || record.slots.length !== slotNames.length) fail('撮影枠が不足または重複しています');
        const seenSlots = new Set();
        for (const slot of record.slots) {
          if (!object(slot) || !slotNames.includes(slot.name) || seenSlots.has(slot.name) || !STATUSES.has(slot.status)) fail('撮影枠または状態が不正です');
          seenSlots.add(slot.name);
          text(slot.reason, '状態の理由', { max: 1000, multiline: true });
          if (!Array.isArray(slot.photoIds) || slot.photoIds.length > LIMITS.photos) fail('写真履歴が不正です');
          if (slot.status === 'unnecessary' && !slot.reason.trim()) fail('撮影不要には理由が必要です');
          if (slot.status === 'taken') {
            if (!validId(slot.activePhotoId) || !slot.photoIds.includes(slot.activePhotoId) || slot.reason !== '') fail('撮影済みの採用写真または理由が不正です');
          } else if (slot.activePhotoId !== null) fail('未採用の状態に採用写真を指定できません');
          for (const photoId of slot.photoIds) {
            if (!validId(photoId) || photoOwners.has(photoId)) fail('写真履歴のIDが不正または重複しています');
            photoOwners.set(photoId, { route, point, record, slot });
          }
        }
        records.set(record.id, { route, point, record });
      }
    }
  }
  let totalBytes = 0;
  const referencedPhotos = new Set();
  for (const photo of project.photos) {
    if (!object(photo)) fail('写真情報が不正です');
    checkId(photo.id, ids, '写真');
    checkImageMetadata(photo);
    totalBytes += photo.size;
    if (totalBytes > LIMITS.totalBytes) fail(`元写真の合計は${LIMITS.totalBytes / 1024 / 1024}MiB以内にしてください`);
    const values = [photo.routeId, photo.pointId, photo.recordId, photo.slot];
    if (values.every(value => value === null)) {
      if (photoOwners.has(photo.id) || photo.applyBoard || photo.board !== null) fail('分類待ち写真に所属または黒板を指定できません');
      continue;
    }
    if (values.some(value => typeof value !== 'string' || !value)) fail('写真の所属はすべて指定するか、すべて未分類にしてください');
    const owner = photoOwners.get(photo.id), context = records.get(photo.recordId);
    if (!routes.has(photo.routeId) || !points.has(photo.pointId) || !context || !owner ||
        context.route.id !== photo.routeId || context.point.id !== photo.pointId ||
        owner.record.id !== photo.recordId || owner.slot.name !== photo.slot) fail('写真の所属と撮影枠の参照が一致しません');
    if (context.point.subject === 'MMS' && (photo.applyBoard || photo.board !== null)) fail('MMS写真には黒板を付けません');
    referencedPhotos.add(photo.id);
  }
  if (referencedPhotos.size !== photoOwners.size) fail('写真履歴が存在しない元写真を参照しています');
  return project;
}

