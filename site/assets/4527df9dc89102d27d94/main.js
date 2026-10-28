import { USE_CASES, LIMITS, createProject, addGroup, addTargets, addRecord, getContext, getSlotState, addPhoto, setSlotStatus, setActivePhoto, summarize, validateProject, upgradeProject } from './model.js';
import {formatBytes,formatByteLimit} from './limits.js';
import {thumbnailIsVisible} from './ui/visibility.js';
import { validateImage, createThumbnail, drawBoard, composePhoto } from './images.js';
import { BOARD_TEMPLATES, BOARD_FIELD_KEYS, createBoard, boardAspectRatio } from './boards.js';
import { loadBoardImages } from './board-assets.js';
import { materialChoices } from './materials.js';
import {exportPhotos} from './photo-export.js';
import {readTSScreenshot} from './ts-screenshot.js';
import {applyTSScreenshot} from './ts-screenshot-data.js';
import {setRouteSection,describeTargetDeletion,deleteTargets} from './workflow.js';
import {relinkBoardDrafts} from './board-link.js';
import { openStorage } from './storage.js';
import { exportWorkPackage, importWorkPackage, PACKAGE_LIMITS } from './package.js';
import {renameProject,renameGroup,updateTarget,saveRecordBoard,savePhotoBoard,describePhotoMove,movePhoto,describePhotoDelete,deletePhoto,setReportField,describeReportPaste,applyReportPaste,setReportSection,reviewReport} from './workflow.js';
import {reportReviewState,reportMissingFields,constructionSection,sectionLabel,STATION_NOTATIONS,getReportItemName,getReportItemNames,updateReportItemNames,visibleReportColumns} from './report-data.js';
import {isTrial,recordNoteMode,resolveCaptureBoard} from './capture-board.js';
import {renderReportView,renderOutputView,scopedRecords} from './ui-pc.js';
import {buildOutputHTML,buildOutputModel} from './reports.js';
import {dateState,workDateLabel,hasBoardDate,captureSourceLabel,setPhotoWorkDate,setNextWorkDate} from './dates.js';
import {createOfflineManager} from './offline.js';
import {createOrganizeState,filterPhotos,renderOrganizeView} from './ui-organize.js';
import {createPreviewViewer} from './preview.js';
import {createSession,sanitizeSession} from './session-state.js';
import {createSessionSaver} from './session-save.js';
import {detailHero,detailSection,renderDateDetails,photoTimeline,photoPagination} from './ui/photo-detail.js';
import {renderTargetPicker,renderTargetTabs,renderPhotoSlot,renderBoardPanel,renderHistoryPanel,renderCaptureProgress,renderBoardChoices,renderTargetNavigation,renderTSReading} from './ui/field-view.js';
import {renderProjectHeader,renderCapacity,renderNextDate,renderInitialView,renderProjectSetupFields,renderHandoff} from './ui/project-view.js';
import {mountAppShell} from './ui/shell.js';
import {createNotifications} from './ui/notifications.js';
import {createFloatingDisclosures} from './ui/floating.js';
import {createViewPosition} from './ui/view-position.js';
import {escapeHTML,button,textField,textareaField,selectField,checkbox,disclosure,panelHeading,badge,actions,photoMeta,metaList,tabButton,tabBar,emptyState,inlineName,optionItems} from './ui/components.js';

mountAppShell();

