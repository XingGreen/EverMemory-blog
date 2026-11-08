/**
 * CDP 探针：实测列显示下拉的真实行为。
 *
 * 只做观察，不改代码。输出菜单是否存在、位置、尺寸、overflow 与命中测试结果，
 * 用来定位「点了没反应 / 滚不动 / 点内部被关掉」的真因。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9333;
const ORIGIN = "http://localhost:4321";
const CHROME = resolveChrome();

/** Resolve the Chrome executable; CHROME_PATH overrides the default locations. */
function resolveChrome() {
	const candidates = [
		process.env.CHROME_PATH,
		join(process.env.PROGRAMFILES ?? "", "Google/Chrome/Application/chrome.exe"),
		join(
			process.env["PROGRAMFILES(X86)"] ?? "",
			"Google/Chrome/Application/chrome.exe",
		),
		join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
	].filter(Boolean);
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) {
		console.error("Chrome not found. Set CHROME_PATH to the executable path.");
		process.exit(0);
	}
	return found;
}

const env = readFileSync(".env.local", "utf8");
const token = env
	.split(/\r?\n/)
	.find((l) => l.startsWith("ADMIN_BREAKGLASS_TOKEN="))
	?.split("=")
	.slice(1)
	.join("=")
	.replace(/^["']|["']$/g, "");

const profile = mkdtempSync(join(tmpdir(), "probe-"));
const chrome = spawn(
	CHROME,
	[
		"--headless=new",
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${profile}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--window-size=1440,900",
		"about:blank",
	],
	{ stdio: "ignore", detached: false },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort() {
	for (let i = 0; i < 40; i++) {
		try {
			const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
			if (r.ok) return r.json();
		} catch {
			/* 还没起来 */
		}
		await sleep(300);
	}
	throw new Error("Chrome 未就绪");
}

function connect(wsUrl) {
	const ws = new WebSocket(wsUrl);
	let id = 0;
	const pending = new Map();
	ws.addEventListener("message", (ev) => {
		const msg = JSON.parse(ev.data);
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error
				? reject(new Error(JSON.stringify(msg.error)))
				: resolve(msg.result);
		}
	});
	const ready = new Promise((res, rej) => {
		ws.addEventListener("open", res);
		ws.addEventListener("error", rej);
	});
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const mid = ++id;
			pending.set(mid, { resolve, reject });
			ws.send(JSON.stringify({ id: mid, method, params }));
		});
	return { ready, send, close: () => ws.close() };
}

