# EverMemory 博客管理员手册

> 适用于：Firefly Blog + Astro 7 + GitHub App + Vercel 部署架构
> 更新时间：2026-08-01

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
- [4. 本地开发（dev server）](#4-本地开发dev-server)
  - [4.1 初始化流程](#41-初始化流程)
  - [4.2 配置本地](#42-配置本地-envlocal) [`.env.local`](#42-配置本地-envlocal)
  - [4.3 启动开发服务器](#43-启动开发服务器)
- [5. 保存/删除的工作原理](#5-保存删除的工作原理)
  - [5.1 保存文章](#51-保存文章)
  - [5.2 删除文章](#52-删除文章)
  - [5.3 本地与 GitHub 不一致时](#53-本地与-github-不一致时)
- [6. Vercel 部署](#6-vercel-部署)
  - [6.1 环境变量清单](#61-环境变量清单)
  - [6.2 重新部署触发条件](#62-重新部署触发条件)
- [7. 常见问题（FAQ）](#7-常见问题faq)

***

## 1. 架构总览

| 层级       | 技术                                   | 说明                               |
| -------- | ------------------------------------ | -------------------------------- |
| 前端页面     | Astro 7 + Svelte 5                   | 静态构建，SSR 端点仅用于管理后台               |
| 认证       | JWT + HttpOnly Cookie                | 管理密码验证通过后签发，有效期可配置               |
| 写入操作     | GitHub App（JWT → Installation Token） | 服务端读取私钥 → 调 GitHub API 写入仓库      |
| 读取保护（可选） | Firefly 主题内建 frontmatter `password`  | 纯前端 AES 解密，不依赖服务端                |
| 部署平台     | Vercel                               | `GITHUB_PRIVATE_KEY` 等密钥通过环境变量注入 |

三者密钥严格分离，互不干扰：

```
┌─ 管理密码 (ADMIN_PASSWORD)  ──→ 登录验证，不接触代码/仓库
├─ JWT 签名 (ADMIN_JWT_SECRET)  ──→ Cookie 签名，会话保持
└─ GitHub App 私钥              ──→ 服务端专用，不经过浏览器
```

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

| 变量名                | 是否必填 | 说明                               |
| ------------------ | ---- | -------------------------------- |
| `ADMIN_PASSWORD`   | ✅    | **SHA256(管理密码)** 的 hex 字符串，64 位  |
| `ADMIN_JWT_SECRET` | ✅    | 32 字节以上的随机字符串，作为 Cookie JWT 签名密钥 |

### 2.3 生成命令速查

```bash
# 1. 生成 ADMIN_PASSWORD（把 'YourPassword' 换成你自己的密码）
node -e "console.log(require('crypto').createHash('sha256').update('YourPassword').digest('hex'))"
# 输出：af6fde3b87a3b3...（64 位十六进制字符串）

# 2. 生成 ADMIN_JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 输出：a1b2c3d4...（64 位十六进制字符串）

# 3. 将私钥 PEM 转为 Base64（用于 Vercel 的 GITHUB_PRIVATE_KEY）
node -e "console.log(require('fs').readFileSync('.key/emblog-ghapp.2026-07-29.private-key.pem').toString('base64'))"
```

> ⚠️ `ADMIN_PASSWORD` **不是明文密码**。如果你在 `.env.local` 中写 `ADMIN_PASSWORD=123456`，登录时即使输入 `123456` 也会失败，因为验证逻辑用 SHA256 比对。请务必使用上方第 1 条命令生成哈希值。

***

## 3. 管理后台使用

管理后台路径：`/admin/`，例如：

- 本地开发：`http://localhost:4321/admin/`
- 线上：`https://your-domain.com/admin/`

### 3.1 登录

1. 访问 `/admin/`
2. 输入**管理密码**（对应 `ADMIN_PASSWORD` 哈希的原文）
3. 按 Enter 或点击"验证并进入后台"

验证通过后：

- 服务端签发 HttpOnly Cookie `admin_session`
- `sessionStorage` 仅存 `admin_verified=true` 标记（不存任何密钥）

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

# 用生成命令算出的哈希值，不要写明文
ADMIN_PASSWORD=af6fde3b87a3b3...

# 随意写一个 32 字节随机串即可（本地开发重启后要重新登录）
ADMIN_JWT_SECRET=a1b2c3d4...
```

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
| `ADMIN_PASSWORD`         | ✅  | SHA256 hex 64 位 | `af6fde3b87a3...`        |
| `ADMIN_JWT_SECRET`       | ✅  | 随机 64 位 hex     | `a1b2c3d4...`            |

> 配置完环境变量记得 **Redeploy** 一次。

### 6.2 重新部署触发条件

- 仓库 `master` / `main` 分支有新的 push
- 在管理后台保存/删除文章（通过 GitHub API 写入 commit 间接触发）
- Vercel 控制台手动点 **Redeploy**

***

## 7. 常见问题（FAQ）

### Q1. 登录时提示"管理密码错误"，但我输入的密码是对的？

检查 `ADMIN_PASSWORD` 环境变量：

1. 是否为 **SHA256 的 hex**（64 位），而不是明文
2. 本地 `.env.local` 和 Vercel 分别核对
3. 大小写敏感，生成和输入要一致

重算命令：

```bash
node -e "console.log(require('crypto').createHash('sha256').update('你的密码').digest('hex'))"
```

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

- **HttpOnly Cookie**（JWT）：由 `ADMIN_JWT_SECRET` 签发，默认有效期可在 `auth.ts` 中配置
- **sessionStorage 标记**：仅存 `admin_verified=true`，关闭标签页即失效

若你设置的 `ADMIN_JWT_SECRET` 在开发环境没有固定值（auth.ts 会在开发环境未配置时生成临时值），**重启 dev server 后 JWT 密钥变更，旧 Cookie 会被判定无效**。解决方式：在 `.env.local` 中给 `ADMIN_JWT_SECRET` 一个固定值。

### Q7. 管理密码是否可以多人共用？

可以。`ADMIN_PASSWORD` 是站点级的同一个哈希，知道密码的人都能登录。推荐密码**强度足够长**（12 位以上，字母数字符号混合），并定期更换：

1. 生成新的 `ADMIN_PASSWORD` 哈希
2. 更新 Vercel 环境变量
3. Redeploy 生效，所有已登录会话都会失效

### Q8. GitHub App 有两个私钥，用哪个？

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

> 手册版本：v1.0 · 最后同步：2026-08-01