const $ = id => document.getElementById(id);
const feedback=createNotifications();
const floating=createFloatingDisclosures();
const viewPosition=createViewPosition({root:$('app')});
let navigationObserver=null;
let renderedViewKey='';
const viewKey=()=>[project?.id||'',mode,activeGroupId,activeTargetId,activeRecordId,reportUseCase].join(':');
const esc = escapeHTML;
const clone = value => structuredClone(value);
const dateToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const bytesLabel = n => formatBytes(n);
const timestampLabel = value => value ? new Date(value).toLocaleString('ja-JP',{timeZoneName:'short'}) : '未取得';
const options = (values, selected) => values.map(value => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('');
const statuses = { missing: '未撮影', taken: '撮影済み', retake: '要撮り直し', unnecessary: '撮影不要' };
let project = null;
// No project exists yet: keep the setup input in this page until explicit creation succeeds.
let initialProjectName = '';
let initialRouteName = '';
const selectedTargetIds = new Set();
let originals = new Map();
let storage = null;
let storageError = '';
let activeGroupId = '__all__';
let activeTargetId = '';
let activeRecordId = '';
let mode = 'field';
let useCaseFilter = '';
let busy = true;
let dirty = false;
let bundleId = null;
let lastExportAt = null;
let pendingCapture = null;
// A failed photo remains an immutable File in this page until retry or explicit discard.
let pendingPhoto = null;
let activeOperation = null;
let offlineManager = null;
let modalSubmit = null;
let renderToken = 0;
let modalRevision = 0;
let pendingPaste = null;
let activeCaptureSlot = '';
let onlyMissing = false;
let reportUseCase = '基準点';
const reportDrafts = new Map();
const outputState = {groupId:'__all__',useCase:'',selectedIds:new Set(),edition:'draft',prepared:null,ready:false,approved:false,initialized:false};
const thumbnails = new Map();
const thumbnailURLs = new Map();
const boardDrafts = new Map();
let organizeState = createOrganizeState();
const nameDrafts = new Map();
const disclosureState = new Map();
let drawerPhotoId = '';
let drawerReturnId = '';
let drawerImageURL = null;
let drawerImagePhotoId = '';
let previewViewer = null;
let restoringSession = true;
let modalEdited = false;
let editorReturnTarget=null;
let intentionalReload = false;
let resumeSaveState = {state:'idle',error:null};
const sessionSaver=createSessionSaver({
  read:()=>project&&storage&&!busy&&!restoringSession?{projectId:project.id,session:sessionSnapshot(project)}:null,
  write:({projectId,session})=>storage.saveSession(projectId,session),
  onStatus:value=>{if(value.state==='pending'&&resumeSaveState.state==='failed')return;resumeSaveState=value;renderResumeStatus();},
});

function draftCounts(){return nameDrafts.size+boardDrafts.size+reportDrafts.size+(pendingPaste?1:0);}
function renderResumeStatus(){
  const text=!storage?'画面・下書きの一時保存を利用できません。':resumeSaveState.state==='failed'?`画面・下書きを一時保存できませんでした：${resumeSaveState.error?.message||'保存に失敗しました。'} 入力はこの画面に保持しています。`:resumeSaveState.state==='pending'?'画面・下書きを一時保存中…':resumeSaveState.state==='idle'?'画面・下書きの一時保存を準備しています…':`画面・下書きを端末内に一時保存済み${draftCounts()?` ／ 編集中の下書き ${draftCounts()}件（未確定）`:''}`;
  feedback.setSessionStatus({visible:Boolean(project),state:resumeSaveState.state,text});
}
function scheduleSessionSave(){
  if(!project||!storage||busy||restoringSession)return;
  sessionSaver.schedule();
}
function sessionSnapshot(next=project,{fresh=false,zipDirty=dirty,clearNames=[],clearReports=false,clearReportKeys=[],clearBoards=false,clearBoardIds=[],clearPaste=false}={}){
  if(fresh)return createSession(next);
  const targets=new Map(next.targets.map(t=>[t.id,t])),records=new Map(next.targets.flatMap(t=>t.records.map(r=>[r.id,r])));
  const names=[...nameDrafts].filter(([id])=>targets.has(id)&&!clearNames.includes(id));
  const reports=clearReports?[]:[...reportDrafts].filter(([key])=>records.has(key.slice(0,key.indexOf(':')))&&!clearReportKeys.includes(key));
  const boards=relinkBoardDrafts(project,next,clearBoards?[]:[...boardDrafts].filter(([id])=>records.has(id)&&!clearBoardIds.includes(id)));
  const raw={view:{mode,activeGroupId,activeTargetId,activeRecordId,useCaseFilter,onlyMissing,reportUseCase,activeCaptureSlot,
    organize:organizeState,disclosures:[...disclosureState],drawerPhotoId:next.photos.some(p=>p.id===drawerPhotoId)?drawerPhotoId:'',
    scroll:{x:window.scrollX,y:window.scrollY,target:$('targetPicker')?.scrollTop||0,targetList:document.querySelector('#targetPicker .target-list')?.scrollTop||0,drawer:$('photoDrawerBody')?.scrollTop||0},
    output:{groupId:outputState.groupId,useCase:outputState.useCase,edition:outputState.edition,selectedIds:[...outputState.selectedIds],initialized:outputState.initialized},zipDirty,lastExportAt:lastExportAt?.toISOString()||null},
    drafts:{names,reports,boards,pendingPaste:clearPaste?null:pendingPaste}};
  const result=sanitizeSession(next,raw);
  if(result.issues.some(value=>value.startsWith('下書き:')))throw new Error(result.issues.join(' '));
  return {view:result.view,drafts:result.drafts};
}
function restoreSession(raw){
  const clean=sanitizeSession(project,raw),v=clean.view,d=clean.drafts;
  mode=v.mode;activeGroupId=v.activeGroupId;activeTargetId=v.activeTargetId;activeRecordId=v.activeRecordId;
  useCaseFilter=v.useCaseFilter;onlyMissing=v.onlyMissing;reportUseCase=v.reportUseCase;activeCaptureSlot=v.activeCaptureSlot;
  organizeState={...createOrganizeState(),...v.organize,selectedIds:new Set()};
  disclosureState.clear();for(const [key,value] of v.disclosures)disclosureState.set(key,value);
  nameDrafts.clear();for(const entry of d.names)nameDrafts.set(...entry);
  reportDrafts.clear();for(const entry of d.reports)reportDrafts.set(...entry);
  boardDrafts.clear();for(const entry of d.boards)boardDrafts.set(...entry);
  pendingPaste=d.pendingPaste;dirty=v.zipDirty||draftCounts()>0;lastExportAt=v.lastExportAt?new Date(v.lastExportAt):null;
  Object.assign(outputState,v.output,{selectedIds:new Set(v.output.selectedIds),prepared:null,ready:false,approved:false});
  return {view:v,issues:clean.issues};
}

function requireSavedNames() {
  if(nameDrafts.size) throw new Error('管理名の編集中の値があります。保存または取消をしてから続けてください。');
}
function requireResolvedPaste(){
  if(pendingPaste)throw new Error('未確定の貼り付け内容があります。調書で貼り付けを反映するか、下書きを取り消してから続けてください。');
}

function notify(message, error = false) {
  feedback.notify(message,{tone:error?'error':'success'});
}

function showProgress(message) {
  const labels = { export: 'ZIPを作成中', import: 'ZIPを読み込み中', validate: '元写真を検証中' };
  const text = typeof message === 'string' ? message : `${labels[message.phase] || '処理中'}：${message.completed} / ${message.total}${message.totalBytes ? `（${bytesLabel(message.bytes)} / ${bytesLabel(message.totalBytes)}）` : ''}`;
  feedback.showProgress(text);
}

function updateDisabled() {
  document.querySelectorAll('button,input,select,textarea').forEach(control => { control.disabled = control.matches('[data-notification-dismiss]') ? false : busy || control.dataset.unavailable === 'true'; });
  $('exportPackage').disabled = busy || !project;
  $('cancelOperation').disabled=!activeOperation;
  $('cancelOperation').hidden=!activeOperation;
}

async function run(task) {
  if (busy) return false;
  busy = true;
  ++renderToken; // Stop the previous view's thumbnail walk before foreground work.
  updateDisabled();
  try { await task(); return true; }
  catch (error) {
    if(error.name!=='AbortError')console.error(error);
    notify(error.name==='AbortError'?'処理を取り消しました。現在の作業は保持しています。':error.message || '処理に失敗しました。現在の作業は保持されています。', true);
    if ($('editorDialog').open) { $('dialogError').textContent = error.message; $('dialogError').hidden = false; }
    return false;
  } finally {
    busy = false;
    feedback.clearProgress();
    render();
  }
}

async function cancellable(task) {
  if(activeOperation)return task(activeOperation.signal);
  const controller=new AbortController();activeOperation=controller;updateDisabled();
  try{return await task(controller.signal);}finally{if(activeOperation===controller)activeOperation=null;updateDisabled();}
}

function revokeThumbnails() {
  for (const url of thumbnailURLs.values()) URL.revokeObjectURL(url);
  thumbnailURLs.clear(); thumbnails.clear();
}

function validateSnapshot(next) {
  validateProject(next);
  const metadataSize = new TextEncoder().encode(JSON.stringify({ ...next, bundleId: '00000000-0000-0000-0000-000000000000', exportedAt: new Date().toISOString() })).length;
  if (metadataSize > PACKAGE_LIMITS.metadataBytes) throw new Error('工事情報が作業ZIPの上限2MiBを超えます。変更は保存していません。');
}

async function persist(next, files, replace = false, nextBundleId = null, sessionOptions = {}) {
  validateSnapshot(next);
  if (storage) {
    await cancellable(async signal=>{
      await sessionSaver.pause();
      const session=sessionSnapshot(next,{...sessionOptions,fresh:replace,zipDirty:true});
      showProgress('この端末へ一時保存しています…');
      if (replace) await storage.replace(next, files, nextBundleId, session,{signal});
      else await storage.save(next, files, session,{signal});
      sessionSaver.reset();
    });
  }
}

async function mutate(change, message, sessionOptions={}) {
  const next = clone(project);
  const result = change(next);
  next.updatedAt = new Date().toISOString();
  const drafts=relinkBoardDrafts(project,next,[...boardDrafts]);
  await persist(next, originals, false, null, sessionOptions);
  boardDrafts.clear();for(const entry of drafts)boardDrafts.set(...entry);
  project = next; dirty = true; invalidateOutput();
  if (message) notify(message);
  return result;
}

async function replaceWork(next, files, nextBundleId = null) {
  requireSavedNames();
  if(pendingPhoto)throw new Error('未保存の写真があります。再試行または写真取込の取消をしてから工事を切り替えてください。');
  await persist(next, files, true, nextBundleId);
  revokeThumbnails();
  boardDrafts.clear();selectedTargetIds.clear();initialRouteName='';
  reportDrafts.clear();pendingPaste=null; activeCaptureSlot = ''; onlyMissing = false;
  outputState.initialized = false; invalidateOutput();
  project = next; originals = files; bundleId = nextBundleId;initialProjectName='';
  dirty = !nextBundleId; lastExportAt = null;
  activeGroupId = '__all__';
  activeTargetId = ''; activeRecordId = ''; useCaseFilter = '';
  organizeState=createOrganizeState();disclosureState.clear();closePhotoDrawer();
}

function selection() {
  const visible = (project?.targets || []).filter(target =>
    (activeGroupId === '__all__' || target.groupId === (activeGroupId || null)) &&
    (!useCaseFilter || target.useCase === useCaseFilter) && (!onlyMissing || target.records.some(r=>r.slots.some(s=>!getSlotState(project,r.id,s.name).complete))));
  const target = visible.find(item => item.id === activeTargetId) || visible[0];
  activeTargetId = target?.id || '';
  const record = target?.records.find(item => item.id === activeRecordId) || target?.records[0];
  activeRecordId = record?.id || '';
  if(record && !record.slots.some(slot=>slot.name===activeCaptureSlot)) activeCaptureSlot=record.slots[0].name;
  const group = target?.groupId ? project.groups.find(item => item.id === target.groupId) : null;
  return { group, target, record, visible };
}

function groupOptions(selected = '', includeAll = false) {
  return `${includeAll ? `<option value="__all__" ${selected === '__all__' ? 'selected' : ''}>すべての記録対象</option>` : ''}<option value="" ${!selected ? 'selected' : ''} disabled>路線を選択してください</option>${project.groups.map(group => `<option value="${group.id}" ${group.id === selected ? 'selected' : ''}>${esc(group.kind)}：${esc(group.name)}</option>`).join('')}`;
}

function navigateTarget(targetId,direction){
  const next=selection().visible.find(target=>target.id===targetId);if(!next)return;
  activeTargetId=next.id;activeRecordId='';activeCaptureSlot='';render();
  document.querySelector(`[data-target-direction="${direction}"]:not(:disabled)`)?.focus({preventScroll:true});
}

function locationLabel(group) { return group ? `${group.kind}：${group.name}` : '工事直下（グループなし）'; }

function capacityPanel() {
  const bytes=project.photos.reduce((total,photo)=>total+photo.size,0),counts=summarize(project);
  return renderCapacity({count:project.photos.length,maxCount:LIMITS.photos,adopted:counts.taken,bytes,limitBytes:LIMITS.totalBytes,reached:bytes>=LIMITS.totalBytes||project.photos.length>=LIMITS.photos,near:bytes>LIMITS.totalBytes*.8||project.photos.length>LIMITS.photos*.8});
}
function nextDatePanel(record) {
  const value=record.workDateDefault;
  return renderNextDate({recordId:record.id,dateLabel:value?.value?value.value+'（任意指定）':dateToday()+'（自動・任意）'});
}

function photoDateDetails(photo){
  const source=project.baseImports?.find(item=>item.id===photo.sourceImportId);
  const entries=[['作業日',workDateLabel(photo)],['登録経路',captureSourceLabel(photo)],['取込日時',timestampLabel(photo.importedAt)+(photo.workDateStatus===undefined&&!photo.sourceImportId?'（旧データ値・出所未確認）':'')],['実際の撮影日時',timestampLabel(photo.capturedAt)]];
  if(hasBoardDate(photo.board))entries.push(['黒板日付',(photo.board.values.date||'空欄')+(photo.workDate!==photo.board.values.date?'（作業日と異なります）':'')]);
  return renderDateDetails({entries,sourceEntries:source?[['工事',source.sourceJob.name],['路線',source.sourceJob.route||'なし'],['旧写真ID',photo.sourceId],['旧登録日時',timestampLabel(photo.sourceRegisteredAt)+'（撮影日時とは断定しません）']]:null});
}

function visiblePhotos() {
  const targets=new Set(project.targets.filter(target=>(activeGroupId==='__all__'||target.groupId===(activeGroupId||null))&&(!useCaseFilter||target.useCase===useCaseFilter)&&(!onlyMissing||target.records.some(record=>record.slots.some(slot=>!getSlotState(project,record.id,slot.name).complete)))).map(target=>target.id));
  return project.photos.filter(photo=>targets.has(photo.targetId));
}
function reviewDatesDialog(ids = null) {
  const photos=ids?project.photos.filter(photo=>ids.includes(photo.id)):visiblePhotos();
  if(!photos.length)throw new Error('この表示範囲に写真がありません。');
  openDialog(ids?'選択した写真の作業日を確認':'表示範囲の作業日を確認',`<p class="hint">${photos.length}枚。値を変更せず、利用者が業務上の日付として確認します。誤った値・空欄は、写真ごとの訂正から先に直してください。</p><div class="paste-preview"><table><tr><th>写真・所属</th><th>現在の作業日</th></tr>${photos.map(photo=>`<tr><td>${esc(photo.originalName)}<br>${esc(photo.recordId?contextText({...getContext(project,photo.recordId),slot:{name:photo.slot}}):'分類待ち')}</td><td>${esc(workDateLabel(photo))}</td></tr>`).join('')}</table></div>${checkbox('一覧の各日付を業務上の作業日として確認しました',{name:'confirmed',required:true})}`,async()=>{
    if(photos.some(photo=>!photo.workDate))throw new Error('空欄の作業日があります。写真ごとに入力してから確認してください。');
    await mutate(next=>photos.forEach(photo=>setPhotoWorkDate(next,photo.id,{value:photo.workDate,confirmed:true})),'表示範囲の作業日を利用者確認済みにしました。必要な調書を再確認してください。');
  },'一覧の日付を確認済みにする');
}

function field(label,name,value='',{type='text',max=300,required=true,multiline=false,attrs={}}={}){
  return (multiline?textareaField:textField)(label,{name,value,type,max,required,attrs});
}

function boardFields(board, applyBoard = true, choices = true, {omitPoint=false,fixedTS=false}={}) {
  const template = BOARD_TEMPLATES[board.templateId];
  const fields=template.fields.filter(item=>!omitPoint||item.key!=='point');
  const visibleKeys = new Set(fields.map(item => item.key));
  return `${choices?renderBoardChoices(board.templateId):''}${selectField('黒板の形式',optionItems(Object.values(BOARD_TEMPLATES).filter(item=>item.id!=='legacy-simple'||board.templateId===item.id).map(item=>[item.id,item.name]),board.templateId),{name:'templateId'})}${fields.map(item => field(item.label, `board-${item.key}`, board.values[item.key], {type:item.type || 'text',max:1000,required:applyBoard && !item.optional,multiline:!!item.large,attrs:{readonly:(['job','route'].includes(item.key))||fixedTS&&['workType','remarks'].includes(item.key)}})).join('')}${BOARD_FIELD_KEYS.filter(key => !visibleKeys.has(key)).map(key => `<input type="hidden" name="board-${key}" value="${esc(omitPoint&&key==='point'?'':board.values[key])}">`).join('')}${board.legacyColor?`<input type="hidden" name="legacyColor" value="${esc(board.legacyColor)}">`:''}`;
}

function readBoard(form) {
  const values = Object.fromEntries(BOARD_FIELD_KEYS.map(key => [key, String(form.elements.namedItem(`board-${key}`)?.value || '').trim()]));
  const templateId=form.elements.templateId.value;
  return createBoard(templateId, values, templateId==='legacy-simple' && form.elements.legacyColor ? {legacyColor:form.elements.legacyColor.value}:{});
}

function boardFits(board,{skipPoint=false}={}) {
  const template = BOARD_TEMPLATES[board.templateId];
  for (const item of template.fields) if (!item.optional && !(skipPoint&&item.key==='point') && !board.values[item.key].trim()) throw new Error(`黒板の${item.label}を入力してください。`);
  const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = Math.round(600 / boardAspectRatio(board));
  const result = drawBoard(canvas.getContext('2d'), 0, 0, canvas.width, canvas.height, board);
  if (result?.overflow) throw new Error(`黒板の文字が収まりません：${result.overflowFields.map(key => template.fields.find(item => item.key === key)?.label || key).join('、')}。短くしてから保存してください。`);
}

function boardDescription(board) {
  if (!board) return '黒板なし';
  const template = BOARD_TEMPLATES[board.templateId];
  return `${template.name}\n${template.fields.map(item => `${item.label}：${board.values[item.key]}`).join('\n')}`;
}

function boardDraft(record) {
  const {target}=getContext(project,record.id);
  const draft=boardDrafts.get(record.id)||{board:record.boardDefaults,applyBoard:record.applyBoardDefault!==false,noteMode:recordNoteMode(target,record)};
  return {...draft,...resolveCaptureBoard(project,record.id,activeCaptureSlot||record.slots[0].name,draft)};
}

async function flushBoardDrafts(persistLocally = true) {
  if (!boardDrafts.size) return;
  const next = clone(project);
  for (const [recordId, draft] of boardDrafts) {
    if (draft.applyBoard) boardFits(draft.board,{skipPoint:isTrial(getContext(project,recordId).target.useCase)});
    const { record } = getContext(next, recordId);
    saveRecordBoard(next,recordId,clone(draft.board),{applyBoard:draft.applyBoard,noteMode:draft.noteMode||'manual'});
  }
  next.updatedAt = new Date().toISOString();
  validateSnapshot(next);
  if (persistLocally) await persist(next, originals, false, null, {clearBoards:true});
  project = next; boardDrafts.clear(); dirty = true; invalidateOutput();
}

function openDialog(title, body, submit, label = '保存する') {
  if(!$('editorDialog').open)editorReturnTarget=floating.returnTarget(document.activeElement);
  floating.close();
  if($('workMenu'))$('workMenu').open=false;
  modalRevision++;
  modalEdited=false;
  $('dialogTitle').textContent = title;
  $('dialogBody').innerHTML = body;
  $('dialogSubmit').textContent = label;
  $('dialogError').hidden = true;
  $('editorForm').onchange = null;
  $('editorForm').oninput = null;
  modalSubmit = submit;
  if(!$('editorDialog').open)$('editorDialog').showModal();
}

async function startNewProject(name,routeName) {
  if(!String(routeName||'').trim())throw new Error('路線名を入力してください。');
  const next=createProject(name),route=addGroup(next,{kind:'路線',name:routeName});
  await replaceWork(next, new Map());mode='field';activeGroupId=route.id;initialRouteName='';selectedTargetIds.clear();
  notify('工事と路線を作成しました。記録対象一覧の「追加」から登録してください。');
}
function newProjectDialog() {
  if(!project){
    floating.close();if($('workMenu'))$('workMenu').open=false;
    $('initialProjectName')?.focus();return;
  }
  openDialog('新しい工事を始める', `<div class="dialog-fields">${renderProjectSetupFields()}</div><p class="dialog-note">開いている工事から切り替えます。必要な作業は先にZIPへ保存してください。</p>`, data => startNewProject(data.get('name'),data.get('routeName')), 'この工事を始める');
}

function newGroupDialog() {
  openDialog('路線を追加', `<div class="dialog-fields">${field('路線名', 'name')}</div>`, async data => {
    const group = await mutate(next => addGroup(next, {kind:'路線',name:data.get('name')}), '路線を追加しました。');
    activeGroupId = group.id; activeTargetId = ''; activeRecordId = ''; useCaseFilter = '';
  }, '路線を追加');
}

function renameProjectDialog() {
  openDialog('工事名を訂正',`<div class="dialog-fields">${field('工事名','name',project.name,{max:100})}</div><p class="hint">工事ID・原本・所属は保持します。採用写真と次回用の黒板の工事名も更新します。元写真は保持し、黒板の訂正履歴を残します。調書は要再確認になります。</p>`,data=>mutate(next=>renameProject(next,data.get('name')),'工事名と採用写真・次回用黒板を更新しました。'));
}

function renameGroupDialog(id) {
  const group=project.groups.find(g=>g.id===id);
  openDialog('路線名を訂正',`<p class="hint">${esc(group.kind)}</p><div class="dialog-fields">${field('路線名','name',group.name)}</div><p class="hint">所属ID・原本は保持し、採用写真と次回用の黒板の路線名も更新します。</p>`,data=>mutate(next=>renameGroup(next,id,data.get('name')),'路線名を訂正しました。'));
}

function editTargetDialog(id) {
  const target=project.targets.find(t=>t.id===id),def=USE_CASES[target.useCase];
  openDialog('管理名・所属を訂正',`<p class="hint">用途：${esc(target.useCase)}（用途はこの操作で変更しません）</p><div class="dialog-fields">${field(def.nameLabel,'name',target.name)}${selectField('路線名',groupOptions(target.groupId||''),{name:'groupId',attrs:{required:true}})}</div><p class="dialog-note">記録・写真・原本のIDを保持し、調書の所属と採用写真・次回用黒板の路線名・点名を更新します。</p>`,async data=>{
    await mutate(next=>updateTarget(next,id,{name:data.get('name'),groupId:data.get('groupId')||null}),'管理名・所属を調書と採用写真・次回用黒板へ反映しました。');
    activeGroupId='__all__';activeTargetId=id;
  });
}

const contextText = context => context ? `${context.target.name} ／ ${context.target.useCase} ／ ${context.record.category} ／ ${context.slot.name}`:'分類待ち';
function photoMoveDialog(photoId) {
  const photo=project.photos.find(p=>p.id===photoId),initial=project.targets.find(t=>t.id===photo.targetId)||project.targets[0];
  if(!initial)throw new Error('移動先の記録対象を先に登録してください。');
  const destinationFields=(target,category=(target.id===photo.targetId?target.records.find(r=>r.id===photo.recordId)?.category:null)||target.records[0].category)=>selectField(USE_CASES[target.useCase].categoryLabel,options(USE_CASES[target.useCase].categories,category),{name:'category'})+selectField('写真の種類',options(USE_CASES[target.useCase].slots,USE_CASES[target.useCase].slots.includes(photo.slot)?photo.slot:USE_CASES[target.useCase].slots[0]),{name:'slot'});
  openDialog('写真の所属・分類を訂正',`<p class="hint">${esc(photo.originalName)}。原本と写真IDは変更しません。</p><div class="dialog-fields">${selectField('移動先の記録対象',optionItems(project.targets.map(target=>[target.id,`${target.name} ／ ${target.useCase} ／ ${locationLabel(project.groups.find(g=>g.id===target.groupId))}`]),initial.id),{name:'targetId'})}<div id="moveDestination" class="dialog-fields">${destinationFields(initial)}</div></div><p class="hint">選んだ区分の記録がなければ、確定時に空の記録を追加します。次の画面で移動の影響を確認します。</p>`,data=>{
    const candidate=clone(project),target=candidate.targets.find(t=>t.id===data.get('targetId'));
    const record=target.records.find(r=>r.category===data.get('category'))||addRecord(candidate,target.id,data.get('category'));
    const destination={recordId:record.id,slot:data.get('slot')};
    const effect=describePhotoMove(candidate,photoId,destination);
    if(!effect.canMove)throw new Error(effect.reason);
    const conflict=Boolean(effect.conflictPhoto||effect.to.slot.status==='unnecessary'||effect.to.slot.status==='retake');
    openDialog('移動の影響を確認',`<div class="dialog-fields"><p><strong>移動元</strong><br>${esc(contextText(effect.from))}</p><p><strong>移動先</strong><br>${esc(contextText(effect.to))}</p><div class="dialog-note">${effect.messages.map(m=>`<p>${esc(m)}</p>`).join('')}<p>移動先の現在の状態：${statuses[effect.to.slot.status]}${effect.to.slot.reason?` ／ ${esc(effect.to.slot.reason)}`:''}</p></div>${selectField('移動先での扱い',`${conflict?'<option value="">扱いを選んでください</option>':''}<option value="adopt">この写真を採用する（現在の採用・不要指定を置き換え）</option><option value="history">履歴として追加する（現在の状態を保持）</option>`,{name:'resolution',attrs:{required:true}})}${effect.requiresMmsConfirmation?checkbox('MMSでは合成を解除し、元の黒板データは保持することを確認しました',{name:'mmsConfirmed',required:true}):''}</div>`,async decision=>{
      const next=clone(candidate);
      movePhoto(next,photoId,{...destination,resolution:decision.get('resolution'),disableBoardForMms:decision.get('mmsConfirmed')==='on'});
      await persist(next,originals);project=next;dirty=true;invalidateOutput();
      notify('写真の所属・分類を訂正しました。移動元と移動先の不足を再判定しました。');
    },'この内容で移動');
  },'移動の影響を確認');
  $('editorForm').onchange=event=>{if(event.target.name==='targetId')$('moveDestination').innerHTML=destinationFields(project.targets.find(t=>t.id===event.target.value));};
}

function photoDeleteDialog(id) {
  const effect=describePhotoDelete(project,id);
  openDialog('写真を1枚削除',`<div class="dialog-fields"><p>${esc(contextText(effect.from))}<br>原本：${esc(effect.photo.originalName)}</p><div class="dialog-note">${effect.messages.map(m=>`<p>${esc(m)}</p>`).join('')}<p>同じ枠に残る履歴：${effect.remainingHistory}枚</p></div>${checkbox('この写真の原本と履歴を削除することを確認しました',{name:'confirmed',required:true})}</div>`,async()=>{
    const next=clone(project);deletePhoto(next,id);const files=new Map(originals);files.delete(id);
    await persist(next,files);project=next;originals=files;dirty=true;invalidateOutput();revokeThumbnails();
    notify('指定した写真を削除しました。過去の写真は自動採用していません。');
  },'この写真を削除');
}

async function flushReportDrafts(persistLocally=true) {
  if(!reportDrafts.size)return;
  const next=clone(project);
  for(const [idKey,value] of reportDrafts){const at=idKey.indexOf(':');const id=idKey.slice(0,at),key=idKey.slice(at+1);try{setReportField(next,id,key,value);}catch(error){const {target,record}=getContext(next,id);throw new Error(`${target.name} / ${record.category} / ${key}: ${error.message}`);}}
  validateSnapshot(next);if(persistLocally)await persist(next,originals,false,null,{clearReports:true});
  project=next;reportDrafts.clear();dirty=true;invalidateOutput();
}

function pasteTextDialog(settings,text,error=''){
  pendingPaste={projectId:project.id,settings,text};dirty=true;
  openDialog('貼り付け内容を確認・修正',`${error?notice(error,{tone:'error',role:'alert'}):''}<p class="hint">元の表は変更していません。タブ区切りの内容を修正して再検証できます。</p><div class="dialog-fields">${textareaField('貼り付けるテキスト',{name:'pasteText',value:text,max:null,rows:10,required:true})}</div>`,data=>{
    const corrected=data.get('pasteText');pendingPaste.text=corrected;
    showPastePreview({...settings,text:corrected});
  },'検証して範囲を確認');
  $('editorForm').oninput=event=>{if(event.target.name==='pasteText')pendingPaste.text=event.target.value;};
}

function showPastePreview(settings){
  const effect=describeReportPaste(project,settings);
  pendingPaste={projectId:project.id,settings,text:settings.text};dirty=true;
  openDialog('調書の貼り付け範囲を確認',`<p>${effect.rows}行 × ${effect.columns}列、${effect.cells}セルを更新します。</p><div class="paste-preview"><table><thead><tr><th>対象・項目</th><th>新しい値</th></tr></thead><tbody>${effect.updates.map(update=>{const {target,record}=getContext(project,update.recordId);const column=USE_CASES[target.useCase].reportColumns.find(c=>c.key===update.key);return `<tr><td>${esc(target.name)} ／ ${esc(record.category)}<br>${esc(column.label)}</td><td>${esc(update.value)}</td></tr>`;}).join('')}</tbody></table></div><p class="hint">範囲・300文字上限を検証済みです。確定するまで表は変更しません。</p>${actions(button('貼付けテキストを修正',{id:'editPasteText'}))}`,async()=>{
    const next=clone(project),replaced=new Set(effect.updates.map(u=>`${u.recordId}:${u.key}`));
    for(const [idKey,value] of reportDrafts){if(replaced.has(idKey))continue;const at=idKey.indexOf(':');setReportField(next,idKey.slice(0,at),idKey.slice(at+1),value);}
    applyReportPaste(next,settings);await persist(next,originals,false,null,{clearReports:true,clearPaste:true});project=next;reportDrafts.clear();pendingPaste=null;dirty=true;invalidateOutput();notify(`${effect.cells}セルの貼り付けを保存しました。`);
  },'この範囲へ貼り付け');
  $('editPasteText').onclick=()=>pasteTextDialog(settings,settings.text);
}

function reportSectionDialog(recordId) {
  const {target,record}=getContext(project,recordId),section=record.reportSection||{};
  openDialog('施工区間（この記録の任意設定）',`<p class="hint">${esc(target.name)} ／ ${esc(record.category)}。未設定でも写真・調書・ZIPを使用できます。</p><div class="dialog-fields">${checkbox('この調書に施工区間を記載する',{name:'enabled',checked:Boolean(record.reportSection)})}<div class="two-fields">${field('起点 m','start',section.start||'',{required:false})}${field('終点 m','end',section.end||'',{required:false})}</div>${field('不施工区間長 m（空欄は0）','excluded',section.excluded||'',{required:false})}${selectField('測点の表示',options(STATION_NOTATIONS,section.notation||'SP'),{name:'notation'})}${field('自由入力の測点名','custom',section.custom||'',{required:false,max:30})}<p id="sectionCalculation" class="hint"></p></div><p class="hint">数値はm、小数第3位まで。No.は100m区切り。KP=もmの数値へ接頭辞を付ける既存表記です。試験の計算・判定は行いません。</p>`,async data=>{
    const value=data.get('enabled')==='on'?{start:data.get('start').trim(),end:data.get('end').trim(),excluded:data.get('excluded').trim(),notation:data.get('notation'),custom:data.get('custom').trim()}:null;
    await mutate(next=>setReportSection(next,recordId,value),'任意の施工区間を保存しました。');
  });
  $('editorForm').oninput=()=>{const f=$('editorForm'),r=constructionSection(f.elements.start.value,f.elements.end.value,f.elements.excluded.value);$('sectionCalculation').textContent=r.error||(r.complete?`工事延長 L = ${r.length} m`:'設定する場合は起点と終点を入力してください。');};
}

function routeSectionDialog(groupId){
  const group=project.groups.find(g=>g.id===groupId);
  if(!group)throw new Error('施工区間を設定する路線を選んでください。');
  const s=group.reportSection||{};
  openDialog('路線の施工区間',`<p>${esc(group.name)}の調書・写真帳で共通に使います。</p><div class="dialog-fields">${checkbox('施工区間を記載する',{name:'enabled',checked:Boolean(group.reportSection)})}${field('起点 m','start',s.start||'',{required:false})}${field('終点 m','end',s.end||'',{required:false})}${field('不施工区間長 m','excluded',s.excluded||'',{required:false})}${selectField('測点の表示',options(STATION_NOTATIONS,s.notation||'SP'),{name:'notation'})}${field('自由入力の測点名','custom',s.custom||'',{required:false,max:30})}<p id="sectionCalculation" class="hint"></p></div>`,data=>mutate(next=>setRouteSection(next,groupId,data.get('enabled')==='on'?{start:data.get('start').trim(),end:data.get('end').trim(),excluded:data.get('excluded').trim(),notation:data.get('notation'),custom:data.get('custom').trim()}:null),'路線の施工区間を保存しました。'));
  $('editorForm').oninput=()=>{const f=$('editorForm'),r=constructionSection(f.elements.start.value,f.elements.end.value,f.elements.excluded.value);$('sectionCalculation').textContent=r.error||(r.complete?`工事延長 L = ${r.length} m`:'起点・終点を入力してください。');};
}

function targetDeleteDialog(ids){
  if(pendingPhoto)throw new Error('未保存の写真取込を解決してから削除してください。');
  const plan=describeTargetDeletion(project,ids);
  openDialog('記録対象の削除を確認',`<ul>${plan.names.map(name=>`<li>${esc(name)}</li>`).join('')}</ul><p>${plan.targetIds.length}対象・${plan.recordIds.length}記録・原本${plan.photoIds.length}枚（${bytesLabel(plan.bytes)}）。採用写真・全履歴・調書も削除します。</p><p class="hint">必要な作業ZIPを先に保存してください。取り消すと変更しません。</p>${checkbox('対象と原本を確認しました',{name:'confirmed',required:true})}`,async()=>{
    const next=clone(project),current=deleteTargets(next,plan.targetIds),files=new Map(originals);
    current.photoIds.forEach(id=>files.delete(id));
    const clearNames=current.targetIds,clearBoardIds=current.recordIds,clearReportKeys=[...reportDrafts.keys()].filter(key=>current.recordIds.some(id=>key.startsWith(id+':')));
    await persist(next,files,false,null,{clearNames,clearBoardIds,clearPaste:Boolean(pendingPaste?.settings?.recordIds?.some(id=>current.recordIds.includes(id)))});
    project=next;originals=files;clearNames.forEach(id=>{nameDrafts.delete(id);selectedTargetIds.delete(id);});clearBoardIds.forEach(id=>boardDrafts.delete(id));clearReportKeys.forEach(key=>reportDrafts.delete(key));if(pendingPaste?.settings?.recordIds?.some(id=>current.recordIds.includes(id)))pendingPaste=null;
    if(current.targetIds.includes(activeTargetId)){activeTargetId='';activeRecordId='';}closePhotoDrawer();current.recordIds.forEach(id=>outputState.selectedIds.delete(id));
    revokeThumbnails();dirty=true;invalidateOutput();notify('確認した記録対象を削除しました。');
  },'対象と原本を削除');
}

function invalidateOutput(){
  if(previewViewer?.isOpen())previewViewer.close();
  const frame=$('outputPreview');if(frame){frame.removeAttribute('srcdoc');frame.src='about:blank';}
  outputState.prepared=null;outputState.ready=false;outputState.approved=false;
}
function selectedOutputIds(){const allowed=new Set(scopedRecords(project,outputState.groupId,outputState.useCase).map(c=>c.record.id));return [...outputState.selectedIds].filter(id=>allowed.has(id));}
function resetOutputSelection(){outputState.selectedIds=new Set(scopedRecords(project,outputState.groupId,outputState.useCase).map(c=>c.record.id));outputState.initialized=true;invalidateOutput();}
function enterMode(nextMode){mode=nextMode;if(mode==='output'&&!outputState.initialized)resetOutputSelection();render();}

async function prepareOutput(){
  requireSavedNames();
  requireResolvedPaste();
  await flushBoardDrafts(true);await flushReportDrafts(true);
  if(outputState.edition==='final'&&buildOutputModel(project,{recordIds:selectedOutputIds(),edition:'draft'}).issues.length){outputState.edition='draft';notify('不足・未確認があるため、途中版のプレビューへ切り替えました。');}
  showProgress('調書・採用写真の参照と原本を確認しています…');
  invalidateOutput();
  const result=await cancellable(signal=>buildOutputHTML(project,originals,{recordIds:selectedOutputIds(),edition:outputState.edition,onProgress:showProgress,signal,format:'blob'}));
  outputState.prepared={...result,fingerprint:JSON.stringify(project)};outputState.ready=false;outputState.approved=false;
  notify(`${result.model.edition==='draft'?'途中版':'完成版'}のプレビューを作成しました。${result.model.pageCount}ページです。`);
}

function observeOutputFrame(frame,prepared) {
  const ready=async()=>{
    const doc=frame.contentDocument;
    try{
      if(!frame.contentWindow.outputReady)return;
      await frame.contentWindow.outputReady;
      if(!frame.isConnected||frame.contentDocument!==doc||outputState.prepared!==prepared)return;
      outputState.ready=true;
      const printControls=doc.querySelector('.print-controls');if(printControls)printControls.style.display='none';
      if(!doc.documentElement.dataset.fullscreenHook){
        doc.documentElement.dataset.fullscreenHook='true';
        doc.addEventListener('click',event=>{
          if($('previewDialog').contains(frame)||event.target.closest('button,a,input,select,textarea'))return;
          event.preventDefault();openDocumentPreview(frame);
        });
      }
      const button=$('printOutput');if(button){button.dataset.unavailable=String(!outputState.approved);updateDisabled();}
    }catch(error){if(frame.isConnected&&frame.contentDocument===doc&&outputState.prepared===prepared)notify(`出力画像を準備できません：${error.message}`,true);}
  };
  frame.onload=ready;
  if(frame.contentDocument?.documentElement.dataset.outputReady==='true')void ready();
}
async function attachOutputPreview(){
  const frame=$('outputPreview'),prepared=outputState.prepared;if(!frame||!prepared)return;
  // srcdoc also works in embedded browsers that do not navigate Blob HTML URLs.
  // Keep only the Blob in prepared state; the transient text is handed to the live frame once.
  try{
    const html=await prepared.blob.text();
    if(!frame.isConnected||outputState.prepared!==prepared)return;
    observeOutputFrame(frame,prepared);frame.srcdoc=html;
  }catch(error){if(frame.isConnected&&outputState.prepared===prepared)notify(`出力を表示できません：${error.message}`,true);}
}
function openDocumentPreview(frame=$('outputPreview'),trigger=document.activeElement){
  if(!frame||!outputState.prepared||!outputState.ready)throw new Error('出力プレビューの準備が完了してから開いてください。');
  const prepared=outputState.prepared;
  trigger=floating.returnTarget(trigger);floating.close();
  previewViewer.showDocument({frame,title:`${prepared.model.edition==='draft'?'途中版':'完成版'} 調書・写真帳（${prepared.model.pageCount}ページ）`,caption:'PDF保存に使う同じ簡易帳票です。拡大率は印刷・保存内容へ反映しません。',trigger});
}
function openImagePreview(photoId,composed=false,trigger=document.activeElement){
  const photo=project.photos.find(p=>p.id===photoId);if(!photo)throw new Error('写真が見つかりません。');
  const blob=originals.get(photoId);if(!blob)throw new Error('元写真がありません。');
  const context=photo.recordId?getContext(project,photo.recordId):null;
  const label=context?`${context.target.name} ／ ${context.record.category} ／ ${photo.slot}`:photo.originalName;
  trigger=floating.returnTarget(trigger);floating.close();
  void previewViewer.showImage({title:label,caption:composed&&photo.applyBoard?'電子黒板を合成した確認用画像です。原本は変更しません。':'原本の拡大表示です。電子黒板の合成は含みません。',blob,loadBlob:composed?()=>composePhoto(blob,photo):undefined,trigger});
}
function openCanvasPreview(id,trigger=document.activeElement){
  const canvas=$(id);if(!canvas)throw new Error('黒板プレビューがありません。');
  trigger=floating.returnTarget(trigger);floating.close();
  void previewViewer.showImage({title:'黒板の拡大プレビュー',caption:'画面に表示中の黒板です。作業データや原本は変更しません。',loadBlob:()=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('黒板を表示できません。')),'image/png')),trigger});
}

