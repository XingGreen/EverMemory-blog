import { requireAuth } from "@/utils/auth";
import { getSession } from "@/utils/session-store";

export const prerender = false;

// 采样次数：单次耗时说明不了稳定性（KV 延迟实测在 280–800ms 间波动），
// 取 3 次足以看出抖动，且不会让探测本身拖到不可接受。
const SAMPLES = 3;

/** 分位数：升序取中间位，样本数为奇数时即为中位数 */
function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

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
		// 采样针对 getSession 而非重复调用 requireAuth：后者会连带重做
		// HMAC 验签、本地文件读取与 touchSession，测到的是别的东西。
		// getSession 内部的会话表读取才是本端点唯一的网络开销来源。
		const sid = auth.payload?.sid;
		const samples: number[] = [];

		for (let i = 0; i < SAMPLES; i++) {
			const t0 = Date.now();
			await getSession(sid ?? "");
			samples.push(Date.now() - t0);
		}

		return new Response(
			JSON.stringify({
				success: true,
				// latency 保持为总耗时，语义与旧版一致，避免前端各处含义漂移
				latency: Date.now() - started,
				samples,
				min: Math.min(...samples),
				median: median(samples),
				max: Math.max(...samples),
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ success: false, message }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}
}