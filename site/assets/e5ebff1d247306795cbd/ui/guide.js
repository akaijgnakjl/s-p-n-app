// アプリの使い方：画面の小さな絵（SVG）と短い説明で、最初から出力・保存までの流れを示す。
// 絵の文字は12px以上・枠の内側に収め、重ならない位置に置く。色は画面の配色（CSS変数）に合わせる。

const box = (x, y, w, h, label, { primary = false, dashed = false, size = 12 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" class="${primary ? 'g-primary' : 'g-box'}"${dashed ? ' stroke-dasharray="5 4"' : ''}/>` +
  (label ? `<text x="${x + w / 2}" y="${y + h / 2 + size * 0.36}" text-anchor="middle" font-size="${size}" class="${primary ? 'g-on-primary' : 'g-text'}">${label}</text>` : '');
const pointer = (x, y) => `<path d="M${x} ${y}l0 18l5-5l4 8l3-1.5l-4-8l7 0z" class="g-pointer"/>`;
const svg = (body, label) => `<svg viewBox="0 0 240 132" role="img" aria-label="${label}" class="guide-art">${`<rect x="1" y="1" width="238" height="130" rx="10" class="g-frame"/>`}${body}</svg>`;

export const GUIDE_STEPS = Object.freeze([
  {
    title: '工事をつくる・開く',
    text: '左上の「工事・取込」から「＋ 新しい工事」を作ります。受け取った作業ZIPは「作業ZIPを開く」で続きから使えます。',
    art: svg(box(14, 14, 96, 30, '工事・取込') + box(14, 52, 128, 28, '＋ 新しい工事', { primary: true }) + box(14, 88, 128, 28, '作業ZIPを開く') + pointer(148, 58), '工事・取込のメニュー'),
  },
  {
    title: '記録対象を登録する',
    text: '「＋ 追加」で用途（TS出来形など）と管理名を入れます。Excel等から管理名の一覧をまとめて貼り付けることもできます。',
    art: svg(box(14, 14, 80, 28, '＋ 追加', { primary: true }) + box(108, 14, 118, 28, '用途を選ぶ') + box(14, 52, 212, 66, '', { dashed: true }) +
      ['240R', '248.88R', '253.1R'].map((name, i) => `<text x="28" y="${72 + i * 17}" font-size="12" class="g-text">${name}</text>`).join('') + `<text x="214" y="${110}" text-anchor="end" font-size="12" class="g-muted">貼り付け可</text>`, '記録対象の追加'),
  },
  {
    title: '写真を入れる',
    text: '「撮影・確認」で撮影枠を押し、撮影または画像を選びます。PCでは貼り付けやドラッグ＆ドロップでも入ります。TSはスクリーンショットをまとめて取り込めます。',
    art: svg(box(14, 14, 100, 104, '', { dashed: true }) + `<path d="M38 82l18-22l14 16l10-10l18 16z" class="g-photo"/><circle cx="88" cy="44" r="8" class="g-photo"/>` +
      box(126, 14, 100, 30, '撮影', { primary: true }) + box(126, 52, 100, 30, '画像を選ぶ') + box(126, 90, 100, 28, 'ドロップ'), '撮影枠と写真の入れ方'),
  },
  {
    title: '調書を入力する',
    text: '「調書入力」で測点や座標などを入れます。TSは路線ごとに測定者・規格値・社内規格値と「印」の表示・非表示をまとめて設定できます。',
    art: svg(box(14, 14, 212, 26, '測定者・規格値・印', { size: 12 }) +
      [0, 1, 2].map(row => [0, 1, 2].map(col => `<rect x="${14 + col * 71}" y="${50 + row * 23}" width="70" height="22" class="g-cell"/>`).join('')).join('') +
      `<text x="49" y="66" text-anchor="middle" font-size="12" class="g-text">測点</text><text x="120" y="66" text-anchor="middle" font-size="12" class="g-text">X</text><text x="191" y="66" text-anchor="middle" font-size="12" class="g-text">Y</text>`, '調書の入力表'),
  },
  {
    title: '出力（印刷・PDF）',
    text: '「出力」で範囲を選び「プレビューを作成」、そのまま「印刷・PDF保存」を押します。不足や未確認があっても作成できます。',
    art: svg(box(14, 14, 120, 30, 'プレビューを作成', { primary: true }) + `<rect x="148" y="12" width="78" height="106" rx="3" class="g-paper"/>` +
      [0, 1, 2, 3, 4].map(i => `<rect x="158" y="${26 + i * 16}" width="58" height="6" rx="2" class="g-line"/>`).join('') + box(14, 62, 120, 30, '印刷・PDF保存', { primary: true }) + pointer(138, 70), 'プレビューと印刷'),
  },
  {
    title: '作業ZIPを保存する',
    text: '作業の区切りで「↓ 作業ZIPを保存」を押します。端末の一時保存だけに頼らず、ZIPで保管・受け渡しします。',
    art: svg(box(14, 14, 140, 32, '↓ 作業ZIPを保存', { primary: true }) + `<path d="M178 34h40v74h-52v-62z" class="g-paper"/><path d="M166 46h12v-12" class="g-line-stroke"/><text x="192" y="84" text-anchor="middle" font-size="12" class="g-text">ZIP</text>` + pointer(44, 49), '作業ZIPの保存'),
  },
]);

export function renderGuide() {
  return `<div class="guide"><p class="hint keep">上から順に進めます。各画面の詳しい説明は、右上の「説明」ボタンで表示できます。</p><ol class="guide-steps">${GUIDE_STEPS.map((step, index) =>
    `<li class="guide-step"><div class="guide-number" aria-hidden="true">${index + 1}</div><div class="guide-body"><h3>${step.title}</h3>${step.art}<p>${step.text}</p></div></li>`).join('')}</ol></div>`;
}
