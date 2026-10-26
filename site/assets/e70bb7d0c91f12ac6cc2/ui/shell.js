import {renderNotificationShell} from './notifications.js';
import {escapeHTML,button,disclosure,editorDialogFrame,photoDrawerFrame,previewDialogFrame} from './components.js';

/** Shared frames are mounted once, before controllers attach to their stable IDs. */
export function renderAppShell({version='v0.6.0',iconURL=new URL('../icon.svg',import.meta.url).href}={}){
  return `<header class="site-header"><a class="brand" href="./" aria-label="測量フォトノート ホーム"><span class="brand-icon" aria-hidden="true"><img src="${escapeHTML(iconURL)}" alt="" width="36" height="36"></span><span>測量フォトノート</span></a><span class="version">${escapeHTML(version)}</span></header><main>
  <div class="app-utilities"><section class="top-toolbar" aria-label="工事と作業ファイル">${disclosure('工事・取込',button('＋ 新しい工事',{id:'newProject'})+button('作業ZIPを開く',{id:'openPackage'}),{id:'workMenu',kind:'menu',floating:'menu',className:'work-menu',bodyClass:'work-menu-actions'})}${button('<span aria-hidden="true">↓</span> 作業ZIPを保存',{id:'exportPackage',variant:'primary',html:true,attrs:{disabled:true}})}</section>
  ${disclosure('圏外利用の準備状況を確認中',`<div id="offlineStatus" role="status" aria-live="polite">圏外利用の準備状況を確認しています。</div><div class="offline-actions ui-actions">${button('圏外利用を準備',{id:'prepareOffline'})}${button('アプリ更新を確認',{id:'checkUpdate'})}${button('更新内容を確認して切替',{id:'applyUpdate',attrs:{hidden:true}})}</div><p class="hint">アプリ資材の準備と、工事・原本の一時保存は別です。再編集用ZIPも保存してください。</p>`,{id:'offlinePanel',summaryId:'offlineSummary',kind:'control',floating:'panel',className:'offline-panel',attrs:{'data-floating-align':'end'},bodyClass:'offline-body'})}</div>
  ${button('黒板一覧',{id:'boardCatalog',className:'board-catalog-trigger'})}
  ${renderNotificationShell()}
  <div id="app"><div class="empty-state">一時保存を確認しています…</div></div><footer>元写真は加工せず保持します。調書・写真帳を出力した後も、再編集用ZIPを保存してください。<br><span>帳票は簡易様式です。試験計算・合否判定は行いません。</span></footer></main>
  ${editorDialogFrame()}${photoDrawerFrame()}${previewDialogFrame()}
  <input id="cameraInput" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden><input id="photoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden><input id="packageInput" type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden>`;
}
export function mountAppShell(){
  document.getElementById('appShell').innerHTML=renderAppShell({version:`v${document.querySelector('meta[name="app-version"]')?.content||'0.6.0'}`});
}
