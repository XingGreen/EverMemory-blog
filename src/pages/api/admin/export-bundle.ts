import { requireAuth } from "@/utils/auth";
import { collectPostAssets } from "@/utils/export-bundle";

export const prerender = false;

/**
 * 导出聚合：一次返回全部文章正文 + 它们引用到的静态资源。
 *
 * 为什么不复用 /api/admin/post-content/：那个接口每次只处理一篇，
 * 导出 24 篇就是 24 次串行请求，且不返回图片——导出的包换台机器打开，
 * 图片全断。这里一次取完，并把资源一并带上。
 *
 * 返回 JSON（而非直接 zip）：打包交给浏览器端做（utils/zip.ts），
 * 这样同一份数据既可用于 zip，也可用于调试查看，服务端也不必持有压缩库。
 */
export async function GET({ request }: { request: Request }) {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	try {
		const bundle = await collectPostAssets();
		return new Response(JSON.stringify({ success: true, ...bundle }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (err) {
		return new Response(
			JSON.stringify({
				success: false,
				message: err instanceof Error ? err.message : String(err),
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}
