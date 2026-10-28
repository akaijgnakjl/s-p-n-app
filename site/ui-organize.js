import { USE_CASES, getSlotState } from './model.js';
import { reportReviewState } from './report-data.js';
import { dateState, workDateLabel as defaultWorkDateLabel } from './dates.js';
import { escapeHTML, attrs, button, textField, selectField, checkbox, disclosure, panelHeading, badge, tabButton, tabBar, emptyState, photoMeta, actions } from './ui/components.js';

/** Presentation state only: none of these values belong in the business ZIP. */
export function createOrganizeState() {
  return { query: '', useCase: '', category: '', slot: '', status: '', dateStatus: '', reportStatus: '', onlyMissing: false, groupId: '__all__', selectedIds: new Set(), activePhotoId: null };
}

const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().trim();
const STATUS_LABELS = { taken: '採用中', history: '履歴', missing: '未撮影', retake: '要撮り直し', unnecessary: '撮影不要', unassigned: '分類待ち' };
const REPORT_LABELS = { unreviewed: '未確認', reviewed: '確認済み', stale: '要再確認' };
const DATE_FILTER_LABELS = { 'needs-confirmation': '確認が必要（旧データを含む）', confirmed: '利用者確認済み', unconfirmed: '未確認', legacy: '既存値・出所未記録' };
const union = values => [...new Set(values)];

function stateWithDefaults(state) { return { ...createOrganizeState(), ...state }; }

function createIndex(project) {
  const groups = new Map(project.groups.map(group => [group.id, group]));
  const records = new Map();
  for (const target of project.targets) for (const record of target.records) records.set(record.id, { target, record, group: groups.get(target.groupId) ?? null });
  const slotStates = new Map(), reviews = new Map();
  return {
    records,
    states(record) {
      if (!slotStates.has(record.id)) slotStates.set(record.id, record.slots.map(slot => getSlotState(project, record.id, slot.name)));
      return slotStates.get(record.id);
    },
    review(context) {
      if (context.target.useCase === 'MMS') return null;
      if (!reviews.has(context.record.id)) reviews.set(context.record.id, reportReviewState(project, context.record.id));
      return reviews.get(context.record.id);
    },
  };
}

function inGroup(target, groupId) {
  return groupId === '__all__' || (target?.groupId ?? null) === (groupId || null);
}

function contextMatches(context, state) {
  if (!inGroup(context?.target, state.groupId)) return false;
  if (state.useCase && context?.target.useCase !== state.useCase) return false;
  if (state.category && context?.record.category !== state.category) return false;
  return true;
}

function matchesPhoto(photo, project, state, index) {
  const context = index.records.get(photo.recordId), query = normalize(state.query);
  if (!contextMatches(context, state)) return false;
  if (query && ![context?.target.name, photo.originalName].some(value => normalize(value).includes(query))) return false;
  if (state.slot && photo.slot !== state.slot) return false;
  const slots = context ? index.states(context.record) : [], slot = slots.find(item => item.name === photo.slot);
  if (state.onlyMissing && !slots.some(item => !item.complete)) return false;
  if (state.status) {
    if (state.status === 'history') { if (!slot || slot.photo?.id === photo.id) return false; }
    else if (state.status === 'taken') { if (slot?.photo?.id !== photo.id) return false; }
    else if (state.status === 'unassigned') { if (context) return false; }
    else if (slot?.status !== state.status) return false;
  }
  if (state.dateStatus === 'needs-confirmation') { if (dateState(photo) === 'confirmed' && photo.workDate) return false; }
  else if (state.dateStatus && dateState(photo) !== state.dateStatus) return false;
  if (state.reportStatus && (!context || index.review(context) !== state.reportStatus)) return false;
  return true;
}

/** Returns existing photo objects in stored order; never changes project or selection. */
export function filterPhotos(project, state = createOrganizeState()) {
  const current = stateWithDefaults(state), index = createIndex(project);
  return project.photos.filter(photo => matchesPhoto(photo, project, current, index));
}

function missingRecords(project, state, index) {
  const query = normalize(state.query), result = [];
  for (const context of index.records.values()) {
    if (!contextMatches(context, state)) continue;
    if (query && !normalize(context.target.name).includes(query) && !project.photos.some(photo => photo.recordId === context.record.id && normalize(photo.originalName).includes(query))) continue;
    const missing = index.states(context.record).filter(slot => !slot.complete && (!state.slot || slot.name === state.slot));
    if (missing.length) result.push({ ...context, missing });
  }
  return result;
}

