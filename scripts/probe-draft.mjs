/**
 * CDP 探针：检查编辑页打开时是否误弹「恢复未保存修改」。
 *
 * 步骤：登录 → 打开编辑页 → 读一次状态 → 写入一份与正文一致的草稿 → 刷新 → 再读一次。
 * 第二次若仍弹窗，说明脏检查被序列化差异绕过。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9334;
const ORIGIN = "http://localhost:4321";
const CHROME = resolveChrome();
const SLUG = process.argv[2] ?? "demo";

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

const profile = mkdtempSync(join(tmpdir(), "probe-draft-"));
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
	{ stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort() {
	for (let i = 0; i < 40; i++) {
		try {
			const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
			if (r.ok) return;
		} catch {
			/* 未就绪 */
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
	await waitPort();
	const target = await fetch(
		`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`,
		{ method: "PUT" },
	).then((r) => r.json());
	const cdp = connect(target.webSocketDebuggerUrl);
	await cdp.ready;
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");

	const evalJs = async (expression) => {
		const r = await cdp.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		return r.exceptionDetails
			? { __error: r.exceptionDetails.text }
			: r.result.value;
	};

	await cdp.send("Page.navigate", { url: `${ORIGIN}/login/` });
	await sleep(2500);
	const login = await evalJs(`(async () => {
		const res = await fetch("/api/admin/verify/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: ${JSON.stringify(token)} }),
		});
		return res.status;
	})()`);
	console.log("登录:", login);

	await cdp.send("Page.navigate", {
		url: `${ORIGIN}/admin/posts/edit/${SLUG}/`,
	});
	await sleep(8000);

	const first = await evalJs(`(() => {
		const key = "admin-post-draft-edit-${SLUG}";
		const raw = localStorage.getItem(key);
		let draft = null;
		try {
			draft = raw ? JSON.parse(raw) : null;
		} catch {
			draft = null;
		}
		return {
			hasDraft: !!raw,
			draftTitleLen: draft?.title?.length ?? 0,
			draftContentLen: draft?.content?.length ?? 0,
			dialogOpen: !!document.querySelector(".modal-overlay"),
			dialogTitle:
				document.querySelector(".modal-overlay h2, .modal-overlay h3")
					?.textContent?.trim() ?? null,
			editorReady: !!document.querySelector(".editor-shell"),
		};
	})()`);
	console.log("首次进入:", JSON.stringify(first));

	const seeded = await evalJs(`(() => {
		const key = "admin-post-draft-edit-${SLUG}";
		const ta = document.querySelector(".content-editor");
		const titleInput = document.querySelector(".editor-header input");
		const payload = {
			title: titleInput ? titleInput.value : "",
			content:
				(ta ? ta.value : "") + String.fromCharCode(10, 10) + "<!-- probe-recovered -->",
			description: "",
			savedAt: Date.now(),
			device: "Probe",
		};
		localStorage.setItem(key, JSON.stringify(payload));
		return {
			contentLen: payload.content.length,
			titleLen: payload.title.length,
		};
	})()`);
	console.log("写入同内容草稿:", JSON.stringify(seeded));

	await cdp.send("Page.reload");
	await sleep(7000);

	const second = await evalJs(`(() => {
		const dialog = document.querySelector(".modal-overlay");
		return {
			dialogOpen: !!dialog,
			dialogTitle: dialog?.querySelector("h2, h3")?.textContent?.trim() ?? null,
			dialogBody:
				dialog?.querySelector("p")?.textContent?.trim()?.slice(0, 90) ?? null,
		};
	})()`);
	console.log("刷新后:", JSON.stringify(second));

	/* 点「恢复」后检查本地草稿是否落盘：这是「恢复后退出即回退」的核心 */
	const afterRestore = await evalJs(`(async () => {
		const dialog = document.querySelector(".modal-overlay");
		if (!dialog) return { noDialog: true };
		const buttons = [...dialog.querySelectorAll("button")];
		const take = buttons.find((b) => /恢复/.test(b.textContent || ""));
		if (!take) {
			return {
				noButton: true,
				labels: buttons.map((b) => b.textContent?.trim()),
			};
		}
		take.click();
		await new Promise((r) => setTimeout(r, 1500));
		const key = "admin-post-draft-edit-${SLUG}";
		const raw = localStorage.getItem(key);
		let draft = null;
		try {
			draft = raw ? JSON.parse(raw) : null;
		} catch {
			draft = null;
		}
		return {
			dialogClosed: !document.querySelector(".modal-overlay"),
			localDraftSaved: !!raw,
			hasMarker: !!draft?.content?.includes("probe-recovered"),
			contentLen: draft?.content?.length ?? 0,
			savedAt: draft?.savedAt ?? null,
		};
	})()`);
	console.log("点击恢复后:", JSON.stringify(afterRestore));

	/* 恢复后再刷新：restored 标记应让草稿直接套用，不再弹窗 */
	await cdp.send("Page.reload");
	await sleep(6000);
	const third = await evalJs(`(() => {
		const dialog = document.querySelector(".modal-overlay");
		const ta = document.querySelector(".content-editor");
		return {
			dialogOpen: !!dialog,
			dialogTitle: dialog?.querySelector("h2")?.textContent?.trim() ?? null,
			editorHasMarker: (ta?.value ?? "").includes("probe-recovered"),
			editorLen: ta?.value?.length ?? 0,
		};
	})()`);
	console.log("恢复后再刷新:", JSON.stringify(third));

	/* 再打开一次：确认标记在多轮之后仍然生效 */
	await cdp.send("Page.reload");
	await sleep(6000);
	const fourth = await evalJs(`(() => {
		const dialog = document.querySelector(".modal-overlay");
		const ta = document.querySelector(".content-editor");
		return {
			dialogOpen: !!dialog,
			dialogTitle: dialog?.querySelector("h2")?.textContent?.trim() ?? null,
			editorHasMarker: (ta?.value ?? "").includes("probe-recovered"),
			editorLen: ta?.value?.length ?? 0,
		};
	})()`);
	console.log("第二次再打开:", JSON.stringify(fourth));

	/* 自动保存链路：改一个标记，等防抖到期，看本地与云端是否都收到 */
	const autoSave = await evalJs(`(async () => {
		const ta = document.querySelector(".content-editor");
		if (!ta) return { noTextarea: true };
		ta.focus();
		ta.value = ta.value + String.fromCharCode(10) + "<!-- autosave-probe -->";
		ta.dispatchEvent(new Event("input", { bubbles: true }));
		await new Promise((r) => setTimeout(r, 3000));
		const key = "admin-post-draft-edit-" + ${JSON.stringify(SLUG)};
		const raw = localStorage.getItem(key);
		const cloud = await fetch(
			"/api/admin/draft/?slug=" + encodeURIComponent(${JSON.stringify(SLUG)}),
		)
			.then((r) => r.json())
			.catch(() => null);
		/* 请求是否真的发出去了：性能条目能反映 fetch 的耗时与结果 */
		const reqs = performance
			.getEntriesByType("resource")
			.filter((r) => r.name.includes("/api/admin/draft"))
			.map((r) => ({
				start: Math.round(r.startTime),
				dur: Math.round(r.duration),
				size: r.transferSize,
			}));
		return {
			localHasMarker: !!raw && raw.includes("autosave-probe"),
			cloudHasMarker: !!cloud?.draft?.content?.includes("autosave-probe"),
			localLen: raw ? raw.length : 0,
			requestCount: reqs.length,
			requests: reqs.slice(-4),
		};
	})()`);
	console.log("自动保存:", JSON.stringify(autoSave));

	/* 改完内容后离开编辑页再回来：模拟用户「编辑 → 退出 → 重进」 */
	await cdp.send("Page.navigate", { url: `${ORIGIN}/admin/posts/` });
	await sleep(3000);
	await cdp.send("Page.navigate", {
		url: `${ORIGIN}/admin/posts/edit/${SLUG}/`,
	});
	await sleep(7000);

	const revisit = await evalJs(`(() => {
		const ta = document.querySelector(".content-editor");
		const dialog = document.querySelector(".modal-overlay");
		const key = "admin-post-draft-edit-" + ${JSON.stringify(SLUG)};
		const raw = localStorage.getItem(key);
		let draft = null;
		try {
			draft = raw ? JSON.parse(raw) : null;
		} catch {
			draft = null;
		}
		return {
			dialogOpen: !!dialog,
			editorHasMarker: (ta?.value ?? "").includes("autosave-probe"),
			editorLen: ta?.value?.length ?? 0,
			draftHasMarker: !!draft?.content?.includes("autosave-probe"),
			draftLen: draft?.content?.length ?? 0,
			draftRestored: draft?.restored ?? null,
		};
	})()`);
	console.log("离开后重进:", JSON.stringify(revisit));

	const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
	writeFileSync("probe-draft.png", Buffer.from(shot.data, "base64"));

	cdp.close();
	chrome.kill();
}

main().catch((e) => {
	console.error("探针失败:", e.message);
	chrome.kill();
	process.exit(1);
});
