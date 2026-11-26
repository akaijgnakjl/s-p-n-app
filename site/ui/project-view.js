import {LIMITS,OUTPUT_LIMITS} from '../definitions.js';
import {formatBytes} from '../limits.js';
import {escapeHTML as esc,button,actions,actionBlock,disclosure,panelHeading,tabButton,tabBar,textField} from './components.js';

// お試し中の帯。工事名・作業日を決めずに使え、作業ZIPの保存は求めない。本番の工事にするか、削除して終わる。
export function renderTrialBanner(){
  return `<section class="trial-banner" role="status"><div><strong>お試し中</strong><span>工事を作らずに、作成・削除を自由に試せます。作業ZIPへの保存は不要です（この端末にだけ一時保存）。</span></div>${actions(button('本番の工事にする',{variant:'primary',attrs:{'data-action':'convert-trial'}})+button('お試しを削除して最初に戻る',{variant:'danger',attrs:{'data-action':'end-trial'}}),{className:'trial-banner-actions'})}</section>`;
}
export function renderProjectHeader({name,trial=false,storageAvailable,zipDirty,mode,groups,activeGroupId,progressHTML=''}){
  const status=trial?'お試し（作業ZIPの保存は不要）':zipDirty?'作業ZIPに未保存の変更あり':'作業ZIPと同じ内容';
  const project=(trial?renderTrialBanner():'')+`<section class="project-bar"><div class="project-title">${panelHeading(name,{className:'ui-panel-heading--inline',actions:trial?'':button('訂正',{attrs:{'data-action':'rename-project','aria-label':'工事名を訂正'}})})}<small><span>${storageAvailable?'端末に一時保存':'一時保存なし'}</span> ・ <span>${status}</span></small></div></section>`;
  const navigation=tabBar([['field','撮影・確認'],['organize','写真を整理'],['report','調書入力'],['output','出力'],['handoff','ZIP受け渡し']].map(([id,label])=>tabButton(label,{selected:id===mode,attrs:{'data-mode':id,'aria-current':id===mode?'page':'false'}})).join(''),{label:'作業の切り替え',role:'navigation',className:'steps app-navigation'});
  const scope=mode==='output'||mode==='handoff'?'':tabBar(groups.map(g=>button(`${esc(g.label)}<small>${g.count}</small>`,{html:true,className:g.id===activeGroupId?'selected':'',attrs:{'data-group-scope':g.id,'aria-pressed':String(g.id===activeGroupId)}})).join('')+button('＋ 路線',{variant:'subtle',attrs:{'data-action':'add-group'}})+(activeGroupId&&activeGroupId!=='__all__'?button('路線名を訂正',{variant:'subtle',attrs:{'data-edit-group':activeGroupId}}):''),{label:'表示する所属',role:'navigation',className:'workspace-scope-nav'});
  // 手順の上に「現場は1で終わり・2〜5は持ち帰り後」を示す見出しを置く（矢羽根の1と2〜5の幅に合わせる）。
  const place='<div class="work-place-legend"><span class="is-field"><strong>現場</strong><span>1で終わり</span></span><span class="is-office"><strong>持ち帰り後</strong><span>2〜5は会社のPCなどで</span></span></div>';
  return project+`<div class="workspace-sticky-nav">${place}${navigation}${scope}${progressHTML}</div>`;
}
export function renderCapacity({count,maxCount,adopted,bytes,limitBytes=LIMITS.totalBytes,near,reached}){
  const bytesLabel=formatBytes(bytes),limitLabel=formatBytes(limitBytes),remainingLabel=formatBytes(Math.max(0,limitBytes-bytes));
  const content=`<p>採用 ${adopted}枚 ／ 採用外・履歴 ${count-adopted}枚。残り最大${maxCount-count}枚・${esc(remainingLabel)}。写真が大きいと、枚数より先に容量が上限に達します。</p><p class="hint keep">使用量 ${esc(bytesLabel)} ／ 保管上限 ${esc(limitLabel)}。GBは十進単位です。作業ZIPは管理情報の分だけ少し大きくなります。</p><p class="hint">帳票1回の出力は採用${OUTPUT_LIMITS.embeddedPhotos}枚・埋込画像${OUTPUT_LIMITS.embeddedBytes/1024/1024}MiBまでです。超える場合は範囲を分けて出力します。</p><progress max="${limitBytes}" value="${bytes}" aria-label="原本容量の使用量"></progress>${near||reached?`<p class="field-error">${reached?'保管上限に達しています。写真は追加できません。':'保管上限に近づいています。'}原本・履歴は自動で圧縮・削除しません。</p>`:''}`;
  return disclosure(`<strong>原本 ${count} / ${maxCount}枚</strong><span>${esc(bytesLabel)} / ${esc(limitLabel)}</span><span class="hint keep">${reached?'上限に達しています':near?'上限に近づいています':'容量の詳細'}</span>`,content,{className:'capacity-panel',kind:'compact',saveKey:'capacity',labelHTML:true});
}
// 工事全体の作業日。これから撮る写真の作業日と黒板の「撮影月日」に入る。日が変わると撮影・取込の前に確認する。
export function renderWorkDate({dateLabel,confirmed}){
  return `<section class="next-date-panel${confirmed?'':' is-unconfirmed'}"><div><h3>作業日（この工事）</h3><p>${esc(dateLabel)}${confirmed?'（今日確認済み）':'（未確認：次の撮影・取込の前に確認します）'}</p></div>${button('作業日を変更',{attrs:{'data-action':'change-work-date'}})}${disclosure('日付の扱い','<p class="hint">これから撮る写真の作業日と、黒板の「撮影月日」に入ります。撮影済みの写真は「写真を整理」の「作業日をまとめて変更」で直します。</p>',{saveKey:'date-help'})}</section>`;
}
const todayLocal=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export function renderProjectSetupFields({name='',routeName='',id,workDate=todayLocal()}={}){
  return textField('工事名',{name:'name',id,value:name,max:100,required:true})+textField('路線名',{name:'routeName',value:routeName,max:300,required:true})+textField('作業日',{name:'workDate',value:workDate,type:'date',required:true})+'<p class="hint">路線名を入力してから、路線ごとに記録対象を登録します。作業日は黒板の「撮影月日」に入ります。日が変わると、最初の撮影・取込の前に確認します。</p>';
}
export function renderInitialView({name='',routeName='',maxPhotos=LIMITS.photos}={}){
  const limitLabel=formatBytes(LIMITS.totalBytes);
  const fields=renderProjectSetupFields({name,routeName,id:'initialProjectName'});
  const controls=actions(button('この工事を始める',{type:'submit',variant:'primary'})+button('作業ZIPを開く',{attrs:{'data-action':'open'}}),{className:'project-setup-actions'});
  const limits=disclosure('写真の形式と上限',`<p class="hint">工事全体の上限は履歴込み${esc(maxPhotos)}枚・原本合計${esc(limitLabel)}。1枚は${LIMITS.imageBytes/1024/1024}MiB・${LIMITS.pixels/10000}万画素・一辺${LIMITS.side}pxまでです。形式はJPEG / PNG / WebPです。未定義の「現場写真」は登録できません。</p>`,{className:'project-setup-limits'});
  const trial=`<div class="project-setup-trial"><div><strong>まず試してみる</strong><p class="hint keep">工事名・路線名・作業日を決めずに、記録対象・写真・黒板・調書・出力を試せます。作業ZIPの保存は不要で、あとから本番の工事にもできます。</p></div>${button('お試しで使う（工事を作らない）',{attrs:{'data-action':'start-trial'}})}</div>`;
  return `<section class="panel project-setup">${panelHeading('新しい工事')}<form id="initialProjectForm" class="project-setup-form">${fields}${controls}</form>${trial}${limits}</section>`;
}
// 作業ZIPを保存して終了する欄。撮影・確認とZIP受け渡しの両方に置く（ZIPの保存はこの中のダイアログで行う）。
export function renderFinishWork(){
  return `<section class="panel review-panel finish-work-panel">${panelHeading('作業の終了',{level:3,className:'ui-panel-heading--responsive',description:'作業ZIPを保存した後、このブラウザーの一時保存を消去できます。',actions:button('保存を確認して作業を終了',{variant:'danger',attrs:{'data-action':'finish-work'}})})}${actions(button('ギガファイル',{attrs:{'data-action':'open-gigafile','aria-label':'ギガファイル便（gigafile.nu）を開く'}}),{className:'finish-work-links'})}</section>`;
}
export function renderHandoff({targetCount,photoCount,sizeValue,sizeUnit,lastExportLabel,missing,unnecessary,maxPhotos}){
  const limitLabel=formatBytes(LIMITS.totalBytes);
  return `<div class="handoff-layout"><section class="panel">${panelHeading('作業ZIPの内容',{eyebrow:'SAVE YOUR WORK',description:'全用途の記録対象・所属・原本・黒板・採用・履歴・撮影不要の理由・調書を含みます。保存は下の「作業の終了」から行います。'})}<div class="file-stats"><div><strong>${targetCount}</strong><small>記録対象</small></div><div><strong>${photoCount}</strong><small>原本</small></div><div><strong>${esc(sizeValue)}</strong><small>${esc(sizeUnit)} / 原本合計</small></div></div>${lastExportLabel?`<p class="hint keep">${esc(lastExportLabel)}</p>`:''}<p class="limits-note">残り ${missing}枠・撮影不要 ${unnecessary}枠。工事全体は履歴込み${maxPhotos}枚・原本合計${esc(limitLabel)}までです。帳票1回の出力は採用${OUTPUT_LIMITS.embeddedPhotos}枚・埋込画像${OUTPUT_LIMITS.embeddedBytes/1024/1024}MiBまでです。</p></section><section class="panel">${panelHeading('会社PCで続きを開く',{eyebrow:'CONTINUE ON YOUR PC'})}<ol class="handoff-steps"><li><strong>スマホでZIPを保存</strong><br>保存先にファイルがあるか確認します。</li><li><strong>社内の方法でPCへ渡す</strong><br>社内Googleドライブなどで、PCへダウンロードします。</li><li><strong>PCで同じアプリを開く</strong><br>下の「受け取った作業ZIPを開く」でZIPを選ぶと、原本・黒板・所属を復元します。ZIPの展開は不要です。</li></ol>${actionBlock(button('受け取った作業ZIPを開く',{className:'full-width',attrs:{'data-action':'open'}}),'複数端末で同時に編集した内容は統合されません。最新版を順番に渡してください。旧版（上限100枚・256MiB）のアプリでは開けない場合があります。渡す側と受け取る側の両方を更新してください。')}</section></div>${renderFinishWork()}`;
}
