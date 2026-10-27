import { USE_CASES } from './model.js';
import { LIMITS, OUTPUT_LIMITS } from './definitions.js';
import {formatBytes} from './limits.js';
import { reportReviewState, reportMissingFields, sectionLabel, getReportItemName, effectiveReportSection } from './report-data.js';
import { buildOutputModel } from './reports.js';
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
  const definition = USE_CASES[useCase], rows = scopedRecords(project, groupId, useCase), columns = definition.reportColumns;
  const visibleDraftCount = rows.reduce((count, { record }) => count + columns.filter(column => drafts.has(`${record.id}:${column.key}`)).length, 0);
  const tabs = tabBar(available.map(name=>{const records=scopedRecords(project,groupId,name),complete=records.every(({record})=>reportReviewState(project,record.id)==='reviewed'&&!USE_CASES[name].reportColumns.some(column=>drafts.has(`${record.id}:${column.key}`)));return tabButton(`${name} ${complete?'入力完了':'未完了'}`,{selected:name===useCase,className:complete?'is-complete':'is-incomplete',attrs:{'data-report-use':name}});}).join(''),{className:'report-tabs',label:'調書の用途'});
  let heading = `<section class="panel">${panelHeading('調書入力（簡易様式）', { eyebrow: 'SIMPLE RECORD SHEET', className: 'section-heading', meta: '<span class="hint">撮影の完了とは別に確認します</span>', actions: button('帳票の項目名を設定', { attrs: { 'data-action': 'report-settings' } }), description: '入力は記録IDに保存します。Excelの範囲をセルへ貼り付けできます。各セル300文字まで。範囲や長さの超過は切り捨てません。' })}${tabs}`;
  if (!columns.length) return heading + emptyState('MMSには調書入力を要求しません', '前・後の写真を確認し、出力画面から写真帳を作成できます。施工区間も不要です。', { level: 3 }) + '</section>';
  if(useCase==='TS出来形(バリアフリー)')heading+='<div class="dialog-note"><strong>スクリーンショットから入力</strong><p>BACK（BUCK）の数値 → X、LEFT／RIGHT（LIGHT）の数値 → Y。画面下部の「68.29R」などを「測点又は区別」に入力します。末尾にL/Rがあれば、左右欄への重複入力は不要です。</p><p>数値はmで入力します（0.002m＝2mm）。見本のように設計値が0の記録では、スクリーンショットの数値を実測値へ入力します。スクリーンショット取込時に数値を自動入力します。読取後は画像と照合し、調書を入力確認済みにしてください。</p></div>';
  if (!rows.length) return `${heading}<p class="hint">この所属・用途には記録がありません。撮影・確認で記録対象を登録してください。</p></section>`;
  const controls = actions(button('編集中の調書をすべて保存', { attrs: { 'data-action': 'save-reports' } })
    + button('表示中の編集を取消', { attrs: { 'data-action': 'discard-reports', 'data-unavailable': visibleDraftCount ? undefined : 'true' } })
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
    return `<tr><th scope="row">${esc(target.name)}<small>${esc(record.category)}<br>項目名：${esc(getReportItemName(project, record.id))}<br>${esc(group ? `${group.kind}：${group.name}` : '工事直下')}</small></th>${cells}<td>${badge(editing ? '編集中' : reviewLabels[state], { tone: state === 'reviewed' && !editing ? 'success' : 'warning' })}${missing.length ? `<p class="hint">未入力：${esc(missing.join('、'))}</p>` : ''}${recordControls}<p class="hint">${esc(sectionLabel(effectiveReportSection(project,record.id)) || '施工区間は未設定です。写真と調書の必須条件ではありません。')}</p></td></tr>`;
  }).join('');
  const routeSections=project.groups.filter(g=>groupId==='__all__'||g.id===groupId).map(g=>`<section class="route-section-panel"><strong>路線：${esc(g.name)}</strong><p>${esc(sectionLabel(g.reportSection)||'施工区間は未設定です。')}</p>${button('路線の施工区間を設定',{attrs:{'data-route-section':g.id}})}</section>`).join('');
  return `${heading}${routeSections}${controls}<p id="reportEditStatus" class="hint" role="status">${drafts.size ? '未保存の編集があります。保存・入力確認・ZIP保存時に確定します。' : '保存済みの入力を表示しています。'}</p><div class="report-table-wrap"><table class="report-input-table"><thead><tr><th>対象・${esc(definition.categoryLabel)}</th>${columns.map(column => `<th>${esc(column.label)}</th>`).join('')}<th>確認・任意設定</th></tr></thead><tbody>${tableRows}</tbody></table></div><p class="hint ui-section-note">座標・高さ・測定値は簡易入力欄です。試験計算・合否判定は行いません。備考は任意です。</p></section>`;
}

