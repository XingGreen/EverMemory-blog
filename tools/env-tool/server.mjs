/**
 * 环境变量填写工具 · 本地服务
 *
 * 目的只有一个：让「还没配好密钥」的人能改 .env.local。
 * 后台的 /admin/env/ 在登录态之后，而登录本身就需要这些密钥，形成死锁。
 *
 * 约束：
 * - 只监听 127.0.0.1，不返回任何 CORS 头，拒绝跨源 POST / GET。
 * - 只写白名单里的键，保留原文件的注释、顺序与换行符。
 * - 不引入依赖，只用 node 内置模块；不读 .git 以外的任何项目文件。
 *
 * 用法：node tools/env-tool/server.mjs   （或用同目录的 start.bat）
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const TARGET = process.env.ENV_TOOL_TARGET || path.join(ROOT, ".env.local");
const HOST = "127.0.0.1";
const PORT_START = Number(process.env.ENV_TOOL_PORT || 8788);

/** 与 src/utils/admin-secrets.ts 保持同一份清单（key / 文案 / 必填） */
const GROUPS = [
	{
		id: "github",
		title: "GitHub App 凭据",
		sub: "写入仓库",
		hint: "都在 GitHub 的 App 设置页",
	},
	{
		id: "auth",
		title: "管理员认证",
		sub: "后台登录",
		hint: "OAuth 凭据在同一个 App 页面，用户 ID 来自你的 GitHub 账号",
	},
	{
		id: "turnstile",
		title: "人机验证",
		sub: "可选",
		hint: "在 Cloudflare 的 Turnstile 里创建站点后填写",
	},
];

const FIELDS = [
	{ key: "GITHUB_OWNER", group: "github", label: "仓库所有者", hint: "用户或组织名，不带 @", required: true, example: "XingGreen", address: true },
	{ key: "GITHUB_REPO", group: "github", label: "仓库名称", hint: "不带 .git 后缀", required: true, example: "EverMemory-blog", address: true },
	{ key: "GITHUB_BRANCH", group: "github", label: "仓库分支", hint: "通常是 master 或 main", required: true, example: "master", address: true },
	{ key: "GITHUB_APP_ID", group: "github", label: "App ID", hint: "App 设置页顶部的数字", required: true, example: "4423412" },
	{ key: "GITHUB_INSTALLATION_ID", group: "github", label: "安装 ID", hint: "把 App 装到账号后可以自动获取", required: true, example: "149804847", probe: true },
	{ key: "GITHUB_PRIVATE_KEY", group: "github", label: "App 私钥", hint: "下载 .pem 后整段粘贴，保存时会转成单行", required: true, multiline: true },
	{ key: "GITHUB_PRIVATE_KEY_PATH", group: "github", label: "私钥文件路径", hint: "可选。不填则用上面粘贴的私钥", required: false, example: ".key/blog.pem" },
	{ key: "GITHUB_APP_CLIENT_ID", group: "auth", label: "OAuth Client ID", hint: "同一个 App 页面里的 Client ID", required: true, example: "Iv23li…" },
	{ key: "GITHUB_APP_CLIENT_SECRET", group: "auth", label: "OAuth Client Secret", hint: "点 Generate 生成，只显示一次", required: true, secret: true },
	{ key: "ADMIN_GITHUB_ID", group: "auth", label: "管理员 GitHub 用户 ID", hint: "打开 api.github.com/user，取返回里的 id", required: true, example: "238927366" },
	{ key: "ADMIN_BREAKGLASS_TOKEN", group: "auth", label: "应急登录令牌", hint: "一般留空，GitHub 登不上时才用", required: false, secret: true },
	{ key: "ADMIN_JWT_SECRET", group: "auth", label: "会话签名", hint: "不用手填，点「生成」即可", required: true, secret: true, generate: true },
	{ key: "ADMIN_ALERT_WEBHOOK", group: "auth", label: "登录告警 Webhook", hint: "可选，留空则不发送", required: false, example: "https://…" },
	{ key: "TURNSTILE_SITE_KEY", group: "turnstile", label: "Turnstile Site Key", hint: "Cloudflare → Turnstile → 站点", required: false },
	{ key: "TURNSTILE_SECRET_KEY", group: "turnstile", label: "Turnstile Secret Key", hint: "和 Site Key 一起填，只填一个登录会被拒", required: false, secret: true },
];

const ALLOWED = new Set(FIELDS.map((f) => f.key));

/* ── .env 读写：保留注释与顺序 ── */

function parseEnv(text) {
	const map = {};
	for (const line of text.split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
		if (!m) continue;
		let value = m[2];
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		map[m[1]] = value;
	}
	return map;
}

