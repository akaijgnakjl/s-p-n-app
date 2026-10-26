import { BOARD_OVERLAYS } from './board-layouts.js';
import { getBoardImage } from './board-assets.js';

/** Five reference boards. Data fields remain compatible with existing schema 2 ZIPs. */
export const BOARD_FIELD_KEYS = Object.freeze([
  'job', 'route', 'date', 'point', 'note', 'contractor', 'workType',
  'location', 'designSize', 'actualSize', 'attendee', 'remarks',
]);

const template = (id, name, layout, fields, sample) => Object.freeze({
  id, name, layout, ...(sample ? { sample } : {}),
  fields: Object.freeze(fields.map(field => Object.freeze(field))),
});

export const BOARD_TEMPLATES = Object.freeze({
  'sample-2111': template('sample-2111', '路線・点名', 'point', [
    { key: 'job', label: '工事名' },
    { key: 'route', label: '路線名', optional: true },
    { key: 'note', label: '作業内容', large: true },
    { key: 'point', label: '点名' },
  ], '見本 2111'),
  'sample-2112': template('sample-2112', '寸法・立会', 'measurement', [
    { key: 'job', label: '工事名' },
    { key: 'workType', label: '工種', optional: true },
    { key: 'date', label: '撮影月日', type: 'date', optional: true },
    { key: 'location', label: '位置', optional: true },
    { key: 'designSize', label: '設計寸法', optional: true },
    { key: 'actualSize', label: '実測寸法', optional: true },
    { key: 'attendee', label: '立会人', optional: true },
    { key: 'remarks', label: '備考', large: true, optional: true },
  ], '見本 2112'),
  'sample-2113': template('sample-2113', '場所・日付', 'date', [
    { key: 'job', label: '工事名' },
    { key: 'location', label: '工事場所', optional: true },
    { key: 'note', label: '作業内容', large: true },
    { key: 'date', label: '撮影日', type: 'date', optional: true },
    { key: 'contractor', label: '施工者', optional: true },
  ], '見本 2113'),
  'sample-2114': template('sample-2114', '大きな記入欄', 'large', [
    { key: 'job', label: '工事名' },
    { key: 'note', label: '記入内容', large: true },
  ], '見本 2114'),
  'sample-2115': template('sample-2115', '受注者付き', 'point', [
    { key: 'job', label: '工事名' },
    { key: 'route', label: '路線名', optional: true },
    { key: 'note', label: '作業内容', large: true },
    { key: 'point', label: '点名' },
    { key: 'contractor', label: '受注者', optional: true },
  ], '見本 2115'),
  'legacy-simple': template('legacy-simple', '旧版の簡易黒板', 'legacy-simple', [
    { key: 'job', label: '工事名' },
    { key: 'route', label: '路線名', optional: true },
    { key: 'point', label: '点名', optional: true },
    { key: 'note', label: '作業内容', large: true },
    { key: 'date', label: '作業日', type: 'date', optional: true },
  ]),
});

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plainObject = value => Boolean(value && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
const invalid = message => { throw new Error(message); };

function getTemplate(templateId) {
  if (typeof templateId !== 'string' || !own(BOARD_TEMPLATES, templateId)) invalid('対応していない黒板形式です。');
  return BOARD_TEMPLATES[templateId];
}

function checkValues(values, complete) {
  if (!plainObject(values) || Object.keys(values).some(key => !BOARD_FIELD_KEYS.includes(key)) ||
      (complete && BOARD_FIELD_KEYS.some(key => !own(values, key)))) invalid('黒板の入力項目が正しくありません。');
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string' || value.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      invalid(`黒板の${key}は1,000文字以内の文字列で指定してください。`);
    }
  }
  const date = values.date ?? '';
  if (date !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) invalid('黒板の日付は正しい年月日で指定してください。');
}

/** Keep all twelve values when changing form; required-value prompts belong to the UI. */
export function createBoard(templateId, values = {}, {legacyColor} = {}) {
  getTemplate(templateId);
  checkValues(values, false);
  const board = { templateId, values: Object.fromEntries(BOARD_FIELD_KEYS.map(key => [key, values[key] ?? ''])) };
  if (legacyColor !== undefined) board.legacyColor = legacyColor;
  validateBoard(board);
  return board;
}