async function openPrintOutput(){
  requireSavedNames();
  const prepared=outputState.prepared;
  if(!prepared||!outputState.ready||!outputState.approved||prepared.fingerprint!==JSON.stringify(project)||boardDrafts.size||reportDrafts.size)throw new Error('最新のプレビューを作成し、内容を確認してください。');
  const win=window.open('','_blank');if(!win)throw new Error('印刷画面を開けません。ポップアップの許可を確認してください。');
  try{
    const html=await prepared.blob.text();
    if(outputState.prepared!==prepared){win.close();throw new Error('出力内容が変更されました。最新のプレビューを確認してください。');}
    win.document.open();win.document.write(html);win.document.close();
  }catch(error){win.close();throw error;}
  notify('確認した内容の印刷画面を開きました。画像の準備後、画面内の印刷ボタンからPDF保存できます。');
}

function finishWorkDialog(){
  if(pendingPhoto)throw new Error('未保存の写真があります。再試行または写真取込の取消をしてから作業を終了してください。');
  let requested=false;
  openDialog('このブラウザーの作業を終了',`<p class="dialog-note">${esc(project.name)}の対象${project.targets.length}件・原本${project.photos.length}枚を一時保存から消去します。作業ZIPを保存し、保存先を確認してください。</p><div class="dialog-fields">${actions(button('現在の作業ZIPを保存',{id:'finishBackup'}))}${checkbox('必要な作業ZIPが保存されていることを確認しました',{name:'confirmed',required:true})}</div>`,async()=>{
    if(!requested)throw new Error('先にこの画面の作業ZIP保存を実行してください。');
    await sessionSaver.pause();if(storage)await storage.clear();project=null;sessionSaver.reset();originals=new Map();boardDrafts.clear();reportDrafts.clear();nameDrafts.clear();pendingPaste=null;disclosureState.clear();closePhotoDrawer();revokeThumbnails();dirty=false;outputState.initialized=false;invalidateOutput();notify('このブラウザーの一時作業を終了しました。保存したZIPから再開できます。');
  },'一時作業を消去して終了');
  $('finishBackup').onclick=()=>run(async()=>{await savePackage();requested=true;});
}

