# 待办

> 每完成一项，把 `- [ ]` 改成 `- [x]`，并在行尾注明 commit。

## 本轮需求（2026-11-08）

- [x] 后台配置扩展：页面切换动画（四效果）、对话框模糊、背景图来源、整体配置策略（新增 `src/config/adminConfig.ts`）
- [x] Session 页数据过时：接口 no-store + 30 秒静默刷新 + 「更新于 HH:mm:ss」时间戳
- [x] App 推荐页无法换页：客户端分页（每页 12 条），筛选/搜索回到第 1 页，运行时重渲染后重算
- [x] Music 歌单改走 `/api/music/playlists/`，服务端 KV 缓存 10 分钟，回源失败返回过期数据
- [x] 导航栏分离模式：sticky 下导航底边 6.5rem，内容区改为 +2rem、侧栏改 7.5rem，不再贴死
- [x] 无标题兜底策略：`siteConfig.post.titleFallback`（extract / filename / require + 长度 + 逗号截断）
- [x] 草稿线上可用：新增 `src/utils/post-draft-store.ts`，保存/读取/列表/删除/历史恢复全部接入 KV
- [x] 文章列表表头对齐：表头「标题」补 20px 大头针占位，与行内标题同轴

## 本轮需求·二批（2026-11-08，e300d97f）

- [x] 本地图片渲染：新增 `/api/admin/post-asset/`，预览与历史版本把相对图片路径改写为该端点（本地读盘、只读部署回源 GitHub raw）；封面图同样换算
- [x] 加密文章默认标题：`siteConfig.post.encryptedTitle`（prefix + timeFormat，支持 YYYY/MM/DD/HH/mm/ss 与 iso），设密码且标题留空时不再取正文首行
- [x] 同名文章拦截（创建）：`save.ts` 在新建或改标识时检查本地与远端占用，返回 409 `POST_EXISTS`
- [x] 同名文章拦截（输入提示）：标题输入框下方红字提示，保存前再校验一次标题冲突并阻断
- [x] Switch 按钮间距：选中态 thumb 由 `left: 18px` 收到 `14px`，右侧留 2px
- [x] 侧边栏 Tab 框选不完整：滚动容器关横向溢出并留 2px 内边距；设置页 tab 下划线压住 1px 分隔线
- [x] 侧边栏图标样式：会话管理未选中用 `devices-outline`，选中用 `devices`
- [x] 通知栏按设计演示重排：图标胶囊（1.5rem 圆 + 10% 语义底）+ 单行文案 + 右侧关闭 + 底部倒计时条；底色 `--float-panel-bg`、文字 `--deep-text`、描边 20% 语义色混 `--line-divider`
- [x] 侧边栏波纹动画：指针位置扩散、跟随 currentColor，尊重 `prefers-reduced-motion`
- [x] 文章管理列扩展：新增字数、作者、语言代码、是否有密码四列（默认收起）
- [x] 阅读数据复用：新增 `AdminPostStats`，编辑预览与历史版本页均显示字数与阅读时长

## 上游同步（6.13.5 → 6.16.9，选择性）

- [x] 正则注入修复、X-Frame-Options 改 SAMEORIGIN、PlantUML 缩放文字模糊、行内代码保留空格
- [x] 日期格式化统一走 siteConfig 时区，纯日期输入不再跨天
- [x] 构建产物根目录统一解析（dist/client、.vercel/output/static、dist），Pagefind 改由脚本运行
- [x] 许可证图标按名称自动匹配
- [x] GitHub 卡片改为构建期缓存，新增 `pnpm github-cards`
- [x] quarantine 脚本：收录 md/mdx、剥离代码块、过滤外链
- [x] 分页支持输入页码跳转
- [x] Atom 订阅页与 llms.txt
- [x] Schema.org 结构化数据与 OG 元数据补全
- [x] Biome 升级至 2.6.2 并排除 Markdown 内容文件
- [ ] 未跟进：壁纸系统单源化重写、样式按页拆分、导航栏重写（与本地实现冲突，需单独立项）
- [ ] 未跟进：markdown 栈迁移与 Astro 大版本升级（会破坏 MD/MDX 双通道）
- [ ] 未跟进：动态页、项目展示、书签导航、文章系列、VNDB/MAL 等新增页面
- [ ] 未跟进：OG 图改用本地中文字体（本项目 og 页基于 satori，woff2 不被支持，需换字体方案）
- [ ] 未跟进：new-post 自动生成拼音 slug（依赖 frontmatter slug 字段，本项目尚未支持）

