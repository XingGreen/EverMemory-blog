/**
 * 环境变量页的「握手」接口：拿当前配置真的去问一次 GitHub。
 *
 * 与 GET /api/admin/secrets 的区别：那个报「填了没」，这个报「通不通」。
 * 只读——不改任何文件、不换 token、不写审计日志以外的副作用；
 * 返回体里也不含私钥、JWT、installation token，只有结论文字。
 */
import { requireAuth } from "@/utils/auth";
import { probeGitHubApp } from "@/utils/github-probe";

export const prerender = false;

const json = (body: unknown, status: number) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

export const GET = async ({ request }: { request: Request }) => {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const force = new URL(request.url).searchParams.get("force") === "1";

	try {
		const report = await probeGitHubApp(force);
		return json({ success: true, ...report }, 200);
	} catch (error) {
		// probeGitHubApp 自己永不抛错；能走到这里说明是导入或运行时层面的问题，
		// 仍然要给前端一句能看的说明，而不是 500 空白。
		return json(
			{
				success: false,
				message: error instanceof Error ? error.message : "探测失败",
			},
			500,
		);
	}
};
