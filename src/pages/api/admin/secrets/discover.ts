/**
 * 环境变量页的「发现」接口：从本地 `.git` 读出仓库地址，供页面预填。
 *
 * 只读、无副作用、不碰密钥；读不到就返回 `repo: null`，不当作错误。
 * 与 probe 的分工：这个回答「本地仓库是什么」，那个回答「GitHub 通不通」。
 */
import { requireAuth } from "@/utils/auth";
import { detectLocalRepo } from "@/utils/repo-locator";

export const prerender = false;

export const GET = async ({ request }: { request: Request }) => {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const repo = await detectLocalRepo();
	return new Response(JSON.stringify({ success: true, repo }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
};
