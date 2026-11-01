# トトと簡易デュエル（ソース管理用リポジトリ）

簡易デュエルアプリのソースをGitで管理し、複数体で並行作業して、
最後にマージで統合するための置き場所。

## 運用の流れ

1. 作業ごとにブランチを切る（例：`work/tile-fix`、`work/start-screen`）
2. 各ブランチで独立に作業する（他の作業と干渉しない）
3. 終わったら `main` へマージする。競合（コンフリクト）が出たらマージ時に解消する

## 競合（コンフリクト）が出た時の決まり（2026-11-02 ユーザー指示）

- 機械的にどちらかを選んで消さない
- まず、そのブランチが何をする作業なのか、作業内容をしっかり把握する
- その上で解消するか、作業そのものの総合的な考え直しが必要かを判断する
4. `main` へ入った時点で GitHub Actions（`.github/workflows/deploy.yml`）が走り、
   本番（GitHub Pages）へ自動で反映される

## 中身

- `index.html` … アプリ本体（単一ファイル）
- `assets/` … BGM・効果音・画像などの素材
- `icon.webp` … アイコン

## 状態

- GitHub：https://github.com/gm0231/duel-app（Public、2026-11-02 接続）
- 本番（GitHub Pages）：https://gm0231.github.io/duel-app/
- Pages の Source は GitHub Actions。main へ push すると自動でデプロイされる
