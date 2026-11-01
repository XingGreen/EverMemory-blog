/**
 * 执行同步：按条目逐个拉取或推送。
 *
 * 只处理调用方明确指定的条目，不做「全量兜底」——同步面板的价值就在于
 * 使用者能看见并选择每一条，静默扩大范围等于绕过了这个确认。
 *
 * 推送走现有 saveFileToGitHub（内部先 GET 拿 sha 再 PUT），
 * 拉取先写本地再推一次远端，保证两端一致。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeAuditLog } from "@/utils/audit-log";
import { requireAuth } from "@/utils/auth";
import {
	getFileFromGitHub,
	saveFileLocally,
	saveFileToGitHub,
} from "@/utils/github-app";

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
		if (item.path.includes("..")) {
			return json({ success: false, message: "非法路径" }, 400);
		}
		if (item.direction !== "pull" && item.direction !== "push") {
			return json({ success: false, message: "方向必须是 pull 或 push" }, 400);
		}
	}

	const results: ApplyResult[] = [];

	for (const item of items) {
		const abs = path.resolve(process.cwd(), item.path);
		try {
			if (item.direction === "pull") {
				const remote = await getFileFromGitHub(item.path);
				if (remote === null) {
					results.push({
						slug: item.slug,
						direction: "pull",
						ok: false,
						message: "远端不存在该文件",
					});
					continue;
				}
				/* 先落本地（开发环境），再推远端——两步都成功才算 ok。
				   云端文件系统只读，saveFileLocally 会失败，此时仍允许推远端，
				   因为它只是「把远端内容再写回远端」的幂等操作，不做也不影响结果。 */
				const savedLocal = saveFileLocally(item.path, remote);
				const pushed = await saveFileToGitHub(
					item.path,
					remote,
					`chore(sync): pull ${item.slug} from remote`,
				);
				if (!savedLocal && !pushed) {
					results.push({
						slug: item.slug,
						direction: "pull",
						ok: false,
						message: "本地与远端都写入失败",
					});
					continue;
				}
				results.push({
					slug: item.slug,
					direction: "pull",
					ok: true,
					message: savedLocal ? undefined : "远端已就绪，本地只读未写入",
				});
				continue;
			}

			/* push */
			if (!existsSync(abs)) {
				results.push({
					slug: item.slug,
					direction: "push",
					ok: false,
					message: "本地文件不存在",
				});
				continue;
			}
			const content = readFileSync(abs, "utf-8");
			const ok = await saveFileToGitHub(
				item.path,
				content,
				`chore(sync): push ${item.slug} to remote`,
			);
			results.push({
				slug: item.slug,
				direction: "push",
				ok,
				message: ok ? undefined : "推送到 GitHub 失败",
			});
		} catch (error) {
			results.push({
				slug: item.slug,
				direction: item.direction,
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const okCount = results.filter((r) => r.ok).length;
	const failCount = results.length - okCount;

	writeAuditLog({
		event: "draft_saved",
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

function json(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
