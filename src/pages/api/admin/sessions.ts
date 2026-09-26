import { requireAuth } from "@/utils/auth";
import { getClientIp, writeAuditLog } from "@/utils/login-guard";
import {
	listSessions,
	revokeAllExcept,
	revokeSession,
} from "@/utils/session-store";

export const prerender = false;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// 会话列表：返回全部在线设备会话，并标记当前请求所属会话（前端高亮"本设备"）
export async function GET({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const sessions = await listSessions();
	const list = sessions.map((s) => ({
		sid: s.sid,
		device: s.device,
		ua: s.ua,
		ip: s.ip,
		loginAt: s.loginAt,
		lastSeenAt: s.lastSeenAt,
		remember: s.remember,
		isCurrent: s.sid === auth.payload?.sid,
	}));

	writeAuditLog({
		event: "sessions_listed",
		client: getClientIp(request),
		username: "admin",
	});

	return json({ success: true, sessions: list });
}

// 踢下线：?sid=xxx 踢指定设备；?allOther=1 踢除当前设备外的全部
export async function DELETE({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;
	const currentSid = auth.payload?.sid;

	const url = new URL(request.url);
	const sid = url.searchParams.get("sid");
	const allOther = url.searchParams.get("allOther") === "1";

	let revoked = 0;
	let detail = "";
	if (allOther) {
		if (!currentSid) {
			return json({ success: false, message: "无法识别当前会话" }, 400);
		}
		revoked = await revokeAllExcept(currentSid);
		detail = `踢除其他设备会话 ${revoked} 个`;
	} else if (sid) {
		const ok = await revokeSession(sid);
		if (!ok) {
			return json({ success: false, message: "该会话不存在或已失效" }, 404);
		}
		revoked = 1;
		detail = `踢除会话 ${sid.slice(0, 8)}…`;
	} else {
		return json({ success: false, message: "缺少参数" }, 400);
	}

	writeAuditLog({
		event: "session_revoked",
		client: getClientIp(request),
		username: "admin",
		detail,
	});

	return json({ success: true, revoked });
}
