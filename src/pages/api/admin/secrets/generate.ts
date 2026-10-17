import { requireAuth } from "@/utils/auth";
import { generateJwtSecret } from "@/utils/secret-io";

export const prerender = false;

const json = (body: unknown, status: number) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

// 生成工具端点：只返回生成结果供前端填入表单，不直接写入 .env.local，
// 最终是否保存由用户在表单中确认。
export async function POST({
	request,
}: {
	request: Request;
}): Promise<Response> {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) return auth.response;

	try {
		const body = await request.json();
		const type = body?.type;

		if (type === "jwt") {
			return json({ success: true, value: generateJwtSecret() }, 200);
		}

		return json({ success: false, message: "未知的生成类型" }, 400);
	} catch (error) {
		console.error(
			"[Admin Secrets] 生成失败:",
			error instanceof Error ? error.stack : error,
		);
		return json(
			{
				success: false,
				message: error instanceof Error ? error.message : "生成失败",
			},
			500,
		);
	}
}
