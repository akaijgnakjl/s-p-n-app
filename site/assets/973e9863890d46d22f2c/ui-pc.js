import { USE_CASES } from './model.js';
import { LIMITS, OUTPUT_LIMITS } from './definitions.js';
import {formatBytes} from './limits.js';
import { reportReviewState, reportMissingFields, sectionLabel, getReportItemName, effectiveReportSection,visibleReportColumns } from './report-data.js';
import { buildOutputModel } from './reports.js';
import { TS_COMMON_KEYS } from './workflow.js';
import { escapeHTML as esc, attrs, button, actions, textareaField, selectField, checkbox, disclosure, panelHeading, badge, notice, tabButton, tabBar, emptyState } from './ui/components.js';

const reviewLabels = { reviewed: '入力確認済み', unreviewed: '未確認', stale: '要再確認' };
export function scopedRecords(project, groupId = '__all__', useCase = '') {
  return project.targets.filter(target => (groupId === '__all__' || target.groupId === (groupId || null)) && (!useCase || target.useCase === useCase))
    .flatMap(target => target.records.map(record => ({ target, record, group: project.groups.find(group => group.id === target.groupId) || null })));
}
const option = (value, label, selected) => `<option${attrs({ value, selected })}>${esc(label)}</option>`;

export function renderReportView(project, { groupId = '__all__', useCase = '基準点', drafts = new Map() } = {}) {
  const available=[...new Set(scopedRecords(project,groupId).map(c=>c.target.useCase))];
  if(available.length&&!available.includes(useCase))useCase=available[0];
  const definition = USE_CASES[useCase], rows = scopedRecords(project, groupId, useCase), columns = visibleReportColumns(useCase);
  const visibleDraftCount = rows.reduce((count, { record }) => count + columns.filter(column => drafts.has(`${record.id}:${column.key}`)).length, 0);
  const tabs = tabBar(available.map(name=>{const records=scopedRecords(project,groupId,name),complete=records.every(({record})=>reportReviewState(project,record.id)==='reviewed'&&!visibleReportColumns(name).some(column=>drafts.has(`${record.id}:${column.key}`)));return tabButton(`${name} ${complete?'入力完了':'未完了'}`,{selected:name===useCase,className:complete?'is-complete':'is-incomplete',attrs:{'data-report-use':name}});}).join(''),{className:'report-tabs',label:'調書の用途'});
  let heading = `<section class="panel">${panelHeading('調書入力', { eyebrow: 'SIMPLE RECORD SHEET', className: 'section-heading', meta: '<span class="hint">撮影とは別に確認します</span>', actions: button('帳票の項目名を設定', { attrs: { 'data-action': 'report-settings' } }), description: 'Excelの範囲を貼り付けできます。1セル300文字までです。はみ出した範囲や文字は切り捨てません。' })}${tabs}`;
  if (!columns.length) return heading + emptyState('MMSは調書入力が不要です', '前・後の写真を確認し、出力から写真帳を作成します。施工区間も不要です。', { level: 3 }) + '</section>';
  if(useCase==='TS出来形(バリアフリー)')heading+='<div class="dialog-note"><strong>スクリーンショットから入力</strong><p>BACK（BUCK）の数値をX、LEFT／RIGHT（LIGHT）の数値をYに入力します。画面下部の「68.29R」などは「測点又は区別」へ入力します。末尾にL/Rがあれば左右欄は不要です。</p><p>数値はm単位です（0.002m＝2mm）。設計値が0の記録は、画面の数値を実測値に入力します。取込時に数値は自動入力されます。画像と照合してから入力確認済みにしてください。</p></div>';
  if (!rows.length) return `${heading}<p class="hint keep">この所属・用途の記録はありません。撮影・確認で記録対象を登録してください。</p></section>`;
  const controls = actions(button('編集中の調書をすべて保存', { attrs: { 'data-action': 'save-reports' } })
    + button('表示中の編集を取り消す', { attrs: { 'data-action': 'discard-reports', 'data-unavailable': visibleDraftCount ? undefined : 'true' } })
    + button('表示中の調書を入力確認済みにする', { variant: 'primary', attrs: { 'data-action': 'review-reports' } })
    + button('出力へ', { attrs: { 'data-mode': 'output' } }), { className: 'report-actions' });
  const tableRows = rows.map(({ target, record, group }, rowIndex) => {
    const state = reportReviewState(project, record.id), missing = reportMissingFields(project, record.id);
    const editing = columns.some(column => drafts.has(`${record.id}:${column.key}`));
    const cells = columns.map((column, columnIndex) => {
      const value = drafts.get(`${record.id}:${column.key}`) ?? record.reportFields?.[column.key] ?? '';
      const label = `${target.name} ${record.category} ${column.label}`;
      const field = textareaField(label, { value, rows: 2, max: null, required: false, className: 'report-cell-field', attrs: {
        'data-report-key': column.key, 'data-record-id': record.id, 'data-report-row': rowIndex, 'data-report-col': columnIndex,
        'aria-label': label, 'aria-invalid': value.length > 300 ? 'true' : undefined,
      } });
      return `<td>${field}<small${attrs({ 'data-report-counter': `${record.id}:${column.key}` })}>${value.length}/300文字</small></td>`;
    }).join('');
    const recordControls = button('この記録の入力を確認', { attrs: { 'data-review-record': record.id } });
    return `<tr><th scope="row">${esc(target.name)}<small>${esc(record.category)}<br>項目名：${esc(getReportItemName(project, record.id))}<br>${esc(group ? `${group.kind}：${group.name}` : '工事直下')}</small></th>${cells}<td>${badge(editing ? '編集中' : reviewLabels[state], { tone: state === 'reviewed' && !editing ? 'success' : 'warning' })}${missing.length ? `<p class="hint keep">未入力：${esc(missing.join('、'))}</p>` : ''}${recordControls}<p class="hint">${esc(sectionLabel(effectiveReportSection(project,record.id)) || '施工区間は未設定です（任意）。')}</p></td></tr>`;
  }).join('');
  // 未設定は赤、設定済みは緑。TS出来形では測定者・規格値の一括入力も同じ色分けで並べる。
  const statusButton=(label,done,attributes)=>button(`${done?'✓ 設定済み：':'未設定：'}${label}`,{className:`route-status-button ${done?'is-done':'is-missing'}`,attrs:attributes});
  const routeSections=project.groups.filter(g=>groupId==='__all__'||g.id===groupId).map(g=>{
    const ts=useCase==='TS出来形(バリアフリー)'?scopedRecords(project,g.id,useCase):[];
    const tsDone=ts.length>0&&ts.every(({record})=>TS_COMMON_KEYS.every(key=>String(record.reportFields?.[key]||'').trim()));
    const notations=new Set(ts.map(({record})=>record.reportFields?.stationNotation==='自由入力'?record.reportFields.stationCustom:record.reportFields?.stationNotation));
    const notationDone=ts.length>0&&!notations.has(undefined)&&!notations.has('');
    const notationLabel=`測点の頭${notationDone&&notations.size===1?`（${[...notations][0]}）`:''}を選択`;
    return `<section class="route-section-panel"><strong>路線：${esc(g.name)}</strong><p>${esc(sectionLabel(g.reportSection)||'施工区間は未設定です。')}</p>${actions(statusButton('施工区間を設定',Boolean(g.reportSection),{'data-route-section':g.id})+(ts.length?statusButton('測定者・規格値・社内規格値を入力',tsDone,{'data-ts-common':g.id})+statusButton(notationLabel,notationDone,{'data-ts-station':g.id}):''),{className:'route-status-actions'})}</section>`;
  }).join('');
  return `${heading}${routeSections}${controls}<p id="reportEditStatus" class="hint" role="status">${drafts.size ? '未保存の編集があります。保存・入力確認・ZIP保存で確定します。' : '保存済みの内容です。'}</p><div class="report-table-wrap"><table class="report-input-table"><thead><tr><th>対象・${esc(definition.categoryLabel)}</th>${columns.map(column => `<th>${esc(column.label)}</th>`).join('')}<th>確認・任意設定</th></tr></thead><tbody>${tableRows}</tbody></table></div><p class="hint ui-section-note">座標・高さは入力のみです。計算・合否判定はしません。備考は任意です。</p></section>`;
}

