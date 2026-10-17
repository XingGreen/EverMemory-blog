# EverMemory 应急操作手册（平台层核按钮）

> 适用：Firefly Blog + Astro + GitHub App + **Vercel** 部署架构
> 关联计划：`docs/todo/2026-10-13.md`（后台安全管理）· CLI 待办：`docs/todo/2026-10-13-cli.md`
> 版本：v1.1 · 2026-10-17

---

## 0. 这份手册解决什么

当出现「**怀疑后台被入侵 / GitHub 账号泄露 / 进不去后台**」时，按本手册从轻到重处置。
核心判断只有一句话：

> **应用内的一切（踢会话、改配置）都存在「攻击者可能对抗」的问题；
> 真正的核按钮在应用之外——Vercel 环境变量与 Vercel Firewall。**

原因见计划 §0 威胁模型：本项目只做「**保住控制权 + 争取时间的缓冲**」。
应用层失守（会话窃取）在范围内；Vercel 平台账号失守、RCE 在范围外
（那种情况见 §6）。

**登录身份（单一）**：

| 登录方式 | 凭据 | 能力 |
| --- | --- | --- |
| GitHub OAuth（主） | 白名单里的 GitHub 账号（`ADMIN_GITHUB_ID`） | 后台全部功能 |
| 应急令牌（备用） | `ADMIN_BREAKGLASS_TOKEN` | 后台全部功能 |

没有超级密码、没有控制台页面。会话管理（查看在线设备 / 踢下线）就在后台
**设置页底部**，各相关 API 一律 `requireAuth`（已登录即可），不再分角色。

---

## 1. 处置顺序（按「你还能做什么」选择）

1. **还能进后台** → 先做 §2（应用内应急，争时间），再做 §3（平台层根治）。
2. **还能进 Vercel**（进不了后台）→ 直接做 §3。
3. **Vercel 也进不去** → §6 彻底失控清单。
4. **只是自己进不去 GitHub / 忘了应急令牌** → §5。

无论走哪条，**收尾都要做 §4 复盘**——尤其是清除运行时配置覆盖，
轮换密钥不会回滚它。

---

## 2. 应用内应急（第一层：争时间）

> 前提：你还能登录后台（GitHub OAuth 或应急令牌）。

1. 访问 `/admin/` 登录。
2. **踢会话**：设置页底部「会话管理」→「踢掉其他设备」。
   - 这会注销除当前外**全部**会话（含其他设备）。
   - 若已知攻击者来源，也可逐条「踢下线」。
3. **运行时配置**：若怀疑站点行为被篡改（友链/公告/站点信息），
   在「站点配置」里逐项**清除覆盖**，回落到源码默认值。

⚠️ 应用内的动作都写在 KV 上，**假设攻击者若持有会话就可能对抗**。
因此做完这些，仍必须执行 §3。

---

## 3. 平台层核按钮（第二层：根治，攻击者够不着）

全部在 **Vercel 项目 Settings → Environment Variables** 完成。
**关键：改完环境变量必须 Redeploy 才生效**——Vercel 的环境变量变更只作用于
新部署，已运行的部署仍读旧值。忘了 redeploy 是最常见的失误。

### 3.1 轮换 JWT 密钥 → 所有旧会话立即失效

```
环境变量 ADMIN_JWT_SECRET = <新随机值>
```

生成新值（本地 Node）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

效果：所有已签发 Cookie 验签失败，**即时全踢**。因为验签先于一切，
哪怕 KV 会话表被同时篡改也无效。

### 3.2 撤销 GitHub 授权 / 更换白名单账号

怀疑 GitHub 账号本身被入侵，或想直接收回后台入口：

```
环境变量 ADMIN_GITHUB_ID = <新的账号数字 id>   # 换成别的账号即把原账号踢出白名单
```

- 更根本的是去 **GitHub 侧**处置：改密码、移除可疑 2FA / SSH key、
  GitHub Settings → Applications → 撤销对本 App 的授权。
- 若不再想用 GitHub 登录，可只留应急令牌：清空 `ADMIN_GITHUB_ID` 后
  登录页就不再提供 GitHub 按钮（前端会按服务端返回的能力开关渲染）。

> 改 `ADMIN_GITHUB_ID` 保存后 `ADMIN_TOKEN_VER` +1，**所有旧会话立即失效**。

### 3.3 轮换应急令牌

```
环境变量 ADMIN_BREAKGLASS_TOKEN = <新的高熵随机串>
```

生成命令：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

轮换后旧令牌立即失效。若怀疑令牌泄露，也可临时删除该变量（即关闭应急入口）。

### 3.4 封 IP（不占应用 KV）

用 **Vercel Firewall**（需付费计划）在边缘直接拒绝来源 IP。
相比应用内 KV 黑名单，攻击者**解不了**它。

### 3.5 让更改生效

Vercel Dashboard：**Deployments → 最新一次 → ⋯ → Redeploy**。
（或在 CLI 用 `vercel --force` 清 build cache 后重部署。）

