import { writeAuditLog } from "@/utils/audit-log";
import { getSecretItem, isManagedSecret } from "@/utils/admin-secrets";
import { requireAuth } from "@/utils/auth";
import { getClientIp } from "@/utils/client-ip";
import { readSecretValue } from "@/utils/secret-io";

export const prerender = false;

const json = (body: unknown, status: number, extraHeaders?: Headers) =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			// 明文密钥绝不允许被浏览器或中间代理缓存
			"Cache-Control": "no-store",
			...(extraHeaders ? Object.fromEntries(extraHeaders) : {}),
		},
	});

/**
 * GET /api/admin/secrets/value/?key=GITHUB_APP_ID — 按需读取单个密钥的明文
 *
 * 为什么单独开接口而不放进列表接口：
 * 列表接口刻意对敏感项只返回 configured 状态、永不下发明文。若改成一次性下发全部
 * 明文，等于每次打开密钥页就把所有密钥暴露在响应与浏览器内存里。这里保持默认
 * 不暴露，只有用户主动点击「显示」时才取单个字段。
 *
 * 安全约束：
 *  - 必须登录
 *  - 只接受清单内的 key，拒绝任意环境变量读取（防止越权读到 ADMIN_PASSWORD 等）
 *  - 托管密钥（ADMIN_JWT_SECRET）拒绝读取：它由服务端生成，用户无需也不需要看到
 *  - 每次读取写审计日志，便于察觉异常翻看
 */
export async function GET({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const url = new URL(request.url);
	const key = url.searchParams.get("key") ?? "";

	const item = getSecretItem(key);
	if (!item) {
		return json({ success: false, message: "未知的配置项" }, 400);
	}

	if (isManagedSecret(key)) {
		return json(
			{ success: false, message: "该密钥由服务端托管，不支持查看明文" },
			400,
		);
	}

	let value = "";
	try {
		value = readSecretValue(key);
	} catch {
		return json({ success: false, message: "读取失败" }, 500);
	}

	writeAuditLog({
		event: "secrets_value_revealed",
		client: getClientIp(request),
		username: "(控制台)",
		detail: `key=${key}`,
	});

	return json({ success: true, key, value }, 200);
}
