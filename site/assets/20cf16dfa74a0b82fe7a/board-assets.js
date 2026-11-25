/** Original embedded PNGs extracted byte-for-byte from 測量フォトノート.html. */
export const BOARD_ASSET_URLS = Object.freeze(Object.fromEntries(
  ['sample-2111', 'sample-2112', 'sample-2113', 'sample-2114', 'sample-2115']
    .map(id => [id, new URL(`./board-assets/${id}.png`, import.meta.url).href]),
));
const images = new Map();
const loading = new Map();
const decodeImage = url => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('黒板画像を読み込めません。アプリ資材を確認して再試行してください。'));
  image.src = url;
});

/** A failed load is retryable; no photo or project data is read or changed. */
export function loadBoardImage(id, decode = decodeImage) {
  if (!Object.hasOwn(BOARD_ASSET_URLS, id)) return Promise.reject(new Error('対応していない黒板画像です。'));
  if (images.has(id)) return Promise.resolve(images.get(id));
  if (!loading.has(id)) {
    const pending = Promise.resolve().then(() => decode(BOARD_ASSET_URLS[id]))
      .then(image => { images.set(id, image); return image; })
      .finally(() => loading.delete(id));
    loading.set(id, pending);
  }
  return loading.get(id);
}

export async function loadBoardImages(decode) {
  for (const id of Object.keys(BOARD_ASSET_URLS)) await loadBoardImage(id, decode);
}

export function getBoardImage(id) {
  if (!images.has(id)) throw new Error('黒板画像の準備が完了していません。再試行してください。');
  return images.get(id);
}
