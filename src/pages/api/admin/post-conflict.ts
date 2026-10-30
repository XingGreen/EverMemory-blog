/**
 * 本地 / 线上内容冲突检测与解决。
 *
 * 背景：本项目的文章以本地 markdown 为事实源，通过 GitHub 提交发布。如果同一篇
 * 文章在别处（GitHub 网页、另一台机器）被改动，本地文件就会和远端分叉。此时
 * 直接保存会把线上改动覆盖掉，且没有任何提示。
 *
 * 本接口做两件事：
 *   GET  ?slug=xxx  比对本地文件与 GitHub 同名文件的内容哈希，给出状态
 *   POST { slug, resolution: "local" | "remote" }
 *        local  → 用本地内容覆盖线上（提交一次）
 *        remote → 用线上内容覆盖本地（写盘，不走 git）
 *
 * 比对用内容哈希而不是全文，避免把整篇文章在接口里来回传。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import {
	getFileFromGitHub,
	saveFileLocally,
	saveFileToGitHub,
} from "@/utils/github-app";

export const prerender = false;

/** 12 位足够区分内容，又不至于让响应变长 */
function shortSha(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function relPathOf(slug: string): string {
	return `src/content/posts/${slug}.md`;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export async function GET({ request }: { request: Request }): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const slug = new URL(request.url).searchParams.get("slug")?.trim() ?? "";
	if (!slug) return json({ success: false, message: "缺少 slug" }, 400);

	const rel = relPathOf(slug);
	const localPath = path.resolve(process.cwd(), rel);
	if (!existsSync(localPath)) {
		return json({ success: false, message: "本地文件不存在" }, 404);
	}

	const local = readFileSync(localPath, "utf-8");
	let remote: string | null = null;
	try {
		remote = await getFileFromGitHub(rel);
	} catch {
		// 远端不可达（无凭据 / 网络异常）当作「无法判定」，不要误报成冲突
		return json({
			success: true,
			state: "unknown",
			message: "无法读取远端文件，可能缺少 GitHub 凭据或网络异常",
			localSha: shortSha(local),
		});
	}

	if (remote === null) {
		return json({
			success: true,
			state: "not-on-remote",
			localSha: shortSha(local),
		});
	}

	const localSha = shortSha(local);
	const remoteSha = shortSha(remote);
	return json({
		success: true,
		state: localSha === remoteSha ? "in-sync" : "conflict",
		localSha,
		remoteSha,
	});
}

export async function POST({ request }: { request: Request }): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	let body: { slug?: string; resolution?: string };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, message: "请求体不是合法 JSON" }, 400);
	}

	const slug = body.slug?.trim() ?? "";
	const resolution = body.resolution;
	if (!slug) return json({ success: false, message: "缺少 slug" }, 400);
	if (resolution !== "local" && resolution !== "remote") {
		return json({ success: false, message: "resolution 必须是 local 或 remote" }, 400);
	}

	const rel = relPathOf(slug);
	const localPath = path.resolve(process.cwd(), rel);
	if (!existsSync(localPath)) {
		return json({ success: false, message: "本地文件不存在" }, 404);
	}

	if (resolution === "local") {
		// 本地覆盖线上：把本地内容提交上去
		const local = readFileSync(localPath, "utf-8");
		const ok = await saveFileToGitHub(
			rel,
			local,
			`chore(sync): 以本地版本覆盖线上 ${slug}`,
		);
		return ok
			? json({ success: true, message: "已用本地版本覆盖线上" })
			: json({ success: false, message: "推送失败，请检查 GitHub 凭据" }, 500);
	}

	// 线上覆盖本地：把远端内容写回文件
	const remote = await getFileFromGitHub(rel);
	if (remote === null) {
		return json({ success: false, message: "远端没有该文件，无法拉取" }, 404);
	}
	const ok = saveFileLocally(rel, remote);
	return ok
		? json({ success: true, message: "已用线上版本覆盖本地" })
		: json({ success: false, message: "写入本地文件失败" }, 500);
}
