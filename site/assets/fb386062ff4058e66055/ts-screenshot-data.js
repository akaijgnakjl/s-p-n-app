import {getContext} from './model.js';
import {tsCaptureBoard} from './ts-board.js';
import {setReportField} from './workflow.js';

/** Apply only independently verified fields to a candidate project before its atomic save. */
export function applyTSScreenshot(project,recordId,result,{board}={}){
  let {target,record,group}=getContext(project,recordId);if(target.useCase!=='TS出来形(バリアフリー)')throw new Error('TS出来形の記録を選んでください。');
  const keys=[],values=result.values||{};
  const set=(key,value)=>{setReportField(project,recordId,key,value);record=getContext(project,recordId).record;keys.push(key);};
  if(values.x!==undefined){set('designX','0.000');set('measuredX',values.x);}
  if(values.y!==undefined){set('designY','0.000');set('measuredY',values.y);}
  if(values.station){set('station',`SP${values.station.station}`);set('side',values.station.side);}
  if(values.station){
    const source=board||record.boardDefaults;
    const update=current=>tsCaptureBoard(current,{route:group?.kind==='路線'?group.name:'',station:`SP${values.station.station}`});
    record.boardDefaults=update(source);
    const slot=record.slots.find(slot=>slot.name==='現場写真'),photo=project.photos.find(photo=>photo.id===slot?.activePhotoId);
    if(photo?.board&&photo.applyBoard)photo.board=update(photo.board);
  }
  if(keys.length||result.complete===false)record.reportReview=null;
  return {keys,boardChanged:Boolean(values.station)};
}
