# Screenshot Guide (headless Chrome / Edge)

Render a page or a local HTML file to PNG so a human can inspect the result. Used when the
visual outcome matters — for example when reproducing a reference UI and comparing it item
by item.

> Note: generating a PNG and reading an image are different capabilities. Screenshots are
> deliverables for human review; do not assume the rendering has been verified by the agent.

## 1. Locate a browser

Chrome and Edge both support `--headless=new`. Do not hardcode install paths; resolve them
at run time:

```powershell
$cands = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $cands | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chrome) { throw "No Chrome or Edge found. Set CHROME_PATH." }
```

Set `CHROME_PATH` to point at a specific binary when needed.

## 2. Conventions

- Write temporary artifacts to a scratch directory outside the repository, for example
  `Join-Path $env:TEMP "blog-screenshots"`.
- `screenshots/` is gitignored. Never commit screenshots.
- Report the final path to the user; the image is a deliverable.

## 3. Capture a URL

```powershell
$t = Join-Path $env:TEMP "blog-screenshots"
New-Item -ItemType Directory -Force -Path $t | Out-Null
& $chrome `
  --headless=new --disable-gpu --hide-scrollbars `
  --window-size=1440,900 `
  --user-data-dir="$t\profile" `
  --screenshot="$t\shot.png" `
  "http://localhost:4321/"
if (Test-Path "$t\shot.png") { "OK: " + (Get-Item "$t\shot.png").Length + " bytes" } else { "FAILED" }
```

Confirm the dev server is running first with `pnpm dev`, and that port 4321 is listening.

## 4. Capture a local HTML file

Use a `file:///` URL with forward slashes:

```powershell
& $chrome --headless=new --disable-gpu --hide-scrollbars `
  --window-size=1440,900 --user-data-dir="$t\profile" `
  --screenshot="$t\shot.png" `
  "file:///$(($t -replace '\\','/'))/page.html"
```

## 5. Flags

| Flag | Effect |
| :--- | :--- |
| `--headless=new` | New headless mode |
| `--window-size=W,H` | Viewport; `--screenshot` crops to it |
| `--hide-scrollbars` | Avoids a scrollbar strip on the right |
| `--user-data-dir=<dir>` | Required; otherwise it fights the already-running browser profile |
| `--screenshot=<path>` | Output PNG path |

Unverified here: true full-page capture (give `--window-size` enough height instead) and
`--default-background-color`.

## 6. Pitfalls

1. Chrome writes progress lines to stderr, which PowerShell renders as a red
   `NativeCommandError`. It is not a failure — verify with `Test-Path` and the file size.
2. Ignore unrelated Chrome log lines.
3. Quote paths containing spaces or non-ASCII characters; invoke with `&`.
4. Reuse one `--user-data-dir`. If it is locked, use another directory or kill the stale
   headless process.

## 7. Pages behind login (unverified)

Admin pages need a session cookie, so a plain screenshot only captures the login screen. A
CDP approach (`--remote-debugging-port`, inject the cookie, `Page.captureScreenshot`) is
possible but has not been verified here. Playwright and Puppeteer are not installed.

## 8. Reproducing a reference UI for comparison

To compare against a reference project without running it end to end:

1. Read the reference source: components, styles, theme tokens, and copy.
2. Write a self-contained static HTML file (inline CSS and SVG, real dimensions and colors)
   and label it as a static reproduction.
3. Capture it with the method in section 4.