function reportRecords(state, index) {
  const query = normalize(state.query);
  return [...index.records.values()].filter(context => contextMatches(context, state)
    && (!query || normalize(context.target.name).includes(query))
    && index.review(context) === state.reportStatus);
}

function optionList(options, selected, esc) {
  const list = options.some(([value]) => value === selected) || !selected ? options : [...options, [selected, `${selected}（現在の条件）`]];
  return list.map(([value, label]) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

/** Compact metadata table; thumbnails are populated lazily by the existing image loader. */
export function renderOrganizeView({ project, state = createOrganizeState(), esc = escapeHTML, bytesLabel = size => `${size} bytes`, workDateLabel = defaultWorkDateLabel, locationLabel = group => group ? `${group.kind}：${group.name}` : '工事直下（グループなし）' }) {
  const current = stateWithDefaults(state), index = createIndex(project);
  const photos = project.photos.filter(photo => matchesPhoto(photo, project, current, index));
  const selectedIds = current.selectedIds instanceof Set ? current.selectedIds : new Set();
  const visibleSelected = photos.filter(photo => selectedIds.has(photo.id));
  const existingIds = new Set(project.photos.map(photo => photo.id));
  const hiddenSelected = [...selectedIds].filter(id => existingIds.has(id) && !visibleSelected.some(photo => photo.id === id)).length;
  const selectionCount = visibleSelected.length, allSelected = photos.length > 0 && selectionCount === photos.length;
  const select = (key, label, options) => selectField(label, optionList(options, current[key], esc), { attrs: { 'data-organize-filter': key } });
  const definitions = current.useCase && USE_CASES[current.useCase] ? [USE_CASES[current.useCase]] : Object.values(USE_CASES);
  const categories = union(definitions.flatMap(definition => definition.categories)), slots = union(definitions.flatMap(definition => definition.slots));
  const categoryLabel = USE_CASES[current.useCase]?.categoryLabel ?? '区分';
  const quick = tabBar([
    ['all', 'すべて', !current.onlyMissing && !current.status && !current.dateStatus && !current.reportStatus],
    ['missing', '撮影不足', Boolean(current.onlyMissing)],
    ['unconfirmed', '作業日未確認', current.dateStatus === 'needs-confirmation'],
    ['stale', '調書要再確認', current.reportStatus === 'stale'],
  ].map(([value, label, active]) => tabButton(label, { selected: active, attrs: { 'data-organize-view': value } })).join(''), { className: 'quick-views', label: 'よく使う表示' });
  const advancedConditions = [
    [current.groupId !== '__all__', '所属', locationLabel(project.groups.find(group => group.id === current.groupId) ?? null)],
    [current.category, categoryLabel, current.category],
    [current.slot, '写真の種類', current.slot],
    [current.status, '写真・枠の状態', STATUS_LABELS[current.status] ?? current.status],
    [current.dateStatus, '作業日', DATE_FILTER_LABELS[current.dateStatus] ?? current.dateStatus],
    [current.reportStatus, '調書', REPORT_LABELS[current.reportStatus] ?? current.reportStatus],
    [current.onlyMissing, '撮影不足', 'この記録に不足あり'],
  ].filter(([enabled]) => enabled);
  const basicControls = `<div class="filter-grid organize-basic-filters">${textField('管理名・原本名で検索', { type: 'search', value: current.query, max: null, required: false, className: 'filter-query', attrs: { 'data-organize-filter': 'query', placeholder: '例：TA1、IMG_001', autocomplete: 'off' } })}${select('useCase', '用途', [['', 'すべての用途'], ...Object.keys(USE_CASES).map(value => [value, value])])}</div>`;
  const advancedControls = select('groupId', '所属', [['__all__', 'すべての所属'], ['', '工事直下（グループなし）'], ...project.groups.map(group => [group.id, locationLabel(group)])])
    + select('category', categoryLabel, [['', 'すべての区分'], ...categories.map(value => [value, value])])
    + select('slot', '写真の種類', [['', 'すべての種類'], ...slots.map(value => [value, value])])
    + select('status', '写真・撮影枠の状態', [['', 'すべての状態'], ...['taken', 'history', 'retake', 'unnecessary', 'missing', 'unassigned'].map(value => [value, STATUS_LABELS[value]])])
    + select('dateStatus', '作業日の確認', [['', 'すべての確認状態'], ...Object.entries(DATE_FILTER_LABELS)])
    + select('reportStatus', '調書の確認', [['', 'すべての調書状態'], ...Object.entries(REPORT_LABELS)])
    + checkbox('この記録に撮影不足がある写真だけ', { checked: current.onlyMissing, className: 'filter-check', attrs: { 'data-organize-filter': 'onlyMissing' } });
  const activeConditions = advancedConditions.length ? `<p class="organize-active-filters" aria-label="現在の詳細条件">${advancedConditions.map(([, label, value]) => badge(`${label}：${value}`, { className: 'filter-chip' })).join('')}</p>` : '';
  const controls = basicControls + disclosure(`詳細条件（設定数 ${advancedConditions.length}）`, `<div class="filter-grid">${advancedControls}</div>${activeConditions}`, { className: 'organize-advanced', saveKey: 'organize-filters' });
  const summary = current.onlyMissing || current.status === 'missing' ? (() => {
    const records = missingRecords(project, current, index), count = records.reduce((total, context) => total + context.missing.length, 0);
    const heading = panelHeading(`撮影不足：${records.length}記録・${count}枠`, { level: 3, description: '所属・用途・検索・区分・写真の種類に合う記録の不足です。写真が0枚の記録も表示します。写真の状態・作業日・調書の条件とは分けて確認できます。' });
    const list = records.length ? `<ul class="missing-record-list">${records.map(({ target, record, group, missing }) => `<li><span><strong>${esc(target.name)}</strong> ／ ${esc(target.useCase)} ／ ${esc(record.category)}<small>${esc(locationLabel(group))}</small><span class="photo-status">${missing.map(slot => `${esc(slot.name)}：${STATUS_LABELS[slot.status]}`).join(' ／ ')}</span></span>${button('撮影・確認へ', { attrs: { 'data-go-record': record.id } })}</li>`).join('')}</ul>` : '<p class="hint">この対象範囲に撮影不足の枠はありません。</p>';
    return `<section class="organize-missing" aria-label="記録の撮影不足">${heading}${list}</section>`;
  })() : '';
  const reportSummary = current.reportStatus ? (() => {
    const records = reportRecords(current, index);
    const heading = panelHeading(`記録の調書確認：${records.length}記録`, { level: 3, description: '所属・用途・管理名検索・区分と、調書の確認状態に合う記録です。写真が0枚・全枠が撮影不要の記録も表示します。この一覧の検索は管理名のみです。写真の種類・写真の状態・作業日・撮影不足の条件とは分けて確認できます。' });
    const list = records.length ? `<ul class="missing-record-list report-record-list">${records.map(({ target, record, group }) => `<li><span><strong>${esc(target.name)}</strong> ／ ${esc(target.useCase)} ／ ${esc(record.category)}<small>${esc(locationLabel(group))}</small><span class="photo-status">調書：${esc(REPORT_LABELS[index.review({ target, record, group })])}</span></span>${button('調書を確認', { attrs: { 'data-go-report': record.id } })}</li>`).join('')}</ul>` : '<p class="hint">この対象範囲に指定した確認状態の調書はありません。MMSは調書の対象外です。</p>';
    return `<section class="organize-missing organize-report-checks" aria-label="記録の調書確認">${heading}${list}</section>`;
  })() : '';
  const rows = photos.map(photo => {
    const context = index.records.get(photo.recordId), slot = context && index.states(context.record).find(item => item.name === photo.slot);
    const adopted = slot?.photo?.id === photo.id, status = context ? adopted ? 'taken' : 'history' : 'unassigned';
    const review = context ? index.review(context) : null;
    const otherState = slot && slot.status !== 'taken' ? `<small>${STATUS_LABELS[slot.status]}${slot.reason ? `：${esc(slot.reason)}` : ''}</small>` : '';
    const name = context?.target.name || '分類待ち';
    const selection = checkbox('', { checked: selectedIds.has(photo.id), className: 'table-photo-checkbox', attrs: { 'data-select-photo': photo.id, 'aria-label': `${name} ／ ${photo.originalName}を選択` } });
    const thumbnail = button(`<img${attrs({ 'data-thumb': photo.id, alt: `${name}の縮小写真`, loading: 'lazy', decoding: 'async' })}>`, { html: true, className: 'photo-preview-button preview-trigger', attrs: { 'data-preview-photo': photo.id, 'aria-label': `${name}の画像を拡大` } });
    const title = button(name, { className: 'button-link photo-name', attrs: { 'aria-label': `${name} ／ ${photo.originalName}の詳細を開く` } });
    const metadata = photoMeta({ name: photo.originalName, details: [`${bytesLabel(photo.size)}・${photo.width} × ${photo.height}px`] });
    const location = photoMeta({ details: [locationLabel(context?.group ?? null), ...(context ? [`${context.target.useCase} ／ ${context.record.category}`, photo.slot] : ['所属・分類を訂正して撮影枠へ割り当て'])] });
    return `<tr${attrs({ class: `photo-row${photo.id === current.activePhotoId ? ' is-active' : ''}`, 'data-open-photo': photo.id, 'aria-selected': String(photo.id === current.activePhotoId) })}><td class="photo-select">${selection}</td><td class="photo-thumbnail">${thumbnail}</td><td>${title}${metadata}</td><td class="photo-meta">${location}</td><td class="photo-status">${badge(STATUS_LABELS[status], { tone: adopted ? 'success' : 'muted' })}${otherState}</td><td class="photo-meta">${esc(workDateLabel(photo))}</td><td class="photo-meta">${context ? context.target.useCase === 'MMS' ? '対象外（MMS）' : esc(REPORT_LABELS[review]) : '分類待ち'}</td><td class="photo-row-actions">${context?button('写真を変更',{attrs:{'data-replace-photo':photo.id}}):''}${context&&context.target.useCase!=='MMS'&&!(context.target.useCase==='TS出来形(バリアフリー)'&&photo.slot==='スマホスクリーンショット')?button('黒板を編集',{attrs:{'data-edit-photo':photo.id}}):''}</td></tr>`;
  }).join('');
  const allCheckbox = checkbox('', { id: 'selectVisiblePhotos', checked: allSelected, className: 'table-photo-checkbox', attrs: { 'aria-label': '表示中の写真をすべて選択', 'aria-checked': allSelected ? 'true' : selectionCount ? 'mixed' : 'false', 'data-indeterminate': selectionCount && !allSelected ? 'true' : undefined } });
  const table = photos.length ? `<div class="photo-table-wrap"><table class="photo-table"><caption class="sr-only">写真一覧。詳細を開いて、作業日・分類・黒板・履歴を確認できます。</caption><thead><tr><th scope="col">${allCheckbox}</th><th scope="col">写真</th><th scope="col">管理名・原本名</th><th scope="col">所属・用途・区分・種類</th><th scope="col">写真・撮影枠の状態</th><th scope="col">作業日</th><th scope="col">調書</th><th scope="col">編集</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : emptyState(project.photos.length ? '条件に合う写真はありません' : '登録された写真はありません', current.reportStatus ? '調書の状態は上の記録一覧から確認できます。' : current.onlyMissing || current.status === 'missing' ? '不足の記録は上の一覧から撮影・確認できます。' : '条件を変更するか、撮影・確認から写真を登録してください。', { level: 3 });
  const selectionActions = button('選択写真の作業日を確認', { id: 'reviewSelectedDates', attrs: { 'data-unavailable': selectionCount ? undefined : 'true' } }) + button('選択解除', { id: 'clearPhotoSelection', attrs: { 'data-unavailable': selectedIds.size ? undefined : 'true' } });
  return `<section class="organize-workspace"><section class="panel organize-toolbar">${panelHeading('PCで写真を整理', { className: 'section-heading', actions: quick })}${controls}</section>${summary}${reportSummary}<div class="organize-results" role="status">表示 ${photos.length} / ${project.photos.length}枚</div><section${attrs({ class: 'selection-bar', 'aria-label': '表示中の選択写真', 'data-visible-selected-count': selectionCount, 'data-total-selected-count': selectedIds.size })}><strong>表示中 ${selectionCount}枚を選択</strong>${hiddenSelected ? `<span class="photo-meta">表示外の選択 ${hiddenSelected}枚は一括確認の対象外</span>` : ''}${actions(selectionActions, { className: 'selection-actions' })}<small>日付の値を変更せず確認します。削除・分類変更は写真ごとに行います。</small></section>${table}</section>`;
}
