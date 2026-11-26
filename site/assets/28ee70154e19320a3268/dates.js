import {BOARD_TEMPLATES} from './boards.js';
/** Business dates are independent from board text and immutable import timestamps. */
export function hasBoardDate(board) { return Boolean(board&&BOARD_TEMPLATES[board.templateId]?.fields.some(field=>field.key==='date')); }
export function validWorkDate(value) {
  return typeof value === 'string' && (value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
}
export function validateDateMetadata(photo) {
  if (!validWorkDate(photo.workDate)) throw new Error('作業日は正しい年月日にするか、空欄にしてください。');
  if (photo.workDateStatus !== undefined && !['confirmed','unconfirmed'].includes(photo.workDateStatus)) throw new Error('作業日の確認状態が正しくありません。');
  if (photo.workDateStatus === 'confirmed' && !photo.workDate) throw new Error('確認済みにするには作業日を入力してください。');
  if (photo.captureSource !== undefined && !['camera','library','file','legacy'].includes(photo.captureSource)) throw new Error('写真の登録方法が正しくありません。');
  if (photo.capturedAt !== undefined && (typeof photo.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(photo.capturedAt) || !Number.isFinite(Date.parse(photo.capturedAt)))) throw new Error('撮影日時が正しくありません。');
}
export function validateRecordDates(record) {
  if (record.workDateDefault === undefined) return;
  const value=record.workDateDefault;
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!['value','confirmed'].includes(key)) || !validWorkDate(value.value) || typeof value.confirmed!=='boolean' || value.confirmed&&!value.value) throw new Error('次の写真の作業日設定が正しくありません。');
}
export function dateState(photo) { return photo.workDateStatus ?? 'legacy'; }
export function workDateLabel(photo) {
  const value=photo.workDate||'未入力';
  return `${value}${dateState(photo)==='confirmed'?'（利用者確認済み）':dateState(photo)==='legacy'?'（既存値・出所未記録）':'（未確認）'}`;
}
export function captureSourceLabel(photo) {
  return photo.captureSource==='camera'?'カメラ撮影として登録':photo.captureSource==='library'||photo.captureSource==='file'?'保存済み写真から取込':'登録方法は旧データに記録なし';
}
export function recordDateSignature(project,recordId) {
  const record=project.targets.flatMap(target=>target.records).find(item=>item.id===recordId);
  return (record?.slots||[]).filter(slot=>slot.status==='taken').map(slot=>{
    const photo=project.photos.find(item=>item.id===slot.activePhotoId);
    return [slot.name,photo?.id??null,photo?.workDate??'',photo?dateState(photo):'missing'];
  });
}
export function setNextWorkDate(project,recordId,{value='',confirmed=false}) {
  const record=project.targets.flatMap(target=>target.records).find(item=>item.id===recordId);
  if (!record) throw new Error('作業記録が見つかりません。');
  const candidate={workDateDefault:{value,confirmed}};validateRecordDates(candidate);
  record.workDateDefault=candidate.workDateDefault;
}
/** 工事全体の作業日。value＝作業日、confirmedOn＝利用者が確認した日の端末の日付（日が変わったら再確認する）。 */
export function validateProjectWorkDate(value) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['value', 'confirmedOn'].includes(key))
    || !value.value || !validWorkDate(value.value) || !value.confirmedOn || !validWorkDate(value.confirmedOn)) throw new Error('工事の作業日が正しくありません。');
}
export function setProjectWorkDate(project, value, today) {
  const candidate = { value: String(value || '').trim(), confirmedOn: today };
  if (!candidate.value) throw new Error('作業日を入力してください。');
  validateProjectWorkDate(candidate);
  project.workDate = candidate;
}
/** 作業日が未設定か、確認した日と今日の日付が違えば、撮影・取込の前に確認する。 */
export const needsWorkDateConfirm = (project, today) => project?.workDate?.confirmedOn !== today;
/** 撮影済み写真の作業日をまとめて変え、日付欄のある黒板の「撮影月日」にも同じ日付を入れる。 */
export function setPhotosWorkDate(project, photoIds, value) {
  if (!photoIds.length) throw new Error('作業日を変更する写真がありません。');
  if (!value || !validWorkDate(value)) throw new Error('作業日を年月日で入力してください。');
  for (const id of photoIds) {
    const photo = project.photos.find(item => item.id === id);
    if (!photo) throw new Error('写真が見つかりません。');
    setPhotoWorkDate(project, id, { value, confirmed: true, sync: hasBoardDate(photo.board) ? 'work-to-board' : 'none' });
  }
}
/** Only an explicitly selected sync operation may change the board date. */
export function setPhotoWorkDate(project,photoId,{value='',confirmed=false,sync='none'}={}) {
  const photo=project.photos.find(item=>item.id===photoId);
  if (!photo) throw new Error('写真が見つかりません。');
  if (!['none','board-to-work','work-to-board'].includes(sync)) throw new Error('日付の反映方法を選んでください。');
  const candidate=structuredClone(photo);
  if(sync==='board-to-work'){
    if(!hasBoardDate(candidate.board)||!candidate.board.values.date)throw new Error('この写真の黒板には日付がありません。');
    value=candidate.board.values.date;
  }
  candidate.workDate=value;candidate.workDateStatus=confirmed?'confirmed':'unconfirmed';
  validateDateMetadata(candidate);
  if(sync==='work-to-board'){
    if(!hasBoardDate(candidate.board))throw new Error('この黒板には日付欄がありません。');
    if(!value)throw new Error('黒板へ反映する作業日を入力してください。');
    candidate.board.values.date=value;
  }
  photo.workDate=candidate.workDate;photo.workDateStatus=candidate.workDateStatus;
  if(sync==='work-to-board')photo.board=candidate.board;
}
