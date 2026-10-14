// 控制面：IP 黑名单管理（仅第二空间 / 应急控制台可调用）。
// GET    列出当前生效的黑名单
// POST   封禁 { ip, reason?, ttlSeconds? }——并同时踢掉该 IP 的现有会话
// DELETE 解封 ?ip=
//
// 封禁与踢会话必须一起做才闭合：只挡新登录，攻击者仍握着旧会话继续用。
import { requireSuperAuth } from "@/utils/auth";
import {
	banIp,
	getClientIp,
	listBanned,
	unbanIp,
	writeAuditLog,
} from "@/utils/login-guard";
import { revokeSessionsByIp } from "@/utils/session-store";

export const prerender = false;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export async function GET({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireSuperAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	return json({ success: true, banned: await listBanned() });
}

export async function POST({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireSuperAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	let body: { ip?: unknown; reason?: unknown; ttlSeconds?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, message: "请求体不是合法 JSON" }, 400);
	}

	const ip = typeof body.ip === "string" ? body.ip.trim() : "";
	if (!ip) return json({ success: false, message: "缺少 ip" }, 400);

	const ttlSeconds =
		typeof body.ttlSeconds === "number" && Number.isFinite(body.ttlSeconds)
			? body.ttlSeconds
			: 0;
	const reason = typeof body.reason === "string" ? body.reason : undefined;

	await banIp(ip, {
		reason,
		by: `${auth.payload?.username || "admin"}(${auth.payload?.role ?? "super"})`,
		ttlSeconds,
	});
	// 封禁同时踢掉该 IP 的现有会话，避免「挡了新登录却留着旧会话」
	const revoked = await revokeSessionsByIp(ip);

	writeAuditLog({
		event: "ip_banned",
		client: getClientIp(request),
		username: auth.payload?.username || "admin",
		detail: `ip=${ip} ttl=${ttlSeconds > 0 ? `${ttlSeconds}s` : "permanent"} revoked=${revoked}`,
	});

	return json({ success: true, revoked });
}

export async function DELETE({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireSuperAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const ip = new URL(request.url).searchParams.get("ip")?.trim() ?? "";
	if (!ip) return json({ success: false, message: "缺少 ip" }, 400);

	const ok = await unbanIp(ip);
	if (!ok) return json({ success: false, message: "该 IP 不在黑名单中" }, 404);

	writeAuditLog({
		event: "ip_unbanned",
		client: getClientIp(request),
		username: auth.payload?.username || "admin",
		detail: `ip=${ip}`,
	});

	return json({ success: true });
}
