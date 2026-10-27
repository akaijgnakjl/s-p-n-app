/** 用途ごとの語彙。区分と必要写真は試作品の確認済み範囲を維持する。 */
const definitions = {
  '基準点': { categories: ['新設', '検測'], slots: ['遠景', '近景'], prefix: 'TA', autoNamePrefix: '基準点', targetLabel: '点', nameLabel: '点名', unit: '点', categoryLabel: '作業段階', defaultBoardTemplate: 'sample-2111', reportColumns: [{ key: 'x', label: 'X座標' }, { key: 'y', label: 'Y座標' }, { key: 'height', label: '高さ H' }, { key: 'kind', label: '点の種類' }] },
  '仮BM': { categories: ['新設'], slots: ['遠景', '近景'], prefix: 'KBM', autoNamePrefix: '仮BM', targetLabel: '点', nameLabel: '点名', unit: '点', categoryLabel: '作業段階', defaultBoardTemplate: 'sample-2111', reportColumns: [{ key: 'station', label: '測点' }, { key: 'position', label: '位置' }, { key: 'height', label: '高さ' }, { key: 'remarks', label: '備考' }] },
  '現密': { categories: ['路体', '路床', '置換層', '凍上抑制層', '下層路盤工', '歩道路盤工'], slots: ['残砂質量測定', '湿潤土質量測定', '試料乾燥状況'], prefix: '', autoNamePrefix: '試験', targetLabel: '試験対象', nameLabel: '試験対象の管理名', unit: '件', categoryLabel: '施工区分', defaultBoardTemplate: 'sample-2113', reportColumns: [{ key: 'station', label: '測点' }, { key: 'material', label: '材料' }, { key: 'result', label: '測定値' }, { key: 'remarks', label: '備考' }] },
  'コア密': { categories: ['表層工', '基層工', '中間層', '上層路盤工', '舗道舗装工'], slots: ['空中質量測定', '水中質量測定', '表乾質量測定'], prefix: '', autoNamePrefix: '試験', targetLabel: '試験対象', nameLabel: '試験対象の管理名', unit: '件', categoryLabel: '施工区分', defaultBoardTemplate: 'sample-2113', reportColumns: [{ key: 'station', label: '測点' }, { key: 'material', label: '材料' }, { key: 'result', label: '測定値' }, { key: 'remarks', label: '備考' }] },
  '縁石': { categories: ['通常'], slots: ['全景', '詳細'], prefix: '', autoNamePrefix: '確認箇所', targetLabel: '確認箇所', nameLabel: '確認箇所の管理名', unit: '件', categoryLabel: '記録区分', defaultBoardTemplate: 'sample-2113', reportColumns: [{ key: 'station', label: '測点' }, { key: 'position', label: '位置' }, { key: 'result', label: '確認結果' }, { key: 'remarks', label: '備考' }] },
  'MMS': { categories: ['通常'], slots: ['前', '後'], prefix: '', autoNamePrefix: '作業', targetLabel: '作業', nameLabel: '作業の管理名', unit: '件', categoryLabel: '記録区分', defaultBoardTemplate: null, reportColumns: [] },
  'TS出来形(バリアフリー)': { categories:['通常'], slots:['現場写真','スマホスクリーンショット'], prefix:'SP', autoNamePrefix:'TS', targetLabel:'計測箇所', nameLabel:'計測箇所名', unit:'箇所', categoryLabel:'記録区分', defaultBoardTemplate:'sample-2112', reportColumns:[{key:'station',label:'測点又は区別'},{key:'side',label:'左右（L/R）'},{key:'designX',label:'X 設計値 m'},{key:'measuredX',label:'X 実測値 m'},{key:'designY',label:'Y 設計値 m'},{key:'measuredY',label:'Y 実測値 m'},{key:'surveyor',label:'測定者',optional:true},{key:'standard',label:'規格値 mm',optional:true},{key:'internalStandard',label:'社内規格値 mm',optional:true},{key:'remarks',label:'備考',optional:true}] },
};
const guides = {
  '基準点':['周辺と設置場所が分かるように','点名と標識が読めるように'],
  '仮BM':['道路との位置関係を含めて','点名と標識を大きく'],
  '現密':['残砂質量の測定状況','湿潤土質量の測定状況','試料の乾燥状況'],
  'コア密':['空中質量の測定状況','水中質量の測定状況','表乾質量の測定状況'],
  '縁石':['対象区間全体が分かるように','形状や状態が分かるように'],
  'MMS':['作業前のスナップ写真','作業後のスナップ写真'],
  'TS出来形(バリアフリー)':['計測箇所と機器・黒板を撮影','PCでスマホのスクリーンショットを選択、または画像を貼り付け'],
};
export const USE_CASES = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, Object.freeze({
  ...definition, categories: Object.freeze(definition.categories), slots: Object.freeze(definition.slots), guides:Object.freeze(guides[name]), reportColumns: Object.freeze(definition.reportColumns.map(column => Object.freeze(column))),
})])));
export const PENDING_USE_CASES = Object.freeze(['現場写真']);
export const GROUP_KINDS = Object.freeze(['路線', '工区', '施工箇所', 'その他']);
/** 端末間で共通にする暫定上限。実機メモリ性能の保証値ではない。 */
export const LIMITS = Object.freeze({ photos: 250, totalBytes: 1_000_000_000, imageBytes: 20 * 1024 * 1024, pixels: 40_000_000, side: 16_000, targets: 2000, groups: 50 });
/** 保持上限と独立した、1回の簡易帳票に埋め込める採用写真の上限。 */
export const OUTPUT_LIMITS = Object.freeze({ embeddedPhotos: 100, embeddedBytes: 96 * 1024 * 1024 });
