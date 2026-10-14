# EverMemory 应急操作手册（平台层核按钮）

> 适用：Firefly Blog + Astro + GitHub App + **Vercel** 部署架构
> 关联计划：`docs/todo/2026-10-13.md`（后台安全管理）· CLI 待办：`docs/todo/2026-10-13-cli.md`
> 版本：v1.0 · 2026-10-14

---

## 0. 这份手册解决什么

当出现「**怀疑后台被入侵 / 密码泄露 / 进不去后台**」时，按本手册从轻到重处置。
核心判断只有一句话：

> **应用内的一切（踢会话、封 IP、改配置）都存在「攻击者可能对抗」的问题；
> 真正的核按钮在应用之外——Vercel 环境变量与 Vercel Firewall。**

原因见计划 §0 威胁模型：本项目只做「**保住控制权 + 争取时间的缓冲**」。
应用层失守（撞库、会话窃取）在范围内；Vercel 平台账号失守、RCE 在范围外
（那种情况见 §6）。

**两个空间（角色）**：

| 空间 | 进入方式 | 能力 |
| --- | --- | --- |
| 主空间 `admin` | 主密码（`ADMIN_PASSWORD`） | 写文章、看会话列表、密钥配置 |
| 第二空间 `super` | 第二密码（`ADMIN_SUPER_PASSWORD`） | 主空间能力 **+ 控制面**（踢会话 / 封 IP / 改运行时配置） |

控制面 = 访达 `/admin/console/`（**应急控制台**），仅 super 会话可达；
各控制面 API 亦在服务端按 role 校验（前端隐藏只是 UX）。

---

## 1. 处置顺序（按「你还能做什么」选择）

1. **还能进后台** → 先做 §2（应用内应急，争时间），再做 §3（平台层根治）。
2. **还能进 Vercel**（进不了后台）→ 直接做 §3。
3. **Vercel 也进不去** → §6 彻底失控清单。
4. **只是自己忘了密码** → §5。

无论走哪条，**收尾都要做 §4 复盘**——尤其是清除运行时配置覆盖，
轮换密钥不会回滚它。

---

## 2. 应用内应急（第一层：争时间）

> 前提：你还能用**第二密码**登录。若只能用主密码，先去 Vercel 配置
> `ADMIN_SUPER_PASSWORD` 并 redeploy（§3），或走 §3 直接掀桌子。

1. 访问 `/admin/`，用**主密码**或**第二密码**登录。
   - 用第二密码（super）会直接进入 `/admin/console/`。
2. **踢会话**：应急控制台 →「活跃会话」→「踢其他全部」。
   - 这会注销除当前外**全部**会话（含其他设备、含 super 会话）。
   - 若已知攻击者来源，也可逐条「踢下线」。
3. **封 IP**：应急控制台 →「IP 黑名单」→ 填 IP + 原因 →「封禁并踢会话」。
   - 封禁会**同时**踢掉该 IP 的现有会话（只挡新登录挡不住已登录者，故二者一体）。
   - 有效期留空 = 永久。
4. **运行时配置**：若怀疑站点行为被篡改（友链/公告/站点信息），
   在「运行时配置」里逐项**清除覆盖**，回落到源码默认值。

⚠️ 应用内的动作都写在 KV 上，**假设攻击者若持有控制面会话就可能对抗**。
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

### 3.2 重设主密码 → 泄露的密码作废

```
环境变量 ADMIN_PASSWORD = <新的 scrypt 哈希>
```

生成哈希（把 `你的密码` 换成新密码；N=131072 耗时约 1 秒属正常）：

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16);const h=c.scryptSync('你的密码',s,64,{N:131072,maxmem:268435456});console.log('scrypt$131072$'+s.toString('base64')+'$'+h.toString('base64'))"
```

> 也接受直接填明文，保存后由后台/CLI 自动哈希；但生产 env 建议直接填哈希。

### 3.3 重设第二密码

```
环境变量 ADMIN_SUPER_PASSWORD = <新的 scrypt 哈希>   # 生成命令同 3.2
```

第二密码**只能**在此处（平台 env）或本地 `.env.local` 修改，**不开放 Web 修改**。

### 3.4 封 IP（不占应用 KV）

用 **Vercel Firewall**（需付费计划）在边缘直接拒绝来源 IP。
相比应用内 KV 黑名单，攻击者**解不了**它。

### 3.5 让更改生效

Vercel Dashboard：**Deployments → 最新一次 → ⋯ → Redeploy**。
（或在 CLI 用 `vercel --force` 清 build cache 后重部署。）

---

## 4. 收尾复盘（必做）

1. **清除运行时配置覆盖**：攻击者若改过 runtime-config，轮换密钥**不会**回滚。
   走应急控制台「运行时配置 → 清除覆盖」，或 CLI（§7）。
2. **核对审计日志**：服务端 `writeAuditLog` 输出形如
   `time | event | client= | user= | detail=`，关注
   `login_success` / `login_failure` / `login_locked` / `ip_banned` /
   `secrets_credentials_updated` 等事件。
   - Vercel：**Deployment → Function Logs**；本地：dev server 终端。
3. **确认无残留会话**：`ADMIN_JWT_SECRET` 已轮换即等价全踢；如需清 KV 表，
   见 §7。
4. **轮换 GitHub App 私钥**（若怀疑仓库写入被滥用）：GitHub App Settings →
   生成新私钥 → 更新 `GITHUB_PRIVATE_KEY` → 删除旧私钥。
5. **检查运行时/站点内容**：有无被注入的友链、公告、跳转脚本等。

---

## 5. 忘记密码的恢复

| 忘记 | 恢复方式 |
| --- | --- |
| 主密码 | 本地/CI 生成新哈希 → 更新 `ADMIN_PASSWORD` → redeploy |
| 第二密码 | 生成新哈希 → 更新 `ADMIN_SUPER_PASSWORD` → redeploy |
| 两者都忘 | 同上下两行，分别重设即可（均只改平台 env） |

生成命令见 §3.2。**不需要**清空 KV、**不需要**改代码。

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
- `admin:set-password`：本地 `hashAdminPassword()` 生成哈希 → 上传 → 重部署
- `admin:token-version-bump`：`ADMIN_TOKEN_VER` +1（等价全踢）
- `admin:sessions` / `admin:revoke <sid>` / `admin:revoke-all`
- `admin:ban <ip>` / `admin:unban <ip>`

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
| `ADMIN_PASSWORD` | 主空间登录密码（scrypt 哈希） | 重设 = 泄露密码作废 |
| `ADMIN_SUPER_PASSWORD` | 第二空间（控制面）密码（scrypt 哈希） | 重设 = 收回控制面 |
| `ADMIN_TOKEN_VER` | 会话撤销版本号 | +1 = 使旧会话失效 |
| `ADMIN_ALERT_WEBHOOK` | 登录成功带外告警 URL（Slack/Discord/邮件网关） | 配置后攻击者一登录即知 |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | KV 存储（会话表 / 封禁表 / 运行时覆盖） | 换 = 需同步清 KV |

**强烈建议**：配置 `ADMIN_ALERT_WEBHOOK`。攻击者登录成功的**那一刻**
你就能收到通知——这是唯一「攻击者够不着」的告警通道。

---

> 本手册随认证设计变动更新。改动认证/会话/控制面逻辑时，请同步核对本文件。
