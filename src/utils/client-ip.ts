/**
 * 从请求头解析客户端 IP（仅服务端使用）。
 *
 * 优先级：CF 直连 IP > X-Forwarded-For 首项 > "unknown"。
 * 取自受信反代头；无任何代理头时返回 "unknown"，调用方须自行处理该哨兵值
 * （例如注册会话时不要把它当真实 IP 使用）。
 */
export function getClientIp(request: Request): string {
	const cf = request.headers.get("cf-connecting-ip");
	if (cf) return cf;
	const fwd = request.headers.get("x-forwarded-for");
	if (fwd) {
		const first = fwd.split(",")[0]?.trim();
		if (first) return first;
	}
	return "unknown";
}