function applyEnv(text, updates) {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const seen = new Set();

	const next = lines.map((line) => {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
		if (!m || !(m[1] in updates)) return line;
		const key = m[1];
		seen.add(key);
		const value = updates[key];
		// 原行有引号就继续用引号，别让保存动作悄悄改变风格
		const quoted = /^\s*[A-Z0-9_]+\s*=\s*"/.test(line);
		return `${key}=${quoted ? `"${value.replace(/"/g, '\\"')}"` : value}`;
	});

	for (const [key, value] of Object.entries(updates)) {
		if (!seen.has(key) && value !== "") next.push(`${key}=${value}`);
	}
	return next.join(eol);
}

/* ── GitHub 探测：App 是否有效、装在哪几个账号 ── */

function base64url(buf) {
	return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signJwt(appId, privateKey) {
	const now = Math.floor(Date.now() / 1000);
	const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
	const data = `${header}.${payload}`;
	const signer = crypto.createSign("RSA-SHA256");
	signer.update(data);
	return `${data}.${base64url(signer.sign(privateKey))}`;
}

/**
 * 把私钥还原成可用的 PEM。三种存法都要认：
 * 1. 直接粘贴 PEM（可能被压成一行）
 * 2. PEM 再套一层 Base64 —— 后台保存时就是这么写的
 * 3. 只有裸密钥体
 */
function formatPem(text) {
	const m = text.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
	if (!m) return "";
	const body = m[2].replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? "";
	return `-----BEGIN ${m[1]}-----\n${body}\n-----END ${m[1]}-----`;
}

function toPems(raw) {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	const compact = trimmed.replace(/\s+/g, "");

	const candidates = [];
	for (const source of [trimmed, compact]) {
		const pem = formatPem(source);
		if (pem && !candidates.includes(pem)) candidates.push(pem);
	}
	try {
		const decoded = Buffer.from(compact, "base64").toString("utf8");
		const pem = formatPem(decoded);
		if (pem && !candidates.includes(pem)) candidates.push(pem);
	} catch {
		/* 不是 Base64 就跳过 */
	}

	if (candidates.length === 0) {
		const body = compact.match(/.{1,64}/g)?.join("\n") ?? "";
		candidates.push(
			`-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`,
			`-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`,
		);
	}
	return candidates;
}

async function githubProbe(values) {
	const appId = (values.GITHUB_APP_ID || "").trim();
	const rawKey = (values.GITHUB_PRIVATE_KEY || "").trim();
	if (!appId || !rawKey) {
		return { ok: false, message: "先填 App ID 与私钥，才能向 GitHub 验证", candidates: [] };
	}

	let jwt = "";
	for (const pem of toPems(rawKey)) {
		try {
			jwt = signJwt(appId, pem);
			break;
		} catch {
			/* 换下一个头继续试 */
		}
	}
	if (!jwt) {
		return { ok: false, message: "私钥读不出来：确认粘贴的是完整的 .pem 内容", candidates: [] };
	}

	const headers = {
		Accept: "application/vnd.github+json",
		"User-Agent": "env-tool",
		Authorization: `Bearer ${jwt}`,
	};
	const timeout = AbortSignal.timeout(8000);
	try {
		const appRes = await fetch("https://api.github.com/app", { headers, signal: timeout });
		if (!appRes.ok) {
			return { ok: false, message: `App 身份未通过（GitHub 返回 ${appRes.status}），检查 App ID 与私钥是否配对`, candidates: [] };
		}
		const app = await appRes.json();
		const listRes = await fetch("https://api.github.com/app/installations", { headers, signal: timeout });
		if (!listRes.ok) {
			return { ok: true, app: app.slug, message: `App 有效，但取安装列表失败（${listRes.status}）`, candidates: [] };
		}
		const list = await listRes.json();
		const candidates = list
			.filter((it) => it.id != null)
			.slice(0, 5)
			.map((it) => ({ id: String(it.id), account: it.account?.login || "未知账号" }));
		return {
			ok: true,
			app: app.slug,
			message: candidates.length > 0 ? `App 有效，已安装到 ${candidates.length} 个账号` : "App 有效，但还没安装到任何账号",
			candidates,
		};
	} catch (error) {
		return { ok: false, message: `连不上 GitHub：${error.message}`, candidates: [] };
	}
}

/* ── 本地 git ── */

async function detectRepo() {
	try {
		const config = await readFile(path.join(ROOT, ".git", "config"), "utf8");
		const head = await readFile(path.join(ROOT, ".git", "HEAD"), "utf8");
		const block = config.match(/\[remote "origin"\]([\s\S]*?)(?=\n\s*\[|$)/);
		const url = block?.[1].match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim() ?? "";
		const cleaned = url.replace(/\.git$/i, "");
		const scp = cleaned.match(/^[\w.-]+@[^:]+:(.+)$/);
		const pathname = scp ? scp[1] : (() => {
			try {
				return new URL(cleaned).pathname;
			} catch {
				return "";
			}
		})();
		const parts = pathname.split("/").filter(Boolean);
		const branch = head.trim().match(/^ref:\s*refs\/heads\/(.+)$/)?.[1] ?? "";
		if (parts.length < 2 || !branch) return null;
		return { owner: parts[parts.length - 2], repo: parts[parts.length - 1], branch };
	} catch {
		return null;
	}
}

/* ── HTTP ── */

function json(res, body, status = 200) {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
	res.end(JSON.stringify(body));
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
			if (raw.length > 512 * 1024) reject(new Error("请求体过大"));
		});
		req.on("end", () => {
			try {
				resolve(raw ? JSON.parse(raw) : {});
			} catch {
				reject(new Error("请求体不是 JSON"));
			}
		});
		req.on("error", reject);
	});
}

