import {escapeHTML as esc} from '../ui/components.js';
import {USE_CASES} from '../definitions.js';
import {constructionSection,formatStation,tsReportCells,tsMeasurements,tsLocationLabel} from '../report-data.js';
import {controlPointLines as wrap} from './control-point.js';

// Read-only measurements of the user's four PDF references. Units are PDF points.
const mm=pt=>pt*25.4/72;
const n=value=>Number(value.toFixed(3));
const text=(x,y,value,size=13.98,anchor='middle',extra='')=>`<text x="${n(x)}" y="${n(y)}" font-size="${size}" text-anchor="${anchor}" ${extra}>${esc(value??'')}</text>`;
const rect=(x,y,width,height,fill='#000')=>`<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" fill="${fill}"/>`;
const line=(x,y,end,width=.06)=>rect(x,y,end-x,width);
const centered=(x,y,values,size=13.98,leading=15)=>values.map((value,i)=>text(x,y+(i-(values.length-1)/2)*leading,value,size)).join('');
const sheet=(type,label,body,images='')=>`<div class="measured-sheet measured-${type}"><svg class="measured-svg" viewBox="0 0 ${type==='ts'?'842 595.22':type==='trial'?'595.32001 841.92004':'595.22 842'}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">${body}</svg>${images}</div>`;
export const MEASURED_FORMS_CSS=`
.page.page-measured{padding:0;display:block;width:595.22pt;height:842pt;page:measured-portrait}.page-measured>.page-content{position:absolute;inset:0;width:100%;height:100%}.measured-sheet{position:relative;width:100%;height:100%;color:#000;font-family:"MS PMincho","ＭＳ Ｐ明朝","Yu Mincho","Hiragino Mincho ProN",serif}.measured-ts{font-family:"MS Mincho","ＭＳ 明朝","Yu Mincho","Hiragino Mincho ProN",serif}.measured-svg{position:absolute;inset:0;width:100%;height:100%;font-family:inherit;overflow:visible}.page.page-measured-trial{width:595.32001pt;height:841.92004pt;page:measured-trial}.page.page-measured-ts{width:842pt;height:595.22pt;page:measured-ts}.measured-photo{position:absolute;border:0;padding:0;margin:0;max-width:none;object-fit:fill}.measured-empty{position:absolute;display:grid;place-content:center;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;border:.12pt dashed #888;font-size:10pt;padding:4pt}.page-measured .watermark{z-index:2;inset:110mm 10mm auto}.page-measured-ts .watermark{inset:80mm 10mm auto}@page measured-portrait{size:595.22pt 842pt;margin:0}@page measured-trial{size:595.32001pt 841.92004pt;margin:0}@page measured-ts{size:842pt 595.22pt;margin:0}
`;

