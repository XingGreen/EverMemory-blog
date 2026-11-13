/**
 * 从本地 `.git` 推断仓库地址，供环境变量页预填 `owner/repo@branch`。
 *
 * 只在开发环境有意义：部署产物里没有 `.git`，而密钥页在线上本来只读。
 * 读不到就返回 null —— 预填失败不是错误，手填仍然可用。
 */
import { IS_PROD_BUILD } from "./env";

export type LocalRepo = {
	owner: string;
	repo: string;
	branch: string;
};

/** `git@github.com:owner/repo.git` 与 `https://github.com/owner/repo.git` 都要认 */
function parseRemote(url: string): { owner: string; repo: string } | null {
	const cleaned = url.trim().replace(/\.git$/i, "");
	const scp = cleaned.match(/^[\w.-]+@[^:]+:(.+)$/);
	const pathname = scp
		? scp[1]
		: (() => {
				try {
					return new URL(cleaned).pathname;
				} catch {
					return "";
				}
			})();
	const parts = pathname.split("/").filter(Boolean);
	if (parts.length < 2) return null;
	const owner = parts[parts.length - 2];
	const repo = parts[parts.length - 1];
	return owner && repo ? { owner, repo } : null;
}

function readOriginUrl(config: string): string {
	const block = config.match(/\[remote "origin"\]([\s\S]*?)(?=\n\s*\[|$)/);
	if (!block) return "";
	const url = block[1].match(/^\s*url\s*=\s*(.+)$/m);
	return url ? url[1].trim() : "";
}

function readBranch(head: string): string {
	const m = head.trim().match(/^ref:\s*refs\/heads\/(.+)$/);
	return m ? m[1].trim() : "";
}

/**
 * 该填哪个分支：就是本地当前分支。
 *
 * 不做「远端默认分支」那类推断——多一层猜测就多一个出错的地方，
 * 而且开发者对自己在哪个分支上最清楚。
 */
export async function detectLocalRepo(): Promise<LocalRepo | null> {
	if (IS_PROD_BUILD) return null;
	try {
		const { readFile } = await import("node:fs/promises");
		const { join } = await import("node:path");
		const root = process.cwd();
		const [config, head] = await Promise.all([
			readFile(join(root, ".git", "config"), "utf8"),
			readFile(join(root, ".git", "HEAD"), "utf8"),
		]);
		const remote = readOriginUrl(config);
		const parsed = remote ? parseRemote(remote) : null;
		if (!parsed) return null;
		const branch = readBranch(head);
		if (!branch) return null;
		return { ...parsed, branch };
	} catch {
		return null;
	}
}