export function validateBoard(board) {
  if (!plainObject(board) || !own(board, 'templateId') || !own(board, 'values') ||
      Object.keys(board).some(key => !['templateId','values','legacyColor'].includes(key))) invalid('黒板のデータ形式が正しくありません。');
  getTemplate(board.templateId);
  if (board.legacyColor !== undefined && (board.templateId !== 'legacy-simple' || !['green','white','dark'].includes(board.legacyColor))) invalid('旧黒板の配色が不正です。');
  checkValues(board.values, true);
  return board;
}

export function boardAspectRatio(board) {
  validateBoard(board);
  return board.templateId === 'legacy-simple' ? 600 / 340 : 4 / 3;
}

function wrapText(ctx, text, width) {
  const lines = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const character of Array.from(paragraph)) {
      if (line && ctx.measureText(line + character).width > width) {
        lines.push(line);
        line = character;
      } else line += character;
    }
    lines.push(line);
  }
  return lines;
}

function fitText(ctx, text, width, height, maximum, minimum) {
  for (let font = maximum; font >= minimum; font -= Math.max(0.5, maximum / 24)) {
    ctx.font = `500 ${font}px sans-serif`;
    const lines = wrapText(ctx, text, width);
    const lineHeight = font * 1.25;
    if (lines.length * lineHeight <= height && lines.every(line => ctx.measureText(line).width <= width)) {
      return { lines, font, lineHeight, fits: true };
    }
  }
  ctx.font = `500 ${minimum}px sans-serif`;
  const lines = wrapText(ctx, text, width);
  const lineHeight = minimum * 1.25;
  return { lines, font: minimum, lineHeight, fits: lines.length * lineHeight <= height && lines.every(line => ctx.measureText(line).width <= width) };
}

const LEGACY_WEIGHTS = Object.freeze({ job: 0.21, route: 0.17, point: 0.15, note: 0.30, date: 0.17 });