export function renderOutputView(project, { groupId = '__all__', useCase = '', selectedIds = new Set(), edition = 'draft', prepared = null, ready = false, approved = false } = {}) {
  const rows = scopedRecords(project, groupId, useCase), allowed = new Set(rows.map(row => row.record.id));
  const chosen = [...selectedIds].filter(id => allowed.has(id));
  let model, issueError = '';
  try { if (chosen.length) model = buildOutputModel(project, { recordIds: chosen, edition: 'draft' }); } catch (error) { issueError = error.message; }
  const issues = model?.issues || [];
  const selectedPhotoCount = model?.selectedPhotoIds.length ?? 0, outputTooLarge = selectedPhotoCount > OUTPUT_LIMITS.embeddedPhotos;
  const stepper = tabBar([['outputRange', '1 出力範囲'], ['outputChecks', '2 不足・版を確認'], ['outputResult', '3 プレビュー・印刷']].map(([id, label]) => `<a href="#${id}">${label}</a>`).join(''), { role: 'navigation', className: 'output-stepper', label: '出力の手順' });
  const settings = `<div id="outputRange" class="output-settings">${selectField('出力する所属', option('__all__', 'すべて', groupId === '__all__') + option('', '工事直下（グループなし）', !groupId) + project.groups.map(group => option(group.id, `${group.kind}：${group.name}`, group.id === groupId)).join(''), { id: 'outputGroup' })}${selectField('出力する用途', option('', 'すべての用途', !useCase) + Object.keys(USE_CASES).map(name => option(name, name, name === useCase)).join(''), { id: 'outputUse' })}${selectField('出力の版', option('draft', '途中版（不足と未確認を明示）', edition === 'draft') + option('final', '完成版（不足・要再確認がないもの）', edition === 'final'), { id: 'outputEdition' })}</div>`;
  const recordButtons = actions(button('この範囲を全て選択', { attrs: { 'data-action': 'output-all' } }) + button('選択を解除', { attrs: { 'data-action': 'output-none' } }), { className: 'actions' });
  const recordList = `<div class="output-record-list">${rows.map(({ target, record, group }) => checkbox(`${target.name} ／ ${target.useCase} ／ ${record.category}`, { checked: selectedIds.has(record.id), attrs: { 'data-output-record': record.id }, description: group ? `${group.kind}：${group.name}` : '工事直下' })).join('') || '<p class="hint">対象の記録がありません。</p>'}</div>`;
  const records = disclosure(`出力する記録を確認：${chosen.length} / ${rows.length}記録`, recordButtons + recordList, { className: 'output-records', saveKey: 'output-records' });
  const issueContent = issueError ? notice(issueError, { tone: 'error', role: 'alert', className: 'field-error' }) : !chosen.length ? '<p class="hint">出力する記録を選択してください。</p>' : issues.length
    ? `<p class="hint">不足・未入力・再確認が${issues.length}件あります。内容の確認には途中版を使えます。</p>${disclosure(`確認事項の詳細：${issues.length}件`, `<ul>${issues.map(issue => `<li>${esc(issue.targetName)} ／ ${esc(issue.category)}：${esc(issue.message)}</li>`).join('')}</ul>`, { className: 'output-issue-details', saveKey: 'output-issues' })}`
    : notice('選択した記録に撮影不足・調書未確認はありません。');
  const limits = `<p class="hint">工事の保持上限：履歴を含め${LIMITS.photos}枚・原本合計${esc(formatBytes(LIMITS.totalBytes))}。1回の帳票：採用${OUTPUT_LIMITS.embeddedPhotos}枚・埋込画像${OUTPUT_LIMITS.embeddedBytes / 1024 / 1024}MiB（合成後の画像バイナリ合計）。</p>${model ? `<p class="hint">選択範囲の採用写真：${selectedPhotoCount} / ${OUTPUT_LIMITS.embeddedPhotos}枚。履歴写真は枚数に含みません。</p>` : ''}${outputTooLarge ? notice('1回に出力できる採用写真の枚数を超えています。原本を削除・圧縮せず、分類・用途・記録を選んで出力範囲を分けてください。', { tone: 'warning' }) : ''}`;
  const checks = `<div id="outputChecks" class="output-issues"><h3>出力前の確認</h3>${limits}${issueContent}</div>`;
  const prepare = actions(button('この範囲でプレビューを作る', { variant: 'primary', attrs: { 'data-action': 'prepare-output', 'data-unavailable': !chosen.length || outputTooLarge ? 'true' : undefined } }) + button('写真を単体で出力（保存先を選択）', { attrs: { 'data-action': 'export-photos', 'data-unavailable': !chosen.length ? 'true' : undefined } }) + button('調書へ戻る', { attrs: { 'data-mode': 'report' } }), { className: 'report-actions' });
  const setup = `<section class="panel">${panelHeading('調書・写真帳を出力', { eyebrow: 'PREVIEW & PRINT', className: 'section-heading', meta: badge('見本様式 / TS調書はA4横') })}${stepper}${settings}${records}${checks}${prepare}<p class="hint">撮影不要は理由、未撮影・要撮り直しは不足として表示します。採用していない履歴写真は掲載しません。写真単体出力は対応ブラウザーで保存先フォルダーを選択できます。未対応の場合は写真ZIPを保存します。</p></section>`;
  if (!prepared) return setup;
  const previewHeading = panelHeading(`${prepared.model.edition === 'draft' ? '途中版' : '完成版'}プレビュー`, { className: 'section-heading', meta: `<span>${prepared.model.pageCount}ページ</span>`, description: '用途ごとに調書→確認事項（途中版のみ）→写真帳の順です。プレビューをクリックすると全画面で拡大できます。内容を編集した場合は再生成が必要です。' });
  const fullscreen = button('プレビューを全画面で確認', { className: 'output-preview-launcher', attrs: { 'data-action': 'enlarge-output' } });
  const frame = `<iframe${attrs({ id: 'outputPreview', title: '簡易調書と写真帳のプレビュー', sandbox: 'allow-scripts allow-same-origin' })}></iframe>`;
  const confirmation = checkbox('出力範囲・版・写真・調書の内容を確認しました', { id: 'outputApproved', checked: approved });
  const printActions = button('印刷画面を開く / PDF保存', { id: 'printOutput', variant: 'primary', attrs: { 'data-action': 'print-output', 'data-unavailable': String(!ready || !approved) } }) + button('閲覧用HTMLを保存', { attrs: { 'data-action': 'save-output-html' } });
  const result = `<section id="outputResult" class="panel output-result">${previewHeading}${fullscreen}${frame}${actions(confirmation + printActions, { className: 'output-confirm' })}<p class="hint">印刷画面で保存先をPDFにします。ブラウザーのヘッダー・フッターを外し、用紙の向きは帳票に従います（TS調書はA4横、写真帳はA4縦）。倍率100%を基本にしてください。PDF保存後も再編集用ZIPを保存できます。</p></section>`;
  return setup + result;
}
