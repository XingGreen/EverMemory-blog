*本项目由AI生成

# EverMemory's Blog

> 以内容文件为核心、自带管理后台的 Astro 个人博客。

![Node.js >= 22](https://img.shields.io/badge/node.js-%3E%3D22-brightgreen)
![pnpm 9](https://img.shields.io/badge/pnpm-9-blue)
![Astro 7](https://img.shields.io/badge/Astro-7.0.2-orange)
![License: MIT](https://img.shields.io/github/license/XingGreen/EverMemory-blog)
[![Issues](https://img.shields.io/github/issues/XingGreen/EverMemory-blog)](https://github.com/XingGreen/EverMemory-blog/issues)

其他语言版本：[繁體中文](./docs/README.zh-TW.md) · [English](./README.en.md) · [日本語](./docs/README.ja.md) · [Русский](./docs/README.ru.md)

## 项目简介

文章以 Markdown / MDX 文件存放在 `src/content/posts/`，由 Astro 在构建期生成页面；`/admin/` 提供文章编辑、预览、草稿、历史版本与站点配置等能力。后台写入通过 GitHub App 完成，内容发布对应一次重新构建。

界面文案支持简体中文、繁体中文、英文、日文与俄文，默认语言由 `src/config/siteConfig.ts` 中的 `SITE_LANG` 决定，词条位于 `src/i18n/languages/`。

## 功能特性

### 内容与阅读

- Markdown / MDX 文章，支持 GFM、提醒块、增强代码块与行号、KaTeX 公式、Mermaid 与 PlantUML 图表、GitHub 仓库卡片
- 分类、标签、置顶、草稿、密码保护、摘要、阅读时间估算与目录（TOC）
- 归档页、专栏页（`spec` 集合）、Pagefind 站内全文搜索、RSS 与站点地图
- 亮色 / 暗色 / 跟随系统，主题色相调节，横幅 / 全屏 / 透明 / 纯色壁纸模式，单侧或双侧侧边栏
- 图片灯箱、评论、页脚内容、字体、音乐播放器、看板娘等可配置模块
- Swup 页面过渡与响应式布局

### 管理后台

- GitHub OAuth 登录（白名单账号）、JWT HttpOnly Cookie 会话、在线设备查看与踢下线、重新认证
- 可选的应急令牌登录与 Cloudflare Turnstile 人机验证
- 文章列表、编辑与实时预览、保存与删除、草稿跨设备续写、历史版本与差异查看
- 同步工作台、分类与标签管理、友链管理、站点配置、环境变量与密钥管理、会话管理
- 后台预览按 `.md` 与 `.mdx` 分通道渲染，互不干扰

### 工程能力

- Astro 7 + Svelte 5 + TypeScript + Tailwind CSS 4
- Biome 代码风格检查、Vitest 单元测试、turbo 编排构建流水线
- 构建顺序：图标生成 → LQIP → 配置快照 → Astro 构建 → 字体子集 → Pagefind 索引

## 快速开始

### 环境要求

- Node.js ≥ 22
- pnpm 9（版本由 `packageManager` 固定，安装时仅允许 pnpm）

### 安装与启动

```bash
git clone https://github.com/XingGreen/EverMemory-blog.git
cd EverMemory-blog
pnpm install
pnpm dev
```

开发服务器默认运行在 `http://localhost:4321`，后台入口为 `/admin/`。后台登录与写入所需的环境变量见 [`docs/ADMIN_MANUAL.md`](./docs/ADMIN_MANUAL.md)。

### 常用命令

| 命令 | 作用 |
| :--- | :--- |
| `pnpm install` | 安装依赖 |
| `pnpm dev` | 启动本地开发服务器 |
| `pnpm build` | 执行完整生产构建 |
| `pnpm preview` | 本地预览构建产物 |
| `pnpm check` | Astro 类型与模板检查 |
| `pnpm type-check` | TypeScript 类型检查 |
| `pnpm lint` / `pnpm format` | Biome 检查（含自动修复）与格式化 |
| `pnpm test` / `pnpm test:run` | Vitest 监视模式 / 单次运行 |
| `pnpm new-post <filename>` | 新建文章 |
| `pnpm icons` / `pnpm lqips` | 重新生成图标与 LQIP 数据 |
| `pnpm astro ...` | 调用 Astro CLI |

## 配置与内容

### 站点配置

可配置项按功能拆分在 `src/config/`，由 `src/config/index.ts` 统一导出。站点标题、地址、语言、主题色、分页与页面开关位于 `siteConfig.ts`；各配置文件的用途见 [`src/config/README.md`](./src/config/README.md)。

站点地址以 `siteConfig.ts` 的 `site_url` 为准。若新增由环境变量控制的构建逻辑，需同步把变量登记到 `turbo.json` 的 `env`，否则变量不会传给构建任务。

### 文章与 Frontmatter

文章位于 `src/content/posts/`（`.md` / `.mdx`），特殊页面位于 `src/content/spec/`。字段定义见 `src/content.config.ts`：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `title` | string | 标题，必填 |
| `published` | date | 发布日期，必填 |
| `updated` | date | 更新日期 |
| `draft` | boolean | 草稿，默认 `false` |
| `description` | string | 摘要 |
| `image` | string | 封面图 |
| `tags` | string[] | 标签 |
| `category` | string | 分类 |
| `lang` | string | 文章语言与站点默认语言不同时填写 |
| `pinned` | boolean | 置顶 |
| `author` / `sourceLink` | string | 作者与原文链接 |
| `licenseName` / `licenseUrl` | string | 文章授权名称与链接 |
| `comment` | boolean | 是否允许评论 |
| `password` / `passwordHint` | string | 阅读密码与提示 |

### 目录结构

| 路径 | 内容 |
| :--- | :--- |
| `src/pages/` | Astro 页面路由，后台入口在 `src/pages/admin/` |
| `src/pages/api/admin/` | 后台接口 |
| `src/components/` | 组件，后台组件集中在 `src/components/admin/` |
| `src/layouts/` | 页面布局 |
| `src/content/` | 文章与特殊页面内容 |
| `src/config/` | 站点与功能配置 |
| `src/plugins/` | remark / rehype 扩展 |
| `src/i18n/` | 语言词条与键名 |
| `src/utils/`、`src/constants/` | 工具函数与生成数据 |
| `scripts/` | 构建期脚本 |
| `tests/` | 单元测试 |
| `docs/` | 管理与运维文档 |

## 构建与部署

`astro.config.mjs` 依据环境变量选择适配器：

| 条件 | 适配器 | 产物与配置 |
| :--- | :--- | :--- |
| `VERCEL=1` | `@astrojs/vercel` | 平台配置见 `vercel.json` |
| `CF_WORKERS=1` | `@astrojs/cloudflare` | `dist/client` + `dist/server/entry.mjs`，配置见 `wrangler.jsonc` |
| 均未设置 | `@astrojs/node`（standalone） | 输出到 `dist/` |

`pnpm build` 产出 `dist/`，`pnpm preview` 可本地预览。Cloudflare Workers 部署还需配置 `SESSION` 等 KV 绑定，命名空间 ID 需自行创建后填入 `wrangler.jsonc`。

生产环境的项目目录只读：文章写入通过 GitHub 完成；站点配置、分类标签与密钥等写入目前仅在本地开发环境可用。

## 维护信息

- **仓库**：[XingGreen/EverMemory-blog](https://github.com/XingGreen/EverMemory-blog)；问题反馈与 Pull Request 约定见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- **维护者**：待补充
- **文档索引**
  - [`CLAUDE.md`](./CLAUDE.md) — 架构、技术约定与开发规约
  - [`docs/ADMIN_MANUAL.md`](./docs/ADMIN_MANUAL.md) — 后台使用与环境变量配置
  - [`docs/EMERGENCY_OPS.md`](./docs/EMERGENCY_OPS.md) — 应急操作
  - [`src/config/README.md`](./src/config/README.md) — 配置项说明
  - [`todo.md`](./todo.md) — 待办与已知问题
- **校验**：`pnpm check`、`pnpm test:run`、`pnpm lint` / `pnpm format`

## 授权与合规

本项目采用 [MIT License](./LICENSE)。使用、修改或分发时需保留以下版权声明：

- Copyright (c) 2024 saicaca
- Copyright (c) 2025 CuteLeaf
- Copyright (c) 2026 XingGreen

后台界面的设计参考了 flare-stack-blog（GPL-3.0-only）的构思；本项目为独立实现，未复制其源代码。

部分图片与看板娘素材的版权归各自权利人所有。
