# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 硬性规则（用户 2026-10-30 锁定，优先级高于本文件其余内容）

**规则 1 — 设计优先复用参考项目，禁止自研。**
任何 UI / 交互 / 数据结构的实现，先到 `E:\flare-stack-blog`（Flare Stack Blog CMS）里找对应实现。
找到就照搬其结构、尺寸、间距、状态机，只允许做技术栈适配（React → Svelte），
不允许"我觉得更好"地重画一版。自研出来的东西一律视为不合格，需重做。

**规则 2 — 无参考方案时立即停止并汇报，严禁硬写代码。**
如果在参考项目里找不到对应方案，**停下来说明**：缺什么、查过哪些位置、可选路线有哪些，
等用户指示后再动手。不要用"通用做法""最佳实践"自行补全设计决策。

违反这两条的最典型后果：界面与参考项目逐步分叉，每个细节都要返工。

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

### 样式改动的验证（2026-10-30 补）

`astro check` **不解析 `<style>` 里的 CSS**。括号不配对、语法写错它一律放过，直到
Vite 编译时才由 postcss 报出来（形如 `xxx.vite-preprocess.css:312:2: Unexpected }`）。

改动 `.svelte` / `.astro` 的样式段后，提交前必须做这三步：

1. `npx biome check <改动的文件>` —— biome 有 CSS 解析器，能直接报语法错误
   （同时会指出 import 排序问题，可 `--write` 自动修）；
2. 核对 style 块括号平衡：

   ```bash
   awk -v s=$(grep -n '^<style>' FILE | cut -d: -f1) \
     'NR>=s {o+=gsub(/{/,"{"); c+=gsub(/}/,"}")} END {print o"/"c}' FILE
   ```

   两个数字必须相等；
3. 需要时请求一次组件模块，确认 Vite 真能编译：

   ```bash
   curl -o /dev/null -w '%{http_code}' \
     http://localhost:4321/src/components/admin/X.svelte   # 应返回 200
   ```

**高危操作：按行区间批量删除样式块**（`sed -i 'A,Bd'`）。删除边界若落在某条规则的
闭合括号之前，就会留下一个孤儿 `}`——`astro check` 报 0 error，只在 dev 启动时炸。
删完务必按上面第 2 步核对。

### 截图验收（强制，不可跳过）

**任何 UI / 样式类改动，交付前必须要求用户提供实机截图，用于与参考项目做视觉对比。
「astro check 通过」「组件返回 200」都不能代替截图验收。**

原因很直接：这些检查只能证明代码能编译，证明不了页面长什么样。对齐、间距、溢出、
配色偏差、层级遮挡，只有真实渲染的截图才暴露得出来。历史上的返工几乎都出在这里——
自认为照着参考写了，实际观感完全不同。

执行要求：

1. 改完先跑 `biome check` + `astro check`（见上一节），再**主动向用户索要截图**；
2. 索要时提醒硬刷新（Ctrl/Cmd+Shift+R），避免缓存让人看到旧版本；
3. 拿到截图后**逐项对照参考项目**核对尺寸、间距、颜色、对齐、层级，不要只看「大致对」；
4. 有偏差就继续改，回到第 1 步，直到截图与参考一致为止；
5. 用户若没给截图就要求进入下一项，**先索要截图**，不要默认「已经好了」。

### 提交约定

- **每次改动完成后立即提交一次，无需等用户提醒。** 一个可验证的改动单元对应一个 commit。
- 提交前先跑 `pnpm check`（必要时 `pnpm build`）确认通过，并在 commit body 中说明改动要点与取舍原因。
- 仅暂存本次改动涉及的文件（`git add <path>`），不要 `git add -A` 混入无关改动。
- 除非用户明确要求，否则**不 push、不 amend**。

### 交互规则（优先于上述自动化流程）

**1. 用户提出修改建议时，只讨论方案，禁止直接改代码。**

用户描述问题、提出建议或指出差异时，默认意图是「先对齐认知再动手」，不是「立刻执行」。此时应当：

- 复述你理解的问题，指出根因
- 给出可选方案与各自取舍
- 等待用户确认后再改代码

只有用户明确说出「改」「做吧」「批准」「落地」这类执行指令时，才进入编码环节。这条规则覆盖「每次改动完成后立即提交」的默认行为。

**2. 交付前必须做「演示稿 vs 实际页面」的图片对比，一致后才交付。**

任何涉及 UI 的改动，在声明完成之前必须：

- 对演示稿（`file:///.../.examples/*.html`）与实际页面分别截图
- 逐项核对关键尺寸与位置：宽度、间距、对齐、区块顺序、文字层级
- 把对比结果写进回复或 commit body

