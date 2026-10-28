import { USE_CASES, getContext, getSlotState, validateProject } from './model.js';
import { OUTPUT_LIMITS } from './definitions.js';
import { reportMissingFields, reportReviewState, sectionLabel, getReportItemName, effectiveReportSection,tsRowHeight,tsReportCells,tsCellLines,visibleReportColumns } from './report-data.js';
import { workDateLabel } from './dates.js';
import { validateImage as defaultValidateImage, composePhoto as defaultComposePhoto, preparePhoto as defaultPreparePhoto } from './images.js';
import { escapeHTML } from './ui/components.js';
import { PRINT_LAYOUT_CSS } from './print/layout.js';
import { printPage, printToolbar } from './print/components.js';
import { yieldTask } from './task-yield.js';
import {planControlPointReports,isControlPointPhotoPage} from './print/control-point.js';
import {planBMReports,planTSReports,isTrialPhotoPage,isTSPhotoPage} from './print/measured-forms.js';
export { escapeHTML } from './ui/components.js';

export { OUTPUT_LIMITS } from './definitions.js';
const abortCheck = signal => { if (signal?.aborted) throw new DOMException('出力の作成を取り消しました。', 'AbortError'); };

// One physical page plan is used for preview, downloaded HTML and browser print.
const CONTENT_MM = 238;
const LINE_MM = 3.6;
const TABLE_HEADER_MM = 10;
const ROW_PADDING_MM = 6;
const PHOTO_ROWS_PER_PAGE = 3;
const PHOTO_CONTINUATION_LINES = 18;
const STATUS_LABELS = { taken: '撮影済み', unnecessary: '撮影不要', missing: '未撮影', retake: '要撮り直し' };


function outputError(code, message, issues = []) {
  const error = new Error(message);
  error.code = code;
  error.issues = issues;
  return error;
}