function suggestedName(useCase, groupId) {
  const definition = USE_CASES[useCase];
  const prefix = definition.prefix || (['現密','コア密'].includes(useCase) ? '試験' : definition.targetLabel);
  let index = 1;
  const names = new Set(project.targets.filter(item => item.groupId === (groupId || null)).map(item => item.name.toLowerCase()));
  while (names.has(`${prefix}${index}`.toLowerCase())) index++;
  return `${prefix}${index}`;
}

function targetRegistrationFields(useCase,groupId='',count=1,name='',category='',prefix,initialTemplate,material=''){
  const definition=USE_CASES[useCase],current=category||definition.categories[0],trial=isTrial(useCase);
  let suggested=trial?current:suggestedName(useCase,groupId);
  if(trial){let index=2;const names=new Set(project.targets.filter(t=>t.groupId===(groupId||null)).map(t=>t.name));while(names.has(suggested))suggested=`${current}${index++}`;}
  const names=count===1?(trial?textField(definition.nameLabel,{name:'name',value:suggested,attrs:{readonly:true}}):field(definition.nameLabel,'name',name||suggested)):field('管理名の先頭部分','prefix',trial?current:(prefix??definition.prefix),{max:30,required:false});
  const materials=trial?selectField('材料',optionItems([['','材料を選択してください'],...materialChoices(useCase,current)],material),{name:'material',attrs:{required:true}}):'';
  return `${selectField('路線名',groupOptions(groupId),{name:'groupId',attrs:{required:true}})}${selectField(definition.categoryLabel,options(definition.categories,current),{name:'category'})}${textField('追加する数',{name:'count',type:'number',value:count,max:null,attrs:{min:1,max:2000,step:1}})}${names}${materials}${useCase==='MMS'?'<input type="hidden" name="initialTemplate" value=""><p class="hint">MMSは黒板なしです。</p>':selectField('今回登録する対象の黒板初期値',optionItems(Object.values(BOARD_TEMPLATES).filter(t=>t.id!=='legacy-simple').map(t=>[t.id,t.name]),initialTemplate||definition.defaultBoardTemplate),{name:'initialTemplate'})}${useCase!=='MMS'?'<section class="registration-board-preview"><strong>登録する黒板のプレビュー</strong><canvas id="registrationBoardPreview" width="600" height="450" class="board-canvas" aria-label="登録する黒板のプレビュー"></canvas><p id="registrationBoardStatus" class="hint"></p></section>':''}<p class="hint">入力した路線に対象を追加します。TSの右側画像はPCから指定します。</p>`;
}

function drawRegistrationPreview(){
  const form=$('editorForm'),canvas=$('registrationBoardPreview');if(!form||!canvas)return;
  const useCase=form.elements.useCase.value,group=project.groups.find(group=>group.id===form.elements.groupId.value);
  try{
    if(!group)throw new Error('路線を選択してください。');
    const candidate=clone(project),count=Math.max(1,Math.min(2000,Number(form.elements.count.value)||1));
    const [target]=addTargets(candidate,{useCase,groupId:group.id,count,name:form.elements.namedItem('name')?.value||'',prefix:form.elements.namedItem('prefix')?.value||'',category:form.elements.category.value,templateId:form.elements.initialTemplate.value});
    const board=resolveCaptureBoard(candidate,target.records[0].id,target.records[0].slots[0].name).board;
    const result=drawBoard(canvas.getContext('2d'),0,0,canvas.width,canvas.height,board);
    $('registrationBoardStatus').textContent=result.overflow?'文字が枠に収まりません。登録前に入力を確認してください。':`${BOARD_TEMPLATES[board.templateId].name} ／ 項目名：${getReportItemName(candidate,target.records[0].id)}`;
  }catch(error){$('registrationBoardStatus').textContent=error.message;}
}

function addTargetsDialog() {
  if(!project.groups.length){newGroupDialog();return;}
  const initial = useCaseFilter || '基準点';
  const groupId = project.groups.some(g=>g.id===activeGroupId)?activeGroupId:project.groups[0].id;
  openDialog('記録対象を追加', `<div class="dialog-fields">${selectField('用途',options(Object.keys(USE_CASES),initial),{name:'useCase'})}<div id="targetRegistration" class="dialog-fields">${targetRegistrationFields(initial,groupId)}</div></div><p class="hint">「現場写真」は、baseでも用途名のみが用意された設定待ちの項目です。現行版では、専用の登録・撮影・写真帳作成フローをまだ追加していません。</p>`, async data => {
    if(!data.get('groupId'))throw new Error('路線を選択してください。');
    const next=clone(project),targets=addTargets(next,{useCase:data.get('useCase'),groupId:data.get('groupId') || null,category:data.get('category'),name:data.get('name') || '',prefix:data.get('prefix') || '',count:Number(data.get('count')),templateId:data.get('initialTemplate')||undefined});
    if(isTrial(data.get('useCase')))for(const target of targets)target.records[0].reportFields.material=String(data.get('material')||'');
    validateSnapshot(next);
    openDialog('登録する対象を確認',`<p class="step-hint">1 用途・管理名を指定 → <strong>2 内容を確認</strong></p><p>${esc(data.get('useCase'))} ／ ${esc(data.get('category'))} ／ ${esc(locationLabel(project.groups.find(g=>g.id===data.get('groupId'))))}</p><div class="registration-preview"><ul>${targets.map(target=>`<li>${esc(target.name)}</li>`).join('')}</ul></div><p class="hint">${targets.length}件を追加します。確定前の取消では工事を変更しません。</p>`,async()=>{
      await persist(next,originals);project=next;dirty=true;invalidateOutput();
      useCaseFilter=data.get('useCase');activeGroupId=data.get('groupId')||'';activeTargetId=targets[0]?.id||'';activeRecordId=targets[0]?.records[0]?.id||'';
      notify(`${targets.length}件の記録対象を追加しました。`);
    },'この内容で登録');
  }, '登録内容を確認');
  let savedName = ''; let savedPrefix;let savedTemplate;
  $('editorForm').onchange = event => {
    const form = $('editorForm');
    if (!['useCase','count','category','groupId'].includes(event.target.name)){drawRegistrationPreview();return;}
    const selectedGroup = form.elements.groupId.value;
    const count = Math.max(1,Math.min(2000,Number(form.elements.count.value)||1));
    const category = event.target.name === 'useCase' ? '' : form.elements.category.value;
    const savedMaterial=['count','groupId'].includes(event.target.name)?form.elements.namedItem('material')?.value||'':'';
    if (event.target.name === 'useCase'||event.target.name==='category') { savedName = ''; savedPrefix = undefined;savedTemplate=undefined; }
    else {
      if (form.elements.namedItem('name')) savedName = form.elements.name.value;
      if (form.elements.namedItem('prefix')) savedPrefix = form.elements.prefix.value;
      savedTemplate=form.elements.initialTemplate.value;
    }
    $('targetRegistration').innerHTML = targetRegistrationFields(form.elements.useCase.value, selectedGroup, count, savedName, category, savedPrefix,savedTemplate,savedMaterial);
    drawRegistrationPreview();
  };
  $('editorForm').oninput=()=>drawRegistrationPreview();
  drawRegistrationPreview();
}

function addRecordDialog() {
  const { target } = selection();
  const definition = USE_CASES[target.useCase];
  const categories = definition.categories.filter(category => !target.records.some(record => record.category === category));
  if (!categories.length) return;
  openDialog(`${target.name}に記録を追加`, `<div class="dialog-fields">${selectField(`追加する${definition.categoryLabel}`,options(categories,categories[0]),{name:'category'})}</div><p class="hint">同じ管理対象に別区分の撮影枠を追加します。以前の写真・黒板・撮影状態は保持します。</p>`, async data => {
    const record = await mutate(next => addRecord(next, target.id, data.get('category')), '区分別の記録を追加しました。'); activeRecordId = record.id;
  }, '記録を追加');
}

function unnecessaryDialog(recordId, slotName) {
  const { target, record } = getContext(project, recordId);
  const slot = record.slots.find(item => item.name === slotName);
  openDialog('撮影不要の理由', `<p class="hint">${esc(target.name)} ／ ${esc(record.category)} ／ ${esc(slotName)}</p><div class="dialog-fields">${field('撮影しない理由', 'reason', slot.reason, { max: 1000, multiline: true })}</div><p class="hint">理由を付けた枠は完了として扱います。既存の原本は履歴に残ります。</p>`, async data => {
    await mutate(next => setSlotStatus(next, recordId, slotName, 'unnecessary', data.get('reason')), '撮影不要の理由を保存しました。');
  }, '撮影不要にする');
}

function nextWorkDateDialog(recordId) {
  const {record}=getContext(project,recordId),value=record.workDateDefault||{value:'',confirmed:false};
  openDialog('次回用の作業日を設定',`<div class="dialog-fields">${field('次の写真の作業日','workDate',value.value,{type:'date',required:false})}</div><p class="dialog-note">この記録から次に撮影・選択する写真に使います。既存写真・黒板の日付は変更しません。未指定時は当日の日付を自動入力します。完成版の条件に影響しません。</p>`,data=>mutate(next=>setNextWorkDate(next,recordId,{value:data.get('workDate'),confirmed:data.get('confirmed')==='on'}),'次回用の作業日を保存しました。既存写真は変更していません。'));
}

function photoDateDialog(id) {
  const photo=project.photos.find(item=>item.id===id);
  openDialog('この写真の作業日を確認・訂正',`<p class="hint">${esc(photo.originalName)}<br>${esc(captureSourceLabel(photo))}<br>取込日時：${esc(timestampLabel(photo.importedAt))}<br>実際の撮影日時：${esc(timestampLabel(photo.capturedAt))}</p>${dateState(photo)==='legacy'?'<p class="dialog-note">既存値の日付の出所・確認状態は旧ZIPだけでは判断できません。値を自動的に確認済みにはしていません。</p>':''}<div class="dialog-fields">${field('この写真の作業日（任意）','workDate',photo.workDate,{type:'date',required:false})}${hasBoardDate(photo.board)?`<p>黒板日付：${esc(photo.board.values.date||'空欄')}${photo.workDate!==photo.board.values.date?'（作業日と異なります）':''}</p>${selectField('黒板日付との反映方法',optionItems([['none','作業日だけを保存（黒板は保持）'],['board-to-work','黒板の日付を作業日へ明示反映'],['work-to-board','指定した作業日をこの写真の黒板へ明示反映']]),{name:'sync'})}`:''}</div><p class="hint">原本・写真ID・所属・取込日時は変えません。作業日の訂正は任意です。日付とその確認状態は完成版の条件に影響しません。</p>`,async data=>{
    await mutate(next=>{setPhotoWorkDate(next,id,{value:data.get('workDate'),confirmed:data.get('confirmed')==='on',sync:data.get('sync')||'none'});const changed=next.photos.find(item=>item.id===id);if(data.get('sync')==='work-to-board'&&changed.applyBoard)boardFits(changed.board,{skipPoint:isTrial(getContext(next,changed.recordId).target.useCase)});},'作業日を保存しました。黒板の日付は選択した反映方法に従っています。');
  });
}

function reportSettingsDialog() {
  const initial=activeGroupId!=='__all__'?activeGroupId||'':'';
  const fields=groupId=>Object.entries(getReportItemNames(project,groupId||null)).map(([useCase,value])=>`${field(`${useCase}の項目名`,`item-${useCase}`,groupId?project.reportSettings?.groups?.[groupId]?.[useCase]||'':project.reportSettings?.defaults?.[useCase]||'',{required:false,max:300,multiline:true})}<p class="hint">現在の有効名：${esc(value)}。${groupId?'空欄で工事既定へ戻ります。':'空欄で用途の初期名へ戻ります。'}</p>`).join('');
  openDialog('簡易帳票の項目名を設定',`<div class="dialog-fields">${selectField('設定する範囲',optionItems([['','工事全体の既定（グループ別指定がない記録）'],...project.groups.map(group=>[group.id,`${locationLabel(group)}だけ`])],initial),{name:'settingsGroup'})}<div id="reportItemFields" class="dialog-fields">${fields(initial)}</div></div><p class="dialog-note">固定された用途別の「項目名」を設定します。列の増減や任意帳票の設計ではありません。グループ別指定は工事既定より優先されます。変更された項目名を使う調書は要再確認になります。</p>`,async data=>{
    const names=Object.fromEntries(Object.keys(USE_CASES).map(useCase=>[useCase,data.get(`item-${useCase}`)]));
    const next=updateReportItemNames(project,{groupId:data.get('settingsGroup')||null,names});
    await persist(next,originals);project=next;dirty=true;invalidateOutput();notify('帳票の項目名を保存しました。関係する調書を確認してください。');
  });
  $('editorForm').onchange=event=>{if(event.target.name==='settingsGroup')$('reportItemFields').innerHTML=fields(event.target.value);};
}

