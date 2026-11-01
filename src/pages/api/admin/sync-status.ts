/**
 * 同步状态检查（只读）。
 *
 * 与 POST /api/admin/sync/ 的区别：那个会真的下载文件、有副作用；
 * 这个只做比对并如实回报失败原因，供同步面板打开时展示。
 *
 * 为什么不在这里判断「冲突」：
 * 真正判断内容是否冲突需要比对 blob SHA 或 commit 时间，单靠目录列表拿不到。
 * 本项目单管理员、单写入口，并发编辑的概率很低，所以这里只区分四种可判定的状态，
 * 把「都在」如实标成 both，不谎称「已一致」。
 */
import { getCollection } from "astro:content";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import { listAllMarkdownFiles } from "@/utils/github-app";

export const prerender = false;

const REMOTE_TIMEOUT_MS = 15_000;

type DiffState = "both" | "local-only" | "remote-only";

interface DiffItem {
	slug: string;
	path: string;
	state: DiffState;
	/** 本地是否有未推送改动无法可靠判定，故不提供 modified 状态 */
	localTitle?: string;
	draft?: boolean;
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

	let remoteFiles: string[] = [];
	let remoteError: string | null = null;

	try {
		remoteFiles = await withTimeout(
			listAllMarkdownFiles("src/content/posts"),
			REMOTE_TIMEOUT_MS,
		);
	} catch (error) {
		/* 这里必须把原始错误原样带出去——面板要展示的就是「为什么连不上」，
		   而不是笼统一句「检查失败」。 */
		remoteError = error instanceof Error ? error.message : String(error);
	}

	let localPosts: Array<{
		id: string;
		data: { title?: string; draft?: boolean };
	}> = [];
	let localError: string | null = null;
	try {
		localPosts = await getCollection("posts");
	} catch (error) {
		localError = error instanceof Error ? error.message : String(error);
	}

	const localMap = new Map(
		localPosts.map((p) => [
			p.id,
			{ title: p.data.title ?? "", draft: Boolean(p.data.draft) },
		]),
	);
	const remoteSlugToPath = new Map(
		remoteFiles.map((f) => [
			f.replace(/^src\/content\/posts\//, "").replace(/\.mdx?$/, ""),
			f,
		]),
	);

	const diffs: DiffItem[] = [];
	for (const [slug, meta] of localMap) {
		diffs.push({
			slug,
			path: remoteSlugToPath.get(slug) ?? `src/content/posts/${slug}.md`,
			state: remoteSlugToPath.has(slug) ? "both" : "local-only",
			localTitle: meta.title,
			draft: meta.draft,
		});
	}
	for (const [slug, filePath] of remoteSlugToPath) {
		if (localMap.has(slug)) continue;
		diffs.push({ slug, path: filePath, state: "remote-only" });
	}
	diffs.sort((a, b) => {
		const rank = (s: DiffState) =>
			s === "remote-only" ? 0 : s === "local-only" ? 1 : 2;
		if (rank(a.state) !== rank(b.state)) return rank(a.state) - rank(b.state);
		return a.slug.localeCompare(b.slug);
	});

	const counts = {
		both: diffs.filter((d) => d.state === "both").length,
		localOnly: diffs.filter((d) => d.state === "local-only").length,
		remoteOnly: diffs.filter((d) => d.state === "remote-only").length,
	};

	return new Response(
		JSON.stringify({
			success: remoteError === null,
			checkedAt,
			/** 连不上 GitHub 时为 null，并附 error 说明具体原因 */
			connected: remoteError === null,
			error: remoteError,
			localError,
			localTotal: localMap.size,
			remoteTotal: remoteSlugToPath.size,
			counts,
			diffs,
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}
