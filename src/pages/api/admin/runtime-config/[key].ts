// 后台读写运行时配置覆盖层（需登录）。
// PUT   保存覆盖值（即时生效，不触发重建）
// DELETE 清除覆盖值（回落构建期源码默认值）
import type { APIRoute } from "astro";
export const prerender = false;

import { getConfigItem } from "@/utils/admin-settings";
import { requireAuth } from "@/utils/auth";
import {
	delRuntimeConfig,
	isRuntimeConfigKey,
	setRuntimeConfig,
} from "@/utils/runtime-config";

export const PUT: APIRoute = async ({ request, params }) => {
	const key = params.key ?? "";
	if (!isRuntimeConfigKey(key)) {
		return new Response(
			JSON.stringify({ success: false, message: `不支持的运行时配置: ${key}` }),
			{ status: 400, headers: { "Content-Type": "application/json" } },
		);
	}
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	try {
		const body = (await request.json()) as { data?: unknown };
		if (body.data === undefined || body.data === null) {
			return new Response(
				JSON.stringify({ success: false, message: "缺少 data 字段" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}
		await setRuntimeConfig(key, body.data);
		const item = getConfigItem(key);
		const message = item
			? `「${item.label}」已保存并即时生效（无需重建）`
			: "已保存并即时生效（无需重建）";
		return new Response(JSON.stringify({ success: true, message }), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (err) {
		console.error(`[PUT /api/admin/runtime-config/${key}] 保存失败:`, err);
		return new Response(
			JSON.stringify({ success: false, message: "运行时配置保存失败" }),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
};

export const DELETE: APIRoute = async ({ request, params }) => {
	const key = params.key ?? "";
	if (!isRuntimeConfigKey(key))
		return new Response("Not Found", { status: 404 });
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;
	try {
		await delRuntimeConfig(key);
		return new Response(
			JSON.stringify({ success: true, message: "已恢复构建期默认值" }),
			{ headers: { "Content-Type": "application/json" } },
		);
	} catch (err) {
		console.error(`[DELETE /api/admin/runtime-config/${key}] 清除失败:`, err);
		return new Response(
			JSON.stringify({ success: false, message: "清除失败" }),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
};