function editPhotoDialog(id) {
  const photo = project.photos.find(item => item.id === id);
  const context = getContext(project, photo.recordId);
  if (context.target.useCase === 'MMS'||(context.target.useCase==='TS出来形(バリアフリー)'&&photo.slot==='スマホスクリーンショット')) return;
  openDialog('この写真の黒板を修正', `<p class="hint">${esc(context.target.name)} ／ ${esc(context.record.category)} ／ ${esc(photo.slot)}</p><div class="dialog-fields"><div id="photoBoardEditor" class="board-form">${boardFields(photo.board || context.record.boardDefaults,photo.applyBoard,true,{omitPoint:isTrial(context.target.useCase)})}</div>${checkbox('電子黒板を合成する',{name:'applyBoard',checked:photo.applyBoard})}</div><p class="hint">この写真の黒板を更新し、位置→測点、備考→調書の備考を反映します。原本と変更前の黒板は保持します。</p>`, async data => {
    const board = readBoard($('editorForm')); const applyBoard = data.get('applyBoard') === 'on';
    if (applyBoard) boardFits(board,{skipPoint:isTrial(context.target.useCase)});
    await mutate(next => { savePhotoBoard(next,id,board,applyBoard); }, '写真の黒板と対応する調書欄を保存しました。作業日は変更していません。');
  });
  $('editorForm').onchange = event => { if (['templateId','applyBoard'].includes(event.target.name)) $('photoBoardEditor').innerHTML = boardFields(readBoard($('editorForm')),$('editorForm').elements.applyBoard.checked,true,{omitPoint:isTrial(context.target.useCase)}); };
}

function showImportReview(data) {
  const same = bundleId === data.bundleId; const counts = summarize(data.project);
  const uses = [...new Set(data.project.targets.map(item => item.useCase))].join('・');
  openDialog('読み込む作業を確認', `<div class="dialog-fields">${panelHeading(data.project.name,{eyebrow:'WORK PACKAGE',level:3})}<p>${data.project.targets.length}記録対象・${counts.records}記録・原本${data.project.photos.length}枚<br>用途：${esc(uses || '未登録')}<br>${data.project.groups.length ? `${data.project.groups.length}グループ（任意）` : 'グループなし・工事直下'}</p><p class="dialog-note">${same ? '同じ受渡ファイルです。' : ''}${project ? '現在の作業をこの内容に切り替えます。必要な変更は先にZIPへ保存してください。' : '原本と黒板・所属の検証が完了しました。'} 写真の自動追加・統合は行いません。</p></div>`, async () => {
    await replaceWork(data.project, data.originals, data.bundleId||null); mode = 'organize';
    notify(`作業ZIPを開きました。${data.project.photos.length}枚の原本・用途・黒板・所属を復元しました。`);
  }, 'この作業を開く');
}

