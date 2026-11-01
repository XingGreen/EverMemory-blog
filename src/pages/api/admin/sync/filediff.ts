/**
 * 单篇差异：按需拉取正文，用于用户在面板上点「差异」时查看。
 *
 * 独立成接口是为了守住「不拉全量正文」这条线——
 * plan 只给 sha，只有这一条被点开时才去 GET /contents/{path}。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { requireAuth } from "@/utils/auth";
import { gitBlobSha } from "@/utils/git-blob";
import { getFileFromGitHub } from "@/utils/github-app";

export const prerender = false;

export async function GET({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const url = new URL(request.url);
	const filePath = url.searchParams.get("path")?.trim() ?? "";
	const slug = url.searchParams.get("slug")?.trim() ?? "";

	if (!filePath || !slug) {
		return json({ success: false, message: "缺少 path 或 slug" }, 400);
	}
	if (filePath.includes("..") || !filePath.startsWith("src/content/posts/")) {
		return json({ success: false, message: "非法路径" }, 400);
	}

	const abs = path.resolve(process.cwd(), filePath);

	let localContent: string | null = null;
	let localSha: string | null = null;
	let localError: string | null = null;
	try {
		if (existsSync(abs)) {
			const buf = readFileSync(abs);
			localContent = buf.toString("utf-8");
			localSha = gitBlobSha(buf);
		}
	} catch (error) {
		localError = error instanceof Error ? error.message : String(error);
	}

	let remoteContent: string | null = null;
	let remoteError: string | null = null;
	try {
		remoteContent = await getFileFromGitHub(filePath);
		if (remoteContent === null) remoteError = "远端不存在该文件";
	} catch (error) {
		remoteError = error instanceof Error ? error.message : String(error);
	}

	return json({
		success: localError === null || remoteError === null,
		slug,
		path: filePath,
		localContent,
		localSha,
		localError,
		remoteContent,
		remoteError,
	});
}

function json(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
