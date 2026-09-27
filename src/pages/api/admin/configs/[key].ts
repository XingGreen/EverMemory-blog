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
import { saveFileToGitHub } from "@/utils/github-app";

export const prerender = false;

const json = (body: unknown, status: number) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

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
			const source = await readConfigSourceFromGitHub(params.key);
			if (source === null)
				return json(
					{ success: false, message: "从 GitHub 读取配置失败" },
					500,
				);
			if (item.kind === "html") {
				return json(
					{
						success: true,
						data: null,
						source,
						file: item.file,
						remote: true,
					},
					200,
				);
			}
			const snapshotData = await readConfigSnapshot(params.key);
			if (snapshotData === undefined) {
				// 快照缺失：降级为纯源码模式
				return json(
					{
						success: true,
						data: null,
						source,
						file: item.file,
						remote: true,
					},
					200,
				);
			}
			return json(
				{
					success: true,
					data: snapshotData,
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
				const ok = await saveFileToGitHub(
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
							message:
								error instanceof Error ? error.message : "保存配置失败",
						},
						500,
					);
				}
			}
			return json(
				{ success: false, message: "配置内容格式错误" },
				400,
			);
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
