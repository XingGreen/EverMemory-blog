*本プロジェクトはAIによって生成されました

# EverMemory's Blog

> Astro で作られた個人ブログです。記事はビルド時にページとして描画され、個人の文章や日々の記録を書き留めて見せるためのもので、配色・レイアウト・読書の好みは自分に合わせて調整できます。

![Node.js >= 22](https://img.shields.io/badge/Node.js-%3E%3D22-5FA04E?logo=nodedotjs&logoColor=white)
![pnpm 9](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)
![Astro 7.0.2](https://img.shields.io/badge/Astro-7.0.2-BC52EE?logo=astro&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-3DA639.svg)](../LICENSE)

他の言語版：[简体中文](../README.md) · [繁體中文](./README.zh-TW.md) · [English](../README.en.md) · [Русский](./README.ru.md)

> [!IMPORTANT]
> 管理画面へのログイン、GitHub App、環境変数については先に [`docs/ADMIN_MANUAL.md`](./ADMIN_MANUAL.md) をお読みください。本ファイルはプロジェクト構成、コマンド、デプロイのみを扱います。

## プロジェクト概要

記事は `src/content/posts/` に Markdown / MDX ファイルとして置かれ、Astro がビルド時にページを生成します。`/admin/` では記事の編集、プレビュー、下書き、履歴バージョン、サイト設定を提供します。記事の保存はローカルファイルへの書き込みのみですが、下書きは本番環境ではクラウドストレージに保存されます。リポジトリへの反映は同期ワークベンチから行い、1 回のプッシュが 1 回の再ビルドに対応します。

UI の文言は簡体字中国語、繁体字中国語、英語、日本語、ロシア語に対応しています。既定の言語は `src/config/siteConfig.ts` の `SITE_LANG` で設定し、訳文は `src/i18n/languages/` にあります。

## 機能

### コンテンツと閲覧

- Markdown / MDX 記事。GFM、アドモニション、行番号付きの拡張コードブロック、KaTeX 数式、Mermaid と PlantUML の図、GitHub リポジトリカードに対応
- カテゴリ、タグ、固定表示、下書き、パスワード保護、抜粋、読了時間の推定、目次（TOC）
- 独立ページ：概要、アーカイブ、検索、リンク、ゲストブック、追番、番組計画、ギャラリー、音楽、アプリ紹介、支援
- 概要ページとゲストブックの本文、リンクページのカスタム内容は `src/content/spec/` から読み込みます
- Pagefind によるサイト内全文検索、RSS、サイトマップ
- ライト / ダーク / システム連動、テーマ色相の調整、バナー / 全画面 / 透明 / 単色の壁紙モード、片側または両側のサイドバー
- 設定可能なモジュール：画像ライトボックス、コメント、フッター内容、フォント、音楽プレイヤー、マスコット
- Swup によるページ遷移とレスポンシブレイアウト

### 管理画面

- GitHub OAuth ログイン（許可リストのアカウント）、JWT HttpOnly Cookie セッション、オンライン端末の確認と強制ログアウト、再認証
- 任意の break-glass 緊急ログイン（`ADMIN_BREAKGLASS_TOKEN`）と Cloudflare Turnstile による人間確認
- 記事一覧、編集とリアルタイムプレビュー、保存と削除、端末をまたぐ下書きの再開、履歴バージョンと差分表示
- 同期ワークベンチ、カテゴリとタグの管理、リンク管理、サイト設定、環境変数とシークレットの管理、セッション管理
- 管理画面のプレビューは `.md` と `.mdx` を別々のチャネルで描画し、互いに干渉しません

### 開発基盤

- Astro 7 + Svelte 5 + TypeScript + Tailwind CSS 4
- Biome によるコードスタイル検査、Vitest による単体テスト、turbo によるビルドパイプラインの編成
- ビルド順序：アイコン生成 → LQIP → GitHub カードのキャッシュ → 設定スナップショット → 分類・タグの検査 → Astro ビルド → フォントサブセット → Pagefind インデックス

## クイックスタート

### 必要環境

- Node.js ≥ 22
- pnpm 9（`packageManager` で固定、インストールは pnpm のみ許可）

### インストールと起動

```bash
git clone https://github.com/XingGreen/EverMemory-blog.git
cd EverMemory-blog
pnpm install
pnpm dev
```

開発サーバーは既定で `http://localhost:4321` で起動し、管理画面の入口は `/admin/` です。管理画面のログインと書き込みに必要な環境変数は [`docs/ADMIN_MANUAL.md`](./ADMIN_MANUAL.md) を参照してください。

### よく使うコマンド

| コマンド | 用途 |
| :--- | :--- |
| `pnpm install` | 依存関係のインストール |
| `pnpm dev` | ローカル開発サーバーの起動 |
| `pnpm build` | 本番用の完全ビルド |
| `pnpm preview` | ビルド成果物のローカル確認 |
| `pnpm check` | Astro の型とテンプレートの検査 |
| `pnpm type-check` | TypeScript の型検査 |
| `pnpm lint` / `pnpm format` | Biome の検査（自動修正あり）と整形 |
| `pnpm test` / `pnpm test:run` | Vitest の監視モード / 単回実行 |
| `pnpm new-post <filename>` | 記事の新規作成 |
| `pnpm icons` / `pnpm lqips` | アイコンと LQIP データの再生成 |
| `pnpm astro ...` | Astro CLI の呼び出し |

コミット前に `pnpm check`、`pnpm test:run`、`pnpm lint` をこの順で実行してください。

## 設定とコンテンツ

### サイト設定

設定は機能ごとに `src/config/` に分割され、`src/config/index.ts` から一括エクスポートされます。サイトのタイトル、URL、言語、テーマ色、ページネーション、ページのオンオフは `siteConfig.ts` にあります。各ファイルの用途は [`src/config/README.md`](../src/config/README.md) を参照してください。

サイトの URL は `siteConfig.ts` の `site_url` に従います。環境変数で制御するビルド処理を追加する場合は、その変数を `turbo.json` の `env` にも登録してください。登録しない場合、ビルドタスクに変数が渡されません。

よく使う設定ファイル：

| ファイル | 用途 |
| :--- | :--- |
| `siteConfig.ts` | サイトのタイトル、URL、言語、テーマ色、ページネーション、ページのオンオフ |
| `profileConfig.ts` | プロフィール、アバター、ソーシャルリンク |
| `navBarConfig.ts` | メインナビゲーションと検索 |
| `sidebarConfig.ts` | サイドバーのレイアウトとウィジェット |
| `commentConfig.ts` | コメントサービスの種類と設定 |
| `musicConfig.ts` | 音楽プレーヤー |
| `fontConfig.ts` | フォント定義と読み込み |
| `licenseConfig.ts` | 記事の既定ライセンス |

### 記事と Frontmatter

記事は `src/content/posts/`（`.md` / `.mdx`）、概要ページ・ゲストブック・リンクページの内容は `src/content/spec/` にあります。フィールドは `src/content.config.ts` で定義されています：

| フィールド | 型 | 説明 |
| :--- | :--- | :--- |
| `title` | string | タイトル、必須 |
| `published` | date | 公開日、必須 |
| `updated` | date | 更新日 |
| `draft` | boolean | 下書き、既定は `false` |
| `description` | string | 抜粋 |
| `image` | string | カバー画像 |
| `tags` | string[] | タグ |
| `category` | string | カテゴリ |
| `lang` | string | サイトの既定言語と異なる場合に設定する記事の言語 |
| `pinned` | boolean | 固定表示 |
| `author` / `sourceLink` | string | 著者と元記事の URL |
| `licenseName` / `licenseUrl` | string | 記事のライセンス名と URL |
| `comment` | boolean | コメントを許可するか |
| `password` / `passwordHint` | string | 閲覧パスワードとヒント |

### ディレクトリ構成

| パス | 内容 |
| :--- | :--- |
| `src/pages/` | Astro のページルーティング、管理画面の入口は `src/pages/admin/` |
| `src/pages/api/admin/` | 管理画面の API |
| `src/components/` | コンポーネント、管理画面用は `src/components/admin/` に集約 |
| `src/layouts/` | ページレイアウト |
| `src/content/` | 記事、および概要ページ・ゲストブック・リンクページの内容 |
| `src/config/` | サイトと機能の設定 |
| `src/plugins/` | remark / rehype 拡張 |
| `src/i18n/` | 訳文のキーと言語ファイル |
| `src/utils/`、`src/constants/` | ユーティリティと生成データ |
| `scripts/` | ビルド時スクリプト |
| `tests/` | 単体テスト |
| `docs/` | 管理・運用ドキュメント |

## ビルドとデプロイ

`astro.config.mjs` は環境変数に応じてアダプターを選択します：

| 条件 | アダプター | 成果物と設定 |
| :--- | :--- | :--- |
| `VERCEL=1` | `@astrojs/vercel` | プラットフォーム設定は `vercel.json` |
| `CF_WORKERS=1` | `@astrojs/cloudflare` | `dist/client` + `dist/server/entry.mjs`、設定は `wrangler.jsonc` |
| いずれも未設定 | `@astrojs/node`（standalone） | `dist/` に出力 |

`pnpm build` は `dist/` を出力し、`pnpm preview` でローカル確認できます。`CF_WORKERS` と `VERCEL` を同時に設定した場合は `CF_WORKERS` が優先されます。`BASE_PATH` はサブパスへのデプロイに使い、未設定時は `/` です。Cloudflare Workers へのデプロイには `SESSION` などの KV バインドも必要で、名前空間 ID は作成して `wrangler.jsonc` に記入する必要があります。

本番環境ではプロジェクトディレクトリが読み取り専用です。公開記事の保存はローカル開発環境でのみ行え、本番環境では書き込みが拒否されます。下書きは例外で、クラウドストレージに保存されるため本番環境でも編集でき、履歴からの復元も可能です。プッシュと削除は GitHub App 経由で行われ、プッシュは同期ワークベンチから複数ファイルをまとめて 1 コミットで実行し、デプロイは 1 回だけ発生します。サイト設定とカテゴリ／タグは本番環境では GitHub に直接書き込まれ、環境変数とシークレットはローカル開発環境でのみ書き込めます。

デプロイ前に推奨する検査順序：

```bash
pnpm check
pnpm type-check
pnpm test:run
pnpm build
```

ホスティング側ではビルドコマンドに `pnpm build`、出力ディレクトリに `dist` を指定してください。

## ドキュメント

- [`AGENTS.md`](../AGENTS.md) — コラボレーション規約と変更範囲
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — アーキテクチャ、技術規約、ビルドフロー
- [`docs/ADMIN_MANUAL.md`](./ADMIN_MANUAL.md) — 管理画面の使い方と環境変数
- [`docs/EMERGENCY_OPS.md`](./EMERGENCY_OPS.md) — 緊急時の操作
- [`src/config/README.md`](../src/config/README.md) — 設定項目の説明
- [`todo.md`](../todo.md) — 未対応項目と既知の問題

## ライセンスとコンプライアンス

本プロジェクトは [MIT License](../LICENSE) の下で公開されています。利用、改変、配布の際は以下の著作権表示を保持してください：

- Copyright (c) 2024 saicaca
- Copyright (c) 2025 CuteLeaf
- Copyright (c) 2026 XingGreen

管理画面のデザインは flare-stack-blog（GPL-3.0-only）の構想を参考にしています。本プロジェクトは独自実装であり、そのソースコードは複製していません。

一部の画像およびマスコット素材の著作権は、それぞれの権利者に帰属します。
