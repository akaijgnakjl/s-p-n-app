import {getContext,USE_CASES} from './model.js';
import {BOARD_TEMPLATES,createBoard} from './boards.js';
import {tsCaptureBoard} from './ts-board.js';

// 黒板の工事名は工事名と同じ文字のまま、利用者が入れた改行（空白を改行に置き換えたものを含む）だけを残す。
const bare=value=>String(value??'').replace(/\s+/g,'');
export function boardJobName(value,projectName){return String(value??'').includes('\n')&&bare(value)===bare(projectName)?String(value):projectName;}
export function linkedBoard(project,recordId,board,{report=true,preservePoint=false}={}){
  if(!board)return null;
  const {target,record,group}=getContext(project,recordId),values={...board.values,job:boardJobName(board.values.job,project.name),route:group?.kind==='路線'?group.name:'',point:['現密','コア密'].includes(target.useCase)?'':preservePoint?board.values.point:target.name};
  if(report&&Object.hasOwn(record.reportFields||{},'station'))values.location=record.reportFields.station;
  if(report&&target.useCase!=='TS出来形(バリアフリー)'&&Object.hasOwn(record.reportFields||{},'remarks'))values.remarks=record.reportFields.remarks;
  const result=createBoard(board.templateId,values,board.legacyColor===undefined?{}:{legacyColor:board.legacyColor});
  return target.useCase==='TS出来形(バリアフリー)'?tsCaptureBoard(result,{route:values.route,station:values.location||(/^SP\s*\d/i.test(target.name)?target.name:'')}):result;
}

/** Rebase only names actually changed by a saved operation; keep unrelated unsaved inputs. */
export function relinkBoardDrafts(previous,next,entries){
  if(!previous)return entries;
  return entries.map(([id,draft])=>{
    const before=getContext(previous,id),after=getContext(next,id),values={...draft.board?.values};if(!draft.board)return [id,draft];
    if(previous.name!==next.name)values.job=next.name;
    if(before.target.name!==after.target.name)values.point=['現密','コア密'].includes(after.target.useCase)?'':after.target.name;
    if(before.target.groupId!==after.target.groupId||before.group?.name!==after.group?.name)values.route=after.group?.kind==='路線'?after.group.name:'';
    let board=createBoard(draft.board.templateId,values,draft.board.legacyColor===undefined?{}:{legacyColor:draft.board.legacyColor});
    if(after.target.useCase==='TS出来形(バリアフリー)')board=tsCaptureBoard(board,{route:values.route,station:values.location});
    return [id,{...draft,board}];
  });
}

/** Only explicitly corresponding fields are linked; free text is never parsed as coordinates. */
export function boardReportUpdates(useCase,board,previous){
  const fields=new Set(BOARD_TEMPLATES[board.templateId].fields.map(field=>field.key)),columns=new Set(USE_CASES[useCase].reportColumns.map(column=>column.key)),updates={};
  for(const [boardKey,reportKey] of [['location','station'],['remarks','remarks']]){
    if(useCase==='TS出来形(バリアフリー)'&&boardKey==='remarks')continue;
    if(fields.has(boardKey)&&columns.has(reportKey)&&board.values[boardKey]!==previous?.values[boardKey])updates[reportKey]=board.values[boardKey];
  }
  return updates;
}

export function replacePhotoBoard(photo,board,applyBoard=photo.applyBoard){
  if(JSON.stringify(photo.board)===JSON.stringify(board)&&photo.applyBoard===applyBoard)return;
  photo.boardRevisions??=[];
  photo.boardRevisions.push({changedAt:new Date().toISOString(),board:structuredClone(photo.board),applyBoard:photo.applyBoard});
  photo.board=structuredClone(board);photo.applyBoard=applyBoard;
}

export function refreshRecordBoards(project,recordId,{photos=false}={}){
  const {target,record}=getContext(project,recordId);
  if(target.useCase==='MMS')return;
  record.boardDefaults=linkedBoard(project,recordId,record.boardDefaults);
  const active=new Set(record.slots.map(slot=>slot.activePhotoId));
  if(photos)for(const photo of project.photos.filter(photo=>active.has(photo.id)&&photo.board&&!(target.useCase==='TS出来形(バリアフリー)'&&photo.slot==='スマホスクリーンショット')))replacePhotoBoard(photo,linkedBoard(project,recordId,photo.board));
}
