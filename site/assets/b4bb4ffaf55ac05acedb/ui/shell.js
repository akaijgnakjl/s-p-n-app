import {renderNotificationShell} from './notifications.js';
import {escapeHTML,button,disclosure,editorDialogFrame,photoDrawerFrame,previewDialogFrame} from './components.js';

/** Shared frames are mounted once, before controllers attach to their stable IDs. */
export function renderAppShell({version='v0.6.0',iconURL=new URL('../icon.svg',import.meta.url).href}={}){
  return `<header class="site-header"><a class="brand" href="./" aria-label="測量フォトノート ホーム"><span class="brand-icon" aria-hidden="true"><img src="${escapeHTML(iconURL)}" alt="" width="36" height="36"></span><span>測量フォトノート</span></a><div class="header-tools">${button('説明',{id:'helpToggle',variant:'subtle',attrs:{'aria-pressed':'false',title:'画面の説明文を表示・非表示'}})}${button('通知',{id:'notificationHistoryButton',variant:'subtle',attrs:{'aria-expanded':'false',title:'これまでの通知をまとめて表示'}})}<span class="version">${escapeHTML(version)}</span></div></header><main>
  <div class="app-utilities"><section class="top-toolbar" aria-label="工事と作業ファイル">${disclosure('工事・取込',button('＋ 新しい工事',{id:'newProject'})+button('作業ZIPを開く',{id:'openPackage'}),{id:'workMenu',kind:'menu',floating:'menu',className:'work-menu',bodyClass:'work-menu-actions'})}${button('<span aria-hidden="true">↓</span> 作業ZIPを保存',{id:'exportPackage',variant:'primary',html:true,attrs:{disabled:true}})}</section>
  ${disclosure('圏外利用の準備状況を確認中',`<div id="offlineStatus" role="status" aria-live="polite">圏外利用の準備状況を確認しています。</div><div class="offline-actions ui-actions">${button('圏外利用を準備',{id:'prepareOffline'})}${button('アプリ更新を確認',{id:'checkUpdate'})}${button('更新を確認して切り替え',{id:'applyUpdate',attrs:{hidden:true}})}</div><p class="hint">圏外利用の準備では、工事や原本は保存されません。作業ZIPも保存してください。</p>`,{id:'offlinePanel',summaryId:'offlineSummary',kind:'control',floating:'panel',className:'offline-panel',attrs:{'data-floating-align':'end'},bodyClass:'offline-body'})}</div>
  ${button('黒板一覧',{id:'boardCatalog',className:'board-catalog-trigger'})}
  ${renderNotificationShell()}
  <div id="app"><div class="empty-state">一時保存を確認しています…</div></div><footer>原本は加工せず保持します。調書・写真帳の出力後も、作業ZIPを保存してください。<br><span>帳票は簡易様式です。試験計算・合否判定は行いません。</span></footer></main>
  ${editorDialogFrame()}${photoDrawerFrame()}${previewDialogFrame()}
  <input id="cameraInput" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden><input id="photoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden><input id="packageInput" type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden>`;
}
export function mountAppShell(){
  document.getElementById('appShell').innerHTML=renderAppShell({version:`v${document.querySelector('meta[name="app-version"]')?.content||'0.6.0'}`});
  // 説明文はふだん隠し、「説明」ボタンで全画面まとめて出す。選んだ状態はこの端末に覚える。
  const toggle=document.getElementById('helpToggle'),apply=on=>{document.body.classList.toggle('show-help',on);toggle.setAttribute('aria-pressed',String(on));toggle.textContent=on?'説明を隠す':'説明';};
  let on=false;try{on=localStorage.getItem('spn-show-help')==='1';}catch{}
  apply(on);
  toggle.addEventListener('click',()=>{on=!on;apply(on);try{localStorage.setItem('spn-show-help',on?'1':'0');}catch{}});
}