const BM_CENTERS=[92.52,185.1,270.72,360.3,484.98],BM_WIDTHS=[64,104,52,111,121];
function bmCells(context,index){const f=context.record.reportFields||{};return [String(index+1),f.station||'—（未入力）',f.position||'—（未入力）',f.height||'—（未入力）',f.remarks||''];}
function sectionParts(section){if(!section)return null;const result=constructionSection(section.start,section.end,section.excluded);return [section.notation==='自由入力'?section.custom:section.notation,...[section.start,section.end].map(value=>section.notation==='No.'?formatStation(value,'No.').slice(3):value),result.length,result.excludedMm?section.excluded:''];}
export function planBMReports(records){
  if(records.some(c=>wrap(c.groupName,360).length>2||wrap(c.itemName,360).length>2||bmCells(c,0).some((value,i)=>wrap(value,BM_WIDTHS[i]).length>3)||sectionParts(c.sectionData)?.some((value,i)=>wrap(value,[45,64,90,85,85][i]).length>1)))return null;
  const groups=new Map();for(const c of records){const key=JSON.stringify([c.groupId,c.category,c.itemName,c.section]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
  const pages=[];for(const group of groups.values())for(let at=0;at<group.length;at+=9){const first=group[0];pages.push({kind:'report',useCase:'仮BM',title:'仮ＢＭ設置箇所',referenceLayout:'bm',groupName:first.groupName,itemName:first.itemName,section:first.section,sectionData:first.sectionData,continued:at>0,columns:[{key:'name',label:'番号'},...USE_CASES.仮BM.reportColumns],usedMm:mm(683.04),entries:group.slice(at,at+9).map((c,i)=>({kind:'row',recordId:c.recordId,targetId:c.targetId,heightMm:mm(57.84),cells:bmCells(c,at+i).map((value,col)=>wrap(value,BM_WIDTHS[col]))}))});}return pages;
}
export function printBMReport(page){
  let b=Array.from('仮ＢＭ設置箇所').map((v,i)=>text([207.84,237.774,262.578,292.512,322.446,352.38,382.314][i],92.52,v,18,'start')).join('');
  b+=rect(56.7,115.38,.96,683.04)+rect(549.54,116.34,.96,682.08)+rect(57.66,115.38,492.84,.96)+rect(57.66,797.46,492.84,.96)+rect(181.14,116.34,.06,120.72);
  for(const x of [128.34,240.84,300.54,419.94])b+=rect(x,237.06,.06,560.4);
  for(const y of [156.24,196.62,237,277.38,335.22,393.06,450.9,508.74,566.58,624.42,682.26,740.1])b+=line(57.66,y,549.54);
  const s=sectionParts(page.sectionData);
  // 不施工がある時は施工区間の枠を上下2段にし、下段の中央へ不施工区間長、右端へL=を置く。
  const split=Boolean(s?.[4]),sy=split?211.1:221.88,ss=split?12:13.98;
  for(const [label,y] of [['項目名',140.64],['施工箇所',181.02]])b+=text(119.61,y,label);
  b+=text(119.61,split?sy:221.4,'施工区間',ss);
  b+=centered(365.37,140.64,wrap(page.itemName,360))+centered(365.37,181.02,wrap(page.groupName,360));
  if(s){b+=text(230.73,sy,s[0],ss)+text(269.94,sy,s[1],ss)+text(330.69,sy,'～',ss)+text(388.5,sy,s[2],ss)+text(452.73,split?231.2:sy,'L=',ss)+text(503.1,split?231.2:sy,s[3],ss);if(split)b+=line(181.2,216.81,549.54)+text(119.61,231.2,'不施工',12)+text(365.37,231.2,`${s[4]} m`,12);}
  ['番号','測点','位置','高さ','備考'].forEach((label,i)=>b+=text(BM_CENTERS[i],i===0||i===2?262.26:261.779,label));
  page.entries.forEach((entry,i)=>{b+=`<g data-record-id="${esc(entry.recordId)}">`+entry.cells.map((values,col)=>centered(BM_CENTERS[col],(col===0||col===1||col===2?311.339:310.859)+57.84*i,values)).join('')+'</g>';});return sheet('bm','仮BM設置箇所の調書',b);
}

const TRIAL_IMAGES=[[78.96,66.6,309.12,228.84],[75.48,313.08,315,233.28],[75.48,564.48,315,233.16]];
function trialCaption(row){const f=row.fields||{};return row.useCase==='現密'?['現場密度試験','',row.category,row.slots[0].name]:['切取供試体密度試験',row.slots[0].name,f.material||row.category];}
function trialExtra(){return [];}
export function isTrialPhotoPage(rows,groupName){return rows.length>0&&wrap(`路線名：${groupName}`,420,9.96).length===1&&rows.every(row=>row.kind==='photo-row'&&['現密','コア密'].includes(row.useCase)&&row.referencePhoto&&wrap(row.fields.station,90,9.96).length<=2&&trialCaption(row).every(value=>wrap(value,146,11.04).length===1)&&trialExtra(row).length<=6);}
function photo(slot,urls,labels,box){const [x,y,w,h]=box,style=`left:${x}pt;top:${y}pt;width:${w}pt;height:${h}pt`;if(slot?.photo&&urls.has(slot.photo.id))return `<img src="${esc(urls.get(slot.photo.id))}" alt="${esc(slot.name)}" class="measured-photo" style="${style}">`;return `<div class="measured-empty" style="${style}">${esc(labels[slot?.status]||'未撮影')}${slot?.reason?`<br>${esc(slot.reason)}`:''}</div>`;}
export function printTrialPhotos(page,urls,labels){
  const density=page.rows[0].useCase==='現密';let b=text(59.04,density?51.12:50.16,`路線名：${page.groupName}`,9.96,'start')+text(density?491.88:462.12,50.64,'試験状況',9.96,'start'),images='';
  b+=rect(561.96,53.76,.96,752.64)+rect(56.76,55.32,.96,751.08)+rect(411.48,56.28,.96,750.12);
  for(const y of [55.32,305.4,555.48,805.44])b+=rect(57.72,y,505.2,.96);
  for(let i=0;i<3;i++){const off=250.08*i;for(const y of [75.72,116.52])b+=rect(412.44,y+off,150.48,.96);for(const y of [140.04,213.96])b+=rect(412.44,y+off,149.52,.12);const row=page.rows[i];if(!row)continue;
    b+=`<g data-record-id="${esc(row.recordId)}">`+text(419.16,69.6+off,'写真NO',9.96,'start')+text(462.17,69.6+off,row.number,9.96,'start')+text(413.76,90+off,'測点',9.96,'start')+wrap(row.fields.station||'—',90,9.96).map((value,j)=>text(462.17,90+off+j*11,value,9.96,'start')).join('');
    const base=density&&i===2?656.28:162.24+off;
    b+=trialCaption(row).map((value,j)=>text(487.32,base+12.24*j,value,11.04)).join('');
    b+=trialExtra(row).map((value,j)=>text(487.32,235+off+j*10.8,value,9.96)).join('')+'</g>';
    images+=photo(row.slots[0],urls,labels,TRIAL_IMAGES[i]);
  }return sheet('trial',`${density?'現密':'コア密'}写真帳の3段配置`,b,images);
}

export const TS_ROW_EDGES=Object.freeze([256.08,268.68,280.2,292.08,304.32,316.92,328.44,340.32,352.56,365.16,376.68,388.2,399.72,411.24,422.76,434.64,446.88,459.48,471,482.88,495.12,507.72,519.24,527.76]);
const TS_X=[47.511,103.431,153.471,203.511,253.551,303.591,353.631,403.671,453.711,503.751,553.791];
export function planTSReports(records){
  if(records.some(c=>tsReportCells(c).some((v,i)=>wrap(v,i?46:52,7.68).length>1)||wrap(`${c.projectName}　${c.groupName}`,640,8.28).length>1||wrap(c.record.reportFields?.surveyor,160,9.48).length>1||['standard','internalStandard'].some(key=>wrap(c.record.reportFields?.[key],78,6.84).length>1)))return null;
  const groups=new Map();for(const c of records){const f=c.record.reportFields||{},key=JSON.stringify([c.groupId,f.surveyor,f.standard,f.internalStandard]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
  const pages=[];for(const group of groups.values())for(let at=0;at<group.length;at+=23)pages.push({kind:'report',useCase:'TS出来形(バリアフリー)',title:'測定結果一覧表',referenceLayout:'ts',orientation:'landscape',groupName:group[0].groupName,records:group.slice(at,at+23),continued:at>0,usedMm:mm(340.44)});return pages;
}
const spread=(value,x,end,y,size=6.84)=>Array.from(value).map((v,i,a)=>text(x+(end-x)*i/Math.max(1,a.length-1),y,v,size,'start')).join('');
export function printMeasuredTS(page){
  const first=page.records[0],f=first.record.reportFields||{};let b=text(418.311,90.72,'測定結果一覧表',13.44)+line(358.911,94.68,477.711,.49);
  b+=text(107.031,119.64,'工事名',8.28,'start')+text(140.391,119.64,`${first.projectName}　${page.groupName}`,8.28,'start')+line(102.711,121.92,329.151,.49);
  b+=text(109.911,146.4,'工種',9.48,'start')+text(136.191,146.4,'縁石工',9.48,'start')+line(102.711,149.16,329.151,.49)+text(109.911,173.4,'種別',9.48,'start')+text(136.191,173.4,'延長（偏心量）',9.48,'start')+line(102.711,176.16,329.151,.49);
  b+=text(556.79,173.4,'測定者',9.48,'start')+text(670.071,173.64,f.surveyor||'',9.48)+text(773.39,173.4,'印',9.48,'start')+line(553.31,176.16,789.35,.49);
  for(const [x,fill] of [[103.431,'#80ffff'],[253.551,'#ff80ff'],[403.671,'#ffff80']])b+=rect(x,188.76,150.24,15.48,fill);
  for(const x of [153.471,303.591])b+=rect(x,256.56,50.16,271.8,'#ffffcc');
  b+=rect(47.031,188.28,.96,340.44)+rect(789.951,189.24,.96,336.84);
  for(const x of [102.951,253.071,403.191,553.31])b+=rect(x,189.24,.96,339.48);
  for(const x of [152.991,203.031,303.111,353.151,453.231,503.271])b+=rect(x,235.92,.96,292.8);
  b+=rect(47.991,188.28,742.92,.96)+rect(47.991,234.96,742.92,.96)+rect(554.271,525.12,236.64,.96);
  for(const y of [203.64,219.48,...TS_ROW_EDGES])b+=rect(47.991,y,506.28,.96);
  for(const [label,y] of [['測定項目',198.96],['規格値',214.56],['社内規格値',230.28],['測点又は区別',248.04]])b+=spread(label,48.95,95.271,y);
  for(const [label,x] of [['△X',178.911],['△Y',329.031],['偏心量',477.471]])b+=text(x,198.48,label,6.84);
  b+=text(631.971,214.2,'略',6.84)+text(712.371,214.2,'図',6.84);
  for(let i=0;i<3;i++){const x=150.12*i;b+=text(165.711+x,214.2,f.standard||'',6.84)+text(165.711+x,230.04,f.internalStandard||'',6.84)+text(230.631+x,214.2,'mm',6.84,'start')+text(230.631+x,229.92,'mm',6.84,'start');}
  const headers=['設計値','実測値','差','設計値','実測値','差','△ Ⅹ','△ Ｙ','偏心量ｄ'];
  headers.forEach((label,i)=>{const left=TS_X[i+1],right=TS_X[i+2];b+=label.length>=3?spread(label,left+1.44,right-7.2,243.239):text((left+right)/2,243.239,label,6.84);b+=text((left+right)/2,253.8,[0,1,3,4].includes(i)?'m':'mm',6.84);});
  const baselines=[265.2,277.32,288.96,301.08,313.441,325.56,337.2,349.32,361.68,373.8,385.32,396.84,408.36,419.88];
  page.records.forEach((c,row)=>{b+=`<g data-record-id="${esc(c.recordId)}">`+tsReportCells(c).map((value,col)=>text(col?TS_X[col+1]-5.28:(TS_X[0]+TS_X[1])/2,baselines[row]??(TS_ROW_EDGES[row]+TS_ROW_EDGES[row+1])/2+2.4,value,7.68,col?'end':'middle',[2,5].includes(col)?'fill="#ff0000"':'')).join('')+'</g>';});return sheet('ts','TS出来形の測定結果一覧表',b);
}

const TS_PHOTO_BOXES=[[199.56,68.64,189,52.56],[200.52,304.8,189,52.44],[199.56,542.04,189,52.2]];
const TS_FIELD_BOXES=[[104.4,125.52,235.2,173.28],[93.36,361.2,236.16,173.76],[94.32,595.68,233.88,173.76]];
const TS_SCREEN_BOXES=[[392.28,128.16,78.72,173.28],[391.08,360.72,78.6,173.76],[390.12,597.24,78.48,173.76]];
function tsCaption(row){const f=row.fields||{},m=tsMeasurements(f);return [`計測箇所：${tsLocationLabel(f,row.targetName)}`,`偏心：X=${m?.dx??'—'}mm  Y=${m?.dy??'—'}mm  D=${m?.d??'—'}mm`];}
export function isTSPhotoPage(rows){return rows.length>0&&rows.every(row=>row.kind==='photo-row'&&row.useCase==='TS出来形(バリアフリー)'&&row.referencePhoto&&tsCaption(row).every(value=>wrap(value,173,9.24).length===1));}
export function printTSPhotos(page,urls,labels){let b='',images='';page.rows.forEach((row,i)=>{const [x,y,w,h]=TS_PHOTO_BOXES[i],baseline=[85.92,321.96,559.08][i],caption=tsCaption(row);b+=`<g data-record-id="${esc(row.recordId)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000" stroke-width=".434"/>`+text(x+w/2,baseline,'縁石工　延長（偏心量）',9.24)+text(x+9,baseline+12.12,caption[0],9.24,'start')+text(x+9,baseline+(i===2?24.12:24.24),caption[1],9.24,'start')+'</g>';images+=photo(row.slots[0],urls,labels,TS_FIELD_BOXES[i])+photo(row.slots[1],urls,labels,TS_SCREEN_BOXES[i]);});return sheet('ts-photo','TS出来形の写真帳',b,images);}
export function printMeasuredPage(page,urls,labels){return page.referenceLayout==='bm'?printBMReport(page):page.referenceLayout==='trial'?printTrialPhotos(page,urls,labels):page.referenceLayout==='ts-photo'?printTSPhotos(page,urls,labels):printMeasuredTS(page);}
