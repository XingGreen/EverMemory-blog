/**
 * 同步记录（只读）。
 *
 * 数据来自 audit-log 的持久化存储（KV，90 天 TTL），
 * 只挑同步相关的事件，其余后台操作不在这个页面出现。
 */

import { listAuditLogs } from "@/utils/audit-log";
import { requireAuth } from "@/utils/auth";

export const prerender = false;

const SYNC_EVENTS = new Set(["sync_applied", "sync_checked"]);

export async function GET({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const url = new URL(request.url);
	const limit = Math.min(
		Number(url.searchParams.get("limit") ?? 100) || 100,
		300,
	);

	/* 审计日志里同步事件占比低，按 limit*2 取窗口再过滤，实际条数常常不足。
	   窗口取满就说明「更早的还没翻到」，用 truncated 如实告诉前端，
	   而不是让面板看起来像是"只有这几条"。 */
	const scanWindow = limit * 2;
	const all = await listAuditLogs(scanWindow);
	const items = all.filter((e) => SYNC_EVENTS.has(e.event)).slice(0, limit);

	return new Response(
		JSON.stringify({
			success: true,
			total: items.length,
			truncated: all.length >= scanWindow,
			items: items.map((e) => ({
				event: e.event,
				at: e.at ?? null,
				detail: e.detail ?? "",
				username: e.username ?? "",
			})),
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}
