import { requireAuth } from "@/utils/auth";

export const prerender = false;

// 后台服务连通性测试：计时本端点处理耗时，供系统状态卡片使用。
// 与 github-ping 对称——那个测外部依赖，这个测承载后台自身的服务端。
export async function GET({ request }) {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	const started = Date.now();
	try {
		// 保持一个 await，让延迟统计覆盖到完整的异步返回路径
		await Promise.resolve();
		return new Response(JSON.stringify({ success: true, latency: Date.now() - started }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ success: false, message }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}
}