import { validateProject, getContext, USE_CASES } from './model.js';
import { getReportContext, validateReportValue, validateReportSection, reportMissingFields, reportSignature, parseReportPaste, TS_STATION_NOTATIONS } from './report-data.js';
import {boardReportUpdates,linkedBoard,refreshRecordBoards,replacePhotoBoard} from './board-link.js';
import {automaticNote,isTrial} from './capture-board.js';

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
  changeProject(project, next => { next.name = nameValue(name, '工事名', 100, true);for(const target of next.targets)for(const record of target.records)refreshRecordBoards(next,record.id,{photos:true}); });
  return project;
}

export function renameGroup(project, id, name) {
  return changeProject(project, next => {
    const group = next.groups.find(item => item.id === id);
    if (!group) fail('グループが見つかりません。');
    const value = nameValue(name, 'グループ名', 300, true);
    if (next.groups.some(item => item.id !== id && item.kind === group.kind && keyName(item.name.trim()) === keyName(value))) fail('同じ種類に同名のグループがあります。');
    group.name = value;
    for(const target of next.targets.filter(target=>target.groupId===id))for(const record of target.records)refreshRecordBoards(next,record.id,{photos:true});
    return group;
  });
}

export function updateTarget(project, id, updates) {
  return changeProject(project, next => {
    if (!object(updates) || Object.keys(updates).some(key => !['name', 'groupId'].includes(key))) fail('変更できるのは管理名と所属グループです。用途は変えられません。');
    const target = next.targets.find(item => item.id === id);
    if (!target) fail('記録対象が見つかりません。');
    const name = own(updates, 'name') ? nameValue(updates.name, USE_CASES[target.useCase].nameLabel, 300) : target.name;
    const groupId = own(updates, 'groupId') ? updates.groupId : target.groupId;
    if (groupId !== null && !next.groups.some(item => item.id === groupId)) fail('移動先のグループが見つかりません。');
    if (next.targets.some(item => item.id !== id && item.groupId === groupId && keyName(item.name.trim()) === keyName(name.trim()))) fail('移動先のグループに同名の記録対象があります。');
    target.name = name; target.groupId = groupId;
    for(const record of target.records)refreshRecordBoards(next,record.id,{photos:true});
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
  if(targets.length!==ids.size)fail('削除する記録対象が見つかりません。');
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
  if (!object(destination) || typeof destination.recordId !== 'string' || typeof destination.slot !== 'string') fail('移動先の作業記録と撮影枠を選んでください。');
  const context = getContext(project, destination.recordId), slot = context.record.slots.find(item => item.name === destination.slot);
  if (!slot) fail('移動先の撮影枠が見つかりません。');
  const to = { ...context, slot }, same = photo.recordId === context.record.id && photo.slot === slot.name;
  const conflictPhoto = slot.activePhotoId && slot.activePhotoId !== photoId ? project.photos.find(item => item.id === slot.activePhotoId) : null;
  const requiresMmsConfirmation = Boolean(from && from.target.useCase !== 'MMS' && to.target.useCase === 'MMS');
  const sourceLosesAdoption = Boolean(!same && from?.slot.activePhotoId === photoId);
  const messages = [];
  if (same) messages.push('現在と同じ所属です。採用を変えるには採用操作を使ってください。');
  if (sourceLosesAdoption) messages.push('移動元は未撮影になります（履歴写真は自動で採用しません）。');
  if (conflictPhoto) messages.push('移動先に採用写真があります。採用を替えるか、履歴に追加するか選んでください。');
  if (requiresMmsConfirmation) messages.push('MMSでは黒板を合成しません。黒板の内容は残し、合成だけ解除します。');
  if (to.target.useCase !== 'MMS') messages.push('黒板の内容は変わりません。必要なら移動後に訂正してください。');
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
    if (!['adopt', 'history'].includes(destination.resolution)) fail('採用するか、履歴に追加するか選んでください。');
    if (effect.requiresMmsConfirmation && destination.disableBoardForMms !== true) fail('MMSへ移動するには、黒板の合成解除を確認してください。');
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
  return { photo, from, sourceLosesAdoption, remainingHistory, messages: [sourceLosesAdoption ? '採用写真を削除すると、この撮影枠は未撮影になります（履歴は自動で採用しません）。' : 'この写真だけを削除します。採用写真は変わりません。', '原本も削除されます。必要なら先に作業ZIPか原本を保存してください。'] };
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
  if (!USE_CASES[context.target.useCase].reportColumns.length) fail('MMSには調書がありません。');
  return context;
}

export function setReportField(project, recordId, key, value) {
  return changeProject(project, next => {
    const { target, record } = reportContext(next, recordId);
    if (!USE_CASES[target.useCase].reportColumns.some(column => column.key === key)) fail('この用途にない調書の項目です。');
    validateReportValue(value);
    record.reportFields = { ...(record.reportFields || {}), [key]: value };
    refreshRecordBoards(next,recordId,{photos:['station','remarks'].includes(key)});
    return record;
  });
}

/** TS出来形の測定者・規格値・社内規格値は路線内の全記録で共通なので、一度の入力でまとめて上書きする。 */
export const TS_COMMON_KEYS = Object.freeze(['surveyor', 'standard', 'internalStandard']);
function tsRouteRecords(project, groupId) {
  if (!project.groups.some(group => group.id === groupId)) fail('路線を選択してください。');
  const records = project.targets.filter(target => target.groupId === groupId && target.useCase === 'TS出来形(バリアフリー)').flatMap(target => target.records);
  if (!records.length) fail('この路線にTS出来形の記録がありません。');
  return records;
}
export function setTSCommonFields(project, groupId, values) {
  return changeProject(project, next => {
    const records = tsRouteRecords(next, groupId);
    for (const key of TS_COMMON_KEYS) validateReportValue(values[key]);
    for (const record of records) record.reportFields = { ...(record.reportFields || {}), ...Object.fromEntries(TS_COMMON_KEYS.map(key => [key, values[key]])) };
    return records.map(record => record.id);
  });
}
/** TS調書の測点の頭（SP等）を路線内の全記録へまとめて設定する。 */
export function setTSStationNotation(project, groupId, { notation, custom = '' }) {
  return changeProject(project, next => {
    const records = tsRouteRecords(next, groupId);
    if (!TS_STATION_NOTATIONS.includes(notation)) fail('測点の表記を選んでください。');
    const text = notation === '自由入力' ? String(custom).trim() : '';
    if (notation === '自由入力' && (!text || text.length > 30 || /[\u0000-\u001f\u007f]/.test(text))) fail('自由入力の測点の頭を30文字以内で入力してください。');
    for (const record of records) record.reportFields = { ...(record.reportFields || {}), stationNotation: notation, stationCustom: text };
    return records.map(record => record.id);
  });
}

export function describeReportPaste(project, { recordIds, keys, startRow = 0, startCol = 0, text } = {}) {
  validateProject(project);
  if (!Array.isArray(recordIds) || !recordIds.length || new Set(recordIds).size !== recordIds.length || !Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length || keys.some(key => typeof key !== 'string') || !Number.isSafeInteger(startRow) || !Number.isSafeInteger(startCol) || startRow < 0 || startCol < 0) fail('貼り付け先の表か開始セルが正しくありません。');
  const matrix = parseReportPaste(text), columns = matrix[0].length;
  if (startRow + matrix.length > recordIds.length || startCol + columns > keys.length) fail('貼り付ける範囲が表からはみ出しています。行・列を減らしてください。');
  const updates = [];
  for (let row = 0; row < matrix.length; row++) {
    const recordId = recordIds[startRow + row], { target } = reportContext(project, recordId);
    for (let col = 0; col < columns; col++) {
      const key = keys[startCol + col];
      if (!USE_CASES[target.useCase].reportColumns.some(column => column.key === key)) fail('貼り付け先に、この用途にない調書項目があります。');
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
    for(const id of new Set(preview.updates.map(update=>update.recordId)))refreshRecordBoards(next,id,{photos:true});
    return preview;
  });
}

function applyBoardPoint(project,target,board,previous){
  if(!['基準点','仮BM'].includes(target.useCase)||!['sample-2111','sample-2115','legacy-simple'].includes(board.templateId)||board.values.point===previous?.values.point||!board.values.point.trim())return;
  const name=nameValue(board.values.point,USE_CASES[target.useCase].nameLabel,300);
  if(project.targets.some(item=>item.id!==target.id&&item.groupId===target.groupId&&keyName(item.name)===keyName(name)))fail('同じ路線に同名の記録対象があります。');
  target.name=name;
  for(const record of target.records)refreshRecordBoards(project,record.id,{photos:true});
}

export function saveRecordBoard(project,recordId,board,{applyBoard=true,noteMode='manual'}={}){
  return changeProject(project,next=>{
    const {target,record}=getContext(next,recordId),updates=boardReportUpdates(target.useCase,board,record.boardDefaults);
    applyBoardPoint(next,target,board,record.boardDefaults);
    for(const [key,value] of Object.entries(updates))validateReportValue(value);
    record.reportFields={...record.reportFields,...updates};
    record.boardDefaults=linkedBoard(next,recordId,board);record.applyBoardDefault=applyBoard;record.boardNoteMode=noteMode;
    for(const slot of record.slots){
      const photo=next.photos.find(photo=>photo.id===slot.activePhotoId);if(!photo||(target.useCase==='TS出来形(バリアフリー)'&&slot.name==='スマホスクリーンショット'))continue;
      const values={...board.values,date:photo.board?.values.date??photo.workDate};
      if(isTrial(target.useCase)&&noteMode==='auto')values.note=automaticNote(target.useCase,record.category,slot.name);
      replacePhotoBoard(photo,linkedBoard(next,recordId,{...board,values}),applyBoard);
    }
    return record;
  });
}

export function savePhotoBoard(project,photoId,board,applyBoard){
  return changeProject(project,next=>{
    const photo=next.photos.find(photo=>photo.id===photoId);if(!photo)fail('写真が見つかりません。');
    const {target,record}=getContext(next,photo.recordId),updates=boardReportUpdates(target.useCase,board,photo.board);
    applyBoardPoint(next,target,board,photo.board);
    for(const [key,value] of Object.entries(updates))validateReportValue(value);
    record.reportFields={...record.reportFields,...updates};
    refreshRecordBoards(next,record.id,{photos:true});
    replacePhotoBoard(photo,linkedBoard(next,record.id,board),applyBoard);photo.boardNoteMode='manual';return photo;
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
