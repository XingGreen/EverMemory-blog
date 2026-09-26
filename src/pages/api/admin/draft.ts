import { requireAuth } from "@/utils/auth";
import { getClientIp, writeAuditLog } from "@/utils/login-guard";
import { getStore } from "@/utils/persist-store";

export const prerender = false;

const DRAFT_KEY = "admin:draft";

/** 可自动上传到云端的字段（敏感字段 password/passwordHint 不参与） */
export interface CloudDraft {
	title: string;
	author: string;
	category: string;
	description: string;
	content: string;
	slug: string;
	published: string;
	updated: string;
	isDraft: boolean;
	isPinned: boolean;
	image: string;
	lang: string;
	licenseName: string;
	licenseUrl: string;
	sourceLink: string;
	enableComment: boolean;
	tags: string[];
	/** 云备份时间 */
	savedAt: number;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// 读取云端草稿（跨设备时用于恢复；无草稿返回 draft: null）
export async function GET({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const store = getStore();
	try {
		const draft = await store.get<CloudDraft>(DRAFT_KEY);
		return json({ success: true, draft });
	} catch (err) {
		console.error("[Draft] 读取云端草稿失败:", err);
		return json({ success: false, message: "读取云端草稿失败" }, 500);
	}
}

// 保存/覆盖云端草稿
export async function POST({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ success: false, message: "请求体不是合法 JSON" }, 400);
	}

	if (!body.content && !body.title) {
		return json({ success: false, message: "草稿为空" }, 400);
	}

	const draft: CloudDraft = {
		title: String(body.title ?? ""),
		author: String(body.author ?? ""),
		category: String(body.category ?? ""),
		description: String(body.description ?? ""),
		content: String(body.content ?? ""),
		slug: String(body.slug ?? ""),
		published: String(body.published ?? ""),
		updated: String(body.updated ?? ""),
		isDraft: Boolean(body.isDraft),
		isPinned: Boolean(body.isPinned),
		image: String(body.image ?? ""),
		lang: String(body.lang ?? ""),
		licenseName: String(body.licenseName ?? ""),
		licenseUrl: String(body.licenseUrl ?? ""),
		sourceLink: String(body.sourceLink ?? ""),
		enableComment:
			body.enableComment !== undefined ? Boolean(body.enableComment) : true,
		tags: Array.isArray(body.tags)
			? body.tags.filter((t): t is string => typeof t === "string")
			: [],
		savedAt: Date.now(),
	};

	const store = getStore();
	try {
		await store.set(DRAFT_KEY, draft);
		writeAuditLog({
			event: "draft_saved",
			client: getClientIp(request),
			username: "admin",
			detail: `云端草稿已保存（字符数 ${draft.content.length}）`,
		});
		return json({ success: true, savedAt: draft.savedAt });
	} catch (err) {
		console.error("[Draft] 云端草稿保存失败:", err);
		return json({ success: false, message: "云端草稿保存失败" }, 500);
	}
}

// 清除云端草稿（文章正式保存成功后调用）
export async function DELETE({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const store = getStore();
	try {
		await store.del(DRAFT_KEY);
		return json({ success: true });
	} catch (err) {
		console.error("[Draft] 清除云端草稿失败:", err);
		return json({ success: false, message: "清除云端草稿失败" }, 500);
	}
}
