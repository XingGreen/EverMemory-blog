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

	const all = await listAuditLogs(limit * 2);
	const items = all.filter((e) => SYNC_EVENTS.has(e.event)).slice(0, limit);

	return new Response(
		JSON.stringify({
			success: true,
			total: items.length,
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
