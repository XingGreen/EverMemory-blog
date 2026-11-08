*本專案由AI生成

# EverMemory's Blog

> 一個用 Astro 建置的個人部落格，文章在建置時渲染成頁面，用於記錄與展示個人的寫作和日常，配色、版面與閱讀偏好都可依自己的喜好調整。

![Node.js >= 22](https://img.shields.io/badge/Node.js-%3E%3D22-5FA04E?logo=nodedotjs&logoColor=white)
![pnpm 9](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)
![Astro 7.0.2](https://img.shields.io/badge/Astro-7.0.2-BC52EE?logo=astro&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-3DA639.svg)](../LICENSE)

其他語言版本：[简体中文](../README.md) · [English](../README.en.md) · [日本語](./README.ja.md) · [Русский](./README.ru.md)

> [!IMPORTANT]
> 後台登入、GitHub App 與環境變數設定請先閱讀 [`docs/ADMIN_MANUAL.md`](./ADMIN_MANUAL.md)；本文件僅涵蓋專案結構、命令與部署。

## 專案簡介

文章以 Markdown / MDX 檔案存放在 `src/content/posts/`，由 Astro 在建置期產生頁面；`/admin/` 提供文章編輯、預覽、草稿、歷史版本與站台設定等功能。文章儲存只寫入本機檔案，正式部署為唯讀；推送到儲存庫透過同步工作台完成，一次推送對應一次重新建置。

介面文案支援簡體中文、繁體中文、英文、日文與俄文，預設語言由 `src/config/siteConfig.ts` 中的 `SITE_LANG` 決定，詞條位於 `src/i18n/languages/`。

## 功能特性

### 內容與閱讀

- Markdown / MDX 文章，支援 GFM、提醒區塊、增強程式碼區塊與行號、KaTeX 公式、Mermaid 與 PlantUML 圖表、GitHub 儲存庫卡片
- 分類、標籤、置頂、草稿、密碼保護、摘要、閱讀時間估算與目錄（TOC）
- 獨立頁面：關於、歸檔、搜尋、友鏈、留言、追番、番組計畫、相冊、音樂、應用推薦、打賞支持
- 關於頁與留言板的正文、友鏈頁的自訂內容取自 `src/content/spec/`
- Pagefind 站內全文搜尋、RSS 與網站地圖
- 亮色 / 暗色 / 跟隨系統、主題色相調整、橫幅 / 全螢幕 / 透明 / 純色桌布模式、單側或雙側側邊欄
- 可設定模組：圖片燈箱、留言、頁尾內容、字型、音樂播放器、看板娘
- Swup 頁面轉場與響應式版面

### 管理後台

- GitHub OAuth 登入（白名單帳號）、JWT HttpOnly Cookie 工作階段、線上裝置查看與強制登出、重新驗證
- 可選的 break-glass 應急登入（`ADMIN_BREAKGLASS_TOKEN`）與 Cloudflare Turnstile 人機驗證
- 文章列表、編輯與即時預覽、儲存與刪除、草稿跨裝置續寫、歷史版本與差異檢視
- 同步工作台、分類與標籤管理、友鏈管理、站台設定、環境變數與密鑰管理、工作階段管理
- 後台預覽依 `.md` 與 `.mdx` 分通道渲染，互不干擾

### 工程能力

- Astro 7 + Svelte 5 + TypeScript + Tailwind CSS 4
- Biome 程式碼風格檢查、Vitest 單元測試、turbo 編排建置流程
- 建置順序：圖示產生 → LQIP → 設定快照 → 分類標籤檢查 → Astro 建置 → 字型子集 → Pagefind 索引

## 快速開始

### 環境需求

- Node.js ≥ 22
- pnpm 9（版本由 `packageManager` 固定，安裝時僅允許 pnpm）

### 安裝與啟動

```bash
git clone https://github.com/XingGreen/EverMemory-blog.git
cd EverMemory-blog
pnpm install
pnpm dev
```

開發伺服器預設執行於 `http://localhost:4321`，後台入口為 `/admin/`。後台登入與寫入所需的環境變數見 [`docs/ADMIN_MANUAL.md`](./ADMIN_MANUAL.md)。

### 常用指令

| 指令 | 作用 |
| :--- | :--- |
| `pnpm install` | 安裝依賴 |
| `pnpm dev` | 啟動本機開發伺服器 |
| `pnpm build` | 執行完整正式建置 |
| `pnpm preview` | 本機預覽建置產物 |
| `pnpm check` | Astro 型別與模板檢查 |
| `pnpm type-check` | TypeScript 型別檢查 |
| `pnpm lint` / `pnpm format` | Biome 檢查（含自動修復）與格式化 |
| `pnpm test` / `pnpm test:run` | Vitest 監視模式 / 單次執行 |
| `pnpm new-post <filename>` | 新增文章 |
| `pnpm icons` / `pnpm lqips` | 重新產生圖示與 LQIP 資料 |
| `pnpm astro ...` | 呼叫 Astro CLI |

提交前建議依序執行 `pnpm check`、`pnpm test:run`、`pnpm lint`。

## 設定與內容

### 站台設定

可設定項目依功能拆分於 `src/config/`，由 `src/config/index.ts` 統一匯出。站台標題、位址、語言、主題色、分頁與頁面開關位於 `siteConfig.ts`；各設定檔用途見 [`src/config/README.md`](../src/config/README.md)。

站台位址以 `siteConfig.ts` 的 `site_url` 為準。若新增由環境變數控制的建置邏輯，需同步把變數登記到 `turbo.json` 的 `env`，否則變數不會傳給建置工作。

常用設定檔：

| 檔案 | 用途 |
| :--- | :--- |
| `siteConfig.ts` | 站台標題、位址、語言、主題色、分頁與頁面開關 |
| `profileConfig.ts` | 個人資料、頭像與社群連結 |
| `navBarConfig.ts` | 主導覽與搜尋設定 |
| `sidebarConfig.ts` | 側欄版面與掛件 |
| `commentConfig.ts` | 留言服務類型與參數 |
| `musicConfig.ts` | 音樂播放器 |
| `fontConfig.ts` | 字型定義與載入 |
| `licenseConfig.ts` | 文章預設授權資訊 |

### 文章與 Frontmatter

文章位於 `src/content/posts/`（`.md` / `.mdx`），關於頁、留言板與友鏈頁的內容位於 `src/content/spec/`。欄位定義見 `src/content.config.ts`：

| 欄位 | 型別 | 說明 |
| :--- | :--- | :--- |
| `title` | string | 標題，必填 |
| `published` | date | 發布日期，必填 |
| `updated` | date | 更新日期 |
| `draft` | boolean | 草稿，預設 `false` |
| `description` | string | 摘要 |
| `image` | string | 封面圖 |
| `tags` | string[] | 標籤 |
| `category` | string | 分類 |
| `lang` | string | 文章語言與站台預設語言不同時填寫 |
| `pinned` | boolean | 置頂 |
| `author` / `sourceLink` | string | 作者與原文連結 |
| `licenseName` / `licenseUrl` | string | 文章授權名稱與連結 |
| `comment` | boolean | 是否允許留言 |
| `password` / `passwordHint` | string | 閱讀密碼與提示 |

### 目錄結構

| 路徑 | 內容 |
| :--- | :--- |
| `src/pages/` | Astro 頁面路由，後台入口在 `src/pages/admin/` |
| `src/pages/api/admin/` | 後台介面 |
| `src/components/` | 元件，後台元件集中於 `src/components/admin/` |
| `src/layouts/` | 頁面版面 |
| `src/content/` | 文章，以及關於頁、留言板與友鏈頁的內容 |
| `src/config/` | 站台與功能設定 |
| `src/plugins/` | remark / rehype 擴充 |
| `src/i18n/` | 語言詞條與鍵名 |
| `src/utils/`、`src/constants/` | 工具函式與產生資料 |
| `scripts/` | 建置期腳本 |
| `tests/` | 單元測試 |
| `docs/` | 管理與維運文件 |

## 建置與部署

`astro.config.mjs` 依據環境變數選擇轉接器：

| 條件 | 轉接器 | 產物與設定 |
| :--- | :--- | :--- |
| `VERCEL=1` | `@astrojs/vercel` | 平台設定見 `vercel.json` |
| `CF_WORKERS=1` | `@astrojs/cloudflare` | `dist/client` + `dist/server/entry.mjs`，設定見 `wrangler.jsonc` |
| 皆未設定 | `@astrojs/node`（standalone） | 輸出到 `dist/` |

`pnpm build` 產出 `dist/`，`pnpm preview` 可本機預覽。同時設定 `CF_WORKERS` 與 `VERCEL` 時以 `CF_WORKERS` 為準；`BASE_PATH` 用於部署到子路徑，未設定時為 `/`。Cloudflare Workers 部署還需設定 `SESSION` 等 KV 綁定，命名空間 ID 需自行建立後填入 `wrangler.jsonc`。

正式環境的專案目錄為唯讀：文章儲存只能在本機開發環境進行，正式環境會拒絕寫入；推送與刪除透過 GitHub App 完成，推送在同步工作台操作，一次提交多個檔案、只觸發一次部署。站台設定與分類標籤在正式環境直接寫入 GitHub；環境變數與密鑰只能在本機開發環境寫入。

部署前的建議檢查順序：

```bash
pnpm check
pnpm type-check
pnpm test:run
pnpm build
```

託管平台將建置命令填為 `pnpm build`，輸出目錄填為 `dist`。

## 專案文件

- [`AGENTS.md`](../AGENTS.md) — 協作規範與操作邊界
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — 架構、技術約定與建置流程
- [`docs/ADMIN_MANUAL.md`](./ADMIN_MANUAL.md) — 後台使用與環境變數設定
- [`docs/EMERGENCY_OPS.md`](./EMERGENCY_OPS.md) — 應急操作
- [`src/config/README.md`](../src/config/README.md) — 設定項目說明
- [`todo.md`](../todo.md) — 待辦與已知問題

## 授權與合規

本專案採用 [MIT License](../LICENSE)。使用、修改或散布時需保留以下版權聲明：

- Copyright (c) 2024 saicaca
- Copyright (c) 2025 CuteLeaf
- Copyright (c) 2026 XingGreen

後台介面的設計參考了 flare-stack-blog（GPL-3.0-only）的構思；本專案為獨立實作，未複製其原始碼。

部分圖片與看板娘素材的版權歸各自權利人所有。
