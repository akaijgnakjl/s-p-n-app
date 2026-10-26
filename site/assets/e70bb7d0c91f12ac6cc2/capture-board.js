import { getContext, USE_CASES } from './model.js';

export const isTrial = useCase => ['現密','コア密'].includes(useCase);
export function automaticNote(useCase, category, slot = '') {
  if (useCase === '現密') return ['現場密度試験',category,slot].filter(Boolean).join('\n');
  if (useCase === 'コア密') return ['切取供試体密度試験',slot,category].filter(Boolean).join('\n');
  return '';
}

/** Only legacy values that exactly match a known default may be inferred as automatic. */
export function recordNoteMode(target, record) {
  if (!isTrial(target.useCase)) return 'manual';
  if (record.boardNoteMode) return record.boardNoteMode;
  const known = ['',...USE_CASES[target.useCase].slots].map(slot => automaticNote(target.useCase,record.category,slot));
  return known.includes(record.boardDefaults?.values.note) ? 'auto' : 'manual';
}

export function resolveCaptureBoard(project, recordId, slot, {board, noteMode} = {}) {
  const {target,record} = getContext(project,recordId);
  if (!USE_CASES[target.useCase].slots.includes(slot)) throw new Error('この用途にない撮影枠です。');
  if (target.useCase === 'MMS') return {board:null,noteMode:'manual'};
  const result = structuredClone(board || record.boardDefaults);
  const mode = noteMode || recordNoteMode(target,record);
  if (!['auto','manual'].includes(mode)) throw new Error('黒板の自動入力指定が不正です。');
  if (isTrial(target.useCase) && mode === 'auto') result.values.note = automaticNote(target.useCase,record.category,slot);
  return {board:result,noteMode:mode};
}
