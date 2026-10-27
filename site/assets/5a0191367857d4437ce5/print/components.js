import { escapeHTML, button } from '../ui/components.js';
import {printSurveyReport,printTSReport,printReferencePhotoRow} from './reference.js';
import {printControlPointReport,printControlPointPhotos} from './control-point.js';
import {printMeasuredPage} from './measured-forms.js';

/** Markup only: page plans, line wrapping and adoption decisions belong to reports.js. */
export const printLines = lines => lines.map(line => `<span class="text-line">${escapeHTML(line) || '&#160;'}</span>`).join('');

export function printToolbar(editionLabel) {
  return `<div class="print-controls">${button('画像の準備中', { id: 'output-print', attrs: { disabled: true } })} <span>${escapeHTML(editionLabel)} · 簡易様式</span></div>`;
}

export function printPhotoFigure(slot, imageURLs, small = false, statusLabels) {
  const status = statusLabels[slot.status];
  const image = slot.photo ? imageURLs.get(slot.photo.id) : null;
  return `<figure class="photo-box${small ? ' near-photo' : ''}"><figcaption>${escapeHTML(slot.name)} · ${escapeHTML(status)}</figcaption>${image ? `<img src="${image}" alt="${escapeHTML(slot.name)}">` : `<div class="photo-placeholder">${escapeHTML(status)}${slot.status === 'unnecessary' ? '<br>理由は写真情報に記載' : '<br>途中版・未完了'}</div>`}</figure>`;
}

export function printPageBody(page, imageURLs, statusLabels) {
  if(page.referenceLayout==='control-point')return page.kind==='report'?printControlPointReport(page):printControlPointPhotos(page,imageURLs,statusLabels);
  if(['bm','trial','ts','ts-photo'].includes(page.referenceLayout))return printMeasuredPage(page,imageURLs,statusLabels);
  if(page.referenceType==='ts')return printTSReport(page);
  if(page.referenceType==='survey')return printSurveyReport(page);
  if (page.kind === 'issues') return `<div class="issue-lines">${printLines(page.lines)}</div>`;
  if (page.kind === 'report') {
    const widths = `34mm repeat(${page.columns.length - 1},minmax(0,1fr))`;
    const header = `<div class="table-head report-grid" style="grid-template-columns:${widths}">${page.columns.map(column => `<div>${escapeHTML(column.label)}</div>`).join('')}</div>`;
    return header + page.entries.map(entry => entry.kind === 'context'
      ? `<div class="report-context">${printLines(entry.lines)}</div>`
      : `<div class="report-row report-grid${entry.continued ? ' row-continuation' : ''}" data-record-id="${escapeHTML(entry.recordId)}" data-continuation="${entry.continued}" style="grid-template-columns:${widths}">${entry.cells.map(lines => `<div class="report-cell">${printLines(lines.length ? lines : [''])}</div>`).join('')}</div>`).join('');
  }
  return page.rows.map(row => row.kind==='photo-row'&&row.referencePhoto?printReferencePhotoRow(row,imageURLs,statusLabels):row.kind === 'photo-continuation'
    ? `<section class="photo-row photo-text-continuation"><div class="continuation-title">写真情報 ${row.number}（続き）</div><div>${printLines(row.lines)}</div></section>`
    : `<section class="photo-row photo-primary" data-record-id="${escapeHTML(row.recordId)}"><div class="photo-main">${printPhotoFigure(row.slots[0], imageURLs, false, statusLabels)}</div><div class="photo-data"><div class="photo-description"><div class="photo-number">写真情報 ${row.number}${row.hasContinuation ? '（続きあり）' : ''}</div>${printLines(row.lines)}</div>${row.paired ? printPhotoFigure(row.slots[1], imageURLs, true, statusLabels) : ''}</div></section>`).join('');
}

export function printPageHeader({ projectNameLines, title, editionLabel }) {
  return `<header class="page-header"><div class="project-name">${printLines(projectNameLines)}</div><div class="page-title">${escapeHTML(title)}</div><div class="edition-label">${escapeHTML(editionLabel)}</div></header>`;
}

export function printPageFooter({ number, total, continued }) {
  return `<footer class="page-footer"><span>測量フォトノート · 簡易様式${continued ? '（続き）' : ''}</span><span>${number} / ${total}</span></footer>`;
}

export function printPage(page, { number, total, edition, projectNameLines, editionLabel, imageURLs, statusLabels }) {
  if(['bm','trial','ts','ts-photo'].includes(page.referenceLayout))return `<article class="page page-measured page-measured-${page.referenceLayout}" data-page="${number}" data-page-kind="${page.kind}" data-use-case="${escapeHTML(page.useCase||page.rows?.[0]?.useCase||'')}">${edition==='draft'?'<div class="watermark">途中版</div>':''}<main class="page-content">${printPageBody(page,imageURLs,statusLabels)}</main></article>`;
  if(page.referenceLayout==='control-point')return `<article class="page page-control-point" data-page="${number}" data-page-kind="${page.kind}" data-use-case="基準点">${edition==='draft'?'<div class="watermark">途中版</div>':''}<main class="page-content">${printPageBody(page,imageURLs,statusLabels)}</main></article>`;
  return `<article class="page${page.orientation==='landscape'?' page-landscape':''}${page.referenceType?' page-reference-report':''}" data-page="${number}" data-page-kind="${page.kind}" data-use-case="${escapeHTML(page.useCase||page.rows?.find(row=>row.useCase)?.useCase||'')}"${page.orientation==='landscape'?' style="page:landscape"':''}>${edition === 'draft' ? '<div class="watermark">途中版</div>' : ''}${printPageHeader({ projectNameLines, title: page.title+(page.kind==='photo'&&page.groupName&&page.groupName.length<=60?' ／ '+page.groupName:''), editionLabel })}<main class="page-content">${printPageBody(page, imageURLs, statusLabels)}</main>${printPageFooter({ number, total, continued: page.continued })}</article>`;
}
