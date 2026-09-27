// 公开只读：返回所有运行时配置覆盖层（未覆盖的配置项不出现）。
// 前台组件加载后拉取并合并，实现"改配置即时生效、无需重建"。
import type { APIRoute } from "astro";
export const prerender = false;
import { getAllRuntimeConfigs } from "@/utils/runtime-config";

export const GET: APIRoute = async () => {
	try {
		const configs = await getAllRuntimeConfigs();
		return new Response(JSON.stringify(configs), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (err) {
		console.error("[GET /api/runtime-config] 读取失败:", err);
		return new Response(JSON.stringify({}), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}
};