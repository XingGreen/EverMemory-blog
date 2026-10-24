/**
 * 开发服务器启动器
 *
 * 并行启动两个进程：
 *   1. icons  watch —— 监听 src/ 变化，自动重新生成图标表
 *   2. astro  dev   —— Astro 开发服务器
 *
 * 为什么需要这个：
 * 图标表 src/constants/icons.ts 是构建产物，由 generate-icons.js 扫描源码
 * 生成。dev 模式下新增图标引用若没重新生成，运行时会报「Icon not found」。
 * 历史上踩过两次（轮换按钮图标、私钥查看弹窗），都是保存代码后忘记跑
 * `pnpm icons`。这里让 dev 自动补全。
 *
 * 不用 turbo 的原因：turbo 面向有向无环的构建任务，两个长驻进程
 * （dev server + watcher）不属于该模型，强行套用会互相拖累。
 * 用 Node 原生 spawn 足够，且不引入新依赖。
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/** 启动子进程，继承 stdio 以便输出直达终端。
 *
 * 注意不要加 shell: true —— node 路径可能含空格（如 C:\Program Files\...），
 * 经 cmd 拼接后会被截断成 'C:\Program'。node 本身是可执行文件，
 * 直接 spawn 即可，无需 shell。
 */
function run(command, args, label) {
	const child = spawn(command, args, {
		cwd: ROOT,
		stdio: "inherit",
	});
	child.on("error", (err) => {
		console.error(`[dev] ${label} 启动失败:`, err.message);
	});
	child.on("exit", (code, signal) => {
		if (signal) return;
		if (code !== 0) {
			console.error(`[dev] ${label} 退出，code=${code}`);
		}
	});
	return child;
}

// 1) 图标表 watch
const iconsWatcher = run(
	process.execPath,
	[join(ROOT, "scripts", "generate-icons.js"), "--watch"],
	"icons-watch",
);

// 2) Astro dev
const astroDev = run(
	process.execPath,
	[
		"--max-old-space-size=4096",
		join(ROOT, "node_modules", "astro", "bin", "astro.mjs"),
		"dev",
	],
	"astro-dev",
);

/** 统一退出：任一子进程结束或收到信号时，清理另一个 */
let shuttingDown = false;
function shutdown(code = 0) {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const child of [iconsWatcher, astroDev]) {
		if (!child.killed) child.kill();
	}
	process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => shutdown(0));
}

// Astro dev 是主进程，它退出意味着开发结束
astroDev.on("exit", (code) => shutdown(code ?? 0));
