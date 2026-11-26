// アプリの使い方：作業項目（画面のタブ）ごとに、実際の画面を簡略化した絵と番号つきの説明で
// 「どこで・何を・どう編集できるか」を示す。タブ切替はラジオボタンとCSSだけで行う（JS不要）。
// 絵の文字は12px以上。文字どうし・文字と番号が重ならないこと、枠の内側に収まることを
// guideLayoutIssues() で検査する（テストで0件を確認）。

const CJK = /[^\x00-\x7f]/;
/** 文字幅の見積り：全角は文字サイズと同じ、半角は0.6倍。 */
export const textWidth = (text, size = 12) => [...String(text)].reduce((sum, ch) => sum + (CJK.test(ch) ? size : size * 0.6), 0);
const esc = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const TABS = ['撮影・確認', '写真を整理', '調書入力', '出力', 'ZIP受け渡し'];

function canvas(designWidth, designHeight, label) {
  const ox = 14, oy = 14, width = designWidth + ox * 2, height = designHeight + oy * 2;
  const parts = [], items = [], issues = [];
  const api = {
    rect(x, y, w, h, cls = 'g-box', extra = '') { parts.push(`<rect x="${x + ox}" y="${y + oy}" width="${w}" height="${h}" rx="${['g-cell', 'g-paper', 'g-check'].includes(cls) ? 2 : 6}" class="${cls}"${extra}/>`); return api; },
    text(x, y, value, { size = 12, anchor = 'start', cls = 'g-text', weight } = {}) {
      const w = textWidth(value, size), left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      items.push({ kind: 'text', value, x: left + ox, y: y + oy - size * 0.88, w, h: size * 1.1 });
      parts.push(`<text x="${x + ox}" y="${y + oy}" font-size="${size}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`} class="${cls}"${weight ? ` font-weight="${weight}"` : ''}>${esc(value)}</text>`);
      return api;
    },
    box(x, y, value, { w, h = 26, primary = false, cls } = {}) {
      const width = w ?? Math.ceil(textWidth(value) + 28);
      if (textWidth(value) > width - 16) issues.push(`「${value}」がボタンの幅に収まりません`);
      api.rect(x, y, width, h, cls || (primary ? 'g-primary' : 'g-box'));
      api.text(x + width / 2, y + h / 2 + 4.3, value, { anchor: 'middle', cls: primary ? 'g-on-primary' : 'g-text' });
      return { x, y, w: width, h, right: x + width };
    },
    tabs(active, y = 0) {
      let x = 0;
      for (const [i, name] of TABS.entries()) { x = api.box(x, y, `${i + 1}. ${name}`, { h: 24, primary: name === active }).right + 6; }
      return api;
    },
    mark(n, x, y) {
      items.push({ kind: 'mark', value: n, x: x + ox - 11, y: y + oy - 11, w: 22, h: 22 });
      parts.push(`<g class="g-mark"><circle cx="${x + ox}" cy="${y + oy}" r="11"/><text x="${x + ox}" y="${y + oy + 4.3}" font-size="12" text-anchor="middle">${n}</text></g>`);
      return api;
    },
    issues() {
      const found = [...issues];
      for (const item of items) if (item.x < 0 || item.y < 0 || item.x + item.w > width || item.y + item.h > height) found.push(`「${item.value}」が絵の外にはみ出します`);
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if ((a.kind === 'text' || b.kind === 'text' || (a.kind === 'mark' && b.kind === 'mark')) && overlap(a, b)) found.push(`「${a.value}」と「${b.value}」が重なります`);
      }
      return found;
    },
    svg() { return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" class="guide-art"><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="10" class="g-frame"/>${parts.join('')}</svg>`; },
  };
  return api;
}

