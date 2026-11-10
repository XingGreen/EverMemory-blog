import { getConfigItem } from "@/utils/admin-settings";
import { requireAuth } from "@/utils/auth";
import {
	isRemoteRuntime,
	readConfigJson,
	readConfigSnapshot,
	readConfigSource,
	readConfigSourceFromGitHub,
	saveConfigJson,
	saveConfigJsonRemote,
	saveConfigSource,
} from "@/utils/config-io";
import { getStorageProvider } from "@/utils/providers/registry";

export const prerender = false;

const json = (body: unknown, status: number) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

/**
 * 快照模块的条目形如 `{ data, source }`（与前端读取 HTML 内联快照的结构一致），
 * 不是配置值本身。readConfigSnapshot 返回的是整个条目，取值必须再解一层。
 */
type SnapshotEntry = { data?: unknown; source?: string };

async function readSnapshotEntry(
	key: string,
): Promise<SnapshotEntry | undefined> {
	const entry = await readConfigSnapshot(key);
	if (!entry || typeof entry !== "object") return undefined;
	return entry as SnapshotEntry;
}

export async function GET({ request, params }) {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const item = getConfigItem(params.key);
	if (!item)
		return json({ success: false, message: `未知配置项: ${params.key}` }, 404);

	try {
		// Serverless 环境无本地文件系统：
		// json 配置读取构建快照（可视化表单可用），html 配置读取 GitHub 源码
		if (isRemoteRuntime()) {
			// 两条数据通道相互独立：表单数据来自构建快照（随产物打包，不依赖
			// GitHub 可达性），源码只服务于「源码模式」编辑。
			const entry = await readSnapshotEntry(params.key);
			const source = await readConfigSourceFromGitHub(params.key);

			// html 配置的内容就是源码本身，没有第二份可展示的数据；用构建快照
			// 顶替会让过期内容冒充当前版本，一保存就回滚线上文件。
			if (item.kind === "html") {
				if (source === null)
					return json(
						{ success: false, message: "从 GitHub 读取配置失败" },
						500,
					);
				return json(
					{ success: true, data: null, source, file: item.file, remote: true },
					200,
				);
			}

			const data = entry?.data;
			// 表单数据与源码都拿不到才算失败；只缺源码时表单仍可读，只是不能编辑源码。
			if (data === undefined && source === null)
				return json(
					{ success: false, message: "配置快照缺失，且从 GitHub 读取配置失败" },
					500,
				);
			return json(
				{
					success: true,
					data: data ?? null,
					source,
					file: item.file,
					remote: true,
				},
				200,
			);
		}

		const { data } = readConfigJson(params.key);
		// 同时返回文件源码，供前端"源码"模式直接展示/编辑真实文件
		const source = readConfigSource(params.key);
		return json(
			{ success: true, data, source, file: item.file, remote: false },
			200,
		);
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
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const item = getConfigItem(params.key);
	if (!item)
		return json({ success: false, message: `未知配置项: ${params.key}` }, 404);

	try {
		const body = await request.json();

		// Serverless 环境：源码或表单数据均以 GitHub 为存储（触发自动重建后生效）
		if (isRemoteRuntime()) {
			if (typeof body?.source === "string" && body.source.length > 0) {
				const storage = getStorageProvider();
				if (!storage.isConfigured()) {
					return json(
						{ success: false, message: "请配置 GitHub App 凭证" },
						400,
					);
				}
				const ok = await storage.writeFile(
					item.file,
					body.source,
					`update config source (${params.key}) via admin dashboard`,
				);
				if (!ok)
					return json(
						{ success: false, message: "GitHub 保存失败，请稍后重试" },
						500,
					);
				return json(
					{
						success: true,
						message: "保存成功（已提交 GitHub，自动重建后生效）",
						file: item.file,
					},
					200,
				);
			}
			if (item.kind !== "html" && body?.data && typeof body.data === "object") {
				try {
					const ok = await saveConfigJsonRemote(params.key, body.data);
					if (!ok)
						return json(
							{ success: false, message: "GitHub 保存失败，请稍后重试" },
							500,
						);
					return json(
						{
							success: true,
							message: "保存成功（已提交 GitHub，自动重建后生效）",
							file: item.file,
						},
						200,
					);
				} catch (error) {
					return json(
						{
							success: false,
							message: error instanceof Error ? error.message : "保存配置失败",
						},
						500,
					);
				}
			}
			return json({ success: false, message: "配置内容格式错误" }, 400);
		}

		// 源码模式：整份文件原文写回（TS 校验 + 失败回滚），html 同样适用
		if (typeof body?.source === "string" && body.source.length > 0) {
			const result = await saveConfigSource(params.key, body.source);
			console.log(
				`[Admin Config] 已保存源码 ${item.file}（本地: ${result.local}，GitHub: ${result.github}）`,
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
		}

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