## 文章编辑器

- [x] 封面图误删：点图改为聚焦地址框，删除由独立按钮触发并二次确认
- [x] MDX 渲染失效：拆成 MD / MDX 双通道，MDX 走 evaluate 运行时 + 降级通道，Icon 真渲染 — 5c271411
- [x] 拖拽纵条不跟随：左右调宽的纵条拖拽时位置不动，修复拖拽事件里的坐标计算 — 938b551f
- [x] 自动提取标题：正文无标题时取第一行，遇逗号截断，无逗号则最多前 16 字，二者先到先得 — dd393cb0

## 文章管理

- [x] 文件类型列只显示 `.md`，改为按真实扩展名（`.mdx` 等）显示 — 420a948f
- [x] 「列显示」入口移到表头操作列，图标换为四条横线，菜单复用 Dropdown
- [x] 列表对齐：表头列名与数据列上下对齐，操作列统一靠右
- [x] 同步面板重构 — 已升级为独立工作台 `/admin/sync/`（保持方案 A，不再回退弹窗）

## 分类与标签管理

- [x] 删除弹窗：补 count 替换、取消按钮补变体、保留无关选中、未分类删除给出提示

## 环境变量

- [x] 脏列表跳转高亮：纵向指示条加粗并呼吸两次
- [x] 密钥检测范围：扫描 .env*、.key/ 与常见证书扩展名，检查 Git 跟踪状态

## 全局与通知

- [x] 标签页标题：后台时格式为「<模块名称> - 控制面板 | <网站名字>」 — dd393cb0
- [x] 通知进度条：悬停/按住暂停；移开或松开瞬间回满 100% 并重新倒计时；再次悬停再回满并暂停 — dd393cb0

## 新增页面

- [ ] 媒体库页
- [x] 友链管理页 — 数据迁到 src/data/friends.json，页面 /admin/links/

## 退出登录

- [x] 退出弹窗 UI 重构 — 改用 ConfirmDialog，破坏色主按钮
- [x] 侧边栏退出按钮 hover 背景变红

## 技术债（早前遗留，未排期）

- [ ] 同步页在生产环境失效：`localAvailable === false` 时退化为只读列表，线上需要普通 CRUD
- [ ] `save.ts` 生产环境返回 403，堵死线上编辑的唯一路径
- [ ] `post-content.ts` 断网误判：与同步页同类问题，会显示「文章不存在」
- [ ] `post-conflict.ts` 死代码：入口已被同步页取代，接口仍保留
- [ ] 构建耗时 205 秒（本机，图片有缓存），线上冷构建预计 5–8 分钟，未优化
- [ ] 草稿槽反查（`findDraftBySlug`）只做静态审查，未跑真实场景
- [ ] `ConfirmDialog` / `DraftRestoreDialog` 文案未走 i18n
- [ ] `.git/hooks/commit-msg` 不进版本控制，重新 clone 后需重装
- [ ] `d8.jpg`（3.0 MB）是否已被 `backgroundWallpaper.ts` 引用未验证
- [ ] `commitFiles` 的 GraphQL 路径未经真实推送验证，失败会退回逐条推送

## 已完成