function download(blob, filename) {
  const safe = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = safe; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function savePackage() {
  requireSavedNames();
  requireResolvedPaste();
  if (!project) return;
  await flushBoardDrafts(true);
  await flushReportDrafts(true);
  showProgress('作業ZIPを準備しています…');
  const result = await cancellable(signal=>exportWorkPackage(project, originals, { onProgress: showProgress,signal }));
  download(result.blob, result.filename);
  bundleId = result.bundleId; dirty = false; lastExportAt = new Date();
  let persistenceIssue = '';
  if (storage) {
    try { await sessionSaver.pause();await storage.save(project, originals, sessionSnapshot(project));sessionSaver.reset(); }
    catch (error) { persistenceIssue = ` 一時保存は更新できませんでした：${error.message}`; }
  }
  notify(`作業ZIPのダウンロードを開始しました。保存先でファイルを確認してから、PCへ渡してください。${persistenceIssue}`, Boolean(persistenceIssue));
}

function beginCapture(recordId, slotName, source) {
  if (busy) return;
  if(pendingPhoto){notify('未保存の写真があります。再試行または写真取込の取消をしてから次の写真を選んでください。',true);return;}
  if(project.photos.length>=LIMITS.photos||project.photos.reduce((sum,photo)=>sum+photo.size,0)>=LIMITS.totalBytes){notify(`工事全体の上限（履歴込み${LIMITS.photos}枚・${formatByteLimit()}）に達しています。新しい撮影・写真選択は開始していません。必要な原本とZIPを保管してから整理してください。`,true);return;}
  if (source === 'camera' && !storage) { notify('現場でのカメラ撮影には一時保存が必要です。通常モードのブラウザーで開き直してください。「写真から選ぶ」はメモリ上で取り込めます。', true); return; }
  const context = getContext(project, recordId);
  const form = recordId===activeRecordId?$('boardForm'):null;
  if(!context.group){notify('撮影・写真選択の前に「管理名・所属を訂正」で路線名を設定してください。',true);return;}
  const draft=boardDrafts.get(recordId)||{board:context.record.boardDefaults,applyBoard:context.record.applyBoardDefault!==false,noteMode:recordNoteMode(context.target,context.record)};
  const resolved=resolveCaptureBoard(project,recordId,slotName,{board:recordId===activeRecordId&&form?readBoard(form):draft.board,noteMode:draft.noteMode});
  const screenshot=context.target.useCase==='TS出来形(バリアフリー)'&&slotName==='スマホスクリーンショット';
  const board=screenshot?null:resolved.board;
  const applyBoard = !screenshot && context.target.useCase !== 'MMS' && Boolean((recordId===activeRecordId?form?.elements.namedItem('applyBoard')?.checked:undefined) ?? draft.applyBoard);
  if (form && applyBoard && !form.checkValidity()) {form.closest('details').open=true;form.reportValidity();notify('黒板の未入力項目を確認してください。',true);return;}
  if (board && applyBoard) boardFits(board,{skipPoint:isTrial(context.target.useCase)});
  activeTargetId=context.target.id;activeRecordId=recordId;activeCaptureSlot=screenshot?context.record.slots[0].name:slotName;
  if(board){boardDrafts.set(recordId,{board,applyBoard,noteMode:resolved.noteMode});if(form){form.elements.namedItem('board-note').value=board.values.note;const caption=$('captureBoardSlot');if(caption)caption.textContent=`対象写真：${slotName}`;drawPreview();}}
  const defaults=context.record.workDateDefault;
  const workDate=defaults?.value || dateToday();
  pendingCapture={projectId:project.id,recordId,slot:slotName,board,defaultBoard:board,tsBoard:screenshot?resolved.board:null,applyBoard,noteMode:resolved.noteMode,workDate,workDateStatus:'unconfirmed',source:source==='camera'?'camera':'library',paste:source==='paste'};
  if(source==='paste'){
    openDialog('スマホスクリーンショットを貼り付け',`<div id="screenshotPasteArea" class="screenshot-paste-area" tabindex="0"><p>PCで画像をコピーして、この枠でCtrl+Vを押してください。</p><p class="hint">${esc(context.target.name)}の右側に保存します。画像を加工したり黒板を合成したりしません。</p></div>`,()=>{},'閉じる');
    $('screenshotPasteArea').focus();return;
  }
  const input=source==='camera'?$('cameraInput'):$('photoInput');input.value='';input.disabled=false;input.click();
}

async function receivePhoto(event) {
  const file = event.target.files?.[0];
  const capture = pendingCapture; pendingCapture = null;
  if (!file || !capture) return;
  pendingPhoto={file,capture};
  await retryPendingPhoto();
}
async function retryPendingPhoto(){
  if(!pendingPhoto)return;
  const {file,capture}=pendingPhoto;
  await run(()=>cancellable(async signal => {
    if (!project || capture.projectId !== project.id) throw new Error('撮影開始時と工事が変わっています。正しい記録対象から選び直してください。');
    if (project.photos.length >= LIMITS.photos || project.photos.reduce((n, p) => n + p.size, 0) + file.size > LIMITS.totalBytes) throw new Error(`工事全体の上限は履歴を含め${LIMITS.photos}枚・原本合計${formatByteLimit()}です。新しい写真は追加していません。`);
    showProgress('写真を検証し、一時保存しています…');
    const dimensions = await validateImage(file,{signal});
    const next = clone(project);
    let tsRead=null,tsEffect={keys:[],boardChanged:false};
    if(capture.slot==='スマホスクリーンショット'&&getContext(next,capture.recordId).target.useCase==='TS出来形(バリアフリー)'){
      if(!pendingPhoto.ocr){try{pendingPhoto.ocr=await readTSScreenshot(file,{signal,onProgress:showProgress});}catch(error){if(error.name==='AbortError')throw error;pendingPhoto.ocr={complete:false,values:{},missing:['X','Y','計測箇所'],message:error.message};}}
      tsRead=pendingPhoto.ocr;tsEffect=applyTSScreenshot(next,capture.recordId,tsRead,{board:capture.tsBoard});
    }
    if (capture.board) {
      const { record } = getContext(next, capture.recordId);
      record.boardDefaults = clone(capture.defaultBoard); record.applyBoardDefault = capture.applyBoard;record.boardNoteMode=capture.noteMode;
    }
    const photo = addPhoto(next, capture.recordId, capture.slot, { originalName: file.name, type: file.type, size: file.size, ...dimensions, board: capture.board, applyBoard: capture.applyBoard, workDate:capture.workDate,workDateStatus:capture.workDateStatus,captureSource:capture.source,boardNoteMode:capture.noteMode });
    const files = new Map(originals); files.set(photo.id, file);
    const usedDraft=JSON.stringify(boardDrafts.get(capture.recordId))===JSON.stringify({board:capture.defaultBoard,applyBoard:capture.applyBoard,noteMode:capture.noteMode});
    const clearReportKeys=tsEffect.keys.map(key=>`${capture.recordId}:${key}`);
    await persist(next, files, false, null, {clearBoardIds:usedDraft||tsEffect.boardChanged?[capture.recordId]:[],clearReportKeys});
    project = next; originals = files; dirty = true;invalidateOutput();
    if (JSON.stringify(boardDrafts.get(capture.recordId)) === JSON.stringify({ board: capture.defaultBoard, applyBoard: capture.applyBoard,noteMode:capture.noteMode })) boardDrafts.delete(capture.recordId);
    if(tsEffect.boardChanged)boardDrafts.delete(capture.recordId);clearReportKeys.forEach(key=>reportDrafts.delete(key));
    const { target, record } = getContext(project, capture.recordId);
    pendingPhoto=null;
    notify(`${target.name} ／ ${record.category} ／ ${capture.slot} を${storage ? 'この端末へ保存' : '取り込み'}しました。${tsRead?(tsRead.complete?'計測箇所・X・Yを調書と黒板へ反映しました。出力前に読み取り結果を確認してください。':`読取未完了：${tsRead.missing.join('・')}。読めた項目だけ反映しました。調書で確認・入力してください。${tsRead.message||''}`):'原本は加工していません。'}`,Boolean(tsRead&&!tsRead.complete));
  }));
}

function emptyView(){return renderInitialView({name:initialProjectName,routeName:initialRouteName,maxPhotos:LIMITS.photos,limitLabel:formatBytes(LIMITS.totalBytes)});}
function projectHeader(){
  const groups=[['__all__','全路線'],...(project.targets.some(t=>!t.groupId)?[['','路線未設定（旧データ）']]:[]),...project.groups.map(g=>[g.id,g.name])].map(([id,label])=>({id,label,count:project.targets.filter(t=>id==='__all__'||t.groupId===(id||null)).length}));
  const models=project.targets.filter(t=>activeGroupId==='__all__'||t.groupId===(activeGroupId||null)).map(t=>{const slots=t.records.flatMap(r=>r.slots);return {id:t.id,useCase:t.useCase,taken:slots.filter(s=>s.status==='taken').length,required:slots.filter(s=>s.status!=='unnecessary').length,complete:slots.length>0&&slots.every(s=>['taken','unnecessary'].includes(s.status))};});
  return renderProjectHeader({name:project.name,storageAvailable:Boolean(storage),zipDirty:dirty,mode,groups,activeGroupId,progressHTML:mode==='field'?renderTargetTabs(models,activeTargetId):''});
}
function captureView({group,target,record,visible}){
  const summary=activeGroupId==='__all__'?summarize(project):summarize(project,activeGroupId||null);
  const allTargetModels=project.targets.filter(t=>activeGroupId==='__all__'||t.groupId===(activeGroupId||null)).map(t=>{const slots=t.records.flatMap(r=>r.slots),required=slots.filter(slot=>slot.status!=='unnecessary').length,taken=slots.filter(slot=>slot.status==='taken').length;return {id:t.id,name:t.name,useCase:t.useCase,recordCount:t.records.length,taken,required,complete:slots.length>0&&slots.every(slot=>['taken','unnecessary'].includes(slot.status))};});
  const targetModels=allTargetModels.filter(t=>visible.some(v=>v.id===t.id));
  const picker=renderTargetPicker({targets:targetModels,selectedId:target?.id,selectedName:target?.name,useCaseFilter,onlyMissing,uses:Object.keys(USE_CASES),selectedIds:selectedTargetIds,open:matchMedia('(min-width: 761px)').matches});
  let selected,board='';
  if(record){
    const def=USE_CASES[target.useCase],remaining=def.categories.filter(c=>!target.records.some(r=>r.category===c));
    const tabs=record=>tabBar(target.records.map(r=>tabButton(`${def.categoryLabel}：${r.category}`,{selected:r.id===record.id,attrs:{'data-record':r.id}})).join('')+(remaining.length?button(`＋ ${def.categoryLabel}の記録を追加`,{className:'add-record',attrs:{'data-action':'add-record'}}):''),{label:def.categoryLabel,className:'record-tabs'});
    selected=`<section class="panel"><span class="eyebrow">${esc(def.targetLabel)} / ${esc(target.useCase)}</span><div class="active-target-title${nameDrafts.has(target.id)?' is-editing':''}">${inlineTargetName(target)}${renderTargetNavigation(visible,target.id)}${badge(target.useCase)}${button('管理名・所属を訂正',{variant:'subtle',attrs:{'data-edit-target':target.id}})}</div><p class="hint">${esc(locationLabel(group))} ／ ${esc(def.categoryLabel)}：${esc(record.category)}</p><p class="hint">分類の区分を確認してから、写真の種類を選んでください。</p>${tabs(record)}${target.useCase==='TS出来形(バリアフリー)'?renderTSReading(record):''}${nextDatePanel(record)}<div class="slot-list">${record.slots.map(slot=>slotHTML(record,slot)).join('')}</div></section>`;
    if(target.useCase==='MMS')board='<section class="panel"><p class="hint">MMSは作業の前・後の写真を原本のまま記録します。黒板・座標・施工区間・調書入力は不要です。</p></section>';
    else{const draft=boardDraft(record);board=renderBoardPanel({recordId:record.id,slotName:activeCaptureSlot,fieldsHTML:boardFields(draft.board,draft.applyBoard,false,{omitPoint:isTrial(target.useCase),fixedTS:target.useCase==='TS出来形(バリアフリー)'}),choicesHTML:renderBoardChoices(draft.board.templateId,{formId:'boardForm'}),trial:isTrial(target.useCase),noteAuto:draft.noteMode==='auto',applyBoard:draft.applyBoard,editing:boardDrafts.has(record.id)});}
  }else selected=emptyState('記録対象を追加','路線を設定し、用途と管理名を指定して始めます。施工区間は任意です。',{actions:button('記録対象を追加',{variant:'primary',attrs:{'data-action':'add-targets'}})});
  return `${renderCaptureProgress(summary)}<div class="capture-layout">${picker}<div class="capture-main">${selected}${board}</div></div>${record?historyPanel(record.id):''}`;
}
function slotHTML(record,slot){
  const photo=getSlotState(project,record.id,slot.name).photo,def=USE_CASES[getContext(project,record.id).target.useCase];
  return renderPhotoSlot({name:slot.name,status:slot.status,statusLabel:statuses[slot.status],guide:def.guides[def.slots.indexOf(slot.name)],photo:photo?{id:photo.id,name:photo.originalName,sizeLabel:bytesLabel(photo.size)}:null,count:slot.photoIds.length,reason:slot.reason,recordId:record.id,boardAvailable:Boolean(def.defaultBoardTemplate)&&slot.name!=='スマホスクリーンショット',screenshot:slot.name==='スマホスクリーンショット'});
}
function historyPanel(recordId=null){
  const photos=project.photos.filter(p=>!recordId||p.recordId===recordId).slice().sort((a,b)=>b.importedAt.localeCompare(a.importedAt)).map(p=>({id:p.id,name:p.originalName,slot:p.slot,dateLabel:workDateLabel(p),active:Boolean(p.recordId&&getSlotState(project,p.recordId,p.slot).photo?.id===p.id)}));
  return renderHistoryPanel({photos,recordId});
}
function handoffView(){
  const counts=summarize(project),bytes=project.photos.reduce((n,p)=>n+p.size,0);
  return renderHandoff({targetCount:project.targets.length,photoCount:project.photos.length,sizeValue:formatBytes(bytes).split(' ')[0],sizeUnit:formatBytes(bytes).split(' ')[1],lastExportLabel:lastExportAt?`${lastExportAt.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}にダウンロード開始。保存先でファイルを確認してください。`:'',missing:counts.missing,unnecessary:counts.unnecessary,maxPhotos:LIMITS.photos,limitLabel:formatBytes(LIMITS.totalBytes)});
}

function drawPreview() {
  const canvas = $('boardPreview');
  const form = $('boardForm');
  if (!canvas || !form) return;
  const board = readBoard(form);
  canvas.height = Math.round(canvas.width / boardAspectRatio(board));
  let result;
  try { result = drawBoard(canvas.getContext('2d'), 0, 0, canvas.width, canvas.height, board); }
  catch (error) { $('boardOverflow').textContent = error.message; return; }
  $('boardOverflow').textContent = result?.overflow ? `文字が収まりません：${result.overflowFields.join('、')}` : '';
}

let thumbnailWalk=null,thumbnailRerun=false;
async function populateThumbnails(token) {
  if(thumbnailWalk){thumbnailRerun=true;return;}
  thumbnailWalk=walkThumbnails(token);
  try{await thumbnailWalk;}finally{thumbnailWalk=null;if(thumbnailRerun){thumbnailRerun=false;void populateThumbnails(renderToken);}}
}
async function walkThumbnails(token) {
  const images = [...document.querySelectorAll('[data-thumb]')];
  for (const element of images) {
    if(token!==renderToken||busy)return;
    if(!thumbnailIsVisible(element)||element.getAttribute('src'))continue;
    const id = element.dataset.thumb;
    if (!originals.has(id)) continue;
    try {
      if (!thumbnails.has(id)) thumbnails.set(id, createThumbnail(originals.get(id)));
      const blob = await thumbnails.get(id);
      if (token !== renderToken) return;
      if (!thumbnailURLs.has(id)) thumbnailURLs.set(id, URL.createObjectURL(blob));
      element.src = thumbnailURLs.get(id);
    } catch { if (token === renderToken) element.alt = '写真を表示できません。原本を確認してください。'; }
  }
}

function render() {
  const position=viewPosition.capture(renderedViewKey);
  const targetScroll=$('targetPicker')?.scrollTop||0;
  const targetListScroll=document.querySelector('#targetPicker .target-list')?.scrollTop||0;
  const focused=document.activeElement;
  const filterKey=focused?.dataset?.organizeFilter;
  const nameKey=focused?.dataset?.nameDraft;
  const focusId=focused?.id;
  const selectedPhotoKey=focused?.dataset?.selectPhoto;
  const outputRecordKey=focused?.dataset?.outputRecord;
  const caret=focused?.selectionStart;
  document.querySelectorAll('[data-disclosure]').forEach(el=>disclosureState.set(el.dataset.disclosure,el.open));
  document.body.classList.toggle('has-project',Boolean(project));
  const token = ++renderToken;
  if (!project) $('app').innerHTML = emptyView();
  else {
    const selected = selection();
    if(mode==='output'&&!outputState.initialized)resetOutputSelection();
    if(mode==='report'){const uses=[...new Set(scopedRecords(project,activeGroupId).map(c=>c.target.useCase))];if(!uses.includes(reportUseCase)&&uses.length)reportUseCase=uses[0];}
    const view=mode==='field'?captureView(selected):mode==='organize'?organizeView():mode==='report'?renderReportView(project,{groupId:activeGroupId,useCase:reportUseCase,drafts:reportDrafts}):mode==='output'?renderOutputView(project,outputState):handoffView();
    $('app').innerHTML = projectHeader()+view+capacityPanel();
    if(typeof ResizeObserver==='function'){navigationObserver?.disconnect();const nav=document.querySelector('.workspace-sticky-nav');if(nav){navigationObserver=new ResizeObserver(()=>document.documentElement.style.setProperty('--workspace-nav-height',`${nav.getBoundingClientRect().height}px`));navigationObserver.observe(nav);}}

    drawPreview();
    attachOutputPreview();
  }
  renderPhotoDrawer();
  document.querySelectorAll('#app [data-disclosure],#photoDrawer [data-disclosure]').forEach(el=>{if(disclosureState.has(el.dataset.disclosure))el.open=disclosureState.get(el.dataset.disclosure);});
  if($('targetPicker'))$('targetPicker').scrollTop=targetScroll;
  const targetList=document.querySelector('#targetPicker .target-list');if(targetList)targetList.scrollTop=targetListScroll;
  document.querySelectorAll('[data-indeterminate]').forEach(el=>{el.indeterminate=el.dataset.indeterminate==='true';});
  updateDisabled();
  floating.prepare();renderedViewKey=viewKey();viewPosition.restore(position,renderedViewKey);floating.sync();
  populateThumbnails(token);
  const restore=filterKey?document.querySelector(`[data-organize-filter="${filterKey}"]`):nameKey?document.querySelector(`[data-name-draft="${nameKey}"]`):selectedPhotoKey?document.querySelector(`[data-select-photo="${CSS.escape(selectedPhotoKey)}"]`):outputRecordKey?document.querySelector(`[data-output-record="${CSS.escape(outputRecordKey)}"]`):focusId?$(focusId):null;
  if(restore){restore.focus({preventScroll:true});if(typeof caret==='number'&&restore.setSelectionRange)restore.setSelectionRange(caret,caret);}
  renderDraftNotice();
  renderResumeStatus();scheduleSessionSave();
}

function renderDraftNotice(){
  const photoActions=pendingPhoto?button('写真の保存を再試行',{attrs:{'data-action':'retry-photo'}})+button('写真取込を取消',{attrs:{'data-action':'discard-photo'}}):'';
  const draftActions=photoActions+(nameDrafts.size?button('管理名の保存・取消',{attrs:{'data-action':'resolve-names'}}):'')+(pendingPaste?button('貼り付けの下書きを再開',{attrs:{'data-action':'resume-paste'}})+button('貼り付けを取消',{attrs:{'data-action':'discard-paste'}}):'');
  feedback.setDraftNotice({visible:Boolean(draftActions),text:pendingPhoto?'写真取込を画面内に保持中（再読込時は選び直し）':`未確定の下書き ${draftCounts()}件`,actionsHTML:draftActions});
}

function organizeView(){
  organizeState.groupId=activeGroupId;
  const targets=project.targets.filter(t=>(activeGroupId==='__all__'||t.groupId===(activeGroupId||null))&&(!organizeState.useCase||t.useCase===organizeState.useCase));
  return renderOrganizeView({project,state:organizeState,esc,bytesLabel,workDateLabel,locationLabel})+disclosure(`記録対象の管理名・所属 ${targets.length}件`,targets.map(t=>`<div class="organize-target">${inlineTargetName(t)}<span class="hint">${esc(t.useCase)} ／ ${esc(locationLabel(project.groups.find(g=>g.id===t.groupId)))}</span>${button('所属も訂正',{attrs:{'data-edit-target':t.id}})}</div>`).join(''),{className:'panel organize-targets',saveKey:'organize-targets'});
}

function finishNameEdit(id){
  nameDrafts.delete(id);disclosureState.set(`name-${id}`,false);
  const editor=document.querySelector(`[data-name-editor="${CSS.escape(id)}"]`);if(editor)editor.open=false;
}

function inlineTargetName(target){return inlineName({id:target.id,name:target.name,draft:nameDrafts.get(target.id),editing:nameDrafts.has(target.id),floating:mode==='field'});}

function closePhotoDrawer() {
  drawerPhotoId='';
  if($('photoDrawer')?.open)$('photoDrawer').close();
  if(drawerImageURL)URL.revokeObjectURL(drawerImageURL);
  drawerImageURL=null;drawerImagePhotoId='';
  if(drawerReturnId){const trigger=document.querySelector(`[data-open-photo="${CSS.escape(drawerReturnId)}"]`);(trigger?.matches('button')?trigger:trigger?.querySelector('button'))?.focus({preventScroll:true});}
}

function openPhotoDrawer(id) {
  floating.close();
  if(!project.photos.some(photo=>photo.id===id))return;
  if(drawerPhotoId!==id)$('photoDrawerBody').scrollTop=0;
  drawerReturnId=id;drawerPhotoId=id;organizeState.activePhotoId=id;renderPhotoDrawer();
  if(!$('photoDrawer').open)$('photoDrawer').showModal();
  floating.sync();
}

function renderPhotoDrawer() {
  if(!drawerPhotoId)return;
  const photo=project?.photos.find(p=>p.id===drawerPhotoId);
  if(!photo){closePhotoDrawer();return;}
  const context=photo.recordId?getContext(project,photo.recordId):null;
  const active=context&&getSlotState(project,photo.recordId,photo.slot).photo?.id===photo.id;
  const related=(context?project.photos.filter(p=>p.recordId===photo.recordId&&p.slot===photo.slot):[photo]).slice().sort((a,b)=>b.importedAt.localeCompare(a.importedAt));
  const body=$('photoDrawerBody'),scroll=body.scrollTop;
  const title=`${context?.target.name||photo.originalName} ／ ${photo.slot||'未分類'}`;
  const subtitle=locationLabel(context?.group)+(context?` ／ ${context.target.useCase} ／ ${context.record.category}`:'');
  const dateSection=detailSection('作業日',photoDateDetails(photo),{actionHTML:button('確認・訂正',{attrs:{'data-edit-date':photo.id}})});
  const assignment=detailSection('所属・写真の種類',`<p class="hint">${esc(context?contextText({...context,slot:{name:photo.slot}}):'分類待ち')}</p>${context?button('この記録の撮影・確認へ',{attrs:{'data-go-record':photo.recordId}}):''}`,{actionHTML:button('訂正',{attrs:{'data-move-photo':photo.id}})});
  const boardSection=(photo.board||context&&context.target.useCase!=='MMS')&&!(context?.target.useCase==='TS出来形(バリアフリー)'&&photo.slot==='スマホスクリーンショット')?disclosure(`この写真の黒板・合成 ${photo.applyBoard?'あり':'なし'}`,(photo.board?button('<canvas id="detailBoard" width="600" class="board-canvas" aria-label="保存された黒板"></canvas>',{html:true,className:'preview-trigger',attrs:{'data-preview-canvas':'detailBoard','aria-label':'保存された黒板を拡大'}}):'<p class="hint">この写真には黒板データがありません。必要ならこの写真だけに追加できます。</p>')+`<p class="details-text">${esc(boardDescription(photo.board)).replaceAll('\n','<br>')}</p>`+(context?.target.useCase!=='MMS'?actions(button('この写真の黒板を修正',{attrs:{'data-edit-photo':photo.id}})+button('合成画像を拡大',{attrs:{'data-preview-composed':photo.id}})+button('合成画像を保存',{attrs:{'data-composed':photo.id}})):''),{className:'detail-section',saveKey:'drawer-board'}):'';
  const history=disclosure(`同じ撮影枠の写真履歴 ${related.length}枚`,photoTimeline(related.map(p=>({id:p.id,name:p.originalName,active:Boolean(context&&getSlotState(project,p.recordId,p.slot).photo?.id===p.id),current:p.id===photo.id,importedLabel:timestampLabel(p.importedAt),dateLabel:workDateLabel(p)})))+(context&&!active?button('表示中の写真を採用',{attrs:{'data-adopt':photo.id}}):''),{className:'detail-section',saveKey:'drawer-history'});
  const original=disclosure('原本情報・保存・削除',metaList([['原本名',photo.originalName],['容量・寸法',`${bytesLabel(photo.size)}・${photo.width} × ${photo.height}px`],['写真ID',photo.id]])+actions((context?button('写真を選び直す（旧写真は履歴に保持）',{attrs:{'data-replace-photo':photo.id}}):'')+button('元写真を保存',{attrs:{'data-original':photo.id}})+button('この写真を削除',{variant:'danger',attrs:{'data-delete-photo':photo.id}}))+'<p class="hint">削除は影響確認後に実行します。再撮影や要撮り直しとは別の操作です。</p>',{className:'detail-section',saveKey:'drawer-original'});
  const browse=mode==='organize'?filterPhotos(project,organizeState):project.photos.filter(p=>p.recordId===photo.recordId),at=browse.findIndex(p=>p.id===photo.id);
  body.innerHTML=(at>=0?photoPagination({previousId:browse[at-1]?.id,nextId:browse[at+1]?.id,index:at,total:browse.length}):'')+detailHero({photoId:photo.id,title,subtitle,status:active?'採用中':context?'履歴':'分類待ち',tone:active?'success':'muted'})+dateSection+assignment+boardSection+(photo.boardRevisions?.length?disclosure(`黒板の訂正履歴 ${photo.boardRevisions.length}件`,photo.boardRevisions.map(revision=>`<p>${esc(timestampLabel(revision.changedAt))}</p><pre>${esc(boardDescription(revision.board))}</pre>`).join(''),{className:'detail-section',saveKey:'drawer-board-revisions'}):'')+history+original;
  if(drawerImagePhotoId!==photo.id){if(drawerImageURL)URL.revokeObjectURL(drawerImageURL);drawerImageURL=URL.createObjectURL(originals.get(photo.id));drawerImagePhotoId=photo.id;}
  $('detailOriginal').src=drawerImageURL;
  if(photo.board){const c=$('detailBoard');c.height=Math.round(c.width/boardAspectRatio(photo.board));drawBoard(c.getContext('2d'),0,0,c.width,c.height,photo.board);}
  body.querySelectorAll('[data-disclosure]').forEach(el=>{const key=el.dataset.disclosure;if(disclosureState.has(key))el.open=disclosureState.get(key);});
  body.scrollTop=scroll;
}

previewViewer=createPreviewViewer({onDocumentMove:frame=>{outputState.ready=false;observeOutputFrame(frame,outputState.prepared);updateDisabled();}});

$('newProject').onclick = newProjectDialog;
$('openPackage').onclick = () => { $('workMenu').open=false;$('packageInput').value = ''; $('packageInput').click(); };
$('exportPackage').onclick = () => run(savePackage);
$('cancelOperation').onclick=()=>{if(activeOperation){activeOperation.abort();$('cancelOperation').disabled=true;showProgress('取消処理をしています…');}};
$('closeDialog').onclick = $('cancelDialog').onclick = () => $('editorDialog').close();
$('editorDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('editorDialog').addEventListener('close',()=>{if(pendingCapture?.paste)pendingCapture=null;});
$('editorForm').onsubmit = async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const revision=modalRevision;
  if (await run(() => modalSubmit(data)) && revision===modalRevision) $('editorDialog').close();
};
$('cameraInput').onchange = receivePhoto;
$('photoInput').onchange = receivePhoto;
$('packageInput').onchange = event => {
  const file = event.target.files?.[0];
  if (file) run(async () => { showProgress('作業ZIPと元写真を検証しています…'); showImportReview(await cancellable(signal=>importWorkPackage(file, { onProgress: showProgress, validateImage,signal }))); });
};
$('app').addEventListener('input', event => {
  if(event.target.id==='initialProjectName'){initialProjectName=event.target.value;return;}
  if(!project&&event.target.name==='routeName'){initialRouteName=event.target.value;return;}
  if(event.target.dataset.nameDraft){nameDrafts.set(event.target.dataset.nameDraft,event.target.value);dirty=true;invalidateOutput();return;}
  if(event.target.dataset.organizeFilter==='query'){organizeState.query=event.target.value;organizeState.selectedIds.clear();if(!event.isComposing)render();return;}
  if(event.target.dataset.reportKey){
    const input=event.target,key=`${input.dataset.recordId}:${input.dataset.reportKey}`;
    reportDrafts.set(key,input.value);dirty=true;invalidateOutput();
    const counter=document.querySelector(`[data-report-counter="${key}"]`);if(counter){counter.textContent=`${input.value.length}/300文字`;counter.className=input.value.length>300?'report-counter-error':'';}
    input.setAttribute('aria-invalid',String(input.value.length>300));
    if(input.value.length>300)notify('調書は各セル300文字までです。入力は切り捨てず画面に残しています。短くしてから保存してください。',true);
    const status=$('reportEditStatus');if(status)status.textContent='編集中です。保存・入力確認・ZIP保存時に確定します。';
    const discard=document.querySelector('[data-action="discard-reports"]');if(discard){discard.dataset.unavailable='false';discard.disabled=busy;}
    return;
  }
  const form = event.target.closest('#boardForm');
  if (!form) return;
  if(event.target.name==='autoNote')return;
  const {target,record}=getContext(project,activeRecordId);
  let noteMode=boardDrafts.get(activeRecordId)?.noteMode||recordNoteMode(target,record);
  if(event.target.name==='board-note'&&isTrial(target.useCase)){noteMode='manual';if(form.elements.autoNote)form.elements.autoNote.checked=false;}
  boardDrafts.set(activeRecordId, { board: readBoard(form), applyBoard: form.elements.applyBoard.checked,noteMode });
  dirty = true;invalidateOutput();
  drawPreview();
  const status = $('boardDraftStatus');
  if (status) status.textContent = '黒板は編集中です。撮影・黒板保存・ZIP保存時に確定します。';
});
$('app').addEventListener('compositionend',event=>{if(event.target.dataset.organizeFilter==='query'){organizeState.query=event.target.value;organizeState.selectedIds.clear();render();}});
$('app').addEventListener('submit', event => {
  if(event.target.id==='initialProjectForm'){
    event.preventDefault();if(busy||project)return;
    const name=event.target.elements.name.value;initialProjectName=name;
    const routeName=event.target.elements.routeName.value;initialRouteName=routeName;
    return run(()=>startNewProject(name,routeName)).then(success=>{if(!success&&!project)$('initialProjectName')?.focus({preventScroll:true});});
  }
  if(event.target.dataset.inlineTarget){
    event.preventDefault();const id=event.target.dataset.inlineTarget,value=event.target.elements.name.value;
    run(async()=>{const t=project.targets.find(t=>t.id===id);await mutate(next=>updateTarget(next,id,{name:value,groupId:t.groupId}),'管理名を保存し、調書と採用写真・次回用黒板へ反映しました。',{clearNames:[id]});finishNameEdit(id);});return;
  }
  if (event.target.id !== 'boardForm') return;
  event.preventDefault();
  const board = readBoard(event.target);
  const recordId = activeRecordId;
  const applyBoard = event.target.elements.applyBoard.checked;
  const {target,record}=getContext(project,recordId);
  const noteMode=boardDrafts.get(recordId)?.noteMode||recordNoteMode(target,record);
  run(async () => {
    if (applyBoard) boardFits(board,{skipPoint:isTrial(target.useCase)});
    await mutate(next => { const { record } = getContext(next, recordId); saveRecordBoard(next,recordId,board,{applyBoard,noteMode}); }, '黒板と対応する調書欄・採用写真を更新しました。原本と訂正履歴は保持しています。',{clearBoardIds:[recordId]});
    boardDrafts.delete(recordId);
  });
});
$('app').addEventListener('change', event => {
  if (busy) return;
  if(event.target.dataset.selectTarget){event.target.checked?selectedTargetIds.add(event.target.dataset.selectTarget):selectedTargetIds.delete(event.target.dataset.selectTarget);render();return;}
  if(event.target.dataset.organizeFilter&&event.target.dataset.organizeFilter!=='query'){const key=event.target.dataset.organizeFilter;organizeState[key]=event.target.type==='checkbox'?event.target.checked:event.target.value;if(key==='groupId')activeGroupId=event.target.value;if(key==='useCase'){organizeState.category='';organizeState.slot='';}organizeState.selectedIds.clear();render();return;}
  if(event.target.dataset.selectPhoto){if(event.target.checked)organizeState.selectedIds.add(event.target.dataset.selectPhoto);else organizeState.selectedIds.delete(event.target.dataset.selectPhoto);render();return;}
  if(event.target.id==='selectVisiblePhotos'){const ids=filterPhotos(project,organizeState).map(p=>p.id);ids.forEach(id=>event.target.checked?organizeState.selectedIds.add(id):organizeState.selectedIds.delete(id));render();return;}
  if (event.target.closest('#boardForm') && ['templateId','applyBoard','autoNote'].includes(event.target.name)) {
    const form = event.target.closest('#boardForm');
    const {target,record}=getContext(project,activeRecordId);
    const noteMode=event.target.name==='autoNote'?(event.target.checked?'auto':'manual'):(boardDrafts.get(activeRecordId)?.noteMode||recordNoteMode(target,record));
    boardDrafts.set(activeRecordId, {...resolveCaptureBoard(project,activeRecordId,activeCaptureSlot,{board:readBoard(form),noteMode}),applyBoard:form.elements.applyBoard.checked}); dirty = true;invalidateOutput(); render(); return;
  }
  if (event.target.id === 'groupSelect') { activeGroupId = event.target.value; activeTargetId = ''; activeRecordId = '';activeCaptureSlot=''; useCaseFilter = ''; render(); }
  if (event.target.id === 'useCaseFilter') { useCaseFilter = event.target.value; activeTargetId = ''; activeRecordId = ''; render(); }
  if(event.target.id==='onlyMissing'){onlyMissing=event.target.checked;render();}
  if(event.target.id==='outputGroup'){outputState.groupId=event.target.value;resetOutputSelection();render();}
  if(event.target.id==='outputUse'){outputState.useCase=event.target.value;resetOutputSelection();render();}
  if(event.target.id==='outputEdition'){outputState.edition=event.target.value;invalidateOutput();render();}
  if(event.target.dataset.outputRecord){if(event.target.checked)outputState.selectedIds.add(event.target.dataset.outputRecord);else outputState.selectedIds.delete(event.target.dataset.outputRecord);invalidateOutput();render();}
  if(event.target.id==='outputApproved'){outputState.approved=event.target.checked;const button=$('printOutput');if(button){button.dataset.unavailable=String(!outputState.ready||!outputState.approved);updateDisabled();}}
});
$('app').addEventListener('paste',event=>{
  const input=event.target.closest('[data-report-key]');if(!input)return;
  const text=event.clipboardData?.getData('text/plain')||'';
  if(!/[\t\r\n]/.test(text)&&text.length<=300)return;
  event.preventDefault();
  run(async()=>{
    const rows=scopedRecords(project,activeGroupId,reportUseCase),keys=visibleReportColumns(reportUseCase).map(c=>c.key);
    const settings={recordIds:rows.map(c=>c.record.id),keys,startRow:Number(input.dataset.reportRow),startCol:Number(input.dataset.reportCol),text};
    try{showPastePreview(settings);}catch(error){pasteTextDialog(settings,text,error.message);}
  });
});
document.addEventListener('paste',event=>{
  if(busy||!event.target.closest('#screenshotPasteArea'))return;
  const file=[...(event.clipboardData?.items||[])].find(item=>item.kind==='file'&&item.type.startsWith('image/'))?.getAsFile();
  if(!file)return;
  event.preventDefault();
  const image=new File([file],`${activeTargetId||'TS'}_スクリーンショット.png`,{type:file.type||'image/png'});
  void receivePhoto({target:{files:[image]}}).then(()=>{if(!pendingPhoto)$('editorDialog').close();});
});
function handleWorkspaceClick(event) {
  const button = event.target.closest('button');
  const photoRow=event.target.closest('tr[data-open-photo]');
  if(!busy&&button?.dataset.previewPhoto){openImagePreview(button.dataset.previewPhoto,false,button);return;}
  if(photoRow&&!button?.dataset.editPhoto&&!button?.dataset.replacePhoto&&!event.target.closest('input,label.checkbox')&&!busy){openPhotoDrawer(photoRow.dataset.openPhoto);return;}
  if (!button || busy) return;
  try {
    if(button.dataset.previewComposed){openImagePreview(button.dataset.previewComposed,true,button);return;}
    if(button.dataset.previewCanvas){openCanvasPreview(button.dataset.previewCanvas,button);return;}
    if(button.dataset.deleteTarget){targetDeleteDialog([button.dataset.deleteTarget]);return;}
    if(button.dataset.navigateTarget){navigateTarget(button.dataset.navigateTarget,button.dataset.targetDirection);return;}
    if(button.dataset.useCaseTab){mode='field';useCaseFilter=button.dataset.useCaseTab;onlyMissing=false;activeTargetId='';activeRecordId='';activeCaptureSlot='';render();return;}
    if(button.dataset.action==='select-all-targets'){selection().visible.forEach(t=>selectedTargetIds.add(t.id));render();return;}
    if(button.dataset.action==='clear-target-selection'){selectedTargetIds.clear();render();return;}
    if(button.dataset.action==='delete-selected-targets'){targetDeleteDialog([...selectedTargetIds]);return;}
    if(button.dataset.routeSection){routeSectionDialog(button.dataset.routeSection);return;}
    if(button.dataset.pasteScreenshot){beginCapture(button.dataset.pasteScreenshot,'スマホスクリーンショット','paste');return;}
    if(button.dataset.action==='enlarge-output'){openDocumentPreview($('outputPreview'),button);return;}
    if(button.dataset.openPhoto){openPhotoDrawer(button.dataset.openPhoto);return;}
    if(button.dataset.groupScope!==undefined){activeGroupId=button.dataset.groupScope;activeTargetId='';activeRecordId='';organizeState.selectedIds.clear();render();return;}
    if(button.dataset.goRecord){const c=getContext(project,button.dataset.goRecord);closePhotoDrawer();activeGroupId='__all__';useCaseFilter='';onlyMissing=false;activeTargetId=c.target.id;activeRecordId=c.record.id;enterMode('field');return;}
    if(button.dataset.goReport){const c=getContext(project,button.dataset.goReport);closePhotoDrawer();activeGroupId=c.target.groupId||'';reportUseCase=c.target.useCase;run(async()=>{await flushBoardDrafts(true);await flushReportDrafts(true);enterMode('report');});return;}
    if(button.dataset.startName){const t=project.targets.find(t=>t.id===button.dataset.startName);nameDrafts.set(t.id,t.name);render();document.querySelector(`[data-name-draft="${t.id}"]`)?.focus({preventScroll:true});return;}
    if(button.dataset.cancelName){finishNameEdit(button.dataset.cancelName);render();return;}
    if(button.id==='clearPhotoSelection'){organizeState.selectedIds.clear();render();return;}
    if(button.id==='reviewSelectedDates'){const ids=filterPhotos(project,organizeState).filter(p=>organizeState.selectedIds.has(p.id)).map(p=>p.id);reviewDatesDialog(ids);return;}
    if(button.dataset.organizeView){const groupId=activeGroupId;organizeState=createOrganizeState();organizeState.groupId=groupId;const v=button.dataset.organizeView;if(v==='missing')organizeState.onlyMissing=true;if(v==='unconfirmed')organizeState.dateStatus='needs-confirmation';if(v==='stale')organizeState.reportStatus='stale';render();return;}
    if(button.dataset.action==='retry-photo'){void retryPendingPhoto();return;}
    if(button.dataset.action==='discard-photo'){pendingPhoto=null;$('photoInput').value='';$('cameraInput').value='';renderDraftNotice();notify('未保存の写真取込を取り消しました。保存済みの作業は変更していません。');return;}
    if(button.dataset.action==='resolve-names'){const id=nameDrafts.keys().next().value;if(!id)return;activeGroupId='__all__';useCaseFilter='';onlyMissing=false;activeTargetId=id;activeRecordId='';mode='field';render();const editor=document.querySelector(`[data-name-editor="${CSS.escape(id)}"]`);floating.open(editor,{anchor:document.querySelector('#draftNotice [data-action="resolve-names"]')||button});editor?.querySelector('[data-name-draft]')?.focus({preventScroll:true});return;}
    if(button.dataset.action==='discard-reports'){const ids=new Set(scopedRecords(project,activeGroupId,reportUseCase).map(c=>c.record.id));for(const key of reportDrafts.keys())if(ids.has(key.slice(0,key.indexOf(':'))))reportDrafts.delete(key);render();notify('表示範囲の保存前の調書編集を取り消しました。別の範囲の下書きは保持しています。');return;}
    if (button.dataset.action === 'new') { newProjectDialog(); return; }
    if (button.dataset.action === 'open') { $('openPackage').click(); return; }
    if (button.dataset.action === 'export') { run(savePackage); return; }
    if (button.dataset.action === 'add-group') { newGroupDialog(); return; }
    if (button.dataset.action === 'add-targets') { addTargetsDialog(); return; }
    if (button.dataset.action === 'add-record') { addRecordDialog(); return; }
    if(button.dataset.action==='rename-project'){renameProjectDialog();return;}
    if(button.dataset.editGroup){renameGroupDialog(button.dataset.editGroup);return;}
    if(button.dataset.editTarget){editTargetDialog(button.dataset.editTarget);return;}
    if(button.dataset.editDate){photoDateDialog(button.dataset.editDate);return;}
    if(button.dataset.nextDate){nextWorkDateDialog(button.dataset.nextDate);return;}
    if(button.dataset.action==='report-settings'){reportSettingsDialog();return;}
    if(button.dataset.action==='review-dates'){reviewDatesDialog();return;}
    if(button.dataset.movePhoto){photoMoveDialog(button.dataset.movePhoto);return;}
    if(button.dataset.deletePhoto){photoDeleteDialog(button.dataset.deletePhoto);return;}
    if(button.dataset.action==='finish-work'){finishWorkDialog();return;}
    if(button.dataset.action==='save-reports'){run(()=>flushReportDrafts(true));return;}
    if(button.dataset.action==='resume-paste'&&pendingPaste){pasteTextDialog({...pendingPaste.settings,text:pendingPaste.text},pendingPaste.text);return;}
    if(button.dataset.action==='discard-paste'){pendingPaste=null;render();return;}
    if(button.dataset.action==='discard-board'){boardDrafts.delete(activeRecordId);render();notify('この記録の黒板の下書きを取り消しました。撮影済み写真の黒板は保持しています。');return;}
    if(button.dataset.action==='review-reports'||button.dataset.reviewRecord){run(async()=>{await flushReportDrafts(true);const ids=button.dataset.reviewRecord?[button.dataset.reviewRecord]:scopedRecords(project,activeGroupId,reportUseCase).map(c=>c.record.id);await mutate(next=>ids.forEach(id=>reviewReport(next,id)),'調書を入力確認済みにしました。撮影完了とは別の状態です。');});return;}
    if(button.dataset.sectionRecord){const c=getContext(project,button.dataset.sectionRecord);routeSectionDialog(c.target.groupId);return;}
    if(button.dataset.reportUse){reportUseCase=button.dataset.reportUse;render();return;}
    if(button.dataset.action==='output-all'){resetOutputSelection();render();return;}
    if(button.dataset.action==='output-none'){outputState.selectedIds.clear();invalidateOutput();render();return;}
    if(button.dataset.action==='export-photos'){
      requireSavedNames();
      const picker=window.showDirectoryPicker?window.showDirectoryPicker({mode:'readwrite'}):Promise.resolve(null);
      void picker.then(directory=>run(async()=>{
        await flushBoardDrafts();
        const result=await cancellable(signal=>exportPhotos(project,originals,selectedOutputIds(),{directory,signal,onProgress:showProgress}));
        if(result.blob)download(result.blob,`${project.name}_写真.zip`);
        notify(`${result.count}枚の写真を${directory?'選択フォルダーに保存しました。':'ZIPで保存しました。展開して利用できます。'}`);
      })).catch(error=>{if(error.name!=='AbortError')notify(error.message,true);});return;
    }
    if(button.dataset.action==='prepare-output'){run(prepareOutput);return;}
    if(button.dataset.action==='print-output'){void openPrintOutput().catch(error=>notify(error.message,true));return;}
    if(button.dataset.action==='save-output-html'){requireSavedNames();if(outputState.prepared)download(outputState.prepared.blob,`${project.name}_${outputState.prepared.model.edition==='draft'?'途中版':'完成版'}_簡易調書写真帳.html`);return;}
    if (button.dataset.mode) { run(async()=>{await flushBoardDrafts(true);await flushReportDrafts(true);enterMode(button.dataset.mode);}); return; }
    if (button.dataset.target) { mode='field';useCaseFilter='';onlyMissing=false;activeTargetId = button.dataset.target; activeRecordId = '';activeCaptureSlot='';render(); return; }
    if (button.dataset.record) { activeRecordId = button.dataset.record;activeCaptureSlot=''; render(); return; }
    if(button.dataset.previewSlot){activeCaptureSlot=button.dataset.previewSlot;render();openCanvasPreview('boardPreview',document.querySelector(`[data-preview-slot="${CSS.escape(activeCaptureSlot)}"]`));return;}
    if (button.dataset.capture) { beginCapture(button.dataset.recordId, button.dataset.capture, button.dataset.source); return; }
    if (button.dataset.unnecessary) { unnecessaryDialog(button.dataset.recordId, button.dataset.unnecessary); return; }
    if (button.dataset.retake) { run(() => mutate(next => setSlotStatus(next, button.dataset.recordId, button.dataset.retake, 'retake'), '撮り直し待ちにしました。原本と履歴は保持しています。')); return; }
    if (button.dataset.editPhoto) { editPhotoDialog(button.dataset.editPhoto); return; }
    if(button.dataset.replacePhoto){const photo=project.photos.find(p=>p.id===button.dataset.replacePhoto);if(photo?.recordId)beginCapture(photo.recordId,photo.slot,'file');return;}
    if (button.dataset.adopt) {
      const photo = project.photos.find(item => item.id === button.dataset.adopt);
      run(() => mutate(next => setActivePhoto(next, photo.recordId, photo.slot, photo.id), 'この写真を採用しました。')); return;
    }
    const id = button.dataset.original || button.dataset.composed;
    if (id) {
      const photo = project.photos.find(item => item.id === id);
      const context = photo.recordId ? getContext(project, photo.recordId) : null;
      const prefix = `${project.name}_${context?.group?.name || (context ? '工事直下' : '未分類')}_${context?.target.name || ''}_${context?.record.category || ''}_${photo.slot || ''}_${photo.id.slice(0, 8)}`;
      if (button.dataset.original) download(originals.get(id), `${prefix}_元写真.${photo.originalPath.split('.').pop()}`);
      else run(async () => { const blob = await composePhoto(originals.get(id), photo); download(blob, `${prefix}_${photo.applyBoard ? '黒板付き' : '画像'}.${blob.type === 'image/jpeg' ? 'jpg' : photo.originalPath.split('.').pop()}`); notify('画像のダウンロードを開始しました。'); });
    }
  } catch (error) { notify(error.message, true); }
}
$('app').addEventListener('click',handleWorkspaceClick);
$('photoDrawerBody').addEventListener('click',handleWorkspaceClick);
$('notificationCenter').addEventListener('click',handleWorkspaceClick);
$('closePhotoDrawer').onclick=closePhotoDrawer;
$('photoDrawer').addEventListener('cancel',event=>{if(busy)event.preventDefault();else closePhotoDrawer();});
$('photoDrawer').addEventListener('close',()=>{if(drawerPhotoId)closePhotoDrawer();});
document.addEventListener('toggle',event=>{
  if(event.target.dataset?.nameEditor&&event.target.open){const id=event.target.dataset.nameEditor;if(!nameDrafts.has(id)){nameDrafts.set(id,event.target.querySelector('[data-name-draft]').value);renderDraftNotice();renderResumeStatus();}}
  if(event.target.dataset?.nameEditor)renderDraftNotice();
  if(event.target.dataset?.disclosure)disclosureState.set(event.target.dataset.disclosure,event.target.open);
  if(event.target.open&&!busy)void populateThumbnails(renderToken);
  if(event.target.dataset?.disclosure)scheduleSessionSave();
},true);
// Run after existing input handlers, so the snapshot contains the edited maps.
for(const type of ['input','change','click','compositionend'])document.addEventListener(type,event=>{
  if(event.target.closest?.('#editorForm')&&['input','change'].includes(type))modalEdited=event.target.name!=='pasteText';
  queueMicrotask(scheduleSessionSave);
});
document.addEventListener('scroll',event=>{
  if(event.target===document||['targetPicker','photoDrawerBody'].includes(event.target.id)||event.target.classList?.contains('target-list'))scheduleSessionSave();
},true);
$('retrySessionSave').onclick=()=>{void sessionSaver.flush().catch(()=>{});};
for(const id of ['cameraInput','photoInput'])$(id).addEventListener('cancel',()=>{pendingCapture=null;scheduleSessionSave();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&project&&storage&&!busy)void sessionSaver.flush().catch(()=>{});});
$('editorDialog').addEventListener('close',()=>{modalEdited=false;if(editorReturnTarget?.isConnected)editorReturnTarget.focus({preventScroll:true});editorReturnTarget=null;scheduleSessionSave();});

