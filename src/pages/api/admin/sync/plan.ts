/**
 * 同步计划：只拉远端元数据（目录列表里的 sha），本地算 blob 哈希比对。
 *
 * 绝不下载正文——GitHub 的目录接口本来就只返回 name/path/type/sha，
 * 正文要另外 GET /contents/{path}，这里一次都不调。
 *
 * 判定只有四种，不含方向：
 *   same        内容一致（sha 相同）
 *   differs     两边都有但内容不同
 *   local-only  远端没有
 *   remote-only 本地没有
 * 「谁更新」判断不了：sha 不同只能说明内容不同，要比时间得逐文件拉 commit，
 * 那会退化成 N 次请求。所以界面上不自带方向，交给使用者决定。
 */

import { getCollection } from "astro:content";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import { gitBlobSha, hasCrlf } from "@/utils/git-blob";
import { listMarkdownWithSha } from "@/utils/github-app";

export const prerender = false;

const REMOTE_TIMEOUT_MS = 15_000;

type PlanState = "same" | "differs" | "local-only" | "remote-only";

interface PlanItem {
	slug: string;
	path: string;
	state: PlanState;
	localSha: string | null;
	remoteSha: string | null;
	/** 本地文件含 CRLF：说明工作区与 .gitattributes 不一致，sha 比对不可信 */
	crlf?: boolean;
	draft?: boolean;
	title?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		p,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
		),
	]);
}

export async function GET({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const checkedAt = Date.now();

	/* 1. 远端元数据（含 sha），一次递归，不拉正文 */
	let remote: Array<{ path: string; sha: string }> = [];
	let error: string | null = null;
	try {
		remote = await withTimeout(
			listMarkdownWithSha("src/content/posts"),
			REMOTE_TIMEOUT_MS,
		);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}

	/* 2. 本地：内容集合给 slug 与 frontmatter，文件系统给字节用于算 sha。
	   云端构建产物不含 src/content，existsSync 为 false —— 此时无法算本地哈希，
	   如实报 localAvailable=false，而不是假装一致。 */
	let localPosts: Array<{
		id: string;
		filePath?: string;
		data: { title?: string; draft?: boolean };
	}> = [];
	let localAvailable = false;
	try {
		localPosts = await getCollection("posts");
		localAvailable = localPosts.some((p) => {
			const fp = p.filePath;
			return (
				Boolean(fp) && existsSync(path.resolve(process.cwd(), fp as string))
			);
		});
	} catch {
		localAvailable = false;
	}

	const remoteBySlug = new Map(
		remote.map((f) => [
			f.path.replace(/^src\/content\/posts\//, "").replace(/\.mdx?$/, ""),
			f,
		]),
	);

	const items: PlanItem[] = [];
	const seen = new Set<string>();

	if (localAvailable) {
		for (const post of localPosts) {
			const fp = post.filePath;
			if (!fp) continue;
			const abs = path.resolve(process.cwd(), fp);
			const remoteFile = remoteBySlug.get(post.id);
			seen.add(post.id);

			if (!existsSync(abs)) {
				items.push({
					slug: post.id,
					path: remoteFile?.path ?? fp,
					state: remoteFile ? "remote-only" : "local-only",
					localSha: null,
					remoteSha: remoteFile?.sha ?? null,
					draft: post.data.draft,
					title: post.data.title,
				});
				continue;
			}

			let localSha: string | null = null;
			let crlf = false;
			try {
				const buf = readFileSync(abs);
				localSha = gitBlobSha(buf);
				crlf = hasCrlf(buf);
			} catch {
				localSha = null;
			}

			let state: PlanState;
			if (!remoteFile) state = "local-only";
			else if (localSha && localSha === remoteFile.sha) state = "same";
			else state = "differs";

			items.push({
				slug: post.id,
				path: remoteFile?.path ?? fp,
				state,
				localSha,
				remoteSha: remoteFile?.sha ?? null,
				crlf,
				draft: post.data.draft,
				title: post.data.title,
			});
		}
	}

	/* 远端独有：本地集合里没有的 */
	for (const [slug, file] of remoteBySlug) {
		if (seen.has(slug)) continue;
		items.push({
			slug,
			path: file.path,
			state: "remote-only",
			localSha: null,
			remoteSha: file.sha,
		});
	}

	const order: Record<PlanState, number> = {
		differs: 0,
		"remote-only": 1,
		"local-only": 2,
		same: 3,
	};
	items.sort((a, b) => {
		if (order[a.state] !== order[b.state])
			return order[a.state] - order[b.state];
		return a.slug.localeCompare(b.slug);
	});

	const counts = {
		same: items.filter((i) => i.state === "same").length,
		differs: items.filter((i) => i.state === "differs").length,
		localOnly: items.filter((i) => i.state === "local-only").length,
		remoteOnly: items.filter((i) => i.state === "remote-only").length,
		crlfSuspect: items.filter((i) => i.crlf).length,
	};

	return new Response(
		JSON.stringify({
			success: error === null,
			checkedAt,
			connected: error === null,
			error,
			localAvailable,
			localTotal: localPosts.length,
			remoteTotal: remote.length,
			counts,
			items,
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}
