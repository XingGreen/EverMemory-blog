import { requireAuth } from "@/utils/auth";
import { getClientIp, writeAuditLog } from "@/utils/login-guard";
import { buildEnvExport, buildVercelCliCommands } from "@/utils/secret-export";

export const prerender = false;

/** GET /api/admin/secrets/export/?format=env|vercel — 导出本地已配置密钥 */
export async function GET({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	const url = new URL(request.url);
	const format = url.searchParams.get("format") === "vercel" ? "vercel" : "env";
	const content =
		format === "vercel" ? buildVercelCliCommands() : buildEnvExport();

	writeAuditLog({
		event: "secrets_exported",
		client: getClientIp(request),
		username: "(控制台)",
		detail: `format=${format}`,
	});

	const headers = new Headers({
		"Content-Type": "text/plain; charset=utf-8",
		// 密钥类响应禁止缓存，避免被浏览器/代理留存
		"Cache-Control": "no-store",
	});
	if (format === "env") {
		headers.set(
			"Content-Disposition",
			'attachment; filename="firefly-env-export.env"',
		);
	}

	return new Response(content, { status: 200, headers });
}
