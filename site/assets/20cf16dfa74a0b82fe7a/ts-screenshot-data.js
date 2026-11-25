import {getContext} from './model.js';
import {tsCaptureBoard} from './ts-board.js';
import {setReportField} from './workflow.js';

/**
 * 管理名・読み取った計測箇所を照合用の形にそろえる（全角半角・大文字小文字・空白・「SP」・括弧の違いを無視し、
 * 数字は数値として比べる：748.680L と 748.68L は同じ）。測点の形でなければ null。
 */
export function tsStationKey(value){
  const text=String(value??'').normalize('NFKC').toUpperCase().replace(/\s/g,'');
  const match=/^(?:SP|NO\.?)?(\d{1,6}(?:\.\d+)?)\(?([LR])\)?$/.exec(text);
  if(!match)return null;
  const number=Number(match[1]);return Number.isFinite(number)?`${number}${match[2]}`:null;
}
/** 読み取った計測箇所（確定値、なければ候補）と同じ管理名の記録対象を探す。候補が1つの対象にだけ合う時に返す。 */
export function matchTSTarget(targets,result){
  const keyed=new Map();for(const target of targets){const key=tsStationKey(target.name);if(key)keyed.set(key,[...(keyed.get(key)||[]),target]);}
  const station=result?.values?.station,exact=station?tsStationKey(`${station.station}${station.side}`):null;
  if(exact){const found=keyed.get(exact)||[];return found.length===1?{target:found[0],certain:true,text:`${station.station}${station.side}`}:{target:null,certain:false,text:`${station.station}${station.side}`,duplicate:found.length>1};}
  const hits=[];for(const candidate of result?.candidates?.station||[]){const key=tsStationKey(`${candidate.station}${candidate.side}`),found=key?keyed.get(key)||[]:[];if(found.length===1&&!hits.some(hit=>hit.target.id===found[0].id))hits.push({target:found[0],text:`${candidate.station}${candidate.side}`});}
  return hits.length===1?{...hits[0],certain:false}:{target:null,certain:false,text:''};
}

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
