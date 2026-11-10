import { getSecretItem, isManagedSecret } from "@/utils/admin-secrets";
import { writeAuditLog } from "@/utils/audit-log";
import {
	generateSessionToken,
	hasFreshAuth,
	requireAuth,
	SESSION_MAX_AGE,
	STEP_UP_WINDOW_SECONDS,
	setAuthCookie,
	stepUpRequiredResponse,
} from "@/utils/auth";
import { getClientIp } from "@/utils/client-ip";
import {
	incrementTokenVersion,
	isEnvFileWritable,
	readSecretStates,
	rotateManagedSecret,
} from "@/utils/secret-io";

export const prerender = false;

const json = (
	body: unknown,
	status: number,
	extraHeaders?: Headers,
): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			...(extraHeaders ? Object.fromEntries(extraHeaders) : {}),
		},
	});

/**
 * POST /api/admin/secrets/rotate/ — 轮换由服务端托管的密钥
 *
 * 目前仅支持 ADMIN_JWT_SECRET：该密钥不暴露给用户手动填写，由服务端生成并写入
 * .env.local，仅在需要「让所有已签发会话立即失效」时调用。
 *
 * 安全约束与保存接口一致：
 *  - 必须登录
 *  - 必须在强认证新鲜期内（登录后 5 分钟），否则 403 STEP_UP_REQUIRED
 *  - 轮换后版本号 +1 使旧令牌失效，并为本请求续签新 Cookie，避免操作者自己被踢
 *  - 只读部署（生产）环境直接拒绝，提示去平台配置
 */
export async function POST({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	let key = "";
	try {
		const body = await request.json();
		key = typeof body?.key === "string" ? body.key : "";
	} catch {
		return json({ success: false, message: "请求格式错误" }, 400);
	}

	const item = getSecretItem(key);
	if (!item || !isManagedSecret(key)) {
		return json(
			{ success: false, message: "该密钥不支持轮换（仅托管密钥可轮换）" },
			400,
		);
	}

	// 轮换会让所有会话立即失效，属于危险操作：要求强认证足够新鲜
	if (!hasFreshAuth(auth.payload)) {
		return stepUpRequiredResponse();
	}

	if (!isEnvFileWritable()) {
		return json(
			{
				success: false,
				message:
					"当前为只读部署环境，无法自动轮换。请到部署平台的环境变量设置中更新该密钥后重新部署。",
				managed: true,
				readonly: true,
			},
			403,
		);
	}

	const next = rotateManagedSecret(key);
	if (!next) {
		return json(
			{
				success: false,
				message: `轮换 ${key} 失败，请检查 .env.local 写入权限`,
			},
			500,
		);
	}

	// 旧令牌全部失效 + 为本请求续签，保证操作者当前会话不中断
	incrementTokenVersion();
	const headers = new Headers();
	setAuthCookie(
		generateSessionToken(
			SESSION_MAX_AGE,
			auth.payload?.sid,
			undefined,
			auth.payload?.amr,
		),
		headers,
	);

	await writeAuditLog({
		event: "secrets_rotated",
		client: getClientIp(request),
		username: "(控制台)",
		detail: `key=${key}`,
	});

	const states = readSecretStates();
	return json(
		{
			success: true,
			message: `已轮换 ${item.label}，所有旧会话已失效。重启服务后新密钥才会被进程读取（当前进程仍用旧值，但版本号校验已生效）。`,
			key,
			configured: states[key] === true,
			stepUpWindowSeconds: STEP_UP_WINDOW_SECONDS,
		},
		200,
		headers,
	);
}
