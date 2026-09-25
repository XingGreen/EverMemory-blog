import { ADMIN_SECRETS, getSecretItem } from "@/utils/admin-secrets";
import { requireAuth } from "@/utils/auth";
import {
	applyEnvFileUpdates,
	isEnvFileWritable,
	readSecretPreview,
	readSecretStates,
} from "@/utils/secret-io";

export const prerender = false;

const json = (body: unknown, status: number) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

const MAX_TEXT_LENGTH = 4096;
const MAX_KEY_LENGTH = 100 * 1024;

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

		// 长度校验：私钥字段放宽，其余限制 4KB
		for (const entry of valid) {
			const item = getSecretItem(entry.key);
			if (!item) continue;
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

		const parts: string[] = [];
		if (updated.length > 0) parts.push(`已更新 ${updated.length} 项`);
		if (removed.length > 0) parts.push(`已清除 ${removed.length} 项`);
		if (ignored.length > 0) parts.push(`跳过无效项 ${ignored.length} 项`);

		return json(
			{
				success: true,
				message: `${parts.join("，")}。重启服务后新值才会生效（登录验证与 GitHub 同步使用环境变量）。`,
				updated,
				removed,
				writable: true,
			},
			200,
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
