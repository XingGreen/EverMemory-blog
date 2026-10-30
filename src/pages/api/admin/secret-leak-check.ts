/**
 * 密钥文件泄露检测。
 *
 * 判定规范来自 docs/todo/单管理员博客：初始化、会话与凭据安全设计.md 第 40-60 行：
 *   - 只被追踪、未 commit     → 警告
 *   - commit 了、未 push      → 严重
 *   - 已 push                → 危险，视为已泄露
 *
 * 判据全部来自 git 命令，不做任何猜测：
 *   git ls-files --error-unmatch <f>  是否被跟踪
 *   git log --all --format=%H -- <f>  进过历史吗（拿到 commit 列表）
 *   git branch -r --contains <sha>    该 commit 是否已推到远端
 *
 * 生产环境（Vercel / Workers）没有 .git，检测不可用，此时返回 unavailable，
 * 由前端提示「仅本地可用」——泄露检测本来就该在能拿到仓库的地方做。
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { requireAuth } from "@/utils/auth";

export const prerender = false;

const run = promisify(execFile);

/** 只检查这几个固定文件，不接受外部传入路径，避免命令注入 */
const CANDIDATES = [
	".env.local",
	".env.admin",
	".env",
	".env.production",
	".env.development",
] as const;

export type LeakLevel = "safe" | "warning" | "serious" | "danger" | "unknown";

interface LeakResult {
	file: string;
	exists: boolean;
	tracked: boolean;
	commits: string[];
	pushedCommits: string[];
	level: LeakLevel;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** 跑 git 命令；非零退出码不算异常，返回 null 表示「否」 */
async function git(args: string[]): Promise<string | null> {
	try {
		const { stdout } = await run("git", args, {
			cwd: process.cwd(),
			timeout: 10_000,
			windowsHide: true,
		});
		return stdout;
	} catch {
		return null;
	}
}

async function inspect(file: string): Promise<LeakResult> {
	const rel = path.posix.join(".", file);
	const exists = existsSync(path.resolve(process.cwd(), file));

	// 1) 是否被 git 跟踪
	const trackedOut = await git(["ls-files", "--error-unmatch", rel]);
	const tracked = trackedOut !== null;

	// 2) 进过历史吗（--all 覆盖所有分支，含已删除分支上的旧提交）
	const logOut = tracked || exists ? await git(["log", "--all", "--format=%H", "--", rel]) : null;
	const commits = (logOut ?? "")
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);

	// 3) 这些 commit 推到远端了吗
	const pushedCommits: string[] = [];
	for (const sha of commits.slice(0, 20)) {
		const branches = await git(["branch", "-r", "--contains", sha]);
		if (branches && branches.trim()) pushedCommits.push(sha);
	}

	let level: LeakLevel;
	if (!tracked && commits.length === 0) {
		level = "safe";
	} else if (tracked && commits.length === 0) {
		level = "warning"; // 只被追踪，还没 commit
	} else if (commits.length > 0 && pushedCommits.length === 0) {
		level = "serious"; // commit 了但没 push
	} else {
		level = "danger"; // 已 push，视为已泄露
	}

	return { file, exists, tracked, commits, pushedCommits, level };
}

export async function GET({ request }: { request: Request }): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	// 没有 .git 就没有判据，直接告诉前端不可用
	if (!existsSync(path.resolve(process.cwd(), ".git"))) {
		return json({
			success: true,
			available: false,
			reason: "当前运行环境没有 git 仓库（生产部署），泄露检测仅在本地可用",
			results: [] as LeakResult[],
		});
	}

	const results: LeakResult[] = [];
	for (const file of CANDIDATES) {
		results.push(await inspect(file));
	}

	return json({ success: true, available: true, results });
}
