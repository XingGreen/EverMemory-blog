import { requireAuth } from "@/utils/auth";

export const prerender = false;

// 后台服务连通性测试：计时本端点处理耗时，供系统状态卡片使用。
// 与 github-ping 对称——那个测外部依赖，这个测承载后台自身的服务端。
export async function GET({ request }) {
	// 计时必须从鉴权之前开始：本端点的真实开销主要在 requireAuth 内的
	// KV 往返（会话表读取 + token 版本比对）。若把起点放在鉴权之后，
	// 中间只剩一个空 await，latency 将恒为 0，对排查毫无参考价值。
	const started = Date.now();

	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	try {
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