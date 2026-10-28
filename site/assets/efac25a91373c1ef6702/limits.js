import { LIMITS } from './definitions.js';
export { LIMITS, OUTPUT_LIMITS } from './definitions.js';

const checkBytes = bytes => {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('容量の値が正しくありません。');
  return bytes;
};
/** Exact bytes are never rounded. Decimal GB and binary GiB are deliberately different units. */
export function exactBytes(bytes) {
  checkBytes(bytes);
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
}
/** Compact values round down so a value below a boundary never displays as having crossed it. */
export function formatBytes(bytes, { standard = 'decimal', digits = 2, exact = false } = {}) {
  checkBytes(bytes);
  if (!['decimal', 'binary'].includes(standard) || !Number.isSafeInteger(digits) || digits < 0 || digits > 6) throw new TypeError('容量の表示設定が正しくありません。');
  const base = standard === 'decimal' ? 1000 : 1024;
  const units = standard === 'decimal' ? ['B', 'kB', 'MB', 'GB', 'TB', 'PB'] : ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let index = 0, divisor = 1;
  while (index < units.length - 1 && bytes >= divisor * base) { divisor *= base; index++; }
  const scale = 10 ** digits;
  const value = Math.floor(bytes / divisor * scale) / scale;
  const label = `${new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)} ${units[index]}`;
  return exact ? `${label}（${exactBytes(bytes)}）` : label;
}
export function formatByteLimit(bytes = LIMITS.totalBytes) {
  return formatBytes(bytes, { standard: 'decimal', exact: true });
}
