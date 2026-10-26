import {LIMITS,OUTPUT_LIMITS} from '../definitions.js';
import {formatBytes} from '../limits.js';
import {escapeHTML as esc,button,actions,actionBlock,disclosure,panelHeading,tabButton,tabBar,textField} from './components.js';

export function renderProjectHeader({name,storageAvailable,zipDirty,mode,groups,activeGroupId}){
  const project=`<section class="project-bar"><div class="project-title">${panelHeading(name,{className:'ui-panel-heading--inline',actions:button('訂正',{attrs:{'data-action':'rename-project','aria-label':'工事名を訂正'}})})}<small><span>${storageAvailable?'端末に一時保存':'一時保存なし'}</span> ・ <span>${zipDirty?'ZIPに未書出の変更あり':'受渡ファイルの内容'}</span></small></div></section>`;
  const navigation=tabBar([['field','撮影・確認'],['organize','写真を整理'],['report','調書入力'],['output','出力'],['handoff','ZIP受け渡し']].map(([id,label])=>tabButton(label,{selected:id===mode,attrs:{'data-mode':id,'aria-current':id===mode?'page':'false'}})).join(''),{label:'作業の切り替え',role:'navigation',className:'steps app-navigation'});
  const scope=mode==='output'||mode==='handoff'?'':tabBar(groups.map(g=>button(`${esc(g.label)}<small>${g.count}</small>`,{html:true,className:g.id===activeGroupId?'selected':'',attrs:{'data-group-scope':g.id,'aria-pressed':String(g.id===activeGroupId)}})).join('')+button('＋ 路線',{variant:'subtle',attrs:{'data-action':'add-group'}})+(activeGroupId&&activeGroupId!=='__all__'?button('路線名を訂正',{variant:'subtle',attrs:{'data-edit-group':activeGroupId}}):''),{label:'表示する所属',role:'navigation',className:'workspace-scope-nav'});
  return project+navigation+scope;
}
export function renderCapacity({count,maxCount,adopted,bytes,limitBytes=LIMITS.totalBytes,near,reached}){
  const bytesLabel=formatBytes(bytes),limitLabel=formatBytes(limitBytes),remainingLabel=formatBytes(Math.max(0,limitBytes-bytes));
  const content=`<p>採用 ${adopted}枚 ／ 採用外・履歴 ${count-adopted}枚。残り最大${maxCount-count}枚・${esc(remainingLabel)}。写真サイズにより容量が先に達する場合があります。</p><p class="hint">使用量 ${esc(bytesLabel)} ／ 保管上限 ${esc(limitLabel)}。GBは十進単位です。作業ZIPには管理情報・ZIP構造の付加容量が含まれます。</p><p class="hint">帳票1回の出力は採用${OUTPUT_LIMITS.embeddedPhotos}枚・埋込画像${OUTPUT_LIMITS.embeddedBytes/1024/1024}MiBまで。保管量とは別に、範囲を分けて出力できます。</p><progress max="${limitBytes}" value="${bytes}" aria-label="原本容量の使用量"></progress>${near||reached?`<p class="field-error">${reached?'工事全体の保管上限に達しています。写真は追加できません。':'工事全体の上限に近づいています。'}原本・履歴は自動圧縮・削除しません。</p>`:''}`;
  return disclosure(`<strong>原本 ${count} / ${maxCount}枚</strong><span>${esc(bytesLabel)} / ${esc(limitLabel)}</span><span class="hint">${reached?'上限に達しています':near?'上限に近づいています':'容量の詳細'}</span>`,content,{className:'capacity-panel',kind:'compact',saveKey:'capacity',labelHTML:true});
}
export function renderNextDate({recordId,dateLabel}){
  return `<section class="next-date-panel"><div><h3>次の写真の作業日</h3><p>${esc(dateLabel)}</p></div>${button('作業日を設定',{attrs:{'data-next-date':recordId}})}${disclosure('日付の扱い','<p class="hint">黒板と別に管理します。次回用の日付を変えても、既存写真の日付は変わりません。</p>',{saveKey:'date-help'})}</section>`;
}
export function renderProjectSetupFields({name='',routeName='',id}={}){
  return textField('工事名',{name:'name',id,value:name,max:100,required:true})+textField('路線名',{name:'routeName',value:routeName,max:300,required:true})+'<p class="hint">路線名を入力してから、路線ごとに記録対象を登録します。</p>';
}
export function renderInitialView({name='',routeName='',maxPhotos=LIMITS.photos}={}){
  const limitLabel=formatBytes(LIMITS.totalBytes);
  const fields=renderProjectSetupFields({name,routeName,id:'initialProjectName'});
  const controls=actions(button('この工事を始める',{type:'submit',variant:'primary'})+button('作業ZIPを開く',{attrs:{'data-action':'open'}}),{className:'project-setup-actions'});
  const limits=disclosure('対応する写真と保管上限',`<p class="hint">履歴込み${esc(maxPhotos)}枚・原本合計${esc(limitLabel)}。1枚${LIMITS.imageBytes/1024/1024}MiB・${LIMITS.pixels/10000}万画素・一辺${LIMITS.side}pxまで。JPEG / PNG / WebPに対応します。未定義の「現場写真」は登録対象外です。</p>`,{className:'project-setup-limits'});
  return `<section class="panel project-setup">${panelHeading('新しい工事の設定')}<form id="initialProjectForm" class="project-setup-form">${fields}${controls}</form>${limits}</section>`;
}
export function renderHandoff({targetCount,photoCount,sizeValue,sizeUnit,lastExportLabel,missing,unnecessary,maxPhotos}){
  const limitLabel=formatBytes(LIMITS.totalBytes);
  return `<div class="handoff-layout"><section class="panel">${panelHeading('写真と記録を、ひとつのZIPに。',{eyebrow:'SAVE YOUR WORK',description:'全用途の記録対象・任意グループ・原本・黒板・採用・履歴・不要理由・調書を含めます。'})}<div class="file-stats"><div><strong>${targetCount}</strong><small>記録対象</small></div><div><strong>${photoCount}</strong><small>元写真</small></div><div><strong>${esc(sizeValue)}</strong><small>${esc(sizeUnit)} / 原本合計</small></div></div>${actionBlock(button('↓ PCへ渡す作業ZIPを保存',{variant:'primary',className:'full-width',attrs:{'data-action':'export'}}),lastExportLabel||'写真・調書の編集中でも保存できます。写真がない準備用ファイルも渡せます。')}<p class="limits-note">残り ${missing}枠・撮影不要 ${unnecessary}枠。工事全体は履歴込み${maxPhotos}枚・原本合計${esc(limitLabel)}まで。帳票1回の出力は採用${OUTPUT_LIMITS.embeddedPhotos}枚・埋込画像${OUTPUT_LIMITS.embeddedBytes/1024/1024}MiBまでです。</p></section><section class="panel">${panelHeading('会社PCで続きを開く',{eyebrow:'CONTINUE ON YOUR PC'})}<ol class="handoff-steps"><li><strong>スマホでZIPを保存</strong><br>端末の保存先にファイルがあることを確認します。</li><li><strong>社内の方法でPCへ渡す</strong><br>社内Googleドライブ等を利用し、PCへダウンロードします。</li><li><strong>PCで同じアプリを開く</strong><br>下の「受け取った作業ZIPを開く」ボタンからZIPを選ぶと、原本・黒板・所属を復元します。ZIPを手動で展開する必要はありません。</li></ol>${actionBlock(button('受け取った作業ZIPを開く',{className:'full-width',attrs:{'data-action':'open'}}),'同じ工事を複数端末で同時に編集した内容の自動統合は行いません。最新版を順番に渡してください。旧100枚・256MiB上限のアプリでは開けない場合があります。受渡し元と受渡し先の両方を更新してください。')}</section></div><section class="panel review-panel">${panelHeading('一時作業の終了',{level:3,className:'ui-panel-heading--responsive',description:'再編集用ZIPを保存した後、このブラウザーの一時作業を消去できます。',actions:button('保存を確認して作業を終了',{variant:'danger',attrs:{'data-action':'finish-work'}})})}</section>`;
}