只跑 `pnpm check` 通过不构成交付依据——它不校验视觉效果。历史上多次出现「类型检查通过但界面与演示稿不符」：私钥路径宽度不足、凭据操作位置偏移、显隐按钮跑到容器角落、上传 input 覆盖全屏，都是靠截图对比才发现的。

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

## 实现前先找现成方案

自研一行代码前，按顺序做完这三步再动手。跳过任何一步都算「Dishonor: reinventing what exists」：

1. **查现有依赖**——先在 `node_modules` 和 `package.json` 里找。官方库能用的就别手写。
2. **查参考项目**——`E:\flare-stack-blog` 是同类项目（better-auth + Cloudflare），先看它怎么处理同类问题。
3. **确认是否值得引入新依赖**——引入要在 commit body 里写清取舍（省多少手工代码 / 增加多少依赖与体积）。

### 为什么这条优先级这么高

自研的代价不只是时间，是**没人踩过坑**。2026-10 手工实现 Turnstile 时连续出的两个问题：

- 用 `getEnv` 读密钥，只查 `process.env` 和 `import.meta.env`；而 Vite 只把 `VITE_` 前缀的变量注入 `import.meta.env`，后台密钥页写入的 `.env.local` 永远读不到，功能实际从未启用。**21 个测试全绿**——因为测试 mock 了错误的边界，测的是一个不存在的调用路径。
- 用 PowerShell 的 `Set-Content` 做批量替换，文件被写成 GBK，中文注释全毁，`pnpm build` 直接失败（`stream did not contain valid UTF-8`）。

对照：flare-stack-blog 的限流用 Durable Objects `checkLimit`、Turnstile 用官方 JS 库，这些坑别人已经踩过了。

### 但不要为复用而重构架构

`better-auth` 是多用户系统（user/session/account/verification 四表、邮箱验证、OAuth）。本项目是单管理员 + scrypt 凭据 + KV 会话表，换过去要重写整个认证与存储层——**那是换赛道，不是省时间**。

判断标准：**小件直接借（官方 snippet、纯函数、独立可换），大件先评估架构成本再定。**

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
- **Node standalone** (`astro.config.mjs` default branch) for self-hosting
- Static output to `dist/`

### Cloudflare Workers: two of the three original blockers no longer hold

`astro.config.mjs` selects `@astrojs/cloudflare` when `CF_WORKERS` is set. An earlier version of this section declared Workers "not viable" on scrypt memory/CPU grounds. **That code no longer exists** — re-measured 2026-10:

**1–2. scrypt memory and CPU — not applicable.** The old argument measured `SCRYPT_N = 2^17` (128 MiB working set, ~484 ms/call) in `secret-io.ts`. But `grep -rn scrypt src/` now matches only an env-var *name* in `env.ts`. Auth was simplified to GitHub OAuth + break-glass, and JWT signing is HMAC-SHA256 via `node:crypto` (covered by `nodejs_compat`). Nothing on the login path needs 128 MiB or half a second of CPU.

**3. Storage — still real, but it is a consistency problem, not an API problem.** `persist-store.ts` only speaks the Upstash/Vercel KV REST protocol, so Cloudflare KV needs a third backend. More importantly **Cloudflare KV is eventually consistent** (~60 s across POPs) while the session table and login-guard lockout need read-your-writes → those belong on Durable Objects (or D1 with its sessions API), not KV. `@astrojs/cloudflare` auto-wires `SESSION` (KV) and `IMAGES` bindings; see its startup log.

Measured 2026-10 (`CF_WORKERS=1` build + `wrangler deploy --dry-run`):

- `turbo.json` silently dropped `CF_WORKERS` (turbo 2 strict env mode), so `pnpm build` emitted a **Node** artifact. `env` for `astro-build` is now declared — do not assume bare env vars reach adapter selection.
- Worker body (`entry.mjs` + `chunks`, excluding stale `.prerender` copies) is **3.49 MiB gzip** → over the 3 MiB Free limit, comfortable under 10 MiB Paid. **Paid is required.**
- `wrangler.jsonc` had the pre-v14 output shape (`assets` → `./dist`). Now `main: ./dist/server/entry.mjs` + `assets: ./dist/client`, plus `no_bundle: true` and `rules: [ESModule]` — without those two, wrangler reads the ESM bundle as a Service Worker and rejects every `node:` import.

**Remaining work, in order:** `node:fs` in six modules (`config-io`, `taxonomy`, `secret-io`, `persist-store`'s file backend, `audit-log`, `github-app` local writes — the three admin APIs `save`/`delete`/`post-content` are already environment-aware); a Durable-Object session backend; then a full build in CI to confirm bundle size.

**Cheap alternative if you only want edge delivery:** static assets + Pagefind index on Cloudflare Pages/R2, admin backend stays on Vercel. Touches no auth code.

Re-measure before assuming any of this still holds — that is exactly how the scrypt argument above went stale.

