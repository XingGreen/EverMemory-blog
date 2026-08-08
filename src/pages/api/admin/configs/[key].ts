import { getConfigItem } from "@/utils/admin-settings";
import { requireAuth } from "@/utils/auth";
import { readConfigJson, saveConfigJson } from "@/utils/config-io";

export const prerender = false;

const json = (body: unknown, status: number) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

export async function GET({ request, params }) {
	const auth = requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const item = getConfigItem(params.key);
	if (!item)
		return json({ success: false, message: `未知配置项: ${params.key}` }, 404);

	try {
		const { data } = readConfigJson(params.key);
		return json({ success: true, data, file: item.file }, 200);
	} catch (error) {
		console.error(
			"[Admin Config] 读取失败:",
			error instanceof Error ? error.stack : error,
		);
		return json(
			{
				success: false,
				message: error instanceof Error ? error.message : "读取配置失败",
			},
			500,
		);
	}
}

export async function POST({ request, params }) {
	const auth = requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const item = getConfigItem(params.key);
	if (!item)
		return json({ success: false, message: `未知配置项: ${params.key}` }, 404);

	try {
		const body = await request.json();
		const data = body?.data;
		// html 等原始文本配置：内容必须是字符串；json 配置必须是普通对象
		if (item.kind === "html") {
			if (typeof data !== "string") {
				return json({ success: false, message: "配置内容格式错误" }, 400);
			}
		} else if (!data || typeof data !== "object" || Array.isArray(data)) {
			return json({ success: false, message: "配置数据格式错误" }, 400);
		}

		const result = await saveConfigJson(params.key, data);
		console.log(
			`[Admin Config] 已保存 ${item.file}（本地: ${result.local}，GitHub: ${result.github}）`,
		);
		return json(
			{
				success: true,
				message: result.github
					? "保存成功（已同步到 GitHub）"
					: "保存成功（仅本地保存）",
				file: result.file,
			},
			200,
		);
	} catch (error) {
		console.error(
			"[Admin Config] 保存失败:",
			error instanceof Error ? error.stack : error,
		);
		return json(
			{
				success: false,
				message: error instanceof Error ? error.message : "保存配置失败",
			},
			500,
		);
	}
}
