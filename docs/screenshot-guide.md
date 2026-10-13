# 截图流程（Headless Chrome / Edge）

把页面或本地 HTML 渲染成 PNG，交给用户查看。适用于「需要看到界面长什么样」的对比场景（例如复刻参考项目 UI 后逐条比对）。

> 重要：生成 PNG 的能力与「看图」的能力是两回事。当前 AI 助手**无法读取图片内容**，截图只能交给人看，不要假设自己校验过渲染结果。

## 1. 找浏览器

本机已确认存在（两者都支持 `--headless=new`）：

- Chrome：`C:\Program Files\Google\Chrome\Application\chrome.exe`
- Edge：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`

探测：

```powershell
$cands = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$cands | Where-Object { Test-Path -LiteralPath $_ }
```

## 2. 约定

- 临时产物统一放 `C:\Users\HRY\AppData\Local\Temp\opencode`（外部工作目录，已批准）。
- 仓库根 `.gitignore` 已忽略 `screenshots/`，**不要把截图提交进仓库**。
- 截图是给别人看的交付物，务必把最终路径明确回复给用户。

## 3. 用法一：截网页 URL

```powershell
$t = "C:\Users\HRY\AppData\Local\Temp\opencode"
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --headless=new --disable-gpu --hide-scrollbars `
  --window-size=1440,900 `
  --user-data-dir="$t\chrome-prof" `
  --screenshot="$t\shot.png" `
  "http://localhost:4321/"
if (Test-Path "$t\shot.png") { "OK: " + (Get-Item "$t\shot.png").Length + " bytes" } else { "FAILED" }
```

截本项目后台/前台页面时，先确认 dev server 在跑：`pnpm dev`（Astro 7 在非 TTY 下会转后台守护，端口 4321），用 `netstat -ano | Select-String ":4321" | Select-String "LISTENING"` 验证。

## 4. 用法二：截本地 HTML

路径写成 `file:///` 形式的正斜杠 URL：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --headless=new --disable-gpu --hide-scrollbars `
  --window-size=1440,900 `
  --user-data-dir="$t\chrome-prof" `
  --screenshot="$t\shot.png" `
  "file:///C:/Users/HRY/AppData/Local/Temp/opencode/page.html"
```

## 5. 参数说明

| 参数 | 作用 |
|---|---|
| `--headless=new` | 新一代无头模式（`--headless` 旧式亦可，行为略有差异） |
| `--window-size=W,H` | 视口尺寸；`--screenshot` 默认按此尺寸裁切 |
| `--hide-scrollbars` | 隐藏滚动条，避免右侧多一条竖条 |
| `--user-data-dir=<独立目录>` | **必须**。否则会与用户已打开的 Chrome 抢占默认 profile 而失败 |
| `--screenshot=<绝对路径>` | 输出 PNG 的绝对路径 |

未验证（要用先自己在本地试）：

- 全页截图（内容高于视口）：未见 `--screenshot` 自带 full-page 开关，稳妥做法是把 `--window-size` 的高度给足。
- `--default-background-color=FFFFFFFF` 之类的背景色覆盖：可用性未在本机验证。

## 6. 坑

1. **PowerShell 把 Chrome 写到 stderr 的提示显示成红色 `NativeCommandError`**（例如 `N bytes written to file ...`）。这不是失败，判断成功请用 `Test-Path` + 文件大小（本仓库 git 命令的 stderr 也有同样现象）。
2. Chrome 还会打印无关日志（如 `externally_managed_app_manager`、`installwebapp` 失败），可忽略。
3. 路径含空格/中文一律加引号；调用外部程序用 `&` 调用运算符。
4. 反复截图复用一个 `--user-data-dir` 即可；若报 profile 被占用，换一个目录或杀掉残留 `chrome.exe` 无头进程。

## 7. 进阶：需要登录的页面（未验证，勿当作可用方案）

后台页面需要会话 cookie，直接截图只会得到登录页。思路（本机尚未验证，动手前先想清楚成本）：

- 用 CDP：以 `--remote-debugging-port=9222` 启动，Node 通过 WebSocket 发 `Network.setCookie` 注入会话 cookie，再 `Page.navigate` + `Page.captureScreenshot`。
- 或引入 Playwright / Puppeteer（本项目与参考项目均**未安装**，需先评估是否值得新增依赖）。

## 8. 案例：静态复刻参考项目 UI 再截图

要对比参考项目（`E:\flare-stack-blog`）的某个界面、又不想把它整套跑起来（Cloudflare D1 + 登录）时：

1. 读源码：组件（`.tsx`）+ 样式（`post-editor.css` 等）+ 主题令牌（`src/styles.css` 的 `--fuwari-*`）+ 文案（`messages/zh.json`）。
2. 写一份**自包含**的静态 HTML（内联 CSS、内联 SVG 图标，复用真实尺寸与色值），标注来源文件与「静态复刻」。
3. 用「用法二」截图。

示例产物（本次）：
`C:\Users\HRY\AppData\Local\Temp\opencode\ref-post-editor-info.html` + `.png`。
