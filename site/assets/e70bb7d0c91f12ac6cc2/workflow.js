import { validateProject, getContext, USE_CASES } from './model.js';
import { getReportContext, validateReportValue, validateReportSection, reportMissingFields, reportSignature, parseReportPaste } from './report-data.js';

const fail = message => { throw new Error(message); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const keyName = value => value.normalize('NFC').toLowerCase();

function nameValue(value, label, maximum, multiline = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) fail(`${label}を${maximum}文字以内で入力してください。`);
  return value.trim();
}

/** Prepare and validate a complete metadata change before touching the caller's project. */
function changeProject(project, change) {
  validateProject(project);
  const next = structuredClone(project), result = change(next);
  next.updatedAt = new Date().toISOString();
  validateProject(next);
  Object.assign(project, next);
  return result;
}

export function renameProject(project, name) {
  changeProject(project, next => { next.name = nameValue(name, '工事名', 100, true); });
  return project;
}

export function renameGroup(project, id, name) {
  return changeProject(project, next => {
    const group = next.groups.find(item => item.id === id);
    if (!group) fail('グループが見つかりません。');
    const value = nameValue(name, 'グループ名', 300, true);
    if (next.groups.some(item => item.id !== id && item.kind === group.kind && keyName(item.name.trim()) === keyName(value))) fail('同じ種類に同名のグループがあります。');
    group.name = value;
    return group;
  });
}

export function updateTarget(project, id, updates) {
  return changeProject(project, next => {
    if (!object(updates) || Object.keys(updates).some(key => !['name', 'groupId'].includes(key))) fail('訂正できるのは管理名と所属グループです。用途は変更できません。');
    const target = next.targets.find(item => item.id === id);
    if (!target) fail('記録対象が見つかりません。');
    const name = own(updates, 'name') ? nameValue(updates.name, USE_CASES[target.useCase].nameLabel, 300) : target.name;
    const groupId = own(updates, 'groupId') ? updates.groupId : target.groupId;
    if (groupId !== null && !next.groups.some(item => item.id === groupId)) fail('移動先のグループが見つかりません。');
    if (next.targets.some(item => item.id !== id && item.groupId === groupId && keyName(item.name.trim()) === keyName(name.trim()))) fail('移動先のグループに同名の対象があります。');
    target.name = name; target.groupId = groupId;
    return target;
  });
}

export function setRouteSection(project,groupId,section){
  return changeProject(project,next=>{
    const group=next.groups.find(item=>item.id===groupId);
    if(!group)fail('路線を選択してください。');
    if(section!=null)validateReportSection(section);
    group.reportSection=section==null?null:structuredClone(section);
  });
}

/** Metadata-only deletion plan. The caller must save the corresponding Blob map atomically. */
export function describeTargetDeletion(project,targetIds){
  validateProject(project);
  if(!Array.isArray(targetIds)||!targetIds.length)fail('削除する記録対象を選択してください。');
  const ids=new Set(targetIds),targets=project.targets.filter(target=>ids.has(target.id));
  if(targets.length!==ids.size)fail('削除対象に存在しない記録対象が含まれています。');
  const photos=project.photos.filter(photo=>ids.has(photo.targetId));
  return {targetIds:[...ids],names:targets.map(target=>target.name),recordIds:targets.flatMap(target=>target.records.map(record=>record.id)),photoIds:photos.map(photo=>photo.id),bytes:photos.reduce((sum,photo)=>sum+photo.size,0)};
}

export function deleteTargets(project,targetIds){
  const plan=describeTargetDeletion(project,targetIds);
  changeProject(project,next=>{
    const ids=new Set(plan.targetIds);
    next.targets=next.targets.filter(target=>!ids.has(target.id));
    next.photos=next.photos.filter(photo=>!ids.has(photo.targetId));
  });
  return plan;
}

function photoContext(project, id) {
  const photo = project.photos.find(item => item.id === id);
  if (!photo) fail('写真が見つかりません。');
  if (photo.recordId === null) return { photo, from: null };
  const context = getContext(project, photo.recordId), slot = context.record.slots.find(item => item.name === photo.slot);
  if (!slot) fail('移動元の撮影枠が見つかりません。');
  return { photo, from: { ...context, slot } };
}

export function describePhotoMove(project, photoId, destination = {}) {
  validateProject(project);
  const { photo, from } = photoContext(project, photoId);
  if (!object(destination) || typeof destination.recordId !== 'string' || typeof destination.slot !== 'string') fail('移動先の作業記録と写真の種類を選んでください。');
  const context = getContext(project, destination.recordId), slot = context.record.slots.find(item => item.name === destination.slot);
  if (!slot) fail('移動先の撮影枠が見つかりません。');
  const to = { ...context, slot }, same = photo.recordId === context.record.id && photo.slot === slot.name;
  const conflictPhoto = slot.activePhotoId && slot.activePhotoId !== photoId ? project.photos.find(item => item.id === slot.activePhotoId) : null;
  const requiresMmsConfirmation = Boolean(from && from.target.useCase !== 'MMS' && to.target.useCase === 'MMS');
  const sourceLosesAdoption = Boolean(!same && from?.slot.activePhotoId === photoId);
  const messages = [];
  if (same) messages.push('現在と同じ所属です。採用の変更は写真の採用操作を使ってください。');
  if (sourceLosesAdoption) messages.push('移動元は未撮影になります。残っている履歴写真は自動採用しません。');
  if (conflictPhoto) messages.push('移動先には採用写真があります。採用し直すか、移動する写真を履歴として追加するか選んでください。');
  if (requiresMmsConfirmation) messages.push('MMSでは電子黒板を合成しません。既存の黒板データを保持し、合成だけを解除します。');
  if (to.target.useCase !== 'MMS') messages.push('既存の黒板内容は自動変更しません。必要なら移動後に写真の黒板を訂正してください。');
  return { photo, from, to, sourceLosesAdoption, conflictPhoto: conflictPhoto || null, changesBoard: false, disablesBoard: requiresMmsConfirmation && photo.applyBoard, requiresMmsConfirmation, canMove: !same, reason: same ? messages[0] : '', messages };
}