/** Conservative character cells plus explicit line breaks keep CJK and long words inside cells. */
export function wrapOutputText(value, width = 54) {
  const lines = [];
  for (const paragraph of String(value ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    let line = '', used = 0;
    for (const character of Array.from(paragraph)) {
      // Count even wide Latin letters as full cells: wrapping must not add unplanned lines.
      const size = 1;
      if (line && used + size > width) { lines.push(line); line = ''; used = 0; }
      line += character;
      used += size;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

function groupLabel(group) { return group ? `${group.kind}：${group.name}` : '工事直下'; }
function fieldValue(record, key) { return String(record.reportFields?.[key] ?? ''); }
function issueFor(context, code, message, extra = {}) {
  return { code, severity: 'unfinished', recordId: context.record.id, targetId: context.target.id,
    useCase: context.target.useCase, targetName: context.target.name, category: context.record.category, message, ...extra };
}

function selectRecords(project, recordIds) {
  const contexts = project.targets.flatMap(target => target.records.map(record => getContext(project, record.id)));
  if (recordIds === undefined) return contexts;
  if (!Array.isArray(recordIds) || recordIds.some(id => typeof id !== 'string')) throw outputError('invalid-selection', '出力する作業記録を選択してください。');
  const wanted = new Set(recordIds);
  if (contexts.filter(context => wanted.has(context.record.id)).length !== wanted.size) throw outputError('invalid-selection', '出力対象に存在しない作業記録が含まれています。');
  return contexts.filter(context => wanted.has(context.record.id));
}

function reportPages(records) {
  if(records[0]?.useCase==='基準点'){const pages=planControlPointReports(records);if(pages)return pages;}
  if(records[0]?.useCase==='仮BM'){const pages=planBMReports(records);if(pages)return pages;}
  if(records[0]?.useCase==='TS出来形(バリアフリー)'){
    const measured=planTSReports(records),pages=measured||[];
    if(!measured){
    const groups=new Map();for(const record of records){const fields=record.record.reportFields||{},key=JSON.stringify([record.groupId,fields.surveyor,fields.standard,fields.internalStandard]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(record);}
    for(const rows of groups.values()){
      let chunk=[],height=0,continued=false;
      const push=()=>{if(chunk.length)pages.push({kind:'report',referenceType:'ts',orientation:'landscape',title:'測定結果一覧表',useCase:rows[0].useCase,records:chunk,groupName:rows[0].groupName,continued,usedMm:160});chunk=[];height=0;continued=true;};
      for(const row of rows){
        const cells=tsReportCells(row).map(tsCellLines),length=Math.max(...cells.map(cell=>cell.length));
        for(let at=0;at<length;at+=24){const part={...row,tsCells:cells.map(cell=>cell.slice(at,at+24).join('\n'))},rowHeight=tsRowHeight(part);if(chunk.length&&(chunk.length===24||height+rowHeight>96))push();chunk.push(part);height+=rowHeight;}
      }push();
    }
    }
    const extra=records.filter(context=>Object.entries(context.record.reportFields||{}).some(([key,value])=>key==='remarks'?Boolean(value):['surveyor','standard','internalStandard'].includes(key)&&String(value).length>20));
    const lines=extra.flatMap(context=>recordDetail(context).flatMap(value=>wrapOutputText(value,53)));
    for(let at=0;at<lines.length;at+=60)pages.push({kind:'issues',useCase:records[0].useCase,title:'TS出来形調書・補足情報',lines:lines.slice(at,at+60),usedMm:Math.min(60,lines.length-at)*LINE_MM});
    return pages;
  }
  const groups = new Map();
  for (const context of records) {
    if (!USE_CASES[context.useCase].reportColumns.length) continue;
    const key = JSON.stringify([context.groupId, context.useCase, context.category, context.itemName, context.section]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(context);
  }
  const pages = [];
  for (const rows of groups.values()) {
    const first = rows[0], columns = visibleReportColumns(first.useCase);
    let page, groupPage = 0;
    const newPage = (repeatContext = false) => {
      page = { kind: 'report', title: `${first.useCase}調書（簡易様式）`, useCase: first.useCase,
        referenceType:['基準点','仮BM'].includes(first.useCase)&&[first.groupName,first.itemName,first.section].every(value=>String(value||'').length<80)&&rows.every(context=>context.targetName.length<=30&&Object.values(context.record.reportFields||{}).every(value=>String(value).length<=40&&!String(value).includes('\n')))?'survey':null,groupName:first.groupName,itemName:first.itemName,section:first.section,
        continued: groupPage++ > 0,
        columns: [{ key: 'name', label: first.useCase === '仮BM' ? '番号・点名' : ['基準点', '仮BM'].includes(first.useCase) ? '点名' : '管理名' }, ...columns], entries: [], usedMm: TABLE_HEADER_MM };
      if (repeatContext) {
        const lines = [`${wrapOutputText(first.groupLabel, 53)[0]}`, `${USE_CASES[first.useCase].categoryLabel}：${first.category}`, '（続き・分類と施工区間の全文はこの調書の冒頭に記載）'];
        page.entries.push({ kind: 'context', lines, continued: true });
        page.usedMm += lines.length * LINE_MM + ROW_PADDING_MM;
      }
      pages.push(page);
    };
    newPage();
    const contextLines = [`項目名：${first.itemName}`, first.groupLabel, `${USE_CASES[first.useCase].categoryLabel}：${first.category}`,
      ...(first.section ? [`施工区間：${first.section}`] : [])].flatMap(value => wrapOutputText(value, 53));
    // Context itself can be long; continue it before the first data row without hiding text.
    for (let offset = 0; offset < contextLines.length;) {
      let capacity = Math.floor((CONTENT_MM - page.usedMm - ROW_PADDING_MM) / LINE_MM);
      if (capacity < 1) { newPage(); capacity = Math.floor((CONTENT_MM - page.usedMm - ROW_PADDING_MM) / LINE_MM); }
      const lines = contextLines.slice(offset, offset + capacity);
      page.entries.push({ kind: 'context', lines, continued: offset > 0 });
      page.usedMm += lines.length * LINE_MM + ROW_PADDING_MM;
      offset += lines.length;
    }
    rows.forEach((context, index) => {
      if(page.referenceType==='survey'&&page.entries.filter(entry=>entry.kind==='row').length>=10)newPage(true);
      const reviewLabel = context.review === 'reviewed' ? '' : context.review === 'stale' ? '［変更後・再確認待ち］' : '［調書未確認］';
      const cells = [`${first.useCase === '仮BM' ? (page.referenceType==='survey'?`${index + 1}`:`${index+1}：${context.targetName}`) : context.targetName}${reviewLabel}`,
        ...columns.map(column => fieldValue(context.record, column.key) || '—（未入力）')]
        .map((value, cellIndex) => wrapOutputText(value, cellIndex === 0 ? 9 : 10));
      const totalLines = Math.max(...cells.map(lines => lines.length));
      let offset = 0;
      while (offset < totalLines) {
        let capacity = Math.floor((CONTENT_MM - page.usedMm - ROW_PADDING_MM) / LINE_MM);
        if (capacity < 1) { newPage(true); capacity = Math.floor((CONTENT_MM - page.usedMm - ROW_PADDING_MM) / LINE_MM); }
        const count = Math.min(capacity, totalLines - offset);
        const heightMm=Math.max(count*LINE_MM+ROW_PADDING_MM,page.referenceType==='survey'?18:0);
        if(page.usedMm+heightMm>CONTENT_MM&&page.entries.some(entry=>entry.kind==='row')){newPage(true);continue;}
        page.entries.push({ kind: 'row', recordId: context.recordId, targetId: context.targetId,heightMm,
          continued: offset > 0, lineOffset: offset, cells: cells.map(lines => lines.slice(offset, offset + count)), lineCount: count });
        page.usedMm += heightMm;
        offset += count;
      }
    });
  }
  return pages;
}

function recordDetail(context) {
  const definition = USE_CASES[context.useCase];
  const paragraphs = [`${definition.nameLabel}：${context.targetName}`, `${definition.categoryLabel}：${context.category}`, context.groupLabel];
  for (const column of visibleReportColumns(context.useCase)) paragraphs.push(`${column.label}：${fieldValue(context.record, column.key) || '—（未入力）'}`);
  if (context.section) paragraphs.push(`施工区間：${context.section}`);
  const dated = context.slots.filter(slot => slot.photo);
  const dates = [...new Set(dated.map(slot => workDateLabel(slot.photo)))];
  if (dates.length === 1) paragraphs.push(`作業日：${dates[0]}`);
  else for (const slot of dated) paragraphs.push(`${slot.name}の作業日：${workDateLabel(slot.photo)}`);
  for (const slot of context.slots) {
    if (slot.status === 'unnecessary') paragraphs.push(`${slot.name}は撮影不要：${slot.reason}`);
    else if (!slot.complete) paragraphs.push(`${slot.name}：${STATUS_LABELS[slot.status]}（未完了）`);
  }
  return paragraphs;
}

function photoPages(records) {
  const rows = [];
  let number = 0;
  for (const context of records) {
    const paired = ['基準点', '仮BM','TS出来形(バリアフリー)'].includes(context.useCase);
    const sets = paired ? [context.slots] : context.slots.map(slot => [slot]);
    for (const slots of sets) {
      const ordinal = ++number;
      const referencePhoto=['基準点','仮BM','現密','コア密','TS出来形(バリアフリー)'].includes(context.useCase)&&context.slots.every(slot=>String(slot.reason||'').length<=40)&&context.groupName.length<=60&&context.targetName.length<=30&&Object.values(context.record.reportFields||{}).every(value=>String(value).length<=40&&String(value).split('\n').length<=2);
      const detail = (referencePhoto?[]:recordDetail(context)).flatMap(value => wrapOutputText(value, 17));
      const firstLimit = paired ? 10 : 16;
      rows.push({ kind: 'photo-row', number: ordinal, recordId: context.recordId, targetName: context.targetName,
        useCase: context.useCase, paired, slots,referencePhoto, lines: detail.slice(0, firstLimit), hasContinuation: detail.length > firstLimit,fields:context.record.reportFields||{},groupId:context.groupId,groupName:context.groupName,category:context.category });
      const rest = detail.slice(firstLimit);
      for (let start = 0; start < rest.length; start += PHOTO_CONTINUATION_LINES) {
        rows.push({ kind: 'photo-continuation', number: ordinal, recordId: context.recordId,
          groupId:context.groupId,groupName:context.groupName,lines: rest.slice(start, start + PHOTO_CONTINUATION_LINES) });
      }
    }
  }
  const pages = [];
  const byRoute=new Map();for(const row of rows){if(!byRoute.has(row.groupId))byRoute.set(row.groupId,[]);byRoute.get(row.groupId).push(row);}
  for(const routeRows of byRoute.values())for (let index = 0; index < routeRows.length; index += PHOTO_ROWS_PER_PAGE) {
    const pageRows=routeRows.slice(index,index+PHOTO_ROWS_PER_PAGE),exact=isControlPointPhotoPage(pageRows,routeRows[0].groupName),trial=isTrialPhotoPage(pageRows,routeRows[0].groupName),ts=isTSPhotoPage(pageRows);
    pages.push({ kind: 'photo', title: `${records[0]?.useCase||''}写真帳`,referenceLayout:exact?'control-point':trial?'trial':ts?'ts-photo':undefined,groupName:routeRows[0].groupName, rows:pageRows, usedMm:exact?714.72*25.4/72:trial?752.64*25.4/72:ts?771*25.4/72:pageRows.length*77 });
  }
  return pages;
}

function issuePages(issues) {
  if (!issues.length) return [];
  const lines = issues.flatMap(issue => wrapOutputText(`${issue.targetName}／${issue.category}：${issue.message}`, 53));
  const pages = [];
  for (let index = 0; index < lines.length; index += 60) pages.push({ kind: 'issues', title: '出力前の確認事項（途中版）', lines: lines.slice(index, index + 60), usedMm: Math.min(60, lines.length - index) * LINE_MM });
  return pages;
}

/** Freeze selection and all metadata before asynchronous image work or UI callbacks. */
export function buildOutputModel(project, { recordIds, edition = 'draft' } = {}) {
  if (!['draft', 'final'].includes(edition)) throw outputError('invalid-edition', '途中版または完成版を選択してください。');
  const snapshot = structuredClone(project);
  try { validateProject(snapshot); } catch (error) { throw outputError('invalid-reference', `工事データの参照を確認してください：${error.message}`); }
  const contexts = selectRecords(snapshot, recordIds ? [...recordIds] : recordIds);
  if (!contexts.length) throw outputError('empty-selection', '出力する作業記録を1件以上選択してください。');
  const issues = [];
  const records = contexts.map(context => {
    const { target, record, group } = context;
    const slots = USE_CASES[target.useCase].slots.map(name => {
      const slot = getSlotState(snapshot, record.id, name);
      if (!slot.complete) issues.push(issueFor(context, slot.status === 'retake' ? 'photo-retake' : 'photo-missing', `${name}が${STATUS_LABELS[slot.status]}です。`, { slotName: name }));
      // Only the explicit current adoption is carried into the output plan.
      return { name, status: slot.status, reason: slot.reason, complete: slot.complete,
        photo: slot.status === 'taken' ? slot.photo : null };
    });
    const missingFields = reportMissingFields(snapshot, record.id), review = reportReviewState(snapshot, record.id);
    if (missingFields.length) issues.push(issueFor(context, 'report-incomplete', `調書の入力が残っています：${missingFields.join('、')}`, { fields: missingFields }));
    if (review !== 'reviewed') issues.push(issueFor(context, review === 'stale' ? 'report-stale' : 'report-unreviewed', review === 'stale' ? '調書を変更した後の再確認が必要です。' : '調書の内容確認が必要です。'));
    return { projectName:snapshot.name,recordId: record.id, targetId: target.id, targetName: target.name, useCase: target.useCase,
      category: record.category, groupId: target.groupId, groupLabel: groupLabel(group), record,
      sectionData:effectiveReportSection(snapshot,record.id),section: sectionLabel(effectiveReportSection(snapshot,record.id)), itemName: getReportItemName(snapshot, record.id), review, slots, groupName:group?.name||'路線未設定' };
  });
  if (edition === 'final' && issues.length) throw outputError('unfinished-output', `完成版には未完了の項目が${issues.length}件あります。内容を確認する場合は途中版を選択してください。`, issues);
  const pages=[];
  for(const useCase of Object.keys(USE_CASES)){
    const chosen=records.filter(record=>record.useCase===useCase);
    if(!chosen.length)continue;
    pages.push(...reportPages(chosen),...issuePages(issues.filter(issue=>issue.useCase===useCase)),...photoPages(chosen));
  }
  return { edition, projectId: snapshot.id, projectName: snapshot.name, project: snapshot,
    recordIds: records.map(record => record.recordId), records, issues, pages,
    selectedPhotoIds: [...new Set(records.flatMap(record => record.slots.map(slot => slot.photo?.id).filter(Boolean)))],
    pageCount: pages.length };
}

function progress(callback, phase, completed, total) { if (callback) callback({ phase, completed, current: completed, total }); }
async function blobDataURL(blob, signal) {
  abortCheck(signal);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  abortCheck(signal);
  let binary = '';
  for (let at = 0; at < bytes.length; at += 32768) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
    if (at && at % (1024 * 1024) === 0) { await yieldTask(); abortCheck(signal); }
  }
  abortCheck(signal);
  const url = `data:${blob.type};base64,${btoa(binary)}`;
  abortCheck(signal);
  return url;
}


/** Check every original's cheap metadata; read/decode only the chosen adopted photos. */
export async function buildOutputHTML(project, originals, { recordIds, edition = 'draft', format = 'html', onProgress,
  validateImage = defaultValidateImage, composePhoto = defaultComposePhoto, preparePhoto = defaultPreparePhoto, signal } = {}) {
  abortCheck(signal);
  if (!['html', 'blob'].includes(format)) throw outputError('invalid-format', '出力形式を確認してください。');
  const model = buildOutputModel(project, { recordIds, edition });
  if (!(originals instanceof Map)) throw outputError('missing-original', '元写真の一覧が見つかりません。作業ZIPを読み直してください。');
  if (originals.size !== model.project.photos.length) throw outputError('missing-original', '工事情報と元写真の件数が一致しません。');
  if (model.selectedPhotoIds.length > OUTPUT_LIMITS.embeddedPhotos) throw outputError('output-limit', `1回の出力に掲載する採用写真が${OUTPUT_LIMITS.embeddedPhotos}枚を超えています。原本を削除・圧縮せず、分類・用途・記録を選んで出力範囲を分けてください。`);
  // Blob references are immutable and cheap. Snapshot only the selected references before callbacks;
  // history and other scopes still undergo existence/size/type checks without reading their bytes.
  const selectedIds = new Set(model.selectedPhotoIds), sourceOriginals = new Map();
  for (const photo of model.project.photos) {
    const blob = originals.get(photo.id);
    if (!(blob instanceof Blob) || blob.size !== photo.size || blob.type !== photo.type) throw outputError('missing-original', `元写真の容量・形式が一致しません：${photo.originalName}`);
    if (selectedIds.has(photo.id)) sourceOriginals.set(photo.id, blob);
  }
  const usePrepared = validateImage === defaultValidateImage && composePhoto === defaultComposePhoto;
  const editionLabel = model.edition === 'draft' ? `途中版 · 未完了 ${model.issues.length}件` : '完成版';
  const projectNameLines = wrapOutputText(model.projectName, 53);
  const parts = [], append = markup => parts.push(format === 'blob' ? new Blob([markup], { type: 'text/html' }) : markup);
  append(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(model.projectName)} 調書・写真帳 ${escapeHTML(editionLabel)}</title><style>${PRINT_LAYOUT_CSS}</style></head><body>${printToolbar(editionLabel)}`);
  let embeddedBytes = 0, completed = 0;
  const imageURL = async photo => {
    const original = sourceOriginals.get(photo.id);
    const mms = getContext(model.project, photo.recordId).target.useCase === 'MMS';
    let dimensions, blob;
    abortCheck(signal);
    try {
      if (usePrepared) {
        dimensions = await preparePhoto(original, mms ? { ...photo, applyBoard: false } : photo, { signal });
        blob = dimensions.blob;
        if (mms && blob !== original) throw new Error('MMSの原本が変更されています。');
      } else dimensions = await validateImage(original, { signal });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw outputError('invalid-image', `元写真を表示できません：${photo.originalName}（${error.message}）`);
    }
    abortCheck(signal);
    if (dimensions.width !== photo.width || dimensions.height !== photo.height) throw outputError('invalid-image', `元写真の寸法が一致しません：${photo.originalName}`);
    progress(onProgress, 'validate', completed + 1, model.selectedPhotoIds.length);
    abortCheck(signal);
    if (!usePrepared) {
      try { blob = mms ? original : await composePhoto(original, photo, { signal }); }
      catch (error) {
        if (error.name === 'AbortError') throw error;
        throw outputError('image-composition', `出力写真を作成できません：${photo.originalName}（${error.message}）`);
      }
    }
    abortCheck(signal);
    if (!(blob instanceof Blob) || !blob.size || !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw outputError('image-composition', `出力写真が不正です：${photo.originalName}`);
    embeddedBytes += blob.size;
    if (embeddedBytes > OUTPUT_LIMITS.embeddedBytes) throw outputError('output-limit', `1回の出力に埋め込む写真が合計${(embeddedBytes / 1024 / 1024).toFixed(1)}MiBとなり、出力上限${OUTPUT_LIMITS.embeddedBytes / 1024 / 1024}MiBを超えました。原本を削除・圧縮せず、分類・用途・記録を選んで出力範囲を分けてください。`);
    const url = await blobDataURL(blob, signal);
    abortCheck(signal);
    sourceOriginals.delete(photo.id);
    progress(onProgress, 'compose', ++completed, model.selectedPhotoIds.length);
    abortCheck(signal);
    return url;
  };
  for (const [index, page] of model.pages.entries()) {
    // Each image belongs to one photo row. Do not retain a second full set of composed Blobs
    // or data URLs while later pages are being prepared.
    const imageURLs = new Map();
    for (const row of page.kind === 'photo' ? page.rows : []) {
      if (row.kind !== 'photo-row') continue;
      for (const slot of row.slots) if (slot.photo) imageURLs.set(slot.photo.id, await imageURL(slot.photo));
    }
    abortCheck(signal);
    append(printPage(page, { number: index + 1, total: model.pages.length, edition: model.edition,
      projectNameLines, editionLabel, imageURLs, statusLabels: STATUS_LABELS }));
    imageURLs.clear();
  }
  append(`<script>(()=>{const ready=async()=>{for(const image of document.images){await (image.decode?image.decode():new Promise((resolve,reject)=>{if(image.complete){image.naturalWidth?resolve():reject(new Error('画像を表示できません'));return}image.onload=resolve;image.onerror=reject}))}if(document.fonts)await document.fonts.ready;document.documentElement.dataset.outputReady='true';const button=document.getElementById('output-print');button.addEventListener('click',()=>window.print());button.disabled=false;button.textContent='印刷 / PDFに保存';return true};window.outputReady=ready().catch(error=>{document.getElementById('output-print').textContent='画像を表示できません。作成元で確認してください';document.documentElement.dataset.outputError='true';throw error});})();</script></body></html>`);
  const output = format === 'blob' ? { blob: new Blob(parts, { type: 'text/html' }) } : { html: parts.join('') };
  progress(onProgress, 'ready', model.pages.length, model.pages.length);
  abortCheck(signal);
  return { ...output, model, issues: model.issues };
}
