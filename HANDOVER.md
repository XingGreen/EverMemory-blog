# 交接文件（2026-11-20 生成）

## 1. 项目目标与当前阶段

Astro 7 + Svelte 5 博客（前台静态、后台/OOBE 服务端）的维护与迭代；当前处于 **OOBE 首配向导的动画迭代阶段**（入场序列已上线，待真机验证）。

## 2. 已确认的事实

- 本项目是**公开的、由众人维护**的项目，不属于个人；署名主体是维护者社区（用户 2026-11-18 明确确认）。
- OOBE 与整个后台是**本项目维护者的原创工作**，与上游无继承关系；上游致署名仅保留在 Footer/SiteInfo/README（`AGENTS.md` Attribution 条 + 用户 2026-11-18 确认）。
- 规范事实源是 `AGENTS.md`；冲突时其 Workflow 块优先（`AGENTS.md` 自述）。
- 后台视觉标准是 `docs/ADMIN_UI.md`（`AGENTS.md` UI standards 条）。
- 动效规范：入场编排允许、ambient 循环禁止、`prefers-reduced-motion` 必须收拢为零（`rules/a11y.md §6`）。
- 文章编辑器内容宽度由**宽度手柄**（`editorMaxWidth`）调节，面板层不得叠加宽度上限或非对称 padding（用户两轮返工后确认，见记忆 2026-11-18/19）。
- 设置页 rail 图标：选中实心、未选中空心；集合无空心变体时**两态实心**，语义正确优先于变体规范，绝不拿近似图标顶替（用户 2026-11-18/19 两轮批评后确认）。
- OOBE 界面中的站点名称绑定 `siteConfig.navbar.title || siteConfig.title`，博主身份用 `profileConfig.name`，界面不出现开发者项目名（`Navbar.astro:42`、`Profile.astro:45` + 用户 2026-11-18 确认）。
- OOBE 统一提交：向导中途不落盘，只在「完成」与「去登录/跳过」两个节点提交（用户 2026-11-18 要求，commit 29ec6050）。
- 引导写入通道：`configs/[key].ts` 的引导分支白名单仅 `site`；secrets 有同类分支；判据统一为 `canBootstrap`（本机回环 + 缺必填 + 非生产）。
- 多标签页拦截：同路由第二标签页**阻断弹窗**（不是只读模式，只读已被用户否决），按钮为「重新加载」（用户 2026-11-17 确认，commit 59f01f77）。
- Svelte 组件验证唯一可信手段是 `.workbuddy/reviews/verify-svelte.cjs`；此前的「vite build 冒烟」因管道 `$?` 假阳性从未生效（2026-11-18 用户抓出后废弃）。
- 未执行任务必须登记 `.todo`（`AGENTS.md` Workflow 第 4 条）。
- AGENTS.md 中曾有「注释保护」条目，已被用户撤销删除（commit 905bb99c）；用户仍明确批评过随意改写既有注释的行为（对话 2026-11-18）。

## 3. 尚未确认的假设/猜测

- `src/components/controls/DisplaySettings.svelte`、`DisplaySettingsIntegrated.svelte` 的编译失败是否由用户 IDE 中未提交的改动造成——**不确定**（它们在前台禁改区，未修复，已列入 `.todo` 与验证器白名单）。
- dev server 的 HMR 在大幅修改 Svelte script 后失效的具体原因——**不确定**（现象：SSR HTML 正确、浏览器 hydration 丢弃；怀疑旧客户端 bundle，未证实）。
- 用户当前是否启用背景图模式（banner 视觉验收所依赖）——**不确定**。
- Windows 12 概念版风格 OOBE 的完整设计方向（只确认了「黑场→LOGO→上移+加载圈」两步）——后续步骤**不确定**。
- 用户对「无空心变体图标两态实心」的最终接受度——已实施，**未获反馈确认**。
- 当前构建/部署目标（CF Workers / Node / Vercel 之一）——**不确定**，需查 `astro.config.mjs` 与 turbo 环境变量。

## 4. 当前进度与唯一的下一步

- 进度：OOBE 入场序列三步（黑场 700ms → LOGO 放大 0.9s → 1600ms 上移 + 原位加载圈 → 数据就绪后淡出）已合并 master（`4f6eddc8`）；`.todo` 中尚有 10 项未执行任务。
- **唯一下一步**：用户重启 dev server 后访问 `/setup/` 验证入场动画（当前环境 `canBootstrap` 已关闭且 HMR 失效，无法自验）。

## 5. 关键文件路径清单（真相源）

| 文件 | 作用 |
|---|---|
| `AGENTS.md` | 规范总纲（Workflow / Scope / Attribution / No reinvention） |
| `.todo` | 未执行任务台账（唯一真相源） |
| `docs/ADMIN_UI.md` | 后台视觉标准（字号/间距/颜色/禁用清单/图标状态） |
| `rules/a11y.md` | 无障碍与动效硬规则（§6 Motion） |
| `src/utils/tab-lock.ts` | 多标签页路由锁（心跳 + BC 握手 + 归一化 key） |
| `src/utils/icon-outline.ts` | 图标变体转换与集合校验 |
| `src/components/setup/SetupPage.svelte` | OOBE 向导（含入场序列状态机） |
| `src/components/admin/AdminDashboard.svelte` | 后台壳（rail/路由锁/进度条/弹窗） |
| `.workbuddy/reviews/verify-svelte.cjs` | Svelte 全量编译验证器 |
| `.workbuddy/memory/2026-11-15.md` | 工程记忆（gitignored，含全部历史决策与坑） |

## 6. 风险与禁忌

- **禁直接 commit master**；每改动独立分支，squash 合并后删分支。
- `src/utils/**`、`src/i18n/**`、`src/config/**`、`src/constants/**`、`src/components/common/**`、构建配置改动**必须先问**；前台 `src/pages/**`（除 admin）、`src/layouts/**`、`src/components/{layout,widget,controls}/**` **禁改**。
- **禁改写/删除既有代码注释**（用户强烈反感，虽条目已撤，行为红线仍在）。
- 禁止用语义不符的近似图标顶替（系统集合缺变体时宁可两态实心）。
- 禁止在自研模块（admin/OOBE）留上游名称、链接或痕迹。
- 验证命令**禁止**使用 `cmd | grep | head; echo $?` 形态（`$?` 取管道末端退出码，恒真）；以脚本退出码为准。
- TEMP 调试改动必须当场逆向，不得提交；不得改动 `canBootstrap` 之外的鉴权逻辑。
- 面板层不得给编辑器内容区加宽度限制或非对称 padding（会废掉手柄）。
- 不得在 `.todo` 之外「口头记住」未执行任务。

## 7. 新接手者必须先读的 3 个文件

1. `AGENTS.md`
2. `docs/ADMIN_UI.md`
3. `.todo`