---

## 4. 收尾复盘（必做）

1. **清除运行时配置覆盖**：攻击者若改过 runtime-config，轮换密钥**不会**回滚。
   走后台上「站点配置」逐项「清除覆盖」，或 CLI（§7）。
2. **核对审计日志**：服务端 `writeAuditLog` 输出形如
   `time | event | client= | user= | detail=`，关注
   `login_success` / `login_failure` / `session_revoked` /
   `sessions_listed` / `secrets_credentials_updated` / `secrets_exported` 等事件。
   - Vercel：**Deployment → Function Logs**；本地：dev server 终端。
3. **确认无残留会话**：`ADMIN_JWT_SECRET` 已轮换即等价全踢；如需清 KV 表，
   见 §7。
4. **轮换 GitHub App 私钥**（若怀疑仓库写入被滥用）：GitHub App Settings →
   生成新私钥 → 更新 `GITHUB_PRIVATE_KEY` → 删除旧私钥。
5. **检查运行时/站点内容**：有无被注入的友链、公告、跳转脚本等。

---

## 5. 进不去后台的恢复

| 情况 | 恢复方式 |
| --- | --- |
| 忘了应急令牌，但 GitHub 还能登录 | 用 GitHub 登录后，在「密钥配置」页查看/重设 `ADMIN_BREAKGLASS_TOKEN`（本地开发可写；线上改平台 env 后 redeploy） |
| GitHub 账号进不去（被锁/被盗），但有应急令牌 | 用应急令牌登录 → 更新 `ADMIN_GITHUB_ID` 为新账号 |
| 两者都进不去 | 在 Vercel 配置一条 `ADMIN_BREAKGLASS_TOKEN`（`node -e` 生成）→ redeploy → 用令牌登录 |

**不需要**清空 KV、**不需要**改代码。

---

## 6. 彻底失控（Vercel 账号也失守）

这已超出「应用层」防护范围，按「止损 + 交接」处理：

1. 撤销 GitHub App 的安装与私钥（切断对仓库的写入）。
2. **删除 Vercel 项目**（或轮换 Vercel 账号密码 + 撤销 API Token + 开启 2FA）。
3. 轮换所有第三方凭据（GitHub、KV/Upstash、Turnstile、告警 Webhook）。
4. 从 git 历史重建部署（新项目、新 env）。
5. 复盘入口：本手册 §4。

---

## 7. 本地 CLI 兜底（可选，见 `docs/todo/2026-10-13-cli.md`）

Vercel 上没有服务器终端，本机 **Vercel CLI + 本地脚本**是唯一的**带外核按钮通道**。

前置：

```bash
vercel link                # 或设 VERCEL_TOKEN + --scope
vercel env pull .env.local # 取 KV 凭据（KV_REST_API_URL / KV_REST_API_TOKEN）
```

计划中的命令（**尚未实现**，见 CLI 待办清单）：

- `admin:rotate-jwt`：生成新 `ADMIN_JWT_SECRET` → `vercel env add … production --force --yes` → `vercel --force`
- `admin:rotate-breakglass`：生成新 `ADMIN_BREAKGLASS_TOKEN` → 上传 → 重部署
- `admin:token-version-bump`：`ADMIN_TOKEN_VER` +1（等价全踢）
- `admin:sessions` / `admin:revoke <sid>` / `admin:revoke-all`

**坑**（摘自 CLI 待办）：

- 改 env 必须重新部署才生效；用 `vercel --force` 清 build cache。
- Secret 变量 **write-only**，保存后不可回读。
- 敏感值走 stdin 管道，不要放进命令行参数。
- CLI 只能改 env，**不能改 KV**；清 KV 用 Upstash 控制台/API 或 `vercel env pull` 后跑脚本。

---

## 8. 环境变量速查

| 变量 | 作用 | 应急动作 |
| --- | --- | --- |
| `ADMIN_JWT_SECRET` | 会话 Cookie 签名 | **轮换 = 全踢**（最根本） |
| `ADMIN_GITHUB_ID` | 后台登录白名单账号数字 id | 换/清空 = 收回 GitHub 登录入口，并使旧会话失效 |
| `ADMIN_BREAKGLASS_TOKEN` | 应急登录令牌 | 轮换 = 旧令牌作废；删除 = 关闭应急入口 |
| `ADMIN_TOKEN_VER` | 会话撤销版本号 | +1 = 使旧会话失效 |
| `ADMIN_ALERT_WEBHOOK` | 登录成功带外告警 URL（Slack/Discord/邮件网关） | 配置后攻击者一登录即知 |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | KV 存储（会话表 / 运行时覆盖） | 换 = 需同步清 KV |

**强烈建议**：配置 `ADMIN_ALERT_WEBHOOK`。攻击者登录成功的**那一刻**
你就能收到通知——这是唯一「攻击者够不着」的告警通道。

---

> 本手册随认证设计变动更新。改动认证/会话/控制面逻辑时，请同步核对本文件。
