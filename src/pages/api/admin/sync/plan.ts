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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import { gitBlobSha, hasCrlf } from "@/utils/git-blob";
import { listMarkdownWithSha } from "@/utils/github-app";
import { slugFromPath } from "@/utils/post-slug";

export const prerender = false;

const REMOTE_TIMEOUT_MS = 15_000;

/** unknown：远端不可达，只能列出本地文件，无法判定
	   与远端的关系。单独一个状态是为了避免把它误标成 local-only。 */
type PlanState = "same" | "differs" | "local-only" | "remote-only" | "unknown";

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

/** 递归收集 src/content/posts 下的 markdown 相对路径 */
function walkPostFiles(rootDir: string): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		let entries: import("node:fs").Dirent[] = [];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const abs = path.join(dir, e.name);
			if (e.isDirectory()) walk(abs);
			else if (/\.mdx?$/.test(e.name)) {
				out.push(path.relative(process.cwd(), abs).split(path.sep).join("/"));
			}
		}
	};
	walk(rootDir);
	return out.sort();
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
	/* 本地文章：直接扫文件系统，不依赖 getCollection。
	   原因：getCollection 在 dev 下是模块级缓存，新建文章后要等 HMR 重载才出现，
	   于是「刚建的文章在同步面板里查不到」。扫盘能立刻看到新文件，
	   代价是要自己读 frontmatter 取标题与草稿标记。 */
	const localFiles = walkPostFiles(
		path.resolve(process.cwd(), "src/content/posts"),
	);
	let localAvailable = localFiles.length > 0;

	const localPosts: Array<{
		slug: string;
		filePath: string;
		title: string;
		draft: boolean;
	}> = localFiles.map((rel) => {
		const abs = path.resolve(process.cwd(), rel);
		let title = "";
		let draft = false;
		try {
			const head = readFileSync(abs, "utf-8").slice(0, 2000);
			const t = head.match(/^title:\s*(.+)$/m);
			if (t) {
				title = t[1]
					.trim()
					.replace(/^["'](.*)["']$/, "$1")
					.trim();
			}
			const d = head.match(/^draft:\s*(.+)$/m);
			if (d) draft = /^(true|yes)$/i.test(d[1].trim());
			// 没写 draft 的文章默认视为已发布（与 content schema 的缺省一致）
		} catch {
			// 读失败就留空，不影响该条目出现在列表里
		}
		return { slug: slugFromPath(rel), filePath: rel, title, draft };
	});
	if (localPosts.length === 0) localAvailable = false;

	const remoteBySlug = new Map(remote.map((f) => [slugFromPath(f.path), f]));

	const items: PlanItem[] = [];
	const seen = new Set<string>();

	if (localAvailable) {
		for (const post of localPosts) {
			const fp = post.filePath;
			const abs = path.resolve(process.cwd(), fp);
			const slug = post.slug;
			const remoteFile = remoteBySlug.get(slug);
			seen.add(slug);

			if (!existsSync(abs)) {
				items.push({
					slug: slug,
					path: remoteFile?.path ?? fp,
					state: remoteFile ? "remote-only" : "local-only",
					localSha: null,
					remoteSha: remoteFile?.sha ?? null,
					draft: post.draft,
					title: post.title,
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
				slug: slug,
				path: remoteFile?.path ?? fp,
				state,
				localSha,
				remoteSha: remoteFile?.sha ?? null,
				crlf,
				draft: post.draft,
				title: post.title,
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
		unknown: 3,
		same: 4,
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
			counts:
				error === null
					? counts
					: {
							same: 0,
							differs: 0,
							localOnly: 0,
							remoteOnly: 0,
							crlfSuspect: 0,
						},
			/* 远端不可达时仍然列出本地文件，但状态一律标 unknown。
			   之前这里是直接清空，结果是网络抖一下整张列表就空了，
			   使用者以为文件丢了。空列表和「读不到远端」是两件事，不能混。
			   标 unknown 也避免了把它们误判成 local-only 而一键全推。 */
			items:
				error === null
					? items
					: localPosts.map((p) => ({
							slug: p.slug,
							path: p.filePath,
							state: "unknown" as PlanState,
							localSha: null,
							remoteSha: null,
							title: p.title,
							draft: p.draft,
						})),
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}
