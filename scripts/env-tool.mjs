/**
 * 环境变量页启动器
 *
 * 页面本身是主项目的 /admin/env/（SecretManager 组件），这里不重造任何 UI，
 * 只做两件事：dev server 没在跑就先起来，然后打开那一页。
 *
 * 首次配置（还没法登录时）不靠这个页面：直接编辑 .env.local 里的必要项，
 * 或照 README 的说明填。
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = process.env.ENV_PAGE_ORIGIN || "http://localhost:4321";
const PAGE = `${ORIGIN}/admin/env/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reachable() {
	try {
		await fetch(ORIGIN, { signal: AbortSignal.timeout(800) });
		return true;
	} catch {
		return false;
	}
}

function openBrowser(url) {
	if (process.env.ENV_PAGE_NO_OPEN) {
		console.log(`页面地址：${url}`);
		return;
	}
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

if (await reachable()) {
	console.log(`开发服务器已在运行，打开 ${PAGE}`);
	openBrowser(PAGE);
	process.exit(0);
}

console.log("开发服务器未运行，先启动 pnpm dev……");
const dev = spawn(process.execPath, [join(ROOT, "scripts", "dev.mjs")], {
	cwd: ROOT,
	stdio: "inherit",
});

const stop = () => {
	dev.kill();
	process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

let ready = false;
for (let i = 0; i < 90; i++) {
	await sleep(1000);
	if (await reachable()) {
		ready = true;
		break;
	}
}

if (ready) {
	console.log(`已就绪，打开 ${PAGE}`);
	openBrowser(PAGE);
	console.log("关闭这个窗口（或按 Ctrl+C）即停止开发服务器。");
} else {
	console.error("等待开发服务器超时，检查上方输出。");
	dev.kill();
	process.exit(1);
}