function sameOrigin(req) {
	const origin = req.headers.origin;
	if (!origin) return true; // 同源导航不带 Origin
	try {
		const host = new URL(origin).hostname;
		return host === "127.0.0.1" || host === "localhost";
	} catch {
		return false;
	}
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://${HOST}`);

	if (!sameOrigin(req)) {
		json(res, { ok: false, message: "只接受本机来源的请求" }, 403);
		return;
	}

	try {
		if (url.pathname === "/" || url.pathname === "/index.html") {
			const html = await readFile(new URL("./index.html", import.meta.url));
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
			res.end(html);
			return;
		}

		// 直接复用主项目的控件样式，避免出现「第二套输入框」
		if (url.pathname === "/assets/ui-base.css") {
			const css = await readFile(path.join(ROOT, "src", "styles", "ui-base.css"));
			res.writeHead(200, {
				"Content-Type": "text/css; charset=utf-8",
				"Cache-Control": "no-store",
			});
			res.end(css);
			return;
		}

		if (url.pathname === "/api/state") {
			let text = "";
			try {
				text = await readFile(TARGET, "utf8");
			} catch {
				/* 文件不存在 = 全新开始，值全空 */
			}
			const values = parseEnv(text);
			json(res, { ok: true, target: TARGET, exists: text.length > 0, values });
			return;
		}

		if (url.pathname === "/api/write" && req.method === "POST") {
			const body = await readBody(req);
			const updates = {};
			for (const [key, value] of Object.entries(body.values || {})) {
				if (!ALLOWED.has(key)) continue;
				updates[key] = String(value ?? "").replace(/\r?\n/g, "\n");
			}
			// 私钥统一压成单行，与后台保存行为一致
			if (updates.GITHUB_PRIVATE_KEY) {
				updates.GITHUB_PRIVATE_KEY = updates.GITHUB_PRIVATE_KEY.replace(/\s+/g, "");
			}
			let text = "";
			try {
				text = await readFile(TARGET, "utf8");
			} catch {
				/* 新文件 */
			}
			await writeFile(TARGET, applyEnv(text, updates), "utf8");
			json(res, { ok: true, saved: Object.keys(updates).length });
			return;
		}

		if (url.pathname === "/api/discover") {
			json(res, { ok: true, repo: await detectRepo() });
			return;
		}

		if (url.pathname === "/api/probe") {
			let text = "";
			try {
				text = await readFile(TARGET, "utf8");
			} catch {
				/* 没有文件就按空值处理 */
			}
			json(res, await githubProbe(parseEnv(text)));
			return;
		}

		json(res, { ok: false, message: "没有这个地址" }, 404);
	} catch (error) {
		json(res, { ok: false, message: error.message }, 500);
	}
});

server.on("error", (error) => {
	if (error.code === "EADDRINUSE") {
		console.error(`端口 ${PORT_START} 被占用，换一个：set ENV_TOOL_PORT=8790 && node tools/env-tool/server.mjs`);
	} else {
		console.error(error.message);
	}
	process.exit(1);
});

server.listen(PORT_START, HOST, () => {
	const url = `http://${HOST}:${PORT_START}/`;
	console.log(`环境变量工具已启动：${url}`);
	console.log(`写入目标：${TARGET}`);
	console.log("关闭窗口即停止。");
	openBrowser(url);
});

/** 起服务再开浏览器，避免浏览器先到一步看到「拒绝连接」 */
function openBrowser(url) {
	if (process.env.ENV_TOOL_NO_OPEN) return;
	const cmd =
		process.platform === "win32"
			? ["cmd", ["/c", "start", "", url]]
			: process.platform === "darwin"
				? ["open", [url]]
				: ["xdg-open", [url]];
	try {
		const child = spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true });
		child.unref();
	} catch {
		console.log(`请手动打开：${url}`);
	}
}
