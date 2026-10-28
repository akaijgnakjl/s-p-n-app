import {escapeHTML as esc,button,actions,selectField,checkbox,disclosure,panelHeading,badge,photoMeta,optionItems} from './components.js';
import { BOARD_TEMPLATES } from '../boards.js';
import { BOARD_ASSET_URLS } from '../board-assets.js';
import {tsMeasurements,tsLocationLabel} from '../report-data.js';

/** Selection is handled by the caller; catalog cards never change project data themselves. */
export function renderBoardChoices(selectedId, {selectable=true, formId=''}={}) {
  return `<div class="board-catalog" role="group" aria-label="黒板の形式一覧">${Object.values(BOARD_TEMPLATES).filter(item=>item.id!=='legacy-simple').map(item=>{
    const content=`<img src="${esc(BOARD_ASSET_URLS[item.id])}" width="1167" height="876" alt="${esc(item.name)}の黒板見本"><strong>${esc(item.name)}</strong><small>${esc(item.sample)}</small>`;
    return selectable?button(content,{html:true,className:`board-choice${selectedId===item.id?' selected':''}`,attrs:{'data-board-choice':item.id,'data-board-form':formId||undefined,'aria-pressed':String(selectedId===item.id),'aria-label':`${item.name}の黒板を選ぶ`}}):button(`${content}<span class="hint keep">${esc(item.fields.map(field=>field.label).join('・'))}</span>`,{html:true,className:'board-choice board-choice--readonly',attrs:{'data-preview-board':item.id,'aria-label':`${item.name}の黒板を拡大`}});
  }).join('')}</div>`;
}

export function renderTargetPicker({targets,selectedId,selectedName,useCaseFilter,onlyMissing,uses,open,selectedIds=new Set()}){
  const heading=panelHeading('記録対象',{className:'ui-panel-heading--row',actions:button('＋ 追加',{attrs:{'data-action':'add-targets'}})});
  const filters=`<div class="target-picker-filters">${selectField('用途',optionItems([['','すべての用途'],...uses],useCaseFilter),{id:'useCaseFilter',attrs:{class:'target-filter'}})}${checkbox('未撮影の枠がある対象のみ',{id:'onlyMissing',checked:onlyMissing})}</div>`;
  const list=`<div class="target-list">${targets.map(t=>`<div class="target-management-row">${checkbox(`${t.name}を削除用に選択`,{checked:selectedIds.has(t.id),attrs:{'data-select-target':t.id}})}${button(`<span class="target-name">${esc(t.name)}</span>`,{className:`target-button${selectedId===t.id?' selected':''}`,attrs:{'data-target':t.id,'aria-pressed':String(selectedId===t.id),title:t.name},html:true})}${button('削除',{variant:'danger',attrs:{'data-delete-target':t.id,'aria-label':`${t.name}を削除`}})}</div>`).join('')||'<p class="hint keep">この範囲に記録対象はありません。「＋ 追加」から登録します。</p>'}</div>`;
  const deletion=actions(button('表示中を全選択',{attrs:{'data-action':'select-all-targets'}})+button('選択を解除',{attrs:{'data-action':'clear-target-selection'}})+button(`選択を削除（${selectedIds.size}件）`,{variant:'danger',attrs:{'data-action':'delete-selected-targets','data-unavailable':!selectedIds.size?'true':undefined}}));
  return disclosure(`<span>記録対象を選ぶ</span><span class="target-picker-current"><strong>${esc(selectedName||'未選択')}</strong><span class="hint keep">${targets.length}件</span></span>`,heading+filters+list+deletion,{id:'targetPicker',className:'panel record-target-list',kind:'panel',saveKey:'targets',open,labelHTML:true,bodyClass:'target-picker-body'});
}