- [x] 「最后活跃」改为内存节流 + 等待落盘：线上不再停留在登录时刻，且常规请求零 KV 往返
- [x] 同步历史在窗口取满时回传 `truncated`，面板不再把"没翻到"显示成"只有这些"
- [x] 审计日志改为等待落盘：serverless 下不再因响应返回而丢失登录/密钥操作记录
- [x] 文章列表与设置页加请求序号：慢请求后到不再覆盖当前页内容
- [x] 分类/标签批量改写改为一次提交，改 N 篇不再触发 N 次构建
- [x] 同步计划每个文件只读一遍（标题与 sha 共用同一份 Buffer）
- [x] 预览接口限制内容长度（512K），编辑器取消在途请求并在卸载时中止
- [x] 分类列表的 `no-store` 头真正生效（此前声明了却从未用上）
- [x] fetch 401 包装可重复安装不会叠加；`popstate` 监听随组件卸载移除
- [x] 会话表改一人一键：并发登录不再互相覆盖，列表清理不误删新会话
- [x] JWT 签名改常量时间比较，与验应急令牌同一标准
- [x] 存储层读取异常不再静默：ENOENT 之外一律 `warn`，会话表损坏可见
- [x] Turnstile 轮询定时器随卸载清理，脚本被拦时不再永久轮询
- [x] 远端读配置把 `{ data, source }` 条目当成配置值返回，表单渲染成全空；改为取 `.data`
- [x] 远端 GitHub 源码读不到时不再整页 500：表单数据回落构建快照，仅 html 配置保持硬失败
- [x] 历史版本的 slug 未校验：`../` 可把读取/删除点挪到文章目录外，补齐 `isValidPostSlug`
- [x] 历史版本恢复按 `.mdx` 真实路径写入，不再给 mdx 文章另存出同名 `.md` 副本
- [x] 同步执行只接受 `src/content/posts` 下的 Markdown：原校验只拦 `..`，`.env.local` 可被推到公开仓库
- [x] 密钥导出加二次确认（与写入同一门槛），前端识别 `STEP_UP_REQUIRED` 并引导重新授权
- [x] frontmatter 转义补反斜杠与控制字符，标题含 Windows 路径不再让构建失败
- [x] 同步列表漏文件：改扫盘取条目，不再依赖 `getCollection`
- [x] 断网误判为 unknown，保留本地条目而非清空列表
- [x] 面板每次打开强制重新拉取，加 `no-store` 与请求序号
- [x] 差异查看独立成页 `/admin/sync/diff/:slug/`，行级 diff + 上下文折叠
- [x] 推送改为 GraphQL 一次提交，多篇只产生一个 commit
- [x] 远端失败原因分类：超时 / DNS / TLS / 401 / 429 / 5xx
- [x] 保存只写本地，不再自动推送
- [x] 草稿支持跨设备续写（编辑页也拉云端草稿）
- [x] 草稿槽反查，改过 slug 也能找回
- [x] 改 slug 保存时清理旧文件
- [x] 三处原生 `confirm` 换成 `ConfirmDialog`
- [x] 提交信息校验脚本与全量历史重写
- [x] 同步弹窗升级为独立工作台 `/admin/sync/`（左列表右详情）
- [x] 同步页六项 UI 修复：断网文案、徽章配色、自定义复选框、右栏铺满、行号单列、长行软换行
- [x] 草稿与正文的视觉区分：顶栏状态徽章（已保存 / 草稿未保存 / 新建未保存 + 草稿时间）
- [x] 恢复草稿后常驻横幅，可直接「放弃草稿，回到正文」
- [x] 编辑页草稿与正文不一致时弹并排对比框，由用户选择用草稿还是用正文（替换原 DraftRestoreDialog）
- [x] 修复旧弹窗文案与行为不符：原「保留当前正文」实际会删掉草稿
- [x] 后台移动端适配：抽屉宽度与安全区、视口高度改 dvh 并按 flex 分配、历史页纵向堆叠、分类表格横向滚动、触控热区 44px、输入框 16px 防 iOS 缩放
- [x] 通知倒计时进度条 2px 加粗到 4px，轨道 `--btn-regular-bg`、填充用语义色（去掉装饰性光晕）

## 环境变量页（2026-11-13 收尾存档）

### 已合并到 master

- [x] 页头统一说明：只用于本机开发 → 保存到 .env.local → 用「导出配置」带到线上；各处重复的「保存到哪」提示一并收掉（`3d24da86`）
- [x] 未保存清单回到旧形态：`savebar` + `savebar-notice` + `dirty-list`，字段名回到 `dirtyItems`（`3d24da86`）
- [x] 清掉注释里遗留的旧名称（`ae811437`）
- [x] 脏列表跳转高亮恢复：点条目滚动到目标字段并整行亮起 1.6s（`7a24586f`）
- [x] 高亮块去圆角，回到旧版直角形态（`0556ea1e`）

### 未合并（分支 `revert/color-baseline`，`0aa14ffb`）

