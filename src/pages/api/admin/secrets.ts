import { ADMIN_SECRETS, getSecretItem } from "@/utils/admin-secrets";
import { generateSessionToken, requireAuth, setAuthCookie } from "@/utils/auth";
import { getClientIp, writeAuditLog } from "@/utils/login-guard";
import {
	applyEnvFileUpdates,
	decodePrivateKey,
	hashAdminPassword,
	incrementTokenVersion,
	isEnvFileWritable,
	readSecretPreview,
	readSecretStates,
	verifyCurrentPassword,
} from "@/utils/secret-io";

export const prerender = false;

const json = (body: unknown, status: number, extraHeaders?: Headers) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...(extraHeaders ? Object.fromEntries(extraHeaders) : {}) },
	});

const MAX_TEXT_LENGTH = 4096;
const MAX_KEY_LENGTH = 100 * 1024;

/** 涉及管理员认证的键：修改时必须二次验证当前密码 */
const AUTH_KEYS = new Set([
	"ADMIN_USERNAME",
	"ADMIN_PASSWORD",
	"ADMIN_JWT_SECRET",
]);

export async function GET({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const states = readSecretStates();
	const items = ADMIN_SECRETS.map((item) => ({
		key: item.key,
		group: item.group,
		label: item.label,
		description: item.description,
		kind: item.kind,
		sensitive: item.sensitive,
		required: item.required,
		configured: states[item.key] === true,
		// 仅非机密密钥回显真实值（供表单编辑），机密密钥只返回状态
		...(!item.sensitive ? { preview: readSecretPreview(item.key) } : {}),
	}));

	return json(
		{
			success: true,
			writable: isEnvFileWritable(),
			file: ".env.local",
			items,
		},
		200,
	);
}

export async function POST({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	if (!isEnvFileWritable()) {
		return json(
			{
				success: false,
				message:
					"当前为生产构建，文件系统只读。请到部署平台（如 Vercel）的环境变量设置中配置这些密钥。",
			},
			403,
		);
	}

	try {
		const body = await request.json();
		const entries = Array.isArray(body?.entries) ? body.entries : null;
		if (!entries) {
			return json({ success: false, message: "请求格式错误" }, 400);
		}

		const valid: { key: string; value?: string; delete?: boolean }[] = [];
		const ignored: string[] = [];
		for (const entry of entries) {
			const key = typeof entry?.key === "string" ? entry.key : "";
			if (!getSecretItem(key)) {
				ignored.push(key || "(未知)");
				continue;
			}
			const isDelete = entry.delete === true;
			const rawValue = typeof entry.value === "string" ? entry.value : "";
			if (!isDelete && rawValue === "") continue; // 空值视为不修改
			valid.push({
				key,
				value: rawValue,
				...(isDelete ? { delete: true } : {}),
			});
		}

		if (valid.length === 0) {
			return json({ success: false, message: "没有需要保存的修改" }, 400);
		}

		// 涉及管理员认证信息的修改：二次验证当前密码（防 CSRF / 会话劫持）
		const touchesAuth = valid.some((entry) => AUTH_KEYS.has(entry.key));
		if (touchesAuth) {
			const currentPassword =
				typeof body.currentPassword === "string" ? body.currentPassword : "";
			if (!currentPassword) {
				return json(
					{ success: false, message: "修改认证信息需要验证当前登录密码" },
					400,
				);
			}
			if (!verifyCurrentPassword(currentPassword)) {
				return json(
					{ success: false, message: "当前密码验证失败，未保存任何修改" },
					401,
				);
			}
		}

		// 长度校验：私钥字段放宽，其余限制 4KB
		for (const entry of valid) {
			const item = getSecretItem(entry.key);
			if (!item) continue;
			// ADMIN_PASSWORD 存哈希：填入 64 位 hex（旧版 SHA256 哈希）或 scrypt$ 开头
			 // （新版自带哈希）视为已是哈希；其余视为明文，自动转为 scrypt 哈希
			if (
				entry.key === "ADMIN_PASSWORD" &&
				entry.value &&
				!/^[0-9a-f]{64}$/i.test(entry.value) &&
				!entry.value.startsWith("scrypt$")
			) {
				entry.value = hashAdminPassword(entry.value);
			}
			const limit =
				item.kind === "multiline" ? MAX_KEY_LENGTH : MAX_TEXT_LENGTH;
			if (entry.value && entry.value.length > limit) {
				return json(
					{
						success: false,
						message: `${item.label} 内容过长（超过 ${limit} 字符）`,
					},
					400,
				);
			}
		}

		const { updated, removed } = applyEnvFileUpdates(valid);
		console.log(
			`[Admin Secrets] 已保存 .env.local（更新: ${updated.join(", ") || "无"}，移除: ${removed.join(", ") || "无"}）`,
		);

		// 读回校验：逐项比对写入值是否确实落盘（个别运行环境存在写入后读不到的现象）
		const expectedByKey = new Map(
			valid
				.filter((entry) => !entry.delete)
				.map((entry) => [entry.key, entry.value ?? ""]),
		);
		const mismatched: string[] = [];
		for (const key of updated) {
			const written = readSecretPreview(key);
			if (written === "") {
				mismatched.push(key);
				continue;
			}
			// 私钥存储时被自动转换为 Base64，读回后需还原再比对
			const normalized =
				key === "GITHUB_PRIVATE_KEY" ? decodePrivateKey(written) : written;
			if (normalized !== expectedByKey.get(key)) mismatched.push(key);
		}

		// 认证信息变更：会话版本号 +1 使所有旧会话立即失效，并为本请求续签新会话
		const authUpdated = updated.filter((key) => AUTH_KEYS.has(key));
		const responseHeaders = new Headers();
		if (authUpdated.length > 0) {
			incrementTokenVersion();
			setAuthCookie(generateSessionToken(), responseHeaders);
		}

		// 审计：认证信息变更与普通密钥变更加以区分
		if (authUpdated.length > 0) {
			writeAuditLog({
				event: "secrets_credentials_updated",
				client: getClientIp(request),
				username: "(控制台)",
				detail: `keys=${authUpdated.join(",")}${mismatched.length > 0 ? `; readback-fail=${mismatched.join(",")}` : ""}`,
			});
		} else if (updated.length > 0) {
			writeAuditLog({
				event: "secrets_updated",
				client: getClientIp(request),
				username: "(控制台)",
				detail: `keys=${updated.join(",")}`,
			});
		}

		const parts: string[] = [];
		if (updated.length > 0) parts.push(`已更新 ${updated.length} 项`);
		if (removed.length > 0) parts.push(`已清除 ${removed.length} 项`);
		if (ignored.length > 0) parts.push(`跳过无效项 ${ignored.length} 项`);
		if (mismatched.length > 0) {
			parts.push(
				`警告: ${mismatched.join("、")} 读回校验未通过（可能未实际落盘），请重启服务后核对`,
			);
		}

		return json(
			{
				success: true,
				message: `${parts.join("，")}。重启服务后新值才会生效（登录验证与 GitHub 同步使用环境变量）。`,
				updated,
				removed,
				mismatched,
				writable: true,
			},
			200,
			responseHeaders,
		);
	} catch (error) {
		console.error(
			"[Admin Secrets] 保存失败:",
			error instanceof Error ? error.stack : error,
		);
		return json(
			{
				success: false,
				message: error instanceof Error ? error.message : "保存密钥失败",
			},
			500,
		);
	}
}