/** Navigation follows the visible route/use/missing filters, without changing them. */
// 「◀ 前へ ｜ 今の撮影対象 ｜ 次へ ▶」の3段組。撮影枠の上と下で同じものを使う。
export function renderTargetNavigation(targets,selectedId,{placement='top'}={}){
  const index=targets.findIndex(t=>t.id===selectedId),current=targets[index];
  const arrow=(step,label)=>{const target=index>=0?targets[index+step]:null,prev=step<0;
    const body=prev?`<span class="target-nav-icon" aria-hidden="true">◀</span><span class="target-nav-text"><b>前へ</b><small>${esc(target?.name||'なし')}</small></span>`:`<span class="target-nav-text"><b>次へ</b><small>${esc(target?.name||'なし')}</small></span><span class="target-nav-icon" aria-hidden="true">▶</span>`;
    return button(body,{html:true,className:`target-nav-arrow ${prev?'is-prev':'is-next'}`,attrs:{'data-navigate-target':target?.id,'data-target-direction':prev?'previous':'next','data-unavailable':!target?'true':undefined,'aria-label':target?`${label}の記録対象：${target.name}`:`${label}の記録対象はありません`,disabled:!target,title:target?.name}});};
  const now=`<div class="target-nav-current"><small>今の撮影対象${index>=0?` ${index+1} / ${targets.length}`:''}</small><strong>${esc(current?.name||'—')}</strong></div>`;
  return `<nav class="target-navigation is-${placement}" aria-label="記録対象の前後移動">${arrow(-1,'前')}${now}${arrow(1,'次')}</nav>`;
}

export function renderTSReading(record){const fields=record.reportFields||{},m=tsMeasurements(fields);return `<div class="next-date-panel ts-reading"><strong>スクリーンショットの読取結果</strong><p>計測箇所：${esc(tsLocationLabel(fields)||'未読取')}</p><p>X=${m?.dx??'—'}mm ／ Y=${m?.dy??'—'}mm ／ D=${m?.d??'—'}mm</p><p class="hint">BACK→X、LEFT／RIGHT→Yです。画像と見比べて調書を確認してください。</p>${button('調書で確認・訂正',{attrs:{'data-go-report':record.id}})}</div>`;}

