import {escapeHTML as esc} from '../ui/components.js';
import {USE_CASES} from '../definitions.js';
import {constructionSection,formatStation} from '../report-data.js';

// PDF user-space coordinates, in points (72 pt = 25.4 mm). No business values are copied.
export const CONTROL_POINT_LAYOUT=Object.freeze({
  width:595.22,height:842,reportX:56.76,reportY:115.44,reportWidth:494.46,
  reportBottom:797.52,reportRowTop:277.47,reportRowHeight:51.96,
  photoX:77.04,photoY:72,photoWidth:454.8,photoBottom:786.72,photoRowHeight:237.96,
});
const mm=points=>points*25.4/72;
export const CONTROL_POINT_CSS=`
.page.page-control-point{width:595.22pt;height:842pt;padding:0;display:block;page:control-point}.page-control-point>.page-content{position:absolute;inset:0;width:100%;height:100%;z-index:1}.control-point-sheet{position:relative;width:595.22pt;height:842pt;color:#000;font-family:"MS PMincho","ＭＳ Ｐ明朝","Yu Mincho","Hiragino Mincho ProN",serif}.control-point-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;font-family:inherit}.control-point-sheet .control-photo{position:absolute;margin:0;padding:0;object-fit:fill;border:0;max-width:none}.control-photo-empty{position:absolute;display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;font-size:8.28pt;line-height:9.36pt;padding:4pt}.page-control-point .watermark{z-index:2;inset:110mm 10mm auto}@page control-point{size:595.22pt 842pt;margin:0}
`;
const extent=(character,size)=>/[^\x20-\x7e]/.test(character)?size:/[WM@%]/.test(character)?size*.92:/[il.,: '\-]/.test(character)?size*.3:size*.55;
export function controlPointLines(value,width=90,size=13.98){
  return String(value??'').split('\n').flatMap(paragraph=>{const lines=[];let text='',used=0;for(const character of Array.from(paragraph)){const step=extent(character,size);if(text&&used+step>width){lines.push(text);text='';used=0;}text+=character;used+=step;}lines.push(text);return lines;});
}
function sectionValues(section){
  if(!section)return null;
  const result=constructionSection(section.start,section.end,section.excluded);
  const prefix=section.notation==='自由入力'?section.custom:section.notation;
  const value=raw=>section.notation==='No.'?formatStation(raw,'No.').slice(3):raw;
  return {prefix,start:value(section.start),end:value(section.end),length:result.length,excluded:result.excludedMm?section.excluded:''};
}
function reportValues(context){const f=context.record.reportFields||{};return [context.targetName,f.x||'—（未入力）',f.y||'—（未入力）',f.height||'—（未入力）',f.kind||'—（未入力）'];}
function sectionFits(section){if(!section)return true;const values=sectionValues(section);return [[values.prefix,100],[values.start,45],[values.end,90],[`L=${values.length}`,90]].every(([value,width])=>controlPointLines(value,width).length===1)&&String(values.excluded).length<=12;}
export function planControlPointReports(records){
  const eligible=records.every(context=>controlPointLines(context.groupName,380).length<=2&&controlPointLines(context.itemName,380).length<=2&&reportValues(context).every(value=>controlPointLines(value).length<=3)&&sectionFits(context.sectionData));
  if(!eligible)return null;
  const groups=new Map();
  for(const context of records){const key=JSON.stringify([context.groupId,context.category,context.itemName,context.section]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(context);}
  const pages=[];
  for(const rows of groups.values())for(let at=0;at<rows.length;at+=10){const first=rows[0];pages.push({kind:'report',useCase:'基準点',title:'基準点設置箇所',columns:[{key:'name',label:'点名'},...USE_CASES.基準点.reportColumns],referenceLayout:'control-point',groupName:first.groupName,itemName:first.itemName,section:first.section,sectionData:first.sectionData,continued:at>0,usedMm:mm(682.08),entries:rows.slice(at,at+10).map(context=>({kind:'row',recordId:context.recordId,targetId:context.targetId,heightMm:mm(51.96),cells:reportValues(context).map(value=>controlPointLines(value))}))});}
  return pages;
}
function photoLines(row){const f=row.fields||{};return (row.useCase==='仮BM'?[f.remarks||'',`H=${f.height||'—'}`]:[row.targetName,f.kind||'—',`X=${f.x||'—'}`,`Y=${f.y||'—'}`,`H=${f.height||'—'}`]).flatMap(value=>controlPointLines(value,140,8.28));}
// 仮BMの見本は測点からSPを外し、位置を括弧で続ける（例：-1.1(中央　分離帯)）。
function bmStation(row){const f=row.fields||{},station=String(f.station||'').trim().replace(/^SP\s*/i,''),position=String(f.position||'').trim().replace(/\s*\n\s*/g,'　');return station+(position?`(${position})`:'');}
const bmFits=row=>[bmStation(row),String(row.fields?.photoLine||'')].every(value=>controlPointLines(value,100,8.28).length===1);
export function isControlPointPhotoPage(rows,groupName){const useCase=rows[0]?.useCase;return rows.length>0&&['基準点','仮BM'].includes(useCase)&&rows.every(row=>row.kind==='photo-row'&&row.useCase===useCase&&row.referencePhoto&&photoLines(row).length<=7&&(useCase!=='仮BM'||bmFits(row)))&&controlPointLines(`路線名:${groupName}`,292,9.24).length===1;}

const text=(x,y,value,size=13.98,anchor='middle',extra='')=>`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" ${extra}>${esc(value)}</text>`;
const line=(x1,y1,x2,y2,width=.06)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${width}"/>`;
const rect=(x,y,width,height)=>`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#000"/>`;
const svg=(label,body)=>`<svg class="control-point-svg" viewBox="0 0 595.22 842" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">${body}</svg>`;
function centeredLines(x,baseline,values,size=13.98,leading=15){const start=baseline-(values.length-1)*leading/2;return values.map((value,index)=>text(x,start+index*leading,value,size)).join('');}

export function printControlPointReport(page){
  let body=Array.from('基準点設置箇所').map((value,index)=>text(205.62+29.9364*index,92.58,value,18,'start')).join('');
  body+=rect(56.76,115.44,.96,682.08)+rect(550.26,116.4,.96,681.12)+rect(57.72,115.44,493.5,.96)+rect(57.72,796.56,493.5,.96)+rect(57.72,236.58,493.5,.96);
  body+=line(155.97,116.4,155.97,796.56);
  for(const x of [254.67,353.37,452.07])body+=line(x,237.54,x,796.56);
  for(const y of [156.33,196.71,277.47,...Array.from({length:9},(_,index)=>329.43+51.96*index)])body+=line(57.72,y,550.26,y);
  const section=sectionValues(page.sectionData);
  // 不施工がある時は施工区間の枠を上下2段にし、下段の中央へ不施工区間長、右端へL=を置く。
  const split=Boolean(section?.excluded),sectionY=split?211.1:221.94,sectionSize=split?12:13.98;
  for(const [label,baseline] of [['項目名',141.18],['施工箇所',181.56]])body+=text(107.028,baseline,label);
  body+=text(107.028,sectionY,'施工区間',sectionSize);
  body+=centeredLines(353.65,141.18,controlPointLines(page.itemName,380));
  body+=centeredLines(353.65,181.56,controlPointLines(page.groupName,380));
  if(section){body+=text(245.158,sectionY,section.prefix,sectionSize)+text(318.697,sectionY,section.start,sectionSize)+text(344.132,sectionY,'～',sectionSize)+text(403.204,sectionY,section.end,sectionSize)+text(499.7,split?231:sectionY,`L=${section.length}`,sectionSize);if(split)body+=line(155.97,216.65,550.26,216.65)+text(107.028,231,'不施工',12)+text(353.65,231,`${section.excluded} m`,12);}
  ['点名','X座標','Y座標','高さ H','点の種類'].forEach((label,index)=>body+=text(107.028+98.7*index,262.32,label));
  page.entries.filter(entry=>entry.kind==='row').forEach((entry,index)=>{body+=`<g data-record-id="${esc(entry.recordId)}">`+entry.cells.map((values,column)=>centeredLines(107.028+98.7*column,308.459+51.96*index,values)).join('')+'</g>';});
  return `<div class="control-point-sheet">${svg('基準点設置箇所の調書',body)}</div>`;
}

function photo(slot,urls,labels,x,y,width,height){
  const style=`left:${Number(x.toFixed(3))}pt;top:${Number(y.toFixed(3))}pt;width:${width}pt;height:${height}pt`;
  if(slot?.photo&&urls.has(slot.photo.id))return `<img src="${esc(urls.get(slot.photo.id))}" class="control-photo" alt="${esc(slot.name)}" style="${style}">`;
  return `<div class="control-photo-empty" style="${style}">${esc(labels[slot?.status]||'未撮影')}${slot?.reason?`<br>${esc(slot.reason)}`:''}</div>`;
}
export function printControlPointPhotos(page,urls,labels){
  // 仮BMは基準点と同じ枠で、見本どおり写真NO・測点（＋任意の欄）・観察・所見を置く。
  const bm=page.rows[0]?.useCase==='仮BM';
  let body=text(79.08,65.64,`路線名:${page.groupName}`,9.24,'start')+text(379.323,65.64,`状況写真：${bm?'仮BM':'基準点'}設置箇所`,9.24,'start'),images='';
  body+=rect(77.04,72,.84,714.72)+rect(531,72.84,.84,713.88)+rect(377.28,72.84,.84,713.88);
  for(let index=0;index<=3;index++)body+=rect(77.88,72+237.96*index,453.96,.84);
  for(let index=0;index<3;index++){
    const top=237.96*index;
    for(const y of [90.72,128.16])body+=rect(378.12,y+top,153.72,.84);
    for(const y of [149.16,222.48])body+=rect(378.12,y+top,152.88,.12);
    body+=text(454.924,141.96+top,bm?'観察・所見':'点名・種類・座標',8.28);
    if(bm)body+=text(389.28,84.84+top,'写真NO',8.28,'start')+text(381.6,101.6+top,'測点',8.28,'start');
    const row=page.rows[index];if(!row)continue;
    body+=`<g data-record-id="${esc(row.recordId)}">`+(bm?'':text(389.28,84.84+top,'管理No',8.28,'start'))+text(428.52,84.84+top,row.number,8.28,'start');
    if(bm)body+=text(428.52,101.6+top,bmStation(row),8.28,'start')+text(428.52,120.3+top,row.fields?.photoLine||'',8.28,'start');
    const values=photoLines(row),first=(bm?186.8:188.879)-(values.length-1)*9.3597/2;
    body+=values.map((value,i)=>text(454.924,first+i*9.3597+top,value,8.28)).join('')+'</g>';
    const nearX=index===1?400.68:397.56,nearY=index===1?226.08:226.32;
    body+=rect(81.36,85.68+top,293.4,210.24)+rect(nearX,nearY+top,112.92,80.88);
    images+=photo(row.slots[0],urls,labels,81.72,86.04+top,292.68,209.52)+photo(row.slots[1],urls,labels,nearX+.36,nearY+.36+top,112.2,80.16);
  }
  return `<div class="control-point-sheet">${svg(`${bm?'仮BM':'基準点'}写真帳の3段配置`,body)}${images}</div>`;
}