async function main() {
	const version = await waitPort();
	const target = await fetch(
		`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`,
		{ method: "PUT" },
	).then((r) => r.json());
	const cdp = connect(target.webSocketDebuggerUrl);
	await cdp.ready;
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("DOM.enable");
	await cdp.send("CSS.enable");

	const evalJs = async (expression) => {
		const r = await cdp.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (r.exceptionDetails) {
			return { __error: r.exceptionDetails.text ?? "eval failed" };
		}
		return r.result.value;
	};

	// 1. 回到同源页面再发登录请求，保证 cookie 落在正确域上
	await cdp.send("Page.navigate", { url: `${ORIGIN}/login/` });
	await sleep(2500);

	const login = await evalJs(`(async () => {
		const res = await fetch("/api/admin/verify/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: ${JSON.stringify(token)} }),
		});
		return { status: res.status, body: await res.text() };
	})()`);
	console.log("登录:", JSON.stringify(login).slice(0, 120));

	// 2. 进后台列表
	await cdp.send("Page.navigate", { url: `${ORIGIN}/admin/posts/` });
	await sleep(7000);

	// 关掉引导蒙层：新会话会弹出欢迎面板，蒙层会拦掉所有点击
	await evalJs(`(() => {
		const nodes = document.querySelectorAll(
			"[class*=tour], [class*=onboarding], [role=dialog]",
		);
		nodes.forEach((n) => n.remove());
		return nodes.length;
	})()`);
	await sleep(500);

	const boot = await evalJs(`(() => ({
		url: location.pathname + location.search,
		hasTrigger: !!document.querySelector(".cols-trigger"),
		triggerCount: document.querySelectorAll(".cols-trigger").length,
		host: !!document.querySelector(".admin-content"),
		zoom: getComputedStyle(document.querySelector(".admin-content") || document.body).zoom,
	}))()`);
	console.log("页面:", JSON.stringify(boot));

	if (!boot?.hasTrigger) {
		console.log("!! 找不到触发按钮，后续跳过");
		chrome.kill();
		process.exit(0);
	}

	// 3. 点一下触发按钮
	const clicked = await evalJs(`(() => {
		const btn = document.querySelector(".cols-trigger");
		btn.click();
		return { rect: btn.getBoundingClientRect().toJSON() };
	})()`);
	console.log("点击:", JSON.stringify(clicked));
	await sleep(600);

	// 4. 观察菜单
	const menu = await evalJs(`(() => {
		const el = document.querySelector(".ui-menu");
		if (!el) {
			return {
				found: false,
				allUiMenus: document.querySelectorAll(".ui-menu").length,
				bodyChildren: document.body.children.length,
			};
		}
		const cs = getComputedStyle(el);
		const r = el.getBoundingClientRect();
		return {
			found: true,
			parent: el.parentElement?.tagName,
			rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
			position: cs.position,
			top: cs.top,
			right: cs.right,
			zoom: cs.zoom,
			maxHeight: cs.maxHeight,
			overflowY: cs.overflowY,
			display: cs.display,
			visibility: cs.visibility,
			opacity: cs.opacity,
			styleAttr: el.getAttribute("style"),
			inlineVisibility: el.style.visibility || "(none)",
			parentVisibility: el.parentElement
				? getComputedStyle(el.parentElement).visibility
				: "(no parent)",
			/* 找是哪条规则把菜单藏起来的 */
			hidingRules: (() => {
				const out = [];
				for (const sheet of document.styleSheets) {
					let rules;
					try {
						rules = sheet.cssRules;
					} catch {
						continue;
					}
					for (const rule of rules) {
						if (!rule.selectorText) continue;
						if (!/opacity|visibility/.test(rule.cssText)) continue;
						let hit = false;
						try {
							hit = el.matches(rule.selectorText);
						} catch {
							hit = false;
						}
						if (hit) out.push(rule.cssText.slice(0, 180));
					}
				}
				return out;
			})(),
			items: el.querySelectorAll(".ui-menu-item").length,
			header: el.querySelector(".ui-menu-header")?.textContent?.trim(),
			/* 菜单位置是否有元素真正可见：取中心点做命中测试 */
			hit: (() => {
				const cx = r.x + r.width / 2;
				const cy = r.y + r.height / 2;
				const hit = document.elementFromPoint(cx, cy);
				return hit?.className?.toString?.().slice(0, 60) ?? null;
			})(),
		};
	})()`);
	console.log("菜单:", JSON.stringify(menu, null, 2));

	// 4b. 用 CDP 查真正命中的样式（能穿透 @media / @layer）
	if (menu?.found) {
		const doc = await cdp.send("DOM.getDocument", { depth: -1 });
		const found = await cdp.send("DOM.querySelector", {
			nodeId: doc.root.nodeId,
			selector: ".ui-menu",
		});
		if (found.nodeId) {
			const matched = await cdp.send("CSS.getMatchedStylesForNode", {
				nodeId: found.nodeId,
			});
			const interesting = [];
			for (const entry of matched.matchedCSSRules ?? []) {
				const text = entry.rule.style?.cssText ?? "";
				if (!/opacity|visibility/.test(text)) continue;
				interesting.push({
					selector: entry.rule.selectorList?.text,
					origin: entry.rule.origin,
					props: text.slice(0, 120),
				});
			}
			console.log("命中规则:", JSON.stringify(interesting, null, 2));
		}
	}

	// 5. 截图，便于直接看位置
	const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
	const { writeFileSync } = await import("node:fs");
	writeFileSync("probe-dropdown.png", Buffer.from(shot.data, "base64"));
	console.log("截图: probe-dropdown.png");

	cdp.close();
	chrome.kill();
}

main().catch((e) => {
	console.error("探针失败:", e.message);
	chrome.kill();
	process.exit(1);
});