export function renderTargetTabs(targets,selectedId){
  const groups=new Map(),selectedUse=targets.find(target=>target.id===selectedId)?.useCase;
  for(const target of targets){
    const group=groups.get(target.useCase)||{useCase:target.useCase,taken:0,required:0,complete:true};
    group.taken+=target.taken||0;group.required+=target.required||0;group.complete&&=target.complete;groups.set(target.useCase,group);
  }
  return `<nav class="target-progress-tabs" aria-label="記録対象の用途と撮影枚数">${[...groups.values()].map(t=>button(`<strong>${esc(t.useCase)}</strong><span>${t.taken}/${t.required}</span><small>${t.complete?'撮影完了':'未完了'}</small>`,{html:true,className:`target-progress-tab ${t.complete?'is-complete':'is-incomplete'}${t.useCase===selectedUse?' selected':''}`,attrs:{'data-use-case-tab':t.useCase,'aria-pressed':String(t.useCase===selectedUse)}})).join('')}</nav>`;
}
const toneFor=status=>status==='taken'?'success':status==='retake'?'danger':status==='unnecessary'?'muted':'warning';
export function renderPhotoSlot({name,status,statusLabel,guide,photo,count,reason,recordId,boardAvailable,screenshot=false}){
  const image=photo?`<div class="slot-thumb">${button(`<img data-thumb="${photo.id}" alt="${esc(name)}の採用写真">`,{html:true,className:'photo-preview-button preview-trigger',attrs:{'data-preview-photo':photo.id,'aria-label':`${name}の画像を拡大`}})}${photoMeta({name:photo.name,title:'採用中の写真',details:[`原本 ${photo.sizeLabel}`,`この枠の写真 ${count}枚（履歴を含む）`],className:'slot-photo-info'})}</div>`:'';
  const extra=button('撮影不要',{variant:'subtle',attrs:{'data-unnecessary':name,'data-record-id':recordId}})+(count&&status==='taken'?button('撮り直し待ち',{variant:'subtle',attrs:{'data-retake':name,'data-record-id':recordId}}):'');
  return `<article class="slot-row">${panelHeading(name,{level:3,className:'ui-panel-heading--row',meta:badge(statusLabel,{tone:toneFor(status),className:status})})}<p class="hint">${esc(guide)}</p>${image}${reason?`<p class="slot-note">撮影不要の理由：${esc(reason)}</p>`:''}${actions((boardAvailable?button('黒板を確認',{attrs:{'data-preview-slot':name}}):'')+(!screenshot?button(count?'再撮影する':'撮影する',{variant:'primary',attrs:{'data-capture':name,'data-record-id':recordId,'data-source':'camera'}}):button('PCで画像を貼り付け',{attrs:{'data-paste-screenshot':recordId}}))+button(screenshot?'スクリーンショットを選ぶ':'写真から選ぶ',{attrs:{'data-capture':name,'data-record-id':recordId,'data-source':'file'}})+disclosure('その他',extra,{kind:'menu',floating:'menu',className:'slot-more',attrs:{'data-floating-align':'end'}}),{className:'slot-actions'})}</article>`;
}
export function renderBoardPanel({recordId,slotName,fieldsHTML,choicesHTML='',trial,noteAuto,applyBoard,editing}){
  const form=`<form id="boardForm" class="board-form">${fieldsHTML}${trial?checkbox('作業内容を自動入力（試験名・施工区分・工程から）',{name:'autoNote',checked:noteAuto})+'<p class="hint">手入力すると自動入力は外れます。チェックすると自動値に戻ります。</p>':''}${actions(button('黒板・調書へ反映',{type:'submit'})+(editing?button('黒板の編集を取り消す',{attrs:{'data-action':'discard-board'}}):''))}<p id="boardDraftStatus" class="hint">${editing?'黒板は編集中です。撮影・黒板保存・ZIP保存時に確定します。':''}</p><p class="hint">位置は調書の測点へ、備考は調書の備考へ反映します。採用写真の黒板も選んだ形式で更新し、変更前の黒板は履歴に残します。</p></form>`;
  // 合成の指定は折りたたみの外に置く。form属性でboardFormの一部として送る。
  const apply=`<div class="board-apply${applyBoard?'':' is-off'}">${checkbox('次の写真に電子黒板を合成する',{name:'applyBoard',checked:applyBoard,attrs:{form:'boardForm'}})}<p class="hint keep">${applyBoard?'実物の黒板を写す場合や、黒板が不要な場合は外してください。':'写真は原本のまま使います。黒板の入力内容は調書へ反映します。'}</p></div>`;
  return `<section class="panel board-details board-preview">${panelHeading('次の写真の黒板',{level:3})}${apply}${choicesHTML}<p id="captureBoardSlot" class="hint">対象写真：${esc(slotName)}</p><div class="board-grid"><div class="board-preview-frame${applyBoard?'':' is-off'}">${applyBoard?'':'<p class="board-off-label">合成しません</p>'}${button('<canvas id="boardPreview" class="board-canvas" width="600" height="450" aria-label="次の写真の黒板プレビュー"></canvas>',{html:true,className:'preview-trigger',attrs:{'data-preview-canvas':'boardPreview','aria-label':'黒板を拡大'}})}<p class="board-caption">参照元と同じ板面・文字配置です。正式な提出様式との一致は未確認です。</p><p id="boardOverflow" class="board-overflow" role="status"></p></div>${disclosure('黒板の内容を編集',form,{className:'board-editor',saveKey:`board-${recordId}`})}</div></section>`;
}
export function renderHistoryPanel({photos,recordId}){
  const cards=photos.length?`<div class="photo-grid">${photos.map(p=>`<article class="photo-card">${button(`<img class="photo-image" data-thumb="${p.id}" alt="${esc(p.slot||'分類待ち')}の原本">`,{html:true,className:'photo-preview-button preview-trigger',attrs:{'data-preview-photo':p.id,'aria-label':`${p.name}の画像を拡大`}})}<div class="photo-info">${badge(p.active?'採用中':'履歴',{tone:p.active?'success':'muted'})}<h3>${esc(p.slot||'分類待ち')}</h3><p>${esc(p.dateLabel)}</p>${button('詳細・訂正',{attrs:{'data-open-photo':p.id}})}</div></article>`).join('')}</div>`:'<p class="hint keep">写真はまだありません。</p>';
  return disclosure(`この記録の写真（原本 ${photos.length}枚）`,cards,{className:'panel review-panel',saveKey:`history-${recordId||'all'}`});
}

export function renderCaptureProgress({records,complete,missing,taken,unnecessary,total}){
  return `<section class="summary-strip"><div><strong>撮影完了 ${complete} / ${records}記録</strong><p class="summary-breakdown"><span>残り ${missing}枠</span><span>／ 撮影済み ${taken}枠</span><span>／ 撮影不要 ${unnecessary}枠</span></p></div><progress class="summary-meter" max="${total||1}" value="${total-missing}" aria-label="撮影の進捗"></progress></section>`;
}
