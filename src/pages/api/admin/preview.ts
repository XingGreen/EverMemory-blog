import { requireAuth } from "@/utils/auth";
import { renderMarkdown } from "@/utils/markdown-renderer";

export const prerender = false;

export async function POST({ request }) {
	const auth = requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	try {
		const body = await request.json();
		const { content } = body;

		if (!content || typeof content !== "string") {
			return new Response(
				JSON.stringify({ success: false, message: "缺少内容" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		const html = await renderMarkdown(content);

		return new Response(JSON.stringify({ success: true, html }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error(
			"[Admin Preview] Render failed:",
			error instanceof Error ? error.message : error,
		);
		return new Response(
			JSON.stringify({ success: false, message: "渲染失败" }),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}