- [ ] 整页回退到 `9bc454d2`：`SecretManager.svelte` / `admin-secrets.ts` / `api/admin/secrets.ts` 三个文件
- [ ] **已知缺陷**：页脚读 `secretSaveState.diffRows`，被回退的组件上报的是 `dirtyItems`，展开清单为空 —— 合并前必须统一字段名
- [ ] 是否采用该分支待确认（它会让这一页回到两列网格 + 分组计数 + 验证连接）

### 未解决

- [ ] 设计基准未定：参考文件 `.workbuddy/reviews/env-page-review.html` 已收到，尚未据此重做样张
- [ ] 样张 `.workbuddy/reviews/env-settings-sample.html`（单列 + 衬线）是候选稿，可能废弃
- [x] 候选稿三 `.workbuddy/reviews/env-variables-sample.html`（可交互）：标题保持「环境变量」，三节改用功能名（仓库写入 / 后台登录 / 人机验证），左纵线只标未保存改动。上一版 `env-connect-sample.html` 的竖脊与提问式标题已被否决。
- [x] 按该样张落地 `/admin/env/`（commit `2bb2b2cd`）：`SecretManager.svelte`、`admin-secrets.ts`、`i18n/**`。私钥改为粘贴内容/编辑，去掉上传槽与文件名；OAuth 与 Turnstile 各拆两行。
- [x] 私钥行已恢复文件上传（f92ced4c）：上传/粘贴/路径三种方式并存，「或填私钥文件路径」保留
- [ ] 待确认：顶部「所有必要配置都已完成」可关闭横幅（`secretSaveState` 之外那条 note）样张里没有，暂留
- [ ] 参考样张与 `docs/ADMIN_UI.md` 存在冲突，需定优先级：输入框 42px/12px 圆角 vs 文档的 36px/10px；分组分隔线 vs 文档「一屏一条通栏细线」
- [ ] 必填标记：沿用 `*`，还是按 GOV.UK「多数必填时只标可选」
- [ ] 每个字段的 `⋯` 菜单：保留（省宽度）还是外露（可发现）
- [ ] 错误态与空态在真实页面里尚未实现（样张只有样式）
- [ ] `src/content/posts/demo.md` 的删除来自后台操作，未提交

### 下一步

1. 定基准：以旧样张为准，还是采用 `revert/color-baseline`
2. 统一 `dirtyItems` / `diffRows`，让改动清单能展开
3. 按基准改样张 → 确认后落代码
4. 补 i18n 词条（新增文案目前只有中文）

## 已完成：OOBE 引导页落地（2026-11-15）

- [x] 设计稿已定稿：`https://ardot.tencent.com/file/747723469136032`（Step1 仓库写入 / Step2 后台登录 / Done 一切就绪 + 交互标注条）
- [x] 落地 `src/components/setup/SetupPage.svelte`：最终以用户样张结构为准（窄卡片 460px、步骤标题、底部三段式、完成屏），非画布稿（`3df036ad`）：居中窄栏（480px）、Hero 区（圆环图标 + 欢迎语 + 「两步配置，马上就好」）、步骤行（文字深浅 + 细线，无数字徽章）、完成屏（大对勾圆环 + 「一切就绪」）
- [x] 分步逻辑：默认第一步，主按钮「下一步：后台登录」切换；完成屏对勾描边 600ms、按钮延迟 300ms；`prefers-reduced-motion` 直落终态
- [x] 动效：入场淡入上移 16px 240ms ease-out；步骤切换 180ms 淡入、焦点落新步骤第一个输入框
- [x] token 不新造：沿用后台 `--page-bg/--card-bg/--primary` 与 `.ui-input` 规格（36h/10 圆角）

## 本轮任务清单（2026-11-22 起，分支 fix/task-sweep-2026-11-22）

> 按 AGENTS.md 第 6 条排序：**从轻到复杂**。第 5 条定预算：单项 10 分钟未完成即记录跳过。
> 每项就地写下已查明的根因，供下一轮直接接手。

### 模块 A — 机械修复（最轻，先做）

- [x] A1 脏列表颜色：环境变量页 savebar-notice 静止态用 primary、hover 转 warning（琥珀）。
      原值来自 commit f556310a 删除前的定义：base=primary 12%、hover=warning 20%。
      **已完成，待提交。**
- [x] A2 预览分隔线：后端返回 83 个 hr，但 Tailwind Typography 的 currentColor+0.08
      在深色下不可见。已在 PostEditorWritePanel 补 `:global(.content-preview hr)`。
      **已完成，待截图复验。**
