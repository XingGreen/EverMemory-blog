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