function removeFromSlot(from, photoId) {
  if (!from) return;
  from.slot.photoIds = from.slot.photoIds.filter(id => id !== photoId);
  if (from.slot.activePhotoId === photoId) {
    from.slot.activePhotoId = null; from.slot.status = 'missing'; from.slot.reason = '';
  }
}

export function movePhoto(project, photoId, destination = {}) {
  return changeProject(project, next => {
    const effect = describePhotoMove(next, photoId, destination);
    if (!effect.canMove) fail(effect.reason);
    if (!['adopt', 'history'].includes(destination.resolution)) fail('移動先で採用するか、履歴として追加するか選んでください。');
    if (effect.requiresMmsConfirmation && destination.disableBoardForMms !== true) fail('MMSへの移動では、黒板の合成を解除することを確認してください。');
    const { photo, from, to } = effect;
    removeFromSlot(from, photoId);
    photo.targetId = to.target.id; photo.recordId = to.record.id; photo.slot = to.slot.name;
    if (to.target.useCase === 'MMS'||(to.target.useCase==='TS出来形(バリアフリー)'&&to.slot.name==='スマホスクリーンショット')) photo.applyBoard = false;
    to.slot.photoIds.push(photoId);
    if (destination.resolution === 'adopt') { to.slot.activePhotoId = photoId; to.slot.status = 'taken'; to.slot.reason = ''; }
    return photo;
  });
}

export function describePhotoDelete(project, photoId) {
  validateProject(project);
  const { photo, from } = photoContext(project, photoId), sourceLosesAdoption = Boolean(from?.slot.activePhotoId === photoId);
  const remainingHistory = from ? from.slot.photoIds.filter(id => id !== photoId).length : 0;
  return { photo, from, sourceLosesAdoption, remainingHistory, messages: [sourceLosesAdoption ? '採用写真を削除するため、この枠は未撮影になります。履歴は自動採用しません。' : 'この写真だけを削除します。撮影枠の採用状態は変えません。', '元写真も削除対象です。必要なら先に作業ZIPまたは原本を保存してください。'] };
}

export function deletePhoto(project, photoId) {
  return changeProject(project, next => {
    const { photo, from } = describePhotoDelete(next, photoId);
    removeFromSlot(from, photoId);
    next.photos = next.photos.filter(item => item.id !== photoId);
    return photo;
  });
}

function reportContext(project, recordId) {
  const context = getReportContext(project, recordId);
  if (!USE_CASES[context.target.useCase].reportColumns.length) fail('MMSは調書入力の対象ではありません。');
  return context;
}

export function setReportField(project, recordId, key, value) {
  return changeProject(project, next => {
    const { target, record } = reportContext(next, recordId);
    if (!USE_CASES[target.useCase].reportColumns.some(column => column.key === key)) fail('この用途にない調書の項目です。');
    validateReportValue(value);
    record.reportFields = { ...(record.reportFields || {}), [key]: value };
    return record;
  });
}

export function describeReportPaste(project, { recordIds, keys, startRow = 0, startCol = 0, text } = {}) {
  validateProject(project);
  if (!Array.isArray(recordIds) || !recordIds.length || new Set(recordIds).size !== recordIds.length || !Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length || keys.some(key => typeof key !== 'string') || !Number.isSafeInteger(startRow) || !Number.isSafeInteger(startCol) || startRow < 0 || startCol < 0) fail('貼り付け先の表と開始セルが不正です。');
  const matrix = parseReportPaste(text), columns = matrix[0].length;
  if (startRow + matrix.length > recordIds.length || startCol + columns > keys.length) fail('貼り付け範囲が表を超えています。追加の行・列は自動で切り捨てません。');
  const updates = [];
  for (let row = 0; row < matrix.length; row++) {
    const recordId = recordIds[startRow + row], { target } = reportContext(project, recordId);
    for (let col = 0; col < columns; col++) {
      const key = keys[startCol + col];
      if (!USE_CASES[target.useCase].reportColumns.some(column => column.key === key)) fail('貼り付け先に用途と合わない調書項目があります。');
      updates.push({ recordId, key, value: matrix[row][col] });
    }
  }
  return { rows: matrix.length, columns, cells: updates.length, matrix, updates };
}

export function applyReportPaste(project, options) {
  return changeProject(project, next => {
    const preview = describeReportPaste(next, options);
    for (const update of preview.updates) {
      const { record } = getReportContext(next, update.recordId);
      record.reportFields = { ...(record.reportFields || {}), [update.key]: update.value };
    }
    return preview;
  });
}

export function setReportSection(project, recordId, section) {
  return changeProject(project, next => {
    const { record } = reportContext(next, recordId);
    if (section !== null) validateReportSection(section);
    record.reportSection = section === null ? null : structuredClone(section);
    return record;
  });
}

export function reviewReport(project, recordId) {
  return changeProject(project, next => {
    const { record } = reportContext(next, recordId), missing = reportMissingFields(next, recordId);
    if (missing.length) fail(`調書の入力が不足しています：${missing.join('、')}`);
    record.reportReview = { signature: reportSignature(next, recordId), reviewedAt: new Date().toISOString() };
    return record;
  });
}