- [x] A3 行数栏错位：**已验证**。gutter 是 overflow:hidden 且高度被设成 scrollHeight，scrollTop 恒为 0；改为外层裁剪 + 内层 translateY 跟随。打开行号开关后 spans=989 正常渲染。
- [x] A4 MDX 代码块复制（**已修复，根因是通道差异**）：已查明两处根因并修复 —— ①选择器 `button.copy` 匹配不到
      （EC 按钮无 class，只有 title/data-code），已改为 `button[title="Copy to clipboard"]`；
      ②按钮 opacity:0（EC 靠自身脚本淡入）已改常显；③按钮有深色底 rgb(40,44,52) 已改透明；
      ④图标是空 div，已改为注入内联 SVG（fill="none" 必须逐元素写）。
      **已验证**：按钮可见（opacity 1）、背景透明、可点击且剪贴板写入成功。\n      **未解决**：图标在 8x 放大下仍是纯色方块 —— DOM 里 svg/rect 的 fill=none、stroke 有色、stroke-width 1.8px 全部正确，但渲染为实心。已排除：选择器、opacity、背景、fill 属性。下一轮建议直接用 CSS 画图标（替代 SVG），或查 EC 注入的 svg 全局规则。

### 模块 B — 需诊断的单点（中等）

- [ ] B1 开屏动画：**需用户说明具体症状**。实测 AdminEntryVeil 功能正常（遮罩出现、约 2s 后
      entry-lift 上移 992px 退场）。疑点：①入场到退场约 2 秒，慢于源码里的 1200ms 定时器；
      ②组件把站名写死成 EverMemory，未读 siteConfig。请确认是「不播放」「太慢」还是「文字/样式不对」。
- [ ] B2 后台页宽度限制：删除 `.admin-content` / `--admin-max-width` 的宽度上限。
- [ ] B3 Tab 焦点框：排查所有按钮是否都有 `:focus-visible` 轮廓。
- [x] ~~B-divider 正文与工具栏之间的分隔线~~ **放弃（2026-11-23，用户判定未修好）**
      已尝试：① 把 `--line-divider` 换色（被否：不许改透明度）；② 补 `:global(.content-preview hr)`
      与 `.editor-field` 顶边 + `gap` 归零（实测边框存在、gap=0，但用户看到的仍是无分隔）。
      未查明：用户所指「正文和标题之间」具体是哪两个区块——我按「工具栏与正文之间」理解并修改，
      猜测可能不成立。**下次必须先让用户在截图上圈出位置，再动手。**
- [x] ~~B-veil 前后台切换概率黑屏~~ **放弃（2026-11-23，用户判定：现在干脆不播，纯黑屏后直接跳转）**
      已尝试：限制 `shouldPlay` 初值 false（SSR 不输出遮罩）+ sessionStorage 只播一次。
      结果：遮罩不再出现在「首次」场景（可能 sessionStorage 已被前面的调试写入过），
      变成白屏/黑屏直跳，比原来更差。**回滚这版改动，恢复原样。**
      根因层判断：遮罩是 SSR 输出、退场靠 hydrate，JS 慢必黑。真正稳的做法是
      「不靠 JS 退场」——用 CSS animation 自动跑完并 `animation-fill-mode: forwards`
      停在不可见状态，JS 只负责在动画结束后可选地移除节点。下次按这个方向重做。

- [~] B4 编辑器宽度：**部分完成，预览部分失败并已回退**。
      已生效：`.editor-field`（编辑区）受 --editor-max-page-width 约束，Tabs 与工具栏保持撑满。
      已回退：`.content-preview`（预览区）的宽度改动 —— 它被容器上的 Tailwind
      `max-w-none!`（`!important`）压制，写 `max-width` 完全无效。这是我在 6f684939
      引入的「看起来写了但实际无效」的改动，按新规第 2 条回退。
      **下次方向**：移除或替换预览容器上的 `max-w-none!`（efee2e1b 引入），
      而不是在下层规则里对抗 `!important`。**需用户确认能否动那个 class。**
