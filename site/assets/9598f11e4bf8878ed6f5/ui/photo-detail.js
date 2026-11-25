import {escapeHTML as esc,button,actions,panelHeading,badge,metaList,disclosure} from './components.js';

export function detailHero({photoId,title,subtitle,status,tone}){
  return `<div class="photo-detail-preview">${button('<img id="detailOriginal" alt="選択した写真の原本">',{html:true,className:'preview-trigger preview-image-trigger',attrs:{'data-preview-photo':photoId,'aria-label':'原本画像を拡大'}})}<span class="hint">原本を表示しています。電子黒板は下で確認できます。</span></div><div class="detail-title">${panelHeading(title,{level:3,meta:badge(status,{tone}),description:subtitle})}</div>`;
}
export function detailSection(title,content,{actionHTML=''}={}){
  return `<section class="detail-section">${panelHeading(title,{level:3,className:'ui-panel-heading--row',actions:actionHTML})}${content}</section>`;
}
export function renderDateDetails({entries,sourceEntries}){
  return metaList(entries,{className:'photo-date'})+(sourceEntries?disclosure('旧データの出所',metaList(sourceEntries),{className:'details-text'}):'');
}
export function photoTimeline(items){
  return `<p class="hint">取込日時の新しい順です。採用状態は現在のものです。</p><ol class="photo-timeline">${items.map(p=>`<li>${badge(p.active?'採用中':'履歴',{tone:p.active?'success':'muted'})}<strong>${esc(p.importedLabel)}</strong><p>${esc(p.name)} ／ ${esc(p.dateLabel)}</p>${p.current?'<span class="hint keep">表示中</span>':button('この写真を開く',{attrs:{'data-open-photo':p.id}})}</li>`).join('')}</ol>`;
}
export function photoPagination({previousId,nextId,index,total}){
  return `<nav class="drawer-pagination" aria-label="写真を順に確認">${button('前の写真',{attrs:previousId?{'data-open-photo':previousId}:{'data-unavailable':'true'}})}<span>${index+1} / ${total}</span>${button('次の写真',{attrs:nextId?{'data-open-photo':nextId}:{'data-unavailable':'true'}})}</nav>`;
}
