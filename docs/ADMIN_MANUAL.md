# EverMemory 博客管理员手册

> 适用于：Firefly Blog + Astro 7 + GitHub App + Vercel 部署架构
> 更新时间：2026-10-15

***

## 目录

- [1. 架构总览](#1-架构总览)
- [2. 环境变量配置](#2-环境变量配置)
  - [2.1 GitHub App 相关](#21-github-app-相关)
  - [2.2 管理后台相关](#22-管理后台相关)
  - [2.3 生成命令速查](#23-生成命令速查)
- [3. 管理后台使用](#3-管理后台使用)
  - [3.1 登录](#31-登录)
  - [3.2 文章列表](#32-文章列表)
  - [3.3 创建新文章](#33-创建新文章)
  - [3.4 编辑已有文章](#34-编辑已有文章)
  - [3.5 删除文章](#35-删除文章)
  - [3.6 退出登录](#36-退出登录)
  - [3.7 密钥配置](#37-密钥配置)
  - [3.8 站点配置](#38-站点配置)
  - [3.9 应急控制台](#39-应急控制台)
- [4. 本地开发（dev server）](#4-本地开发dev-server)
  - [4.1 初始化流程](#41-初始化流程)
  - [4.2 配置本地 `.env.local`](#42-配置本地-envlocal)
  - [4.3 启动开发服务器](#43-启动开发服务器)
- [5. 保存/删除的工作原理](#5-保存删除的工作原理)
  - [5.1 保存文章](#51-保存文章)
  - [5.2 删除文章](#52-删除文章)
  - [5.3 本地与 GitHub 不一致时](#53-本地与-github-不一致时)
- [6. Vercel 部署](#6-vercel-部署)
  - [6.1 环境变量清单](#61-环境变量清单)
  - [6.2 重新部署触发条件](#62-重新部署触发条件)
- [7. 常见问题（FAQ）](#7-常见问题faq)
- [8. 应急操作（平台层核按钮）](./EMERGENCY_OPS.md) ← 怀疑被入侵 / 进不去后台时看这份

***

## 1. 架构总览

| 层级       | 技术                                   | 说明                               |
| -------- | ------------------------------------ | -------------------------------- |
| 前端页面     | Astro 7 + Svelte 5                   | 静态构建，SSR 端点仅用于管理后台               |
| 认证       | scrypt 密码哈希 + JWT HttpOnly Cookie | 用户名 + 密码验证通过后签发；分 admin / super 两空间 |
| 防爆破      | 失败锁定 + 尝试频次限流 + IP 封禁（可选）       | 状态存 KV；IP 封禁需手动操作               |
| 人机验证（可选） | Cloudflare Turnstile               | 未配置则完全跳过，不影响既有部署                |
| 写入操作     | GitHub App（JWT → Installation Token） | 服务端读取私钥 → 调 GitHub API 写入仓库      |
| 读取保护（可选） | Firefly 主题内建 frontmatter `password`  | 纯前端 AES 解密，不依赖服务端                |
| 部署平台     | Vercel                               | `GITHUB_PRIVATE_KEY` 等密钥通过环境变量注入 |

四类密钥严格分离，互不干扰：

```
┌─ 管理员用户名 (ADMIN_USERNAME)     ──→ 登录身份校验
├─ 主密码 (ADMIN_PASSWORD)          ──→ 登录验证，进入 admin 主空间
├─ 第二密码 (ADMIN_SUPER_PASSWORD)  ──→ 登录验证，进入 super 应急控制台（可选）
├─ JWT 签名 (ADMIN_JWT_SECRET)     ──→ Cookie 签名，会话保持
└─ GitHub App 私钥                   ──→ 服务端专用，不经过浏览器
```

> **两个空间的区别**：`admin`（主密码）是日常后台的全部功能；`super`（第二密码）= 主空间能力 + 控制面（踢会话 / 封 IP）。**踢人权只在第二空间**，攻击者即使拿到主会话也无法夺走控制权。

***

## 2. 环境变量配置

所有变量均支持通过 `.env.local`（本地开发）或 **Vercel 项目 Settings → Environment Variables** 配置。

### 2.1 GitHub App 相关

| 变量名                       | 是否必填 | 说明                                          |
| ------------------------- | ---- | ------------------------------------------- |
| `GITHUB_APP_ID`           | ✅    | GitHub App 的 App ID，纯数字，在 App Settings 顶部可见 |
| `GITHUB_INSTALLATION_ID`  | ✅    | App 安装到仓库时生成的 Installation ID，纯数字           |
| `GITHUB_OWNER`            | ✅    | 仓库所有者 GitHub 用户名或组织名                        |
| `GITHUB_REPO`             | ✅    | 仓库名称，不带 `.git` 后缀                           |
| `GITHUB_BRANCH`           | ✅    | 部署分支，通常为 `master` 或 `main`                  |
| `GITHUB_PRIVATE_KEY`      | ✅    | GitHub App 私钥 PEM，**推荐 Base64 编码**后填入       |
| `GITHUB_PRIVATE_KEY_PATH` | 可选   | 本地私钥文件路径，仅在 `GITHUB_PRIVATE_KEY` 未设置时回退读取   |

**私钥格式选择建议：**

| 形式              | 适用场景                  | 示例                                   |
| --------------- | --------------------- | ------------------------------------ |
| 纯文本 PEM         | 本地文件 `.key/*.pem`     | `-----BEGIN RSA PRIVATE KEY-----...` |
| Base64 编码后的 PEM | Vercel 环境变量（避免换行符破坏值） | `LS0tLS1CRUdJTiBSU0EgUF...`          |

### 2.2 管理后台相关

| 变量名                    | 是否必填 | 说明                                                                             |
| ---------------------- | ---- | ------------------------------------------------------------------------------ |
| `ADMIN_USERNAME`       | ✅    | 后台登录用户名，未配置时默认 `admin`                                                    |
| `ADMIN_PASSWORD`       | ✅    | **主密码的 scrypt 加盐哈希**，格式 `scrypt$N$salt$hash`。**填明文也可以**，服务端保存时会自动转成哈希 |
| `ADMIN_JWT_SECRET`     | ✅    | 32 字节以上的随机字符串，作为 Cookie JWT 签名密钥；生产环境未配置会直接启动失败               |
| `ADMIN_SUPER_PASSWORD` | 可选   | **第二密码**哈希（同样 `scrypt$…`），用于进入应急控制台。未配置时控制面降级为主密码二次验证              |
| `ADMIN_SCRYPT_N`       | 可选   | scrypt 成本因子，默认 `131072`（约 128MB 内存）。一般无需修改                             |
| `ADMIN_ALERT_WEBHOOK`  | 可选   | 登录成功告警：每次登录成功向该 URL POST 一条 JSON（Slack / Discord / 邮件网关）             |
| `TURNSTILE_SITE_KEY`   | 可选   | Turnstile 人机验证 site key，**需与 Secret Key 成对配置**                          |
| `TURNSTILE_SECRET_KEY` | 可选   | Turnstile 人机验证 secret key                                                    |

> 除了上面这些，还有一个内部变量 `ADMIN_TOKEN_VER`（会话撤销版本号，一般不用手动配）：改用户名 / 密码 / JWT 密钥 / 第二密码时自动 +1，使**所有已登录会话立即失效**。

### 2.3 生成命令速查

```bash
# 1. 生成 ADMIN_PASSWORD（或 ADMIN_SUPER_PASSWORD）的 scrypt 哈希
#    N=131072 是默认值，耗时约 1 秒属正常
node -e "const c=require('crypto');const s=c.randomBytes(16);const h=c.scryptSync('YourPassword',s,64,{N:131072,maxmem:268435456});console.log('scrypt$131072$'+s.toString('base64')+'$'+h.toString('base64'))"
# 输出：scrypt$131072$AbCd...==$XyZw...==

# 2. 生成 ADMIN_JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 输出：a1b2c3d4...（64 位十六进制字符串）

# 3. 将私钥 PEM 转为 Base64（用于 Vercel 的 GITHUB_PRIVATE_KEY）
node -e "console.log(require('fs').readFileSync('.key/emblog-ghapp.2026-07-29.private-key.pem').toString('base64'))"
```

> ⚠️ `ADMIN_PASSWORD` **不是明文密码**。如果你在 `.env.local` 中写 `ADMIN_PASSWORD=123456`，登录时输入 `123456` 会失败，因为验证逻辑用 scrypt 哈希比对。请务必用上方第 1 条命令生成哈希值。
>
> 💡 例外：在后台 **「密钥配置」页** 直接粘贴明文密码是**可以**的，保存时服务端会自动转成 scrypt 哈希（仅在本地开发的可写环境下生效，详见 [3.7 密钥配置](#37-密钥配置)）。

***

## 3. 管理后台使用

管理后台路径：`/admin/`，例如：

- 本地开发：`http://localhost:4321/admin/`
- 线上：`https://your-domain.com/admin/`

### 3.1 登录

1. 访问 `/admin/`
2. 输入**用户名**（对应 `ADMIN_USERNAME`，默认 `admin`）
3. 输入**密码**
4. 勾选「记住我」（可选，见下方会话时长）
5. 通过人机验证（**仅当**配置了 Turnstile 才会出现）
6. 点击「验证并进入后台」

**登录去向由服务端判定（「主密码优先」）：**

| 输入的密码              | 结果                                     |
| ------------------ | -------------------------------------- |
| 主密码正确              | 进入主空间 `/admin/dashboard/`             |
| 主密码错 + 第二密码正确（已配置） | 进入应急控制台 `/admin/console/`             |
| 两者都错               | 登录失败                                  |

> 「主密码优先」的设计用意：主密码通过即进主空间，且**完全不参考第二密码的结果**。这样「正确主密码 + 乱试第二密码」的请求永远返回主空间——攻击者即使拿到主密码，也无法借响应逐次试探第二密码是否正确。

**会话时长：**

| 空间            | 默认            | 勾选「记住我」      |
| ------------- | ------------- | ------------ |
| admin（主空间）    | 12 小时         | 7 天           |
| super（应急控制台） | 1 小时          | **不提供**「记住我」 |

验证通过后：

- 服务端签发 HttpOnly Cookie `admin_session`（`Secure` + `SameSite=Strict`）
- `sessionStorage` 仅存 `admin_verified=true` 标记（不存任何密钥）

**防爆破（自动）：**

| 措施        | 规则                                             | 效果                 |
| --------- | ---------------------------------------------- | ------------------ |
| 失败锁定     | 连续失败 5 次                                       | 锁定时长 30 秒起指数翻倍，上限 30 分钟 |
| 尝试频次限流   | 60 秒窗口内累计尝试 10 次（成功失败都算，成功会清零计数）               | 窗口内剩余时间返回 429 + `Retry-After` |
| IP 封禁     | 手动在应急控制台操作                                    | 该 IP 一律拒绝登录          |

前端登录页会按 `Retry-After` 头倒计时并禁用提交按钮，无需手动算时间。限流/锁定状态存在 KV（Upstash）；KV 不可用时降级为进程内内存，**降级策略是放行而非拒绝**。

### 3.2 文章列表

登录成功后展示所有文章。列表字段：

| 字段   | 说明                         |
| ---- | -------------------------- |
| 标题   | 文章 frontmatter 的 `title`   |
| 分类   | `category`                 |
| 标签   | `tags` 数组                  |
| 发布日期 | `published`                |
| 草稿标记 | `draft: true` 时标为草稿（不参与构建） |

操作按钮：

- **编辑**：打开编辑器，加载文章内容到表单
- **删除**：弹出二次确认后删除

### 3.3 创建新文章

1. 点击列表页顶部的 **"新建文章"**
2. 填写表单：

| 字段   | 必填     | 说明                              |
| ---- | ------ | ------------------------------- |
| Slug | ✅      | 文章 URL 标识，仅允许字母、数字、`-`、`_`      |
| 标题   | ✅      | 文章标题                            |
| 作者   | <br /> | 不填时使用站点默认作者                     |
| 分类   | <br /> | 单分类字符串                          |
| 标签   | <br /> | 逗号分隔，回车即添加                      |
| 发布日期 | <br /> | 自动填当前日期，可改                      |
| 摘要   | <br /> | `description`，用于 SEO 和列表卡片      |
| 封面图  | <br /> | `image`，封面图 URL                 |
| 草稿   | <br /> | 勾选后 frontmatter 设 `draft: true` |
| 正文   | ✅      | Markdown 正文，不包含 `---` 分隔符       |

1. 点击 **"保存"** 或按 Ctrl+S

保存成功后提示包含两种信息之一：

- `保存成功（已同步到 GitHub）` — 本地与远程均成功
- `保存成功（仅本地保存）` — GitHub 同步失败（如网络），但本地文件已落盘

### 3.4 编辑已有文章

从列表点击 **"编辑"** 按钮，预填所有字段，修改后保存。

### 3.5 删除文章

点击 **"删除"** → 弹出确认框 → 点击 **"确认删除"**。

删除流程：

1. 先删除本地 `src/content/posts/<slug>.md`
2. 再尝试删除 GitHub 对应分支上的同名文件
3. 只要本地删除成功即返回成功；GitHub 若失败会在消息中提示

### 3.6 退出登录

点击右上角 **"退出"**（或 `退出管理` 按钮）：

- `sessionStorage.admin_verified` 被清除
- 服务端 Cookie `admin_session` 过期（被服务端响应头 `Max-Age=0` 清除）
- 服务端会话表中该会话被删除，该会话 ID 不可再用

### 3.7 密钥配置

路径：`/admin/dashboard/secrets`

后台集中管理服务端密钥的页面，共 **15 项**，按三组归类：

| 分组             | 内容                                                     |
| -------------- | ------------------------------------------------------ |
| GitHub App 凭据  | App ID、仓库所有者、仓库名、分支、Installation ID、私钥、私钥文件路径 |
| 管理员认证         | 用户名、主密码哈希、第二密码哈希、JWT 签名密钥、scrypt 成本参数、登录告警 Webhook |
| 人机验证（可选）      | Turnstile Site Key、Secret Key                          |

要点：

- **机密项不回显真实内容**，只显示「已配置 / 未配置」状态。
- 修改 `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_SUPER_PASSWORD` / `ADMIN_JWT_SECRET` 时会**弹出密码二次验证**，并且保存后 `ADMIN_TOKEN_VER` 自动 +1 —— **所有已登录会话立即失效**（包括你自己）。
- 修改 `GITHUB_PRIVATE_KEY` / `GITHUB_PRIVATE_KEY_PATH` 属于**破坏性操作**（可把仓库写入重定向到攻击者的 App，或用无效私钥直接切断同步），同样需要二次验证。
- **线上（Vercel）只能查看状态，不能真正改值**：生产构建的文件系统是只读的。线上要改密钥，必须去 Vercel 项目 Settings → Environment Variables 改，然后 Redeploy。

### 3.8 站点配置

路径：`/admin/dashboard/settings`

浏览与编辑站点配置（共 24 项，按分组归类）。分两类：

- **运行时可改项**：保存后即时生效，直接写入运行时配置存储，不改仓库代码。
- **静态配置项**：写入源码中的配置文件，需重新构建部署后才生效。

### 3.9 应急控制台

路径：`/admin/console/`

**需要 super 会话**（用第二密码登录）才能进入。这里是控制面专属页面，只放两件事：

| 功能    | 说明                        |
| ----- | ------------------------- |
| 会话管理  | 查看当前登录会话，可将任意会话（含本机）踢下线 |
| IP 封禁 | 手动封禁 / 解封指定 IP，被封 IP 一律拒绝登录 |

> **服务端硬门禁**：导航里隐藏入口只是 UX，真正的门在 `/admin/console/` 页面本身以及各控制面 API 的 `requireSuperAuth`。用 admin（主）会话访问会直接 302 退回 `/admin/dashboard/`，不是权限不足提示，而是根本不允许渲染。

忘记第二密码时，请按 [8. 应急操作](./EMERGENCY_OPS.md) 走平台层流程恢复。

***

## 4. 本地开发（dev server）

### 4.1 初始化流程

```bash
# 1. 安装依赖
pnpm install
# 或
npx pnpm install

# 2. 复制并编辑环境变量
cp .env.example .env.local
# 按第 2 章说明填入所有必填项

# 3. 启动开发服务器
pnpm dev
```

### 4.2 配置本地 `.env.local`

本地开发时，`GITHUB_PRIVATE_KEY_PATH` 指向本地私钥文件**可以省去 Base64 编码**：

```dotenv
# .env.local 示例
GITHUB_APP_ID=4423412
GITHUB_OWNER=YourName
GITHUB_REPO=YourRepo
GITHUB_BRANCH=master
GITHUB_INSTALLATION_ID=149804847
GITHUB_PRIVATE_KEY_PATH=.key/emblog-ghapp.2026-07-29.private-key.pem

# 用户名（留空则默认 admin）
ADMIN_USERNAME=admin

# 用第 2.3 节命令算出的 scrypt 哈希，不要写明文
ADMIN_PASSWORD=scrypt$131072$AbCd...==$XyZw...==

# 第二密码（可选，强烈建议配置，务必与主密码不同）
ADMIN_SUPER_PASSWORD=scrypt$131072$EfGh...==$RsTu...==

# 随意写一个 32 字节随机串即可（本地开发重启后要重新登录）
ADMIN_JWT_SECRET=a1b2c3d4...

# 登录成功告警（可选）
# ADMIN_ALERT_WEBHOOK=https://hooks.slack.com/services/...
```

> 完整模板见仓库根目录 `.env.example`，可直接 `cp .env.example .env.local` 后填值。

### 4.3 启动开发服务器

```bash
pnpm dev
# 默认监听 http://localhost:4321
```

***

## 5. 保存/删除的工作原理

### 5.1 保存文章

```
POST /api/admin/save/
   │
   ├─ 1. 校验 slug（白名单：字母/数字/-/_，禁止 ../）
   ├─ 2. 写入本地  src/content/posts/<slug>.md      ← 保证 dev 热更新立即生效
   ├─ 3. 调 GitHub API PUT /contents/<filePath>     ← 生成 commit 触发部署
   │     ├─ 成功：message = "保存成功（已同步到 GitHub）"
   │     └─ 失败：message = "保存成功（仅本地保存）"
   └─ 返回 { success, message, filePath }
```

### 5.2 删除文章

```
POST /api/admin/delete/
   │
   ├─ 1. 校验 slug
   ├─ 2. 删除本地 src/content/posts/<slug>.md
   ├─ 3. 调 GitHub API DELETE /contents/<filePath>     ← 捕获异常，不因为 GitHub 失败阻断整体
   │     ├─ 成功：message = "删除成功（已同步到 GitHub）"
   │     └─ 失败：message = "删除成功（已删除本地文件，但 GitHub 同步失败：…）"
   └─ 返回 { success, message, filePath }
```

### 5.3 本地与 GitHub 不一致时

如果只看到 `保存成功（仅本地保存）` 或 GitHub 同步失败消息，可以用 git 手动同步：

```bash
# 查看本地有哪些未提交的变更
git status
git diff src/content/posts/

# 手动提交并推送（dev server 网络出问题时的兜底）
git add src/content/posts/my-post.md
git commit -m "update post: my-post via local"
git push
```

推送后 Vercel 会自动重新部署。

***

## 6. Vercel 部署

### 6.1 环境变量清单

在 Vercel 项目 **Settings → Environment Variables** 中配置以下变量（`Production` 环境必须全部勾选）：

| 变量名                      | 必填 | 格式              | 示例                       |
| ------------------------ | -- | --------------- | ------------------------ |
| `GITHUB_APP_ID`          | ✅  | 纯数字             | `4423412`                |
| `GITHUB_OWNER`           | ✅  | 字符串             | `Hengruoyi`              |
| `GITHUB_REPO`            | ✅  | 字符串             | `Hengruoyi-blog-firefly` |
| `GITHUB_BRANCH`          | ✅  | 字符串             | `master`                 |
| `GITHUB_INSTALLATION_ID` | ✅  | 纯数字             | `149804847`              |
| `GITHUB_PRIVATE_KEY`     | ✅  | Base64（推荐）      | `LS0tLS1CRUdJTi...`      |
| `ADMIN_USERNAME`         | ✅  | 字符串             | `admin`                  |
| `ADMIN_PASSWORD`         | ✅  | scrypt 哈希       | `scrypt$131072$...`      |
| `ADMIN_JWT_SECRET`       | ✅  | 随机 64 位 hex     | `a1b2c3d4...`            |
| `ADMIN_SUPER_PASSWORD`   | 可选 | scrypt 哈希       | `scrypt$131072$...`      |
| `ADMIN_SCRYPT_N`         | 可选 | 数字              | `131072`                 |
| `ADMIN_ALERT_WEBHOOK`    | 可选 | URL             | `https://hooks.slack.com/...` |
| `TURNSTILE_SITE_KEY`     | 可选 | 字符串             | `0x4AAAAAAA...`          |
| `TURNSTILE_SECRET_KEY`   | 可选 | 字符串             | `0x4AAAAAAA...`          |

> 配置完环境变量记得 **Redeploy** 一次。
> ⚠️ 线上密钥页（`/admin/dashboard/secrets`）只能**查看状态**，不能改值（生产文件系统只读）——改值请走 Vercel 环境变量。

### 6.2 重新部署触发条件

- 仓库 `master` / `main` 分支有新的 push
- 在管理后台保存/删除文章（通过 GitHub API 写入 commit 间接触发）
- Vercel 控制台手动点 **Redeploy**

***

## 7. 常见问题（FAQ）

### Q1. 登录时提示"管理密码错误"，但我输入的密码是对的？

检查 `ADMIN_PASSWORD` 环境变量：

1. 是否为 **scrypt 哈希**（`scrypt$N$salt$hash`），而不是明文
2. 本地 `.env.local` 和 Vercel 分别核对
3. 用户名也要一起对：`ADMIN_USERNAME` 未配置时默认 `admin`，若你改过用户名，登录要用新用户名

重算命令：

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16);const h=c.scryptSync('你的密码',s,64,{N:131072,maxmem:268435456});console.log('scrypt$131072$'+s.toString('base64')+'$'+h.toString('base64'))"
```

> 上面的「旧版 SHA256 哈希」在升级后会被自动迁移：如果 `.env.local` 里仍是旧的 SHA256 hex，**本地开发**下第一次用明文登录成功后会就地转成 scrypt。生产（Vercel）环境文件只读，不会自动迁移，需自己换新值。

### Q2. 登录提示"验证失败"（500 内部错误），服务端日志显示 `GitHub App 私钥未找到`？

原因：`GITHUB_PRIVATE_KEY` 环境变量未配置（或 Base64 解码后不是合法 PEM）。检查：

- Vercel 环境变量 `GITHUB_PRIVATE_KEY` 是否填写
- 若使用纯文本 PEM，确认包含 `-----BEGIN` 字样
- 若使用 Base64，确认是用 Node `Buffer.toString('base64')` 生成的

### Q3. 文章保存后提示"保存成功（仅本地保存）"

保存的本地文件是正确的，但 GitHub API 调用失败。常见原因：

1. Installation Token 过期（会自动重试 3 次，仍失败才提示）
2. 私钥/GitHub App 配置错误
3. 仓库分支名配错（`GITHUB_BRANCH=main` vs `master`）
4. GitHub 网络临时不通

查看服务端日志：

- 本地：终端 `[GitHub Save]` 开头的日志
- Vercel：**Deployment → Function Logs**

### Q4. 保存成功后看不到文章？

两种情况：

1. **本地开发**：dev server 支持 HMR，正常几秒内出现；若没出现，刷新页面
2. **Vercel 线上**：保存 → GitHub commit → Vercel Build → 部署生效，整个过程 1\~3 分钟

### Q5. 文章删除提示 404 Not Found？

文章文件**只存在本地、未推送到远程仓库**时，删除 GitHub API 会返回 404。删除流程对此做了容错：

- 只要本地文件已删除，返回值仍为 `success=true`
- 消息中会明确说明 `GitHub 同步失败：文件在 GitHub 仓库中不存在`

### Q6. 刷新管理后台页面为什么又要重新登录？

会话有两个层级：

- **HttpOnly Cookie**（JWT `admin_session`）：由 `ADMIN_JWT_SECRET` 签发，默认 12 小时（勾「记住我」为 7 天）
- **sessionStorage 标记**：仅存 `admin_verified=true`，关闭标签页即失效

以下情况会让旧 Cookie 立即失效，被迫重新登录：

1. **`ADMIN_JWT_SECRET` 变更**：开发环境未配置时会生成临时密钥，**重启 dev server 后密钥变更**，旧 Cookie 就被判无效。解决方式：在 `.env.local` 中给 `ADMIN_JWT_SECRET` 一个固定值。
2. **`ADMIN_TOKEN_VER` 变更**：改用户名 / 密码 / JWT 密钥 / 第二密码时会自动 +1，撤销所有旧会话。
3. **会话被踢下线**：在应急控制台的会话管理里，该会话被删除后其 `sid` 即失效。

### Q7. 管理密码是否可以多人共用？

可以。`ADMIN_PASSWORD` 是站点级的同一个哈希，知道用户名 + 密码的人都能登录。推荐密码**强度足够长**（12 位以上，字母数字符号混合），并定期更换：

1. 生成新的 `ADMIN_PASSWORD` scrypt 哈希
2. 更新 Vercel 环境变量
3. Redeploy 生效；同时 `ADMIN_TOKEN_VER` 会 +1，**所有已登录会话（含你当前这个）都会失效**

> 若想让「日常登录」与「控制面操作」用不同密码，可配置 `ADMIN_SUPER_PASSWORD`：主密码只能进日常后台，第二密码才能进应急控制台。

### Q8. 登录时提示被锁定 / 要求等待若干秒？

服务端内置了防爆破，见 [3.1 登录](#31-登录) 的「防爆破」表。常见触发：

- 连续输错密码 5 次 → 锁定 30 秒起，每次继续错翻倍，最长 30 分钟
- 60 秒内密集尝试超过 10 次

登录页会显示倒计时，等倒计时结束再试即可。**注意：锁定按你的 IP 计算，换 IP 会重新计数。**

### Q9. 忘记第二密码（应急控制台进不去）怎么办？

`ADMIN_SUPER_PASSWORD` 未配置时，控制面会**降级为主密码二次验证**，此时用主密码在相应操作处验证即可，不会把你锁在外面。

若已配置但忘记了，本地开发可在后台「密钥配置」页重设；线上只能去 Vercel 环境变量更新 `ADMIN_SUPER_PASSWORD` 后 Redeploy。彻底进不去时按 [8. 应急操作](./EMERGENCY_OPS.md) 走平台层流程。

### Q10. GitHub App 有两个私钥，用哪个？

GitHub App 的私钥可以有多份。要确认本地 `.key/*.pem` 和 GitHub 页面上显示的 SHA256 指纹是否匹配：

```bash
# 本地计算私钥指纹（同 GitHub 显示的 SHA256:xxxxx）
node -e "
  const fs = require('fs');
  const crypto = require('crypto');
  const pk = crypto.createPublicKey(fs.readFileSync('.key/emblog-ghapp.2026-07-29.private-key.pem'));
  const der = pk.export({type:'spki', format:'der'});
  console.log('SHA256:', crypto.createHash('sha256').update(der).digest('base64'));
"
```

对比 GitHub App Settings → Private keys 中每行显示的 `SHA256:` 前缀，匹配上的就是当前在用的。

***

> 手册版本：v1.1 · 最后同步：2026-10-15

