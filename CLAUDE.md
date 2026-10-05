# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Firefly is a feature-rich static blog theme built on **Astro 6** with **Svelte 5** for interactive components. It's a fork of [Fuwari](https://github.com/saicaca/fuwari) extended with extensive features. Primary language is Chinese (Simplified) with i18n for en, zh_TW, ja, ru.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server at `localhost:4321` |
| `pnpm build` | Production build (icons → LQIPs → Astro build → Pagefind indexing) |
| `pnpm preview` | Preview production build |
| `pnpm check` | `astro check` for type/error checking |
| `pnpm type-check` | `tsc --noEmit --isolatedDeclarations` |
| `pnpm lint` | Biome lint + auto-fix |
| `pnpm format` | Biome format |
| `pnpm test` | Vitest watch mode |
| `pnpm test:run` | Vitest single run (CI / 提交前) |
| `pnpm new-post <filename>` | Scaffold a new blog post |

Package manager is **pnpm** (enforced). Node.js >= 22 required.

## Architecture

### Astro + Svelte Hybrid

- `.astro` components for static content and layouts
- `.svelte` components for interactive UI (search, settings, pagination, archive) — mounted with `client:load` or `client:visible`
- Swup.js handles SPA-like page transitions with multiple container targets

### Configuration-Driven

All features are toggled/configured via TypeScript files in `src/config/`, exported through the barrel at `src/config/index.ts`. Key configs:

- `siteConfig.ts` — core site settings, theme, pagination
- `sidebarConfig.ts` — sidebar layout (left/right/both, widget ordering)
- `commentConfig.ts`, `analyticsConfig.ts`, `fontConfig.ts`, etc.

### Layout System

- `Layout.astro` — base HTML shell (head, body, theme init, analytics, Swup hooks)
- `MainGridLayout.astro` — full page grid with sidebar(s), navbar, wallpaper, footer

### Content Collections

Defined in `src/content.config.ts`:
- `posts` — blog posts (`.md`/`.mdx`) with frontmatter: title, published, tags, category, draft, pinned, password, comment, etc.
- `spec` — special pages (about, guestbook)

### Key Directories

- `src/components/` — organized by domain: `analytics/`, `comment/`, `common/`, `controls/`, `features/`, `layout/`, `misc/`, `pages/`, `widget/`
- `src/plugins/` — 15 custom remark/rehype plugins (Mermaid, PlantUML, KaTeX, GitHub cards, reading time, etc.)
- `src/i18n/` — translation keys in `i18nKey.ts`, language files in `languages/*.ts`, lookup via `translation.ts`
- `src/utils/` — content sorting, crypto (encrypted posts), date formatting, image processing/LQIP, TOC generation
- `src/pages/` — Astro file-based routing
- `scripts/` — build-time utilities (`generate-icons.js`, `generate-lqips.ts`, `new-post.js`)

### Path Aliases (tsconfig.json)

`@components/*`, `@assets/*`, `@constants/*`, `@utils/*`, `@i18n/*`, `@layouts/*` → `./src/<dir>/*`; `@/*` → `./src/*`

`vitest.config.ts` 的 alias 必须与上表保持一致，缺一个别名会直接解析失败。

## Tests

Vitest（`tests/`，Node 环境）。当前覆盖后台工具链中出错代价最高的部分：

- `tests/auth.test.ts` — JWT 签发/验签、签名与payload 篡改、过期边界、token 版本失效、sid 缺失、角色校验、`requireAuth` 的 401 分支、Cookie 属性
- `tests/session-store.test.ts` — 会话注册/过期清理、踢下线、touch 节流与合并、`describeDevice` 解析、删除竞态下的 `verifyDeleted`

约定：

- **测真实代码，不mock 被测对象**。只 mock 边界（存储后端、`.env.local` 读取）；`tests/helpers/memory-store.ts` 提供与 `persist-store` 等价的内存双工，让 `session-store` 跑完整逻辑。
- **`.astro` / `.svelte` 组件暂不测**。组件需要 DOM 环境，当前 vitest 配为 `node`；贸然加入会迫使引入 jsdom 并显著拉长搭建成本。
- **新增测试必须验证其有效性**。写完用变异测试确认：手动改坏被测代码的关键分支，测试必须失败。断言只覆盖「最终结果」时会漏判——例如移除 `if (!payload.sid) return null` 后，`getSession(undefined)` 仍会返回 `null` 使断言通过，必须额外断言「该层是否被调用」。
- 新增 alias、tsconfig `include` 或 vitest 配置后，`pnpm type-check` 的错误数不应变化（当前基线 51 处 `isolatedDeclarations` 报错属既有问题，不要顺手「修」）。

## Code Style

- **Biome** enforces: tab indentation, double quotes, recommended lint rules
- Relaxed rules for `.svelte`/`.astro` files (useConst off, noUnusedVariables off)
- Commit convention: **Conventional Commits** (`feat:`, `fix:`, `chore:`, etc.)

### 提交约定

- **每次改动完成后立即提交一次，无需等用户提醒。** 一个可验证的改动单元对应一个 commit。
- 提交前先跑 `pnpm check`（必要时 `pnpm build`）确认通过，并在 commit body 中说明改动要点与取舍原因。
- 仅暂存本次改动涉及的文件（`git add <path>`），不要 `git add -A` 混入无关改动。
- 除非用户明确要求，否则**不 push、不 amend**。

## Eight Honors and Eight Shames

Behavioral codex for every change in this repository. When a decision is ambiguous, these outrank convenience.

- **Dishonor:** guessing at interfaces. **Honor:** carefully checking the docs.
- **Dishonor:** executing vague instructions. **Honor:** asking for confirmation.
- **Dishonor:** imagining business requirements. **Honor:** confirming with a human.
- **Dishonor:** inventing new interfaces. **Honor:** reusing what already exists.
- **Dishonor:** skipping verification. **Honor:** proactively testing.
- **Dishonor:** breaking the architecture. **Honor:** following the conventions.
- **Dishonor:** pretending to understand. **Honor:** honestly admitting ignorance.
- **Dishonor:** making blind changes. **Honor:** refactoring cautiously.

Applied concretely here: read the actual file before editing it; verify with `pnpm check`/`pnpm build` instead of assuming; say "I don't know" rather than invent an API; confirm scope before a refactor that touches more than one module.

## Markdown 渲染约定

任何 Markdown 渲染/预览（前台文章、后台编辑器预览、相关 API）**必须复用项目既有管线**，优先级高于任何自建/手写方案：

- 渲染：`src/utils/markdown-renderer.ts`（remark 管线）与 `/api/admin/preview/` 等既有 API
- 样式：`src/styles/markdown.css` 的 `.custom-md`（前台）与 `markdown-extend.styl` 扩展

后台若缺样式，通过引入既有 CSS 或补主题变量（如 `admin.css` 中 `--card-bg-transparent`/`--link-hover`/`--font-jetbrains-mono`）解决，不得另起炉灶手写一套渲染或样式。

## Build Pipeline

Multi-step: `scripts/generate-icons.js` → `scripts/generate-lqips.ts` → `astro build` → `pagefind --site dist`

Icons/LQIP data are generated into `src/constants/` and committed. Regenerate with `pnpm icons` or `pnpm lqips`.

## Deployment

- **Vercel** (default, `vercel.json`)
- **Cloudflare Workers** (`wrangler.jsonc`, set `CF_WORKERS` env var)
- Static output to `dist/`

