/**
 * 执行同步：按条目逐个拉取或推送。
 *
 * 只处理调用方明确指定的条目，不做「全量兜底」——同步面板的价值就在于
 * 使用者能看见并选择每一条，静默扩大范围等于绕过了这个确认。
 *
 * 推送走 commitFiles：一次 GraphQL 提交多个文件，只产生一个 commit，
 * 因而只触发一次部署（逐条 PUT 会是 N 个 commit / N 次构建）。
 * 拉取先写本地再推一次远端，保证两端一致。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeAuditLog } from "@/utils/audit-log";
import { requireAuth } from "@/utils/auth";
import { saveFileLocally } from "@/utils/github-app";
import { getStorageProvider } from "@/utils/providers/registry";

export const prerender = false;

interface ApplyItem {
	slug: string;
	path: string;
	direction: "pull" | "push";
}

interface ApplyResult {
	slug: string;
	direction: "pull" | "push";
	ok: boolean;
	message?: string;
}

export async function POST({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	let body: { items?: ApplyItem[] };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, message: "请求体不是合法 JSON" }, 400);
	}

	const items = Array.isArray(body.items) ? body.items : [];
	if (items.length === 0) {
		return json({ success: false, message: "没有选中任何条目" }, 400);
	}
	for (const item of items) {
		if (!item?.path || !item?.slug) {
			return json({ success: false, message: "条目缺少 slug 或 path" }, 400);
		}
		if (!isAllowedPostPath(item.path)) {
			return json(
				{
					success: false,
					message: "非法路径：同步只处理 src/content/posts 下的 Markdown 文件",
				},
				400,
			);
		}
		if (item.direction !== "pull" && item.direction !== "push") {
			return json({ success: false, message: "方向必须是 pull 或 push" }, 400);
		}
	}

	const results: ApplyResult[] = [];

	/* 1. 拉取：只写本地。
	   原来的 pull 分支里还调了一次 saveFileToGitHub，把远端内容原样写回远端，
	   幂等但会凭空多出一个 commit，等于多触发一次部署。 */
	for (const item of items.filter((i) => i.direction === "pull")) {
		try {
			const remote = await getStorageProvider().readFile(item.path);
			if (!remote.ok) {
				/* 只有 404 才说「不存在」；断网、认证失败、5xx 各有各的说法，
				   把它们都说成「远端不存在」会让人去仓库里找一个本来就有的文件。 */
				results.push({
					slug: item.slug,
					direction: "pull",
					ok: false,
					message: remote.message,
				});
				continue;
			}
			const savedLocal = saveFileLocally(item.path, remote.content);
			results.push({
				slug: item.slug,
				direction: "pull",
				ok: savedLocal,
				message: savedLocal ? undefined : "当前环境本地只读，无法拉取",
			});
		} catch (error) {
			results.push({
				slug: item.slug,
				direction: "pull",
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/* 2. 推送：先收集全部内容，再一次性提交。
	   逐条推 N 篇 = N 个 commit = N 次部署，这是「改完要等半天」的主要来源。
	   一次提交后只有一个 commit，只触发一次构建。 */
	const pushes = items.filter((i) => i.direction === "push");
	const pending: Array<{ path: string; content: string; slug: string }> = [];
	const skipped = new Map<string, string>();

	for (const item of pushes) {
		const abs = path.resolve(process.cwd(), item.path);
		if (!existsSync(abs)) {
			skipped.set(item.slug, "本地文件不存在");
			continue;
		}
		pending.push({
			path: item.path,
			content: readFileSync(abs, "utf-8"),
			slug: item.slug,
		});
	}

	if (pending.length > 0) {
		const headline =
			pending.length === 1
				? `chore(sync): push ${pending[0].slug} to remote`
				: `chore(sync): push ${pending.length} posts to remote`;
		const body = pending
			.map((f) => `- ${f.path.replace(/^src\/content\/posts\//, "")}`)
			.join("\n");
		const commit = await getStorageProvider().commitFiles(
			pending.map((f) => ({ path: f.path, content: f.content })),
			{ headline, body },
		);

		if (commit.ok) {
			for (const file of pending) {
				results.push({
					slug: file.slug,
					direction: "push",
					ok: true,
				});
			}
		} else {
			/* 批量路径失败时退回逐条推送。
			   逐条会重新变成 N 个 commit / N 次构建，但至少内容能上去——
			   宁可多触发一次构建，也不能让「推送」这个核心动作失效。 */
			console.warn(
				"[sync/apply] 批量提交失败，逐条重试：",
				commit.message ?? "未知错误",
			);
			for (const file of pending) {
				let ok = false;
				let message: string | undefined;
				try {
					ok = await getStorageProvider().writeFile(
						file.path,
						file.content,
						`chore(sync): push ${file.slug} to remote`,
					);
					if (!ok) message = "推送到 GitHub 失败";
				} catch (error) {
					message = error instanceof Error ? error.message : String(error);
				}
				results.push({
					slug: file.slug,
					direction: "push",
					ok,
					message,
				});
			}
		}
	}

	for (const item of pushes) {
		const reason = skipped.get(item.slug);
		if (reason) {
			results.push({
				slug: item.slug,
				direction: "push",
				ok: false,
				message: reason,
			});
		}
	}

	/* 结果按请求顺序返回：前端按 slug 取值，顺序不影响正确性，
	   但稳定的顺序便于对着面板排查 */
	const order = new Map(
		items.map((item, idx) => [`${item.slug}:${item.direction}`, idx]),
	);
	results.sort(
		(a, b) =>
			(order.get(`${a.slug}:${a.direction}`) ?? 0) -
			(order.get(`${b.slug}:${b.direction}`) ?? 0),
	);

	const okCount = results.filter((r) => r.ok).length;
	const failCount = results.length - okCount;

	writeAuditLog({
		event: "sync_applied",
		client: "sync-panel",
		username: String(auth.payload?.username ?? "admin"),
		detail: `同步执行：成功 ${okCount} / 失败 ${failCount}`,
	});

	return json({
		success: failCount === 0,
		message:
			failCount === 0
				? `已完成 ${okCount} 项`
				: `完成 ${okCount} 项，失败 ${failCount} 项`,
		results,
	});
}

/**
 * 同步条目只允许指向文章目录。
 *
 * 只拦 ".." 挡不住绝对路径，也挡不住 .env.local 这类同项目文件：
 * push 方向会把读到的文件内容提交进公开仓库——一条
 * `{"path": ".env.local", "direction": "push"}` 就足以把全部密钥推上去；
 * pull 方向同样能覆盖任意可写文件。因此按「目录 + 扩展名 + 解析后前缀」
 * 三重条件限制，而不是只做字符串黑名单。
 */
const POST_PATH_RE = /^src\/content\/posts\/(?:[^/]+\/)*[^/]+\.mdx?$/;

export function isAllowedPostPath(value: unknown): value is string {
	if (typeof value !== "string" || !POST_PATH_RE.test(value)) return false;
	if (value.includes("..")) return false;
	const root = path.resolve(process.cwd(), "src/content/posts");
	const abs = path.resolve(process.cwd(), value);
	return abs.startsWith(`${root}${path.sep}`);
}

function json(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
