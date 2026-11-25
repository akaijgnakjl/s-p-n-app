import {escapeHTML as esc} from '../ui/components.js';
import {tsMeasurements,tsReportCells,tsCellLines,tsRowHeight,tsReportStation} from '../report-data.js';

const lines=value=>String(value??'').split('\n').map(line=>`<span>${esc(line)||'&#160;'}</span>`).join('');
const value=(fields,key)=>String(fields?.[key]??'');
const image=(slot,urls,labels)=>slot?.photo&&urls.has(slot.photo.id)?`<img src="${urls.get(slot.photo.id)}" alt="${esc(slot.name)}">`:`<div class="ref-photo-placeholder">${esc(slot?labels[slot.status]:'未撮影')}${slot?.reason?`<br>${esc(slot.reason)}`:''}</div>`;

export function printSurveyReport(page){
  const bm=page.useCase==='仮BM',title=bm?'仮ＢＭ設置箇所':'基準点設置箇所';
  const rows=page.entries.filter(entry=>entry.kind==='row');
  const body=rows.map(entry=>`<tr data-record-id="${esc(entry.recordId)}" style="height:${entry.heightMm||18}mm">${entry.cells.map(cell=>`<td>${cell.map(line=>`<span>${esc(line)||'&#160;'}</span>`).join('')}</td>`).join('')}</tr>`).join('');
  const blanks=[page.groupName,page.itemName,page.section].every(text=>String(text||'').length<80)&&rows.every(row=>(row.heightMm||18)<=18)?Math.max(0,10-rows.length):0;
  return `<section class="reference-survey"><h2>${title}${page.continued?'（続き）':''}</h2><table class="reference-context"><tbody><tr><th>項目名</th><td>${esc(page.itemName)}</td></tr><tr><th>施工箇所</th><td>${esc(page.groupName)}</td></tr><tr><th>施工区間</th><td>${esc(page.section||'')}</td></tr></tbody></table><table class="reference-survey-table"><colgroup>${(bm?[14,23,12,24,27]:[20,20,20,20,20]).map(width=>`<col style="width:${width}%">`).join('')}</colgroup><thead><tr>${(bm?['番号','測点','位置','高さ','備考']:['点名','X座標','Y座標','高さ H','点の種類']).map(label=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${body}${Array.from({length:blanks},()=>`<tr class="blank-row">${Array.from({length:5},()=>'<td>&#160;</td>').join('')}</tr>`).join('')}</tbody></table></section>`;
}

export function printTSReport(page){
  const first=page.records[0],fields=first.record.reportFields||{};
  const meta=value=>String(value||'').length>20?'別紙・補足情報を参照':esc(value||'');
  const rows=page.records.map((context,index)=>{
    return `<tr data-record-id="${esc(context.recordId)}" style="height:${tsRowHeight(context)}mm">${tsReportCells(context).map((cell,index)=>`<td${[2,5].includes(index)?' class="measured"':''}>${tsCellLines(cell).map(line=>`<span>${esc(line)||'&#160;'}</span>`).join('')}</td>`).join('')}</tr>`;
  }).join('');
  const blankRows=Array.from({length:Math.max(0,Math.min(24-page.records.length,Math.floor((96-page.records.reduce((sum,context)=>sum+tsRowHeight(context),0))/3.8)))},()=>`<tr>${Array.from({length:10},()=>'<td>&#160;</td>').join('')}</tr>`).join('');
  return `<section class="reference-ts"><h2>測定結果一覧表</h2><p>路線名：${esc(page.groupName)}</p><div class="ts-form-meta"><div><p>工種　縁石工</p><p>種別　延長（偏心量）</p></div><p>測定者　${meta(fields.surveyor)}　　印</p></div><div class="ts-result-layout"><table><thead><tr><th>測定項目</th><th colspan="3" class="ts-x">△X</th><th colspan="3" class="ts-y">△Y</th><th colspan="3" class="ts-d">偏心量</th></tr><tr><th>規格値</th><td colspan="3">${meta(fields.standard)} mm</td><td colspan="3">${meta(fields.standard)} mm</td><td colspan="3">${meta(fields.standard)} mm</td></tr><tr><th>社内規格値</th><td colspan="3">${meta(fields.internalStandard)} mm</td><td colspan="3">${meta(fields.internalStandard)} mm</td><td colspan="3">${meta(fields.internalStandard)} mm</td></tr><tr><th>測点又は区別</th><th>設計値<br>m</th><th>実測値<br>m</th><th>差<br>mm</th><th>設計値<br>m</th><th>実測値<br>m</th><th>差<br>mm</th><th>△X<br>mm</th><th>△Y<br>mm</th><th>偏心量 d<br>mm</th></tr></thead><tbody>${rows}${blankRows}</tbody></table><aside><h3>略図</h3></aside></div><p class="ts-calculation-note">差＝（実測値－設計値）×1000、偏心量＝√(△X²＋△Y²)をmm単位で四捨五入。規格値の適否判定は行いません。</p></section>`;
}

export function printReferencePhotoRow(row,urls,labels){
  const f=row.fields||{},ts=row.useCase==='TS出来形(バリアフリー)';
  if(ts){const m=tsMeasurements(f);return `<section class="photo-row ts-photo-row" data-record-id="${esc(row.recordId)}"><header>縁石工　延長（偏心量）<br>計測箇所：${esc(tsReportStation(f,row.targetName))}<br>偏心：X=${m?m.dx:'—'}mm　Y=${m?m.dy:'—'}mm　D=${m?m.d:'—'}mm</header><div class="ts-photo-pair"><figure>${image(row.slots[0],urls,labels)}</figure><figure>${image(row.slots[1],urls,labels)}</figure></div></section>`;}
  const bm=row.useCase==='仮BM',point=row.useCase==='基準点',trial=['現密','コア密'].includes(row.useCase);
  const caption=point?`${row.targetName}\n${value(f,'kind')}\nX=${value(f,'x')}\nY=${value(f,'y')}\nH=${value(f,'height')}`:bm?`${row.targetName}\n${value(f,'remarks')}\nH=${value(f,'height')}`:row.useCase==='現密'?`現場密度試験\n${row.category}\n${row.slots[0].name}\n${value(f,'material')}`:`切取供試体密度試験\n${row.slots[0].name}\n${value(f,'material')||row.category}`;
  return `<section class="photo-row photo-primary reference-photo" data-record-id="${esc(row.recordId)}"><div class="photo-main"><figure>${image(row.slots[0],urls,labels)}</figure></div><div class="photo-data"><div class="ref-photo-number">${point?'管理No':'写真NO'}　${row.number}</div><div class="ref-station">測点　${esc(point?row.targetName:value(f,'station'))}${bm&&f.position?` (${esc(f.position)})`:''}</div><div class="ref-caption-label">${point?'点名・種類・座標':bm?'観察・所見':'試験状況'}</div><div class="ref-caption">${lines(caption)}</div>${row.paired?`<figure class="ref-near">${image(row.slots[1],urls,labels)}</figure>`:''}</div></section>`;
}
