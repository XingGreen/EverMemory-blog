# EverMemory 博客管理员手册

> 适用于：Firefly Blog + Astro 7 + GitHub App + Vercel 部署架构
> 更新时间：2026-10-17

***

## 目录

- [1. 架构总览](#1-架构总览)
- [2. 环境变量配置](#2-环境变量配置)
  - [2.1 GitHub App 相关](#21-github-app-相关)
  - [2.2 管理后台登录相关](#22-管理后台登录相关)
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
  - [3.9 会话管理](#39-会话管理)
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
| 登录       | GitHub OAuth（复用写入用的同一个 GitHub App）  | 仅白名单 GitHub 账号可登录；签发 JWT HttpOnly Cookie |
| 应急入口     | 应急令牌 `ADMIN_BREAKGLASS_TOKEN`（可选）    | GitHub 不可用时的备用登录入口              |
| 危险操作确认   | 重新走 GitHub OAuth（`prompt=login`）    | 改密钥等敏感操作要求重新认证，借 GitHub 2FA 当第二因子 |
| 会话管理     | 服务端会话表 + JWT HttpOnly Cookie        | 可查看在线设备并精确踢下线                    |
| 人机验证（可选） | Cloudflare Turnstile               | 未配置则完全跳过，不影响既有部署                |
| 写入操作     | GitHub App（JWT → Installation Token） | 服务端读取私钥 → 调 GitHub API 写入仓库      |
| 读取保护（可选） | Firefly 主题内建 frontmatter `password`  | 纯前端 AES 解密，不依赖服务端                |
| 部署平台     | Vercel                               | `GITHUB_PRIVATE_KEY` 等密钥通过环境变量注入 |

五类凭证严格分离，互不干扰：

```
┌─ GitHub OAuth 凭据 (GITHUB_APP_CLIENT_ID / _SECRET) ──→ 管理员登录换取身份
├─ 白名单账号        (ADMIN_GITHUB_ID)               ──→ 仅该 GitHub 数字 id 可登录
├─ 应急令牌          (ADMIN_BREAKGLASS_TOKEN, 可选)   ──→ GitHub 不可用时的备用登录入口
├─ JWT 签名         (ADMIN_JWT_SECRET)              ──→ Cookie 签名，会话保持
└─ GitHub App 私钥                                   ──→ 服务端专用，不经过浏览器
```

> **为什么登录外包给 GitHub**：个人博客后台自研密码存储（加盐哈希、失败锁定、频率限流）成本高且易出漏洞，业界 CMS（Decap / Keystatic / Sveltia）一律把管理员身份交给 GitHub。本项目的登录复用写入文章用的同一个 GitHub App，只认白名单里的那个 GitHub 账号。
>
> **应急令牌**：万一 GitHub 不可用（或账号异常），可用一段高熵随机串登录。默认不配置即为「不开放该入口」。

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

> 同一个 GitHub App 还用于**管理员登录**（见下节）。登录走的是 OAuth（client id / secret），写入走的是 App 私钥，二者是同一 App 的两套凭据。

### 2.2 管理后台登录相关

| 变量名                        | 是否必填 | 说明                                                                    |
| -------------------------- | ---- | --------------------------------------------------------------------- |
| `GITHUB_APP_CLIENT_ID`     | ✅    | GitHub App 的 Client ID（形如 `Iv23li…`），**注意与应用页顶部的 App ID 不同**         |
| `GITHUB_APP_CLIENT_SECRET` | ✅    | GitHub App 的 Client Secret，回调换取 token 用；泄露后立即到 GitHub 重新生成          |
| `ADMIN_GITHUB_ID`          | ✅    | 允许登录后台的 GitHub 账号**数字 id**（形如 `238927366`，不随用户名/头像变化）                |
| `GITHUB_OAUTH_REDIRECT_URI` | 可选   | 覆写 OAuth 回调地址；留空则按请求域名推导，仅反向代理/自定义域名导致推导错误时才设                  |
| `ADMIN_BREAKGLASS_TOKEN`   | 可选   | 应急登录令牌，高熵随机串。未配置即不开放该入口                                       |
| `ADMIN_JWT_SECRET`         | ✅    | 32 字节以上的随机字符串，作为 Cookie JWT 签名密钥；生产环境未配置会直接启动失败                      |
| `ADMIN_ALERT_WEBHOOK`      | 可选   | 登录成功告警：每次登录成功向该 URL POST 一条 JSON（Slack / Discord / 邮件网关）            |
| `TURNSTILE_SITE_KEY`       | 可选   | Turnstile 人机验证 site key，**需与 Secret Key 成对配置**                       |
| `TURNSTILE_SECRET_KEY`     | 可选   | Turnstile 人机验证 secret key                                             |

**GitHub App 需要登记 OAuth 回调地址（Callback URL）**，在 App 设置页填写：

- 线上：`https://你的域名/api/admin/auth/github/callback`
- 本地开发如需在 localhost 登录，在**同一个 App** 里再登记一条：`http://localhost:4321/api/admin/auth/github/callback`

> 还有一个内部变量 `ADMIN_TOKEN_VER`（会话撤销版本号，一般不用手动配）：改认证相关密钥时自动 +1，使**所有已登录会话立即失效**。

### 2.3 生成命令速查

```bash
# 1. 生成 ADMIN_JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 输出：a1b2c3d4...（64 位十六进制字符串）

# 2. 生成 ADMIN_BREAKGLASS_TOKEN（应急令牌）
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# 输出：一段 URL 安全的高熵随机串

# 3. 将私钥 PEM 转为 Base64（用于 Vercel 的 GITHUB_PRIVATE_KEY）
node -e "console.log(require('fs').readFileSync('.key/emblog-ghapp.2026-07-29.private-key.pem').toString('base64'))"
```

> `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` 不需要生成，直接在 GitHub App 设置页复制。
> 查询自己的 GitHub 数字 id：登录 GitHub 后访问 `https://api.github.com/user`，取返回 JSON 里的 `"id"` 字段。

***

## 3. 管理后台使用

管理后台路径：`/admin/`，例如：

- 本地开发：`http://localhost:4321/admin/`
- 线上：`https://your-domain.com/admin/`

### 3.1 登录

访问 `/admin/`，会看到两种登录方式（取决于环境变量配置）：

1. **使用 GitHub 登录**（主方式）：点击按钮 → 跳转 GitHub 授权 → 回调进后台。只有 `ADMIN_GITHUB_ID` 白名单里的那个账号能通过。
2. **使用应急令牌**（备用）：展开后粘贴 `ADMIN_BREAKGLASS_TOKEN` 的值 → 提交。**仅当配置了该变量时才会出现这个入口。**

通过人机验证（**仅当**配置了 Turnstile 才会出现）。

验证通过后：

- 服务端签发 HttpOnly Cookie `admin_session`（`Secure` + `SameSite=Strict`）
- `sessionStorage` 仅存 `admin_verified=true` 标记（不存任何密钥），且**始终以服务端会话为准**，本地标记残留不会让后台误渲染

**会话时长：**

| 登录方式          | 默认     |
| ------------- | ------ |
| GitHub OAuth  | 7 天    |
| 应急令牌          | 12 小时 |

> **危险操作的二次确认**：修改 JWT 密钥、GitHub 私钥等敏感项时，服务端会要求**重新走一次 GitHub OAuth**（带 `prompt=login`）。这是有意为之——借 GitHub 自身的 2FA / 通行密钥作为第二因子，而不是再维护一套密码。判定基于会话里的「最近强认证时间」（默认 5 分钟内免重复认证）。

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

| 分组             | 内容                                                          |
| -------------- | ----------------------------------------------------------- |
| GitHub App 凭据  | App ID、仓库所有者、仓库名、分支、Installation ID、私钥、私钥文件路径              |
| 管理员认证         | GitHub OAuth Client ID、Client Secret、管理员 GitHub 用户 ID、应急登录令牌、JWT 签名密钥、登录告警 Webhook |
| 人机验证（可选）      | Turnstile Site Key、Secret Key                               |

要点：

- **机密项不回显真实内容**，只显示「已配置 / 未配置」状态。
- 修改 **危险项**（`ADMIN_JWT_SECRET` / `GITHUB_APP_CLIENT_SECRET` / `ADMIN_GITHUB_ID` / `ADMIN_BREAKGLASS_TOKEN`）时会要求**重新走一次 GitHub OAuth** 做二次确认，并且保存后 `ADMIN_TOKEN_VER` 自动 +1 —— **所有已登录会话立即失效**（包括你自己）。
- 修改 `GITHUB_PRIVATE_KEY` / `GITHUB_PRIVATE_KEY_PATH` 属于**破坏性操作**（可把仓库写入重定向到攻击者的 App，或用无效私钥直接切断同步），同样需要二次确认。
- **线上（Vercel）只能查看状态，不能真正改值**：生产构建的文件系统是只读的。线上要改密钥，必须去 Vercel 项目 Settings → Environment Variables 改，然后 Redeploy。

### 3.8 站点配置

路径：`/admin/dashboard/settings`

浏览与编辑站点配置（共 24 项，按分组归类）。分两类：

- **运行时可改项**：保存后即时生效，直接写入运行时配置存储，不改仓库代码。
- **静态配置项**：写入源码中的配置文件，需重新构建部署后才生效。

### 3.9 会话管理

路径：`/admin/dashboard/settings` 页面底部（「会话管理」栏目）

登录后可以查看当前所有在线会话，并将任意会话（含本机）**踢下线**。

| 字段   | 说明                        |
| ---- | ------------------------- |
| 设备   | 由 User-Agent 解析出的浏览器 + 系统   |
| IP   | 该会话最近一次登录的来源 IP           |
| 登录时间 | 该会话首次登录时刻                 |
| 最后活跃 | 该会话最近一次请求时刻（60 秒节流写入）     |
| 认证方式 | GitHub OAuth / 应急令牌         |

> **同设备去重**：同一台设备（同 User-Agent）反复登录时，新会话会自动顶掉旧会话，会话表里同一设备只保留最新一条，避免列表被无意义的历史会话刷屏。
>
> **服务端硬门禁**：查看与踢人走 `requireAuth`（即任何已登录会话都能看到自己的会话列表）。攻击者一旦拿到会话，主人都能用「踢掉其他设备」立即收回控制权。

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

# GitHub OAuth 登录（与上方同一个 App 的 Client ID / Secret）
GITHUB_APP_CLIENT_ID=Iv23li...
GITHUB_APP_CLIENT_SECRET=...

# 允许登录的 GitHub 数字 id
ADMIN_GITHUB_ID=238927366

# 应急令牌（可选）
# ADMIN_BREAKGLASS_TOKEN=...

# 随意写一个 32 字节随机串即可（本地开发重启后要重新登录）
ADMIN_JWT_SECRET=a1b2c3d4...

# 登录成功告警（可选）
# ADMIN_ALERT_WEBHOOK=https://hooks.slack.com/services/...
```

> 完整模板见仓库根目录 `.env.example`，可直接 `cp .env.example .env.local` 后填值。
> 本地登录还需在 GitHub App 里登记回调 `http://localhost:4321/api/admin/auth/github/callback`。

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
| `GITHUB_APP_CLIENT_ID`   | ✅  | 字符串             | `Iv23li...`              |
| `GITHUB_APP_CLIENT_SECRET` | ✅  | 字符串           | `...`                    |
| `ADMIN_GITHUB_ID`        | ✅  | 纯数字             | `238927366`              |
| `ADMIN_JWT_SECRET`       | ✅  | 随机 64 位 hex     | `a1b2c3d4...`            |
| `ADMIN_BREAKGLASS_TOKEN` | 可选 | 高熵随机串（base64url） | `xY...`                  |
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

### Q1. 点「使用 GitHub 登录」没反应 / 提示回调错误？

检查 GitHub App 与 `ADMIN_GITHUB_ID`：

1. `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` 是否填对（Client ID 形如 `Iv23li…`，**不是** App ID）
2. GitHub App 设置页的 **Callback URL** 是否登记了 `https://你的域名/api/admin/auth/github/callback`（本地开发还要额外登记 localhost 那条）
3. `ADMIN_GITHUB_ID` 是否为当前登录账号的数字 id；不是白名单账号会被拒绝
4. 线上改过环境变量后是否 **Redeploy** 过

查询自己的 GitHub 数字 id：登录 GitHub 后访问 `https://api.github.com/user`，取 `"id"` 字段。

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

- **HttpOnly Cookie**（JWT `admin_session`）：由 `ADMIN_JWT_SECRET` 签发，GitHub 登录默认 7 天，应急令牌 12 小时
- **sessionStorage 标记**：仅存 `admin_verified=true`，关闭标签页即失效；但服务端会话仍在，重开页面会以服务端为准自动恢复

以下情况会让旧 Cookie 立即失效，被迫重新登录：

1. **`ADMIN_JWT_SECRET` 变更**：开发环境未配置时会生成临时密钥，**重启 dev server 后密钥变更**，旧 Cookie 就被判无效。解决方式：在 `.env.local` 中给 `ADMIN_JWT_SECRET` 一个固定值。
2. **`ADMIN_TOKEN_VER` 变更**：改认证相关密钥时会自动 +1，撤销所有旧会话。
3. **会话被踢下线**：在「设置 → 会话管理」里，该会话被删除（或同设备再次登录顶掉）后其 `sid` 即失效。

### Q7. 可以让别人也登录后台吗？

可以，但方式是**把对方的 GitHub 账号数字 id 加进白名单**——目前后台只认 `ADMIN_GITHUB_ID` 一个账号。若需要多人，需改动代码支持多 id 白名单（当前版本未提供）。

> 换句话说，「登录权限」= 那个 GitHub 账号本身。要收回权限，去 GitHub 侧处理（改密码 / 移除 2FA / 删除账号），或在后台改 `ADMIN_GITHUB_ID`（保存后 `ADMIN_TOKEN_VER` +1，所有旧会话立即失效）。

### Q8. 后台有登录失败锁定 / 频率限制吗？

没有。密码认证整条链路（scrypt 哈希、失败锁定、频率限流、IP 封禁）已全部移除，登录安全交给 GitHub（2FA / 通行密钥 / 异常检测）。

理由：登录入口只认 GitHub OAuth，攻击者要登录必须先通过 GitHub 认证并命中白名单账号，在自家端点再自研一套防爆破既无必要、又是维护负担。

### Q9. 忘记 / 进不去 GitHub，怎么登录后台？

用**应急令牌**（前提是 `.env.local` / Vercel 里配了 `ADMIN_BREAKGLASS_TOKEN`）：

1. 在登录页展开「使用应急令牌」
2. 粘贴 `ADMIN_BREAKGLASS_TOKEN` 的值 → 提交

若从未配置该变量，请在 Vercel 环境变量里加一个（`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` 生成）后 Redeploy。彻底进不去时按 [8. 应急操作](./EMERGENCY_OPS.md) 走平台层流程。

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

> 手册版本：v1.2 · 最后同步：2026-10-17