function topScreen() {
  const c = canvas(600, 250, '画面上部の操作');
  c.box(0, 0, '▶ 工事・取込'); c.box(116, 0, '↓ 作業ZIPを保存', { primary: true }); c.box(421, 0, '▶ 圏外未準備・オンライン');
  c.box(0, 36, '黒板一覧'); c.box(86, 36, '↑ 作業ZIPを開く'); c.box(522, 36, '? 使い方');
  c.rect(0, 72, 600, 42, 'g-panel'); c.text(12, 99, '〇〇工事（工事名）', { size: 14, weight: 700 }); c.box(160, 80, '訂正', { h: 24 });
  c.text(0, 134, '現場：1で終わり'); c.text(118, 134, '持ち帰り後：2〜5は会社のPCなどで');
  c.tabs('撮影・確認', 142);
  c.box(0, 180, '全路線 9'); c.box(84, 180, '検証路線 9'); c.box(180, 180, '＋ 路線'); c.box(257, 180, '路線名を訂正');
  c.box(0, 218, 'すべて'); c.box(70, 218, 'TS出来形(バリアフリー) 9/16 未完了'); c.box(320, 218, '基準点 0/2 未完了');
  c.mark(1, 0, 0).mark(2, 116, 0).mark(3, 421, 0).mark(4, 0, 36).mark(5, 522, 36).mark(6, 588, 154).mark(7, 160, 80).mark(8, 180, 180).mark(9, 0, 218);
  return c;
}
function fieldScreen() {
  const c = canvas(600, 436, '撮影・確認の画面');
  c.tabs('撮影・確認');
  c.rect(0, 34, 200, 266, 'g-panel'); c.text(10, 58, '記録対象', { size: 14, weight: 700 }); c.box(112, 38, '＋ 追加');
  c.rect(10, 82, 12, 12, 'g-check'); c.text(28, 93, '未撮影の対象のみ');
  for (const [i, name] of ['240R', '248.88R', '253.1R'].entries()) { c.rect(10, 112 + i * 30, 12, 12, 'g-check'); c.box(30, 106 + i * 30, name, { w: 160, h: 24 }); }
  c.box(10, 200, '表示中を全選択', { w: 180 }); c.box(10, 232, '選択の名前を貼り付けで変更', { w: 180 }); c.box(10, 264, '選択を削除', { w: 180 });
  c.text(224, 54, '240R', { size: 16, weight: 700 });
  c.box(224, 70, '✎ 管理名・所属を訂正'); c.box(224, 100, '☰ 管理名をまとめて変更（8件）'); c.box(224, 130, '⇪ スクリーンショットをまとめて取り込む');
  c.box(224, 166, '◀ 前へ', { w: 90 }); c.box(320, 166, '今の撮影対象 1/8', { w: 170 }); c.box(496, 166, '次へ ▶', { w: 94 });
  c.rect(224, 202, 366, 68, 'g-panel'); c.text(236, 220, '現場写真', { size: 13, weight: 700 });
  c.box(236, 232, '撮影する', { primary: true }); c.box(318, 232, '写真から選ぶ'); c.box(424, 232, 'その他 ▼');
  c.rect(224, 280, 366, 68, 'g-panel'); c.text(236, 298, 'スマホスクリーンショット', { size: 13, weight: 700 });
  c.box(236, 310, 'PCで画像を貼り付け'); c.box(380, 310, 'スクリーンショットを選ぶ');
  c.rect(224, 358, 366, 68, 'g-panel'); c.text(236, 376, '次の写真の黒板', { size: 13, weight: 700 });
  c.box(236, 388, '黒板の内容を編集'); c.text(372, 405, '工事名・位置・寸法…', { cls: 'g-muted' });
  c.mark(1, 112, 38).mark(2, 10, 106).mark(3, 10, 200).mark(4, 224, 70).mark(5, 224, 166).mark(6, 224, 202).mark(7, 224, 280).mark(8, 224, 358);
  return c;
}
function organizeScreen() {
  const c = canvas(600, 376, '写真を整理の画面');
  c.tabs('写真を整理');
  c.box(0, 36, 'すべて', { primary: true }); c.box(70, 36, '撮影不足'); c.box(152, 36, '作業日未確認'); c.box(258, 36, '調書要再確認');
  c.box(0, 70, '管理名・原本名で検索', { w: 230 }); c.box(236, 70, '用途 ▼', { w: 100 }); c.box(342, 70, '詳細条件 ▼');
  c.rect(0, 106, 600, 24, 'g-head');
  for (const [x, name] of [[10, '写真'], [80, '管理名・原本名'], [250, '状態'], [320, '作業日'], [410, '調書'], [486, '編集']]) c.text(x, 122, name, { weight: 700 });
  for (const [i, row] of [['240R', 'genba.png', '採用中', true], ['240R', 'screen.png', '履歴', false]].entries()) {
    const y = 130 + i * 62;
    c.rect(0, y, 600, 62, 'g-row'); c.rect(10, y + 12, 56, 38, 'g-thumb');
    c.text(80, y + 26, row[0]); c.text(80, y + 46, row[1], { cls: 'g-muted' }); c.text(250, y + 36, row[2]); c.text(320, y + 36, '11/24'); c.text(410, y + 36, '未確認');
    c.box(486, y + 6, '写真を変更', { w: 104, h: 24 }); if (row[3]) c.box(486, y + 34, '黒板を修正', { w: 104, h: 24 });
  }
  c.box(0, 266, '作業日をまとめて変更');
  c.rect(0, 302, 600, 74, 'g-panel'); c.text(12, 324, '記録対象の管理名・所属 9件', { size: 13, weight: 700 });
  c.text(12, 356, '240R'); c.box(120, 338, '管理名を編集'); c.box(226, 338, '所属を訂正');
  c.mark(1, 0, 36).mark(2, 10, 142).mark(3, 486, 136).mark(4, 486, 164).mark(5, 0, 266).mark(6, 0, 302);
  return c;
}
function reportScreen() {
  const c = canvas(600, 372, '調書入力の画面');
  c.tabs('調書入力');
  c.box(0, 36, '帳票の項目名を設定');
  c.box(0, 70, '基準点 未完了'); c.box(113, 70, 'TS出来形(バリアフリー) 未完了', { primary: true });
  c.rect(0, 106, 600, 70, 'g-panel'); c.text(12, 126, '路線：検証路線', { size: 13, weight: 700 });
  c.box(12, 138, '施工区間を設定'); c.box(130, 138, '測定者・規格値・社内規格値・印を入力'); c.box(368, 138, '測点の頭を選択');
  c.box(0, 188, '編集中の調書をすべて保存'); c.box(178, 188, '表示中の編集を取り消す'); c.box(344, 188, '表示中の調書を入力確認済みにする');
  c.rect(0, 256, 600, 24, 'g-head');
  for (const [x, name] of [[8, '対象'], [92, '測点'], [170, '左右'], [230, 'X 実測値'], [330, 'Y 実測値'], [436, '確認・任意設定']]) c.text(x, 272, name, { weight: 700 });
  for (const [i, row] of [['240R', '240', 'R', '0.003', '0.006'], ['248.88R', '248.88', 'R', '0.009', '0.007']].entries()) {
    const y = 280 + i * 46;
    c.rect(0, y, 600, 46, 'g-row'); c.text(8, y + 28, row[0]);
    for (const [x, w, v] of [[86, 74, row[1]], [166, 50, row[2]], [226, 94, row[3]], [326, 94, row[4]]]) { c.rect(x, y + 10, w, 26, 'g-cell'); c.text(x + 8, y + 28, v); }
    c.box(436, y + 10, 'この記録の入力を確認');
  }
  c.mark(1, 0, 36).mark(2, 0, 70).mark(3, 0, 106).mark(4, 0, 188).mark(5, 76, 303).mark(6, 436, 290);
  return c;
}
function outputScreen() {
  const c = canvas(600, 398, '出力の画面');
  c.tabs('出力');
  c.box(0, 36, '所属：すべて ▼', { w: 170 }); c.box(176, 36, '用途：すべての用途 ▼', { w: 200 });
  c.box(0, 70, '▶ 出力する記録：9 / 9記録', { w: 260 });
  c.rect(0, 104, 600, 64, 'g-panel'); c.text(12, 124, '出力前の確認', { size: 13, weight: 700 });
  c.text(12, 154, '240R：現場写真が未撮影です'); c.box(470, 136, 'ここへ移動');
  c.box(0, 180, 'プレビューを作成', { primary: true }); c.box(130, 180, '写真ファイルを保存');
  c.rect(0, 216, 600, 182, 'g-panel'); c.text(12, 236, '調書・写真帳プレビュー', { size: 13, weight: 700 }); c.text(588, 236, '21ページ', { anchor: 'end', cls: 'g-muted' });
  c.box(12, 250, '全画面で表示'); c.box(517, 250, '✎ 編集');
  c.rect(150, 286, 300, 66, 'g-paper'); for (let i = 0; i < 4; i++) c.rect(170, 298 + i * 13, 260, 6, 'g-line');
  c.box(12, 362, '印刷・PDF保存', { primary: true });
  c.mark(1, 0, 36).mark(2, 0, 104).mark(3, 0, 180).mark(4, 130, 180).mark(5, 12, 250).mark(6, 517, 250).mark(7, 12, 362);
  return c;
}
function handoffScreen() {
  const c = canvas(600, 304, 'ZIP受け渡しの画面');
  c.tabs('ZIP受け渡し');
  c.rect(0, 36, 600, 66, 'g-panel'); c.text(12, 58, '作業ZIPの内容', { size: 13, weight: 700 });
  c.text(12, 88, '記録対象 9', { size: 14 }); c.text(140, 88, '原本 16', { size: 14 }); c.text(260, 88, '2.84 MB', { size: 14 });
  c.rect(0, 112, 600, 120, 'g-panel'); c.text(12, 134, '会社PCで続きを開く', { size: 13, weight: 700 });
  c.text(12, 162, '1 スマホでZIPを保存'); c.text(12, 186, '2 社内の方法でPCへ渡す'); c.text(12, 210, '3 PCで同じアプリを開く');
  c.box(330, 150, '受け取った作業ZIPを開く');
  c.rect(0, 242, 600, 62, 'g-panel'); c.text(12, 278, '作業の終了', { size: 13, weight: 700 });
  c.box(130, 260, '保存を確認して作業を終了'); c.box(308, 260, 'ギガファイル');
  c.mark(1, 0, 36).mark(2, 0, 112).mark(3, 330, 150).mark(4, 130, 260).mark(5, 308, 260);
  return c;
}

