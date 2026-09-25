import { isEnvFileWritable } from "@/utils/secret-io";
import { isInitialized, verifySetupToken } from "@/utils/setup";

export const prerender = false;

function json(body: unknown, status = 200, extraHeaders?: Headers): Response {
	const headers = new Headers({ "Content-Type": "application/json" });
	if (extraHeaders) {
		for (const [key, value] of extraHeaders) headers.set(key, value);
	}
	return new Response(JSON.stringify(body), { status, headers });
}

/**
 * POST /api/admin/setup/verify-token/ — 轻量令牌校验（仅验证，不消费）
 * 供初始化表单的第一步使用：先确认安装令牌正确，再展示账号表单。
 * 真正的初始化（POST /api/admin/setup/）仍会再次校验令牌，防止绕过。
 */
export async function POST({
	request,
}: {
	request: Request;
}): Promise<Response> {
	try {
		if (isInitialized()) {
			return json({ success: false, message: "已完成初始化，请直接登录" }, 409);
		}
		if (!isEnvFileWritable()) {
			return json(
				{ success: false, message: "当前为只读部署环境，无需安装令牌" },
				403,
			);
		}

		const body = (await request.json()) as { token?: string };
		if (!verifySetupToken(String(body.token || ""))) {
			return json({ success: false, message: "安装令牌无效或已过期" }, 401);
		}
		return json({ success: true, message: "令牌验证通过" });
	} catch (error) {
		console.error(
			"[Setup] 令牌验证异常:",
			error instanceof Error ? error.stack : error,
		);
		return json({ success: false, message: "验证失败，请稍后重试" }, 500);
	}
}