- [x] B5 路由转场：**已完成**。applyRoute 增加 animate 参数，首次同步（后台刷新/直接打开链接）传 false。实测刷新 hasAnim=false、内部导航 t+150 播 / t+600 自动摘、animationstart+end 都触发。前后台互切是整页加载，走 AdminEntryVeil（该组件状态见上方失败记录）。

### 模块 C — 全局视觉（较重）

- [ ] C1 连续曲线圆角（squircle）：全项目圆角规范。
- [ ] C2 通知栏：进度条与左右边缘留白；添加撤回功能。
- [x] C3 OOBE：**已完成**（7d04191a）。卡片改 flex 居中（实测 top 244 / bottom 256）；
      Logo 恢复渲染（此前入参被 `void` 丢弃）；两处内边距改用 `--admin-gutter`。
      注：验证时需临时清空一个必填项才能进入 `/setup/`，已恢复 `.env.local`（SHA256 一致）。

### 模块 D — 排查与评估（重，产出结论而非代码）

- [ ] D1 后台目录分类是否合理，严禁代码混杂。
- [x] D2 配置文件「半连接」问题：**已排查，结论如下。**

      **三条读取路径并存（这就是「半连接」）：**
      1. `AdminLayout.astro` 把构建快照写进 `<div id="admin-config-snapshot" data-snapshot="…">`，
         **仅 `import.meta.env.PROD` 注入**；dev 下是 `{}`。
      2. `config-io.ts#readConfigSnapshot` 服务端 `import("@/constants/admin-config-snapshot")`，
         只在 `isRemoteRuntime()`（VERCEL / CF_WORKERS / AWS_LAMBDA_FUNCTION_NAME）时被用。
      3. 回落 `/api/admin/configs/[key]/` 实时读盘（tsx 求值），**dev 唯一可用路径**。

      **格式**：快照是 `Record<key, { data: unknown; source: string }>`，API 返回
      `{ success, data, source, remote }`。两者结构不同——所以 `AdminDashboard.loadSettings`
      里对快照与 API 各写了一段解析分支（`settingsData / settingsSource / settingsRemote`）。

      **是否互相覆盖**：不覆盖，是**同一条读取链上的三级回落**：
      DOM 快照 → (无则) API。写路径同理分叉：本地可写就写文件，否则走
      `saveConfigJsonRemote` 提交 GitHub 触发重建。**但存在真实风险**：
      - 快照是**构建时**的求值结果，页面在长会话里不会刷新它；用户改完配置后
        若没重新构建，读到的仍是旧快照。dev 下无快照所以看不到这个问题，
        **这正是「半连接」最容易在生产暴露的形态**。
      - 43 个文件直接 `import "@/config"`（编译期常量），它们**永远拿不到**运行时改动，
        即使 Admin 页显示已保存。前后台因此可能读到不同的值。

      **统一配置源的建议**（按代价从低到高）：
      - **方案 A（推荐，小改）**：明确「编译期 vs 运行时」边界。编译期配置（siteConfig 等）
        保持直接 import，并在 Admin 页把这类字段标为「需重新构建生效」；运行时配置
        （runtime-config）统一走单一 API，删掉 DOM 快照这条路径，减少一个真相源。
      - **方案 B（中改）**：保留快照但加版本号（构建时间戳）。前端每次读快照前比对
        `/api/admin/configs/version`，不一致就自动回落 API 并提示「有更新，刷新以应用」。
      - **方案 C（大改）**：把 43 处直接 import 全部改为运行时注入的 provider。
        收益最大但改动面极广，且会让首屏多一次请求——不建议为本项目规模付这个代价。
- [ ] D3 后台内部标签页管理体系可行性评估。

### 模块 E — 架构升级（最重，先出方案再写代码）

- [ ] E1 环境变量页加侧边栏 + 模块化拆分（便于接 KV）。
- [ ] E2 设置页分流：「管理类」页面移到侧栏，保留纯配置页；评估混合页面方案。
- [ ] E3 导出功能：单文件 JSON → 含原始文章与静态资源的 Zip 包，评估兼容性优势。

### 规范更新

- [x] 长任务清单必须完整写入 todo.md（AGENTS.md 第 4 条 / rules §2）
- [x] 单项 10 分钟预算，超时记录跳过（AGENTS.md 第 5 条）
- [x] 长清单按难度模块化、从轻到复杂（AGENTS.md 第 6 条）