/** 作業項目ごとの説明。points は絵の番号と対応する（[ボタン・場所, できること]）。 */
export const GUIDE_SECTIONS = Object.freeze([
  { id: 'top', tab: '最初に・画面上部', title: '工事を作る・開く（画面上部）', screen: topScreen,
    intro: 'どの画面でも上部にある操作です。最初に工事を作るか、受け取った作業ZIPを開きます。',
    points: [
      ['工事・取込', '「＋ 新しい工事」で工事名・路線名・作業日を入れて工事を作ります。試しに使うだけなら、最初の画面の「お試しで使う（工事を作らない）」で始めると、作業ZIPの保存なしで作成・削除を試せます（「本番の工事にする」で残すこともできます）。作業ZIPに保存していない変更がある時は、保存を確かめてから始めます。「作業ZIPを開く」で保存したZIPの続きから作業できます（展開は不要）。'],
      ['↓ 作業ZIPを保存', '原本写真・黒板・調書をまとめて1つのZIPに保存します。作業の区切りごとに押してください。'],
      ['圏外未準備・オンライン', '「圏外利用を準備」で電波のない現場でも開けるようにします。「アプリ更新を確認」で新しい版に切り替えます。'],
      ['黒板一覧・↑ 作業ZIPを開く', '「黒板一覧」で使える黒板（5種類）の見本を表示します。右の「↑ 作業ZIPを開く」で保存した作業ZIPを読み込むと、「1. 撮影・確認」の画面から続きを作業できます（展開は不要）。中身を確認するだけなら「お試しとして開く」にチェックすると、作業ZIPを保存（ダウンロード）せずに削除できます。お試し中はその右に「お試しを削除して最初に戻る」が出ます（確認してから、工事を作る最初の画面に戻ります）。'],
      ['? 使い方', 'この説明を開きます。右上の「説明」で各画面の補足説明、「通知」でこれまでのお知らせを表示できます。'],
      ['作業の順番（1〜5）', '矢印の形の切り替えで、左から順に進めます。現場の作業は「1. 撮影・確認」で終わりです。撮り終えたら「↓ 作業ZIPを保存」で保存して持ち帰り、「2. 写真を整理」〜「5. ZIP受け渡し」は会社のPCなどで行います。'],
      ['訂正（工事名の右）', '工事名を直します。その右の「お試しに切り替える」で、本番の工事を途中からお試しにできます（作業ZIPを保存せずに削除できるようになります。「本番の工事にする」で戻せます）。'],
      ['＋ 路線・路線名を訂正', '路線（所属）を追加・名前を訂正します。「全路線」や路線名を押すと、その路線の記録対象だけを表示します。'],
      ['用途のタブ', '用途ごとの撮影枚数（撮影済み／必要数）と未完了を表示します。押すとその用途の記録対象だけを表示し、「すべて」で全用途に戻ります。'],
    ] },
  { id: 'field', tab: '撮影・確認', title: '撮影・確認：記録対象を登録して写真を入れる', screen: fieldScreen,
    intro: '記録対象（測点・計測箇所など）を登録し、撮影枠ごとに写真を入れます。黒板の内容もここで決めます。',
    points: [
      ['＋ 追加', '用途・路線名・記録区分・追加する数・名前を指定して登録します。「管理名を一覧で貼り付け」にExcel等の列を貼ると、その名前で上から順に登録します。'],
      ['記録対象の一覧', '押すと右側がその記録対象に切り替わります。用途で絞り込み、「未撮影の枠がある対象のみ」で残りだけを表示できます。各行の「削除」で削除します。'],
      ['選択の操作', 'チェックで選び、「選択の名前を貼り付けで変更」でExcel等の名前一覧に上から順に置き換えます。「選択を削除」でまとめて削除します。'],
      ['管理名の訂正・まとめて変更・取込', '「管理名・所属を訂正」でこの記録対象の名前と路線を直します。「管理名をまとめて変更」は表示中の全件の名前を貼り付けで一度に変えます。TSは「スクリーンショットをまとめて取り込む」で複数の画像を読み取り、同じ管理名へ振り分けます。'],
      ['前へ・次へ', '前後の記録対象へ移動します。'],
      ['撮影枠（現場写真など）', '「撮影する」でカメラ、「写真から選ぶ」で画像を選びます。PCでは画像を枠へドラッグ＆ドロップしても入ります。「黒板を確認」で合成後の見た目を確認、「その他」から撮影不要（理由つき）にできます。'],
      ['スマホスクリーンショット（TS）', '「PCで画像を貼り付け」（Ctrl+Vやドロップ）か「スクリーンショットを選ぶ」で入れると、X・Y・測点を読み取ります。結果を確かめて「黒板・調書へ反映」を押します。'],
      ['次の写真の黒板', '「黒板の内容を編集」で黒板の形式と項目（工事名・工種・位置・寸法・立会人・備考など）を直します。「次の写真に電子黒板を合成する」のオン・オフ、表示中の路線の写真すべてへの反映も選べます。'],
    ],
    more: ['作業日は工事全体で1つです。黒板の「撮影月日」に自動で入ります。日が変わると、最初の撮影・取込の前に「作業日の確認」が出ます。「作業日（この工事）」の「作業日を変更」でも直せます。', '「この記録の写真」から過去の写真（履歴）を確認し、「詳細・訂正」で作業日・所属・黒板を直せます。', '「保存を確認して作業を終了」で、作業ZIPの保存を確かめてから終われます。'] },
  { id: 'organize', tab: '写真を整理', title: '写真を整理：撮った写真をまとめて確認・訂正する', screen: organizeScreen,
    intro: '工事の全写真を一覧で確認し、不足や作業日の確認、写真の差し替え・黒板の修正を行います。',
    points: [
      ['絞り込み', '「撮影不足」「作業日未確認」「調書要再確認」で直す必要がある写真だけを表示します。検索・用途・詳細条件でも絞れます。'],
      ['写真の行', '行を押すと「写真の詳細」が開きます。作業日の「確認・訂正」、所属・写真の種類の「訂正」、「黒板を修正」、履歴写真の「この写真を採用」、原本の保存・削除ができます。'],
      ['写真を変更', '同じ撮影枠の写真を選び直します。前の写真は履歴として残ります。'],
      ['黒板を修正', 'その写真に合成する黒板の内容を直します（撮影月日は作業日から自動）。原本と変更前の黒板は残ります。'],
      ['作業日をまとめて変更', 'チェックした写真（選択がなければ表示中の写真すべて）の作業日を同じ日付にし、黒板の「撮影月日」もそろえます。'],
      ['記録対象の管理名・所属', '一覧のまま「管理名を編集」「所属を訂正」で直せます。保存していない管理名の入力もここで保存・取消できます。'],
    ] },
  { id: 'report', tab: '調書入力', title: '調書入力：数値と帳票の項目を入れる', screen: reportScreen,
    intro: '用途ごとの表に座標・測点などを入れます。路線ごとの共通設定もここで行います。',
    points: [
      ['帳票の項目名を設定', '用途ごとに帳票の「項目名」を変えます（列は変わりません）。路線別の設定が優先されます。'],
      ['用途の切替', '入力する用途を選びます。未完了・完了が色で分かります。'],
      ['路線の共通設定', '「施工区間を設定」で起点・終点・不施工区間を入れます。TSは「測定者・規格値・社内規格値・印を入力」で路線全体に同じ値を入れ、測定結果一覧表の「印」の表示・非表示も選べます。「測点の頭を選択」でSPなど測点の前に付ける文字を決めます。'],
      ['保存・取消・確認済み', '「編集中の調書をすべて保存」で確定、「表示中の編集を取り消す」で元に戻します。「表示中の調書を入力確認済みにする」で表示中の全記録を確認済みにします。'],
      ['表の入力欄', 'マスに直接入力します。Excel等からコピーした表を貼り付けると、複数のマスにまとめて入ります。'],
      ['この記録の入力を確認', 'その行の内容を確かめたら押します（確認済みになります）。'],
    ] },
  { id: 'output', tab: '出力', title: '出力：プレビューを作って印刷・PDF保存', screen: outputScreen,
    intro: '出力範囲を選んでプレビューを作り、そのまま印刷・PDF保存します。不足や未確認があっても作成できます。',
    points: [
      ['所属・用途・出力する記録', '出力する範囲を選びます。「出力する記録」を開くと、記録ごとにチェックで選べます。'],
      ['出力前の確認', '撮影不足や調書の未入力を一覧表示します。「ここへ移動」でその場所へ移動して直せます（直さなくても出力できます）。'],
      ['プレビューを作成', '選んだ範囲の調書・写真帳を作ります。内容を変えたら作り直してください。'],
      ['写真ファイルを保存', '採用写真を画像ファイルとして保存します。'],
      ['全画面で表示', 'プレビューを大きく表示します。拡大・縮小（＋・−・画面に合わせる・100%）ができます。'],
      ['✎ 編集', '全画面表示を開き、そのまま編集モードになります。直したい文字を押すと書き換えられます。印刷・PDFだけに反映し、工事データは変わりません（プレビューを作り直すと元に戻ります）。'],
      ['印刷・PDF保存', '印刷画面を開きます。PDFは保存先で「PDFに保存」を選びます。倍率は100%、ヘッダー・フッターはなしにします。TS調書はA4横、写真帳はA4縦です。'],
    ] },
  { id: 'handoff', tab: 'ZIP受け渡し', title: 'ZIP受け渡し：保存して会社PCで続きを開く', screen: handoffScreen,
    intro: '現場（スマホ）の作業を作業ZIPにまとめ、会社のPCで続きを行う手順です。',
    points: [
      ['作業ZIPの内容', '記録対象の数・原本の枚数・容量を表示します。'],
      ['会社PCで続きを開く', 'スマホで作業ZIPを保存 → 社内の方法（社内Googleドライブなど）でPCへ渡す → PCで同じアプリを開く、の順に進めます。'],
      ['受け取った作業ZIPを開く', 'ZIPを選ぶと、原本・黒板・所属・調書を復元します。ZIPの展開は不要です。'],
      ['保存を確認して作業を終了', '作業ZIPを保存したか確かめてから作業を終えます。'],
      ['ギガファイル', 'ファイル転送サービス（ギガファイル便）を開きます。大きなZIPを渡すときに使えます。'],
    ] },
]);

