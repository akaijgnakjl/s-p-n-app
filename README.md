# 測量フォトノート 公開用リポジトリ

公開アプリ: https://akaijgnakjl.github.io/s-p-n-app/

ソースコードは [akaijgnakjl/survey-photo-note](https://github.com/akaijgnakjl/survey-photo-note) で管理します。
ソース側の main への Push で検査・テスト・ビルドを行い、生成されたアプリだけをこのリポジトリの site/ へ自動転送します。
このリポジトリは main への Push を受け、GitHub Actions で site/ を GitHub Pages へ公開します。再ビルドは行いません。

- site/: 自動生成した配信資材。直接編集せず、ソース側を変更してください。
- deployment.json: 元ソースのコミット、ビルドID、生成した Actions 実行への参照。
- .github/workflows/pages.yml: 公開専用 workflow。

所有者が Settings → Pages → Source を GitHub Actions に設定してください。
クロスリポジトリの転送には、このリポジトリの書き込み用 Deploy Key と、ソース側の APP_DEPLOY_KEY Secret を使用します。

写真や入力情報はアプリを使うブラウザーに保存され、このリポジトリへ自動送信されることはありません。