export function renderOutputView(project, { groupId = '__all__', useCase = '', selectedIds = new Set(), edition = 'draft', prepared = null, ready = false, approved = false } = {}) {
  const rows = scopedRecords(project, groupId, useCase), allowed = new Set(rows.map(row => row.record.id));
  const chosen = [...selectedIds].filter(id => allowed.has(id));
  let model, issueError = '';
  try { if (chosen.length) model = buildOutputModel(project, { recordIds: chosen, edition: 'draft' }); } catch (error) { issueError = error.message; }
  const issues = model?.issues || [];
  const selectedPhotoCount = model?.selectedPhotoIds.length ?? 0, outputTooLarge = selectedPhotoCount > OUTPUT_LIMITS.embeddedPhotos;
  const stepper = tabBar([['outputRange', '1 出力範囲'], ['outputChecks', '2 不足・版を確認'], ['outputResult', '3 プレビュー・印刷']].map(([id, label]) => `<a href="#${id}">${label}</a>`).join(''), { role: 'navigation', className: 'output-stepper', label: '出力の手順' });
  const settings = `<div id="outputRange" class="output-settings">${selectField('所属', option('__all__', 'すべて', groupId === '__all__') + option('', '工事直下（グループなし）', !groupId) + project.groups.map(group => option(group.id, `${group.kind}：${group.name}`, group.id === groupId)).join(''), { id: 'outputGroup' })}${selectField('用途', option('', 'すべての用途', !useCase) + Object.keys(USE_CASES).map(name => option(name, name, name === useCase)).join(''), { id: 'outputUse' })}${selectField('版', option('draft', '途中版（不足・未確認を表示）', edition === 'draft') + option('final', '完成版（不足・要再確認なし）', edition === 'final'), { id: 'outputEdition' })}</div>`;
  const recordButtons = actions(button('すべて選択', { attrs: { 'data-action': 'output-all' } }) + button('選択を解除', { attrs: { 'data-action': 'output-none' } }), { className: 'actions' });
  const recordList = `<div class="output-record-list">${rows.map(({ target, record, group }) => checkbox(`${target.name} ／ ${target.useCase} ／ ${record.category}`, { checked: selectedIds.has(record.id), attrs: { 'data-output-record': record.id }, description: group ? `${group.kind}：${group.name}` : '工事直下' })).join('') || '<p class="hint keep">対象の記録がありません。</p>'}</div>`;
  const records = disclosure(`出力する記録：${chosen.length} / ${rows.length}記録`, recordButtons + recordList, { className: 'output-records', saveKey: 'output-records' });
  const issueContent = issueError ? notice(issueError, { tone: 'error', role: 'alert', className: 'field-error' }) : !chosen.length ? '<p class="hint keep">出力する記録を選択してください。</p>' : issues.length
    ? `<p class="hint keep">不足・未入力・要再確認が${issues.length}件あります。途中版で確認できます。</p>${disclosure(`確認事項：${issues.length}件`, `<ul>${issues.map(issue => `<li>${esc(issue.targetName)} ／ ${esc(issue.category)}：${esc(issue.message)}</li>`).join('')}</ul>`, { className: 'output-issue-details', saveKey: 'output-issues' })}`
    : notice('撮影不足・調書の未確認はありません。');
  const limits = `<p class="hint">工事の上限：履歴を含め${LIMITS.photos}枚・原本合計${esc(formatBytes(LIMITS.totalBytes))}。1回の出力：採用写真${OUTPUT_LIMITS.embeddedPhotos}枚・画像合計${OUTPUT_LIMITS.embeddedBytes / 1024 / 1024}MiBまで。</p>${model ? `<p class="hint keep">採用写真：${selectedPhotoCount} / ${OUTPUT_LIMITS.embeddedPhotos}枚（履歴写真は含みません）。</p>` : ''}${outputTooLarge ? notice('採用写真が1回の上限を超えています。用途・記録を選び、分けて出力してください。原本の削除・圧縮は不要です。', { tone: 'warning' }) : ''}`;
  const checks = `<div id="outputChecks" class="output-issues"><h3>出力前の確認</h3>${limits}${issueContent}<p class="hint">調書が空欄でも途中版は作れます。完成版は不足・未確認を解消してから作ります。</p></div>`;
  const prepare = actions(button('プレビューを作成', { variant: 'primary', attrs: { 'data-action': 'prepare-output', 'data-unavailable': !chosen.length || outputTooLarge ? 'true' : undefined } }) + button('写真ファイルを保存', { attrs: { 'data-action': 'export-photos', 'data-unavailable': !chosen.length ? 'true' : undefined } }) + button('調書へ戻る', { attrs: { 'data-mode': 'report' } }), { className: 'report-actions' });
  const setup = `<section class="panel">${panelHeading('調書・写真帳を出力', { eyebrow: 'PREVIEW & PRINT', className: 'section-heading', meta: badge('見本様式 / TS調書はA4横') })}${stepper}${settings}${records}${checks}${prepare}<p class="hint">撮影不要は理由を、未撮影・要撮り直しは不足を表示します。履歴写真は載せません。写真ファイルは保存先を選べます（非対応ブラウザーはZIPで保存）。</p></section>`;
  if (!prepared) return setup;
  const previewHeading = panelHeading(`${prepared.model.edition === 'draft' ? '途中版' : '完成版'}プレビュー`, { className: 'section-heading', meta: `<span>${prepared.model.pageCount}ページ</span>`, description: '用途ごとに調書・確認事項（途中版のみ）・写真帳の順です。クリックで全画面表示します。編集後は作り直してください。' });
  const fullscreen = button('全画面で表示', { className: 'output-preview-launcher', attrs: { 'data-action': 'enlarge-output' } });
  const frame = `<iframe${attrs({ id: 'outputPreview', title: '調書と写真帳のプレビュー', sandbox: 'allow-scripts allow-same-origin' })}></iframe>`;
  const confirmation = checkbox('出力範囲・版・写真・調書の内容を確認しました', { id: 'outputApproved', checked: approved });
  const printActions = button('印刷・PDF保存', { id: 'printOutput', variant: 'primary', attrs: { 'data-action': 'print-output', 'data-unavailable': String(!ready || !approved) } }) + button('閲覧用HTMLを保存', { attrs: { 'data-action': 'save-output-html' } });
  const result = `<section id="outputResult" class="panel output-result">${previewHeading}${fullscreen}${frame}${actions(confirmation + printActions, { className: 'output-confirm' })}<p class="hint">PDFは印刷画面の保存先で選びます。ヘッダー・フッターは外し、倍率は100%にします。用紙はTS調書がA4横、写真帳がA4縦です。PDF保存後も作業ZIPを保存できます。</p></section>`;
  return setup + result;
}