/** 直したいもの → 編集する場所の早見表。 */
export const GUIDE_WHERE = Object.freeze([
  ['工事名', '画面上部の工事名の右「訂正」'],
  ['路線名', '「路線名を訂正」'],
  ['管理名（1件）', '撮影・確認「✎ 管理名・所属を訂正」／写真を整理「管理名を編集」'],
  ['管理名（まとめて）', '撮影・確認「☰ 管理名をまとめて変更」「選択の名前を貼り付けで変更」'],
  ['これから撮る写真の黒板', '撮影・確認「次の写真の黒板」→「黒板の内容を編集」'],
  ['撮影済み写真の黒板', '写真を整理・写真の詳細の「黒板を修正」'],
  ['写真の差し替え', '写真を整理「写真を変更」／写真の詳細「この写真を採用」'],
  ['作業日（これから撮る写真）', '撮影・確認「作業日（この工事）」の「作業日を変更」（日が変わると撮影前に自動で確認）'],
  ['作業日（撮影済みの写真）', '写真を整理「作業日をまとめて変更」（黒板の撮影月日もそろう）'],
  ['調書の数値', '調書入力の表（Excelから貼り付け可）'],
  ['測定者・規格値・社内規格値・印', '調書入力「測定者・規格値・社内規格値・印を入力」'],
  ['帳票の項目名', '調書入力「帳票の項目名を設定」'],
  ['印刷物の文字だけ', '出力「✎ 編集」（工事データは変わりません）'],
]);