/** Preview and JPEG output share this drawing function, including overflow detection. */
export function drawBoard(ctx, x, y, width, height, board) {
  validateBoard(board);
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) invalid('黒板の描画サイズが正しくありません。');
  if (board.templateId !== 'legacy-simple') return drawReferenceBoard(ctx, x, y, width, height, board);
  const definition = getTemplate(board.templateId);
  const legacy = board.templateId === 'legacy-simple';
  const scale = Math.min(width / 600, height / (legacy ? 340 : 450));
  const pad = (legacy ? 9 : 8) * scale;
  const border = Math.max(1, 2 * scale);
  const headerHeight = height * (legacy ? 0.105 : 0.075);
  const labelWidth = width * (legacy ? 0.18 : 0.22);
  const weight = field => legacy ? LEGACY_WEIGHTS[field.key] :
    field.large ? (definition.layout === 'large' ? 6 : definition.layout === 'measurement' ? 2.5 : 3) : 1;
  const totalWeight = definition.fields.reduce((total, field) => total + weight(field), 0);
  const overflowFields = [];
  const foreground = board.legacyColor === 'white' ? '#213c34' : '#f4faf5';
  const background = board.legacyColor === 'white' ? '#fafbf7' : board.legacyColor === 'dark' ? '#263a42' : board.legacyColor === 'green' ? '#14574e' : legacy ? '#185443' : '#006464';
  ctx.save();
  ctx.fillStyle = background;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = foreground;
  ctx.lineWidth = border;
  ctx.strokeRect(x + border / 2, y + border / 2, width - border, height - border);
  ctx.fillStyle = foreground;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${Math.max(1, 12 * scale)}px sans-serif`;
  ctx.fillText(legacy ? '電 子 黒 板（簡 易）' : `${definition.name}（簡易表示）`, x + width / 2, y + headerHeight / 2);
  let rowY = y + headerHeight;
  for (const field of definition.fields) {
    const rowHeight = (height - headerHeight) * weight(field) / totalWeight;
    ctx.beginPath();
    ctx.moveTo(x, rowY);
    ctx.lineTo(x + width, rowY);
    ctx.moveTo(x + labelWidth, rowY);
    ctx.lineTo(x + labelWidth, rowY + rowHeight);
    ctx.stroke();
    ctx.fillStyle = foreground;
    ctx.textAlign = 'center';
    ctx.font = `500 ${Math.min(15 * scale, rowHeight * 0.48)}px sans-serif`;
    ctx.fillText(field.label, x + labelWidth / 2, rowY + rowHeight / 2);
    const value = board.values[field.key].trim() || '—';
    const maximum = Math.min((field.large && !legacy ? 27 : 22) * scale, (rowHeight - pad * 2) / 1.25);
    const minimum = Math.max(1, Math.min(maximum, 9 * scale));
    const plan = fitText(ctx, value, width - labelWidth - pad * 2, rowHeight - pad * 2, maximum, minimum);
    if (!plan.fits) overflowFields.push(field.key);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + labelWidth + pad, rowY + pad, width - labelWidth - pad * 2, rowHeight - pad * 2);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${plan.font}px sans-serif`;
    const textY = rowY + (rowHeight - plan.lines.length * plan.lineHeight) / 2 + plan.lineHeight / 2;
    plan.lines.forEach((line, index) => ctx.fillText(line, x + labelWidth + pad, textY + index * plan.lineHeight));
    ctx.restore();
    rowY += rowHeight;
  }
  if (overflowFields.length) {
    ctx.strokeStyle = '#ffbc72';
    ctx.lineWidth = Math.max(2, 4 * scale);
    ctx.strokeRect(x + border, y + border, width - border * 2, height - border * 2);
    ctx.fillStyle = '#842727';
    ctx.fillRect(x + width * 0.3, y, width * 0.7, headerHeight);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.max(1, 12 * scale)}px sans-serif`;
    ctx.fillText('文字が収まりません・短くしてください', x + width * 0.65, y + headerHeight / 2);
  }
  ctx.restore();
  return { overflow: overflowFields.length > 0, overflowFields };
}

/** Display-only date formatting from the reference; the stored ISO value stays unchanged. */
export function boardText(key, value) {
  const text = String(value ?? '');
  const date = key === 'date' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return date && Number(date[1]) >= 2019
    ? `令和${Number(date[1]) - 2018}年${Number(date[2])}月${Number(date[3])}日` : text;
}

/** The same original board and percentage regions are used for preview and JPEG output. */
function drawReferenceBoard(ctx, x, y, width, height, board) {
  const image = getBoardImage(board.templateId);
  const layout = BOARD_OVERLAYS[board.templateId];
  const overflowFields = [];
  ctx.save();
  ctx.drawImage(image, x, y, width, height);
  const drawRegion = (region, keys) => {
    const text = keys.map(key => boardText(key, board.values[key])).filter(Boolean).join('\n');
    if (!text) return;
    const bx = x + width * region.x / 100, by = y + height * region.y / 100;
    const bw = width * region.w / 100, bh = height * region.h / 100;
    const maximum = width * region.font / 100, minimum = Math.min(maximum, Math.max(1, width / 200));
    const plan = fitReferenceText(ctx, text, bw, bh, maximum, minimum, width / 1200);
    if (!plan.fits) overflowFields.push(...keys.filter(key => board.values[key]));
    ctx.save();
    ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
    ctx.fillStyle = '#fff'; ctx.textAlign = region.align; ctx.textBaseline = 'middle';
    ctx.font = `${plan.font}px sans-serif`;
    const tx = region.align === 'center' ? bx + bw / 2 : region.align === 'right' ? bx + bw : bx;
    const firstY = by + (bh - plan.lines.length * plan.lineHeight) / 2 + plan.lineHeight / 2;
    plan.lines.forEach((line, index) => ctx.fillText(line, tx, firstY + index * plan.lineHeight));
    ctx.restore();
  };
  for (const [key, region] of Object.entries(layout.fields)) drawRegion(region, [key]);
  if (layout.stack) drawRegion(layout.stack, layout.stack.keys);
  if (overflowFields.length) {
    ctx.strokeStyle = '#ffbc72'; ctx.lineWidth = Math.max(2, width / 150);
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = '#842727'; ctx.fillRect(x, y, width, height * .06);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.max(1, width / 50)}px sans-serif`;
    ctx.fillText('文字が収まりません・短くしてください', x + width / 2, y + height * .03);
  }
  ctx.restore();
  return { overflow: overflowFields.length > 0, overflowFields: [...new Set(overflowFields)] };
}

function fitReferenceText(ctx, text, width, height, maximum, minimum, step) {
  for (let font=maximum; ; font=Math.max(minimum,font-step)) {
    ctx.font=`${font}px sans-serif`;
    const lines=wrapText(ctx,text,width),lineHeight=font*1.18;
    const fits=lines.length*lineHeight<=height&&lines.every(line=>ctx.measureText(line).width<=width);
    if(fits||font===minimum)return {lines,font,lineHeight,fits};
  }
}