function renderOffline(state) {
  if($('offlineSummary'))$('offlineSummary').querySelector('.disclosure-label').textContent=`${state.ready?'圏外準備済み':'圏外未準備'} ・ ${state.online?'オンライン':'オフライン'}${state.updateAvailable||state.reloadRequired?' ・ 更新あり':''}`;
  $('offlineStatus').textContent=`${state.ready?'圏外利用の準備完了':'圏外利用は未準備'}${state.currentVersion?` ／ アプリ${state.currentVersion}`:''}${state.online?' ／ 端末はオンライン表示':' ／ 端末はオフライン表示'}。${state.message||''}${state.error?` ${state.error}`:''}`;
  $('prepareOffline').dataset.unavailable=String(!state.supported);
  $('checkUpdate').dataset.unavailable=String(!state.supported||!state.online);
  $('applyUpdate').hidden=!state.updateAvailable&&!state.reloadRequired;
  $('applyUpdate').textContent=state.reloadRequired?'新しい版で再読込':'更新内容を確認して切替';
  updateDisabled();
}
function updateAppDialog() {
  const state=offlineManager.getState();
  openDialog('アプリ更新と作業再開を確認',`<p>現在：${esc(state.currentVersion||'不明')}<br>新しい版：${esc(state.updateVersion||state.preparedVersion||'準備済みの版')}</p><p class="dialog-note">入力中の内容を一時保存してから、明示的にアプリを再読込します。工事・原本の一時保存は消去しません。必要な再編集用ZIPは先に保存してください。資材の準備に失敗した場合は旧版を保持して、通信復帰後に再試行できます。</p>${checkbox('作業を保存して、この画面を更新することを確認しました',{name:'confirmed',required:true})}`,async()=>{
    if(pendingPhoto)throw new Error('未保存の写真があります。再試行または写真取込の取消をしてからアプリを更新してください。');
    if(!project&&(initialProjectName||initialRouteName))throw new Error('入力中の工事名があります。工事を開始するか、工事名を空欄にしてからアプリを更新してください。');
    if(project){
      if(!storage)throw new Error('一時保存を利用できません。作業ZIPを保存してからアプリを更新してください。');
      await sessionSaver.pause();await storage.saveSession(project.id,sessionSnapshot(project));sessionSaver.reset();
    }
    if(!state.reloadRequired)await offlineManager.applyUpdate();
    intentionalReload=true;window.location.reload();
  },'一時保存して更新・再読込');
}
$('prepareOffline').onclick=()=>run(()=>offlineManager.prepare());
$('checkUpdate').onclick=()=>run(()=>offlineManager.checkForUpdate());
$('applyUpdate').onclick=updateAppDialog;
$('boardCatalog').onclick=()=>openDialog('黒板一覧',`<p class="hint">参照元と同じ5種類の板面です。撮影画面の黒板一覧から次の写真の形式を選べます。</p>${renderBoardChoices(null,{selectable:false})}`,async()=>{},'閉じる');
document.addEventListener('click',event=>{
  const preview=event.target.closest('[data-preview-board]');
  if(preview&&!busy){
    const id=preview.dataset.previewBoard;
    void previewViewer.showImage({title:BOARD_TEMPLATES[id].name,caption:'参照元と同じ黒板の板面です。入力値は含みません。',trigger:preview,loadBlob:async()=>{
      await loadBoardImages();
      const canvas=document.createElement('canvas');canvas.width=1167;canvas.height=876;
      drawBoard(canvas.getContext('2d'),0,0,canvas.width,canvas.height,createBoard(id));
      return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('黒板を表示できません。')),'image/png'));
    }});return;
  }
  const choice=event.target.closest('[data-board-choice]');
  if(!choice||busy)return;
  const form=choice.dataset.boardForm?$(choice.dataset.boardForm):choice.closest('form');
  const select=form?.elements.namedItem('templateId');
  if(!select||select.value===choice.dataset.boardChoice)return;
  select.value=choice.dataset.boardChoice;
  select.dispatchEvent(new Event('change',{bubbles:true}));
});
window.addEventListener('beforeunload', event => { if (!intentionalReload&&(busy||sessionSaver.unsettled||modalEdited||pendingCapture||pendingPhoto||(!project&&(initialProjectName||initialRouteName))||(!storage&&project))) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('error', event => { if (event.message) notify(`エラー：${event.message}`, true); });
window.addEventListener('unhandledrejection', event => { notify(event.reason?.message || '処理に失敗しました。', true); });

async function start() {
  updateDisabled();
  if (!window.isSecureContext || !globalThis.crypto?.randomUUID) {
    $('app').innerHTML = emptyState('HTTPSで開いてください','スマートフォンではHTTPSのURLが必要です。会社PCでの動作確認は、READMEにあるローカル起動手順を使ってください。');
    return;
  }
  let resume=null;
  try { await loadBoardImages(); }
  catch(error) { notify(error.message,true); }
  try {
    storage = await openStorage();
    const saved = await storage.load();
    if (saved) {
      const restored = upgradeProject(saved.project);
      project = restored; originals = saved.originals; bundleId = saved.bundleId;
      dirty = true;
      if(!saved.session)notify('このブラウザーの一時作業を再開しました。作業ZIPを保存してPCへ引き継げます。');
      if(saved.session){
        resume=restoreSession(saved.session);
        notify(`このブラウザーの作業と表示状態を再開しました。${draftCounts()?`下書き${draftCounts()}件は編集中のまま復元しました。`:''}${mode==='output'?'帳票は再生成し、印刷前に内容を確認してください。':''}${resume.issues.length?' 一部の保存状態は復元できませんでした：'+resume.issues.join(' '):''}`,resume.issues.length>0);
      }
      if(saved.sessionIssue)notify(`工事と写真は再開しました。画面・下書きの復元に問題があります：${saved.sessionIssue}`,true);
    }
  } catch (error) {
    storage = null; storageError = error.message;
    feedback.setStorageWarning(`${storageError} カメラ撮影は停止しています。「写真から選ぶ」とZIPの確認・保存は利用できます。作業は再読み込みで失われるため、明示的にZIPへ保存してください。`);
  }
  offlineManager=createOfflineManager({onChange:renderOffline});
  offlineManager.start().catch(error=>notify(`圏外準備状況を確認できません：${error.message}`,true));
  busy = false;
  render();
  if(resume){
    const {view}=resume;
    if(view.drawerPhotoId)openPhotoDrawer(view.drawerPhotoId);
    requestAnimationFrame(()=>{
      if($('targetPicker'))$('targetPicker').scrollTop=view.scroll.target;
      const list=document.querySelector('#targetPicker .target-list');if(list)list.scrollTop=view.scroll.targetList;
      if($('photoDrawerBody'))$('photoDrawerBody').scrollTop=view.scroll.drawer;
      window.scrollTo(view.scroll.x,view.scroll.y);
      document.querySelectorAll('[data-disclosure]').forEach(el=>{const saved=view.disclosures.find(([key])=>key===el.dataset.disclosure);if(saved)el.open=saved[1];});floating.sync();
      restoringSession=false;scheduleSessionSave();
    });
  }else{restoringSession=false;scheduleSessionSave();}
}
start();

let thumbnailFrame=0;
const scheduleThumbnails=()=>{if(thumbnailFrame)return;thumbnailFrame=requestAnimationFrame(()=>{thumbnailFrame=0;if(!busy)void populateThumbnails(renderToken);});};
document.addEventListener('scroll',scheduleThumbnails,{capture:true,passive:true});
window.addEventListener('resize',scheduleThumbnails,{passive:true});
window.addEventListener('unload',revokeThumbnails);