const FLOW = [['top', '工事を作る・作業ZIPを開く'], ['field', '記録対象を登録し、写真を撮る・入れる（現場の作業はここまで。作業ZIPを保存して持ち帰ります）'], ['organize', '持ち帰り後：写真・作業日・黒板を整える'], ['report', '調書を入力して確認する'], ['output', 'プレビューを作って印刷・PDF保存'], ['handoff', '作業ZIPを保存・受け渡し']];

/** すべての絵の配置の問題（文字の重なり・はみ出し）。0件であること。 */
export function guideLayoutIssues() {
  return GUIDE_SECTIONS.flatMap(section => section.screen().issues().map(issue => `${section.tab}：${issue}`));
}

export function renderGuide() {
  const all = [{ id: 'flow', tab: '全体の流れ' }, ...GUIDE_SECTIONS];
  const radios = all.map((section, i) => `<input type="radio" name="guideTab" id="guide-tab-${section.id}" class="guide-radio" value="${section.id}"${i ? '' : ' checked'}>`).join('');
  const nav = `<div class="guide-tabs" role="tablist" aria-label="使い方の項目">${all.map(section => `<label for="guide-tab-${section.id}" class="guide-tab" data-guide-tab="${section.id}">${esc(section.tab)}</label>`).join('')}</div>`;
  const flow = `<section class="guide-panel" data-guide-panel="flow"><h3>全体の流れ</h3><p class="guide-intro">上から順に進めます。各項目を押すと、その画面の詳しい説明に移ります。</p><ol class="guide-flow">${FLOW.map(([id, text]) => `<li><label for="guide-tab-${id}"><strong>${esc(GUIDE_SECTIONS.find(s => s.id === id).tab)}</strong><span>${esc(text)}</span></label></li>`).join('')}</ol><h3>どこで何を直せるか</h3><table class="guide-where"><thead><tr><th>直したいもの</th><th>場所</th></tr></thead><tbody>${GUIDE_WHERE.map(([what, where]) => `<tr><th scope="row">${esc(what)}</th><td>${esc(where)}</td></tr>`).join('')}</tbody></table><p class="guide-intro">原本写真は加工されません。黒板の修正や写真の変更をしても、元の写真と前の黒板は履歴に残ります。</p></section>`;
  const panels = GUIDE_SECTIONS.map(section => `<section class="guide-panel" data-guide-panel="${section.id}"><h3>${esc(section.title)}</h3><p class="guide-intro">${esc(section.intro)}</p><div class="guide-figure">${section.screen().svg()}</div><ol class="guide-points">${section.points.map(([where, what], i) => `<li><span class="guide-mark" aria-hidden="true">${i + 1}</span><div><strong>${esc(where)}</strong><p>${esc(what)}</p></div></li>`).join('')}</ol>${section.more ? `<ul class="guide-more">${section.more.map(text => `<li>${esc(text)}</li>`).join('')}</ul>` : ''}</section>`).join('');
  return `<div class="guide">${radios}${nav}${flow}${panels}</div>`;
}
