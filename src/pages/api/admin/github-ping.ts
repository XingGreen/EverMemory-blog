import { testGitHubConnection } from "@/utils/github-app";

export const prerender = false;

// 连通性测试：真实请求一次 GitHub API（不走 token 缓存），
// 供后台"系统状态 → GitHub 同步"卡片的"测试连通性"按钮使用。
export async function GET() {
	try {
		const latency = await testGitHubConnection();
		return new Response(
			JSON.stringify({ success: true, latency }),
			{
				status: 200,
				headers: { "Content-Type": "application/json" },
			},
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(
			JSON.stringify({ success: false, message }),
			{
				status: 200,
				headers: { "Content-Type": "application/json" },
			},
		);
	}
}