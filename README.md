*本项目由AI生成

# EverMemory's Blog

> 一个用 Astro 构建的个人博客，文章在构建时渲染成页面，用于记录与展示个人的写作和日常，配色、布局与阅读偏好都可按自己的喜好调整。

![Node.js >= 22](https://img.shields.io/badge/Node.js-%3E%3D22-5FA04E?logo=nodedotjs&logoColor=white)
![pnpm 9](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)
![Astro 7.0.2](https://img.shields.io/badge/Astro-7.0.2-BC52EE?logo=astro&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-3DA639.svg)](./LICENSE)

其他语言版本：[繁體中文](./docs/README.zh-TW.md) · [English](./README.en.md) · [日本語](./docs/README.ja.md) · [Русский](./docs/README.ru.md)

> [!IMPORTANT]
> 后台登录、GitHub App 与环境变量配置请先阅读 [`docs/ADMIN_MANUAL.md`](./docs/ADMIN_MANUAL.md)；本文件只覆盖项目结构、命令与部署。

## 项目简介

文章以 Markdown / MDX 文件存放在 `src/content/posts/`，由 Astro 在构建期生成页面；`/admin/` 提供文章编辑、预览、草稿、历史版本与站点配置等能力。文章保存只写本地文件，生产部署为只读；推送到仓库通过同步面板完成，一次推送对应一次重新构建。

界面文案支持简体中文、繁体中文、英文、日文与俄文，默认语言由 `src/config/siteConfig.ts` 中的 `SITE_LANG` 决定，词条位于 `src/i18n/languages/`。

## 功能特性

### 内容与阅读

- Markdown / MDX 文章，支持 GFM、提醒块、增强代码块与行号、KaTeX 公式、Mermaid 与 PlantUML 图表、GitHub 仓库卡片
- 分类、标签、置顶、草稿、密码保护、摘要、阅读时间估算与目录（TOC）
- 独立页面：关于、归档、搜索、友链、留言、追番、番组计划、相册、音乐、应用推荐、打赏支持
- 关于页与留言板的正文、友链页的自定义内容取自 `src/content/spec/`
- Pagefind 站内全文搜索、RSS 与站点地图
- 亮色 / 暗色 / 跟随系统，主题色相调节，横幅 / 全屏 / 透明 / 纯色壁纸模式，单侧或双侧侧边栏
- 图片灯箱、评论、页脚内容、字体、音乐播放器、看板娘等可配置模块
- Swup 页面过渡与响应式布局

### 管理后台

- GitHub OAuth 登录（白名单账号）、JWT HttpOnly Cookie 会话、在线设备查看与踢下线、重新认证
- 可选的 break-glass 应急登录（`ADMIN_BREAKGLASS_TOKEN`）与 Cloudflare Turnstile 人机验证
- 文章列表、编辑与实时预览、保存与删除、草稿跨设备续写、历史版本与差异查看
- 同步工作台、分类与标签管理、友链管理、站点配置、环境变量与密钥管理、会话管理
- 后台预览按 `.md` 与 `.mdx` 分通道渲染，互不干扰

### 工程能力

- Astro 7 + Svelte 5 + TypeScript + Tailwind CSS 4
- Biome 代码风格检查、Vitest 单元测试、turbo 编排构建流水线
- 构建顺序：图标生成 → LQIP → GitHub 卡片缓存 → 配置快照 → 分类标签校验 → Astro 构建 → 字体子集 → Pagefind 索引

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

提交前建议依次运行 `pnpm check`、`pnpm test:run`、`pnpm lint`。

## 配置与内容

### 站点配置

可配置项按功能拆分在 `src/config/`，由 `src/config/index.ts` 统一导出。站点标题、地址、语言、主题色、分页与页面开关位于 `siteConfig.ts`；各配置文件的用途见 [`src/config/README.md`](./src/config/README.md)。

站点地址以 `siteConfig.ts` 的 `site_url` 为准。若新增由环境变量控制的构建逻辑，需同步把变量登记到 `turbo.json` 的 `env`，否则变量不会传给构建任务。

常用配置文件：

| 文件 | 用途 |
| :--- | :--- |
| `siteConfig.ts` | 站点标题、地址、语言、主题色、分页与页面开关 |
| `profileConfig.ts` | 个人资料、头像与社交链接 |
| `navBarConfig.ts` | 主导航与搜索配置 |
| `sidebarConfig.ts` | 侧栏布局与挂件 |
| `commentConfig.ts` | 评论服务类型与参数 |
| `musicConfig.ts` | 音乐播放器 |
| `fontConfig.ts` | 字体定义与加载 |
| `licenseConfig.ts` | 文章默认授权信息 |

### 文章与 Frontmatter

文章位于 `src/content/posts/`（`.md` / `.mdx`），关于页、留言板与友链页的内容位于 `src/content/spec/`。字段定义见 `src/content.config.ts`：

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
| `src/content/` | 文章，以及关于页、留言板与友链页的内容 |
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

`pnpm build` 产出 `dist/`，`pnpm preview` 可本地预览。`CF_WORKERS` 与 `VERCEL` 同时设置时以 `CF_WORKERS` 为准；`BASE_PATH` 用于部署到子路径，未设置时为 `/`。Cloudflare Workers 部署还需配置 `SESSION` 等 KV 绑定，命名空间 ID 需自行创建后填入 `wrangler.jsonc`。

生产环境的项目目录只读：文章保存只能在本地开发环境进行，生产环境会拒绝写入；推送与删除通过 GitHub App 完成，推送在同步面板操作，一次提交多个文件、只触发一次部署。站点配置与分类标签在生产环境直接写入 GitHub；环境变量与密钥只能在本地开发环境写入。

部署前的建议校验顺序：

```bash
pnpm check
pnpm type-check
pnpm test:run
pnpm build
```

托管平台将构建命令填为 `pnpm build`，输出目录填为 `dist`。

## 项目文档

- [`AGENTS.md`](./AGENTS.md) — 协作规范与操作边界
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 架构、技术约定与构建流程
- [`docs/ADMIN_MANUAL.md`](./docs/ADMIN_MANUAL.md) — 后台使用与环境变量配置
- [`docs/EMERGENCY_OPS.md`](./docs/EMERGENCY_OPS.md) — 应急操作
- [`src/config/README.md`](./src/config/README.md) — 配置项说明
- [`todo.md`](./todo.md) — 待办与已知问题

## 授权与合规

本项目采用 [MIT License](./LICENSE)。使用、修改或分发时需保留以下版权声明：

- Copyright (c) 2024 saicaca
- Copyright (c) 2025 CuteLeaf
- Copyright (c) 2026 XingGreen

后台界面的设计参考了 flare-stack-blog（GPL-3.0-only）的构思；本项目为独立实现，未复制其源代码。

部分图片与看板娘素材的版权归各自权利人所有。
