import { requireAuth } from "@/utils/auth";
import { renderMarkdown } from "@/utils/markdown-renderer";
import { renderMdxRuntime } from "@/utils/mdx-runtime";

export const prerender = false;

export async function POST({ request }) {
	const auth = await requireAuth(request);
	if (!auth.authenticated && auth.response) {
		return auth.response;
	}

	try {
		const body = await request.json();
		const { content, filePath, mdx } = body;

		if (!content || typeof content !== "string") {
			return new Response(
				JSON.stringify({ success: false, message: "缺少内容" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		/* 只有 .mdx 才启用 MDX 解析：remark-mdx 会把 `<`、`{` 等当成 JSX/表达式语法，
		   普通 .md 里出现 `<!-- 注释 -->` 这类不合法 JSX 会直接报错。
		   扩展名判定放在服务端，避免各调用点各写一份。 */
		const isMdx =
			mdx === true ||
			(typeof filePath === "string" && /\.mdx$/i.test(filePath.trim()));

		let html: string;
		if (isMdx) {
			/* 首选 evaluate 全量运行时：.map、模板串、任意表达式都真实渲染。
			   编辑中的内容随时可能是编译不过的半成品，失败时退回降级管线保底。 */
			try {
				html = await renderMdxRuntime(content);
			} catch (error) {
				console.warn(
					"[Admin Preview] MDX runtime failed, fallback to flatten:",
					error instanceof Error ? error.message : error,
				);
				html = await renderMarkdown(content, { mdx: true });
			}
		} else {
			html = await renderMarkdown(content);
		}

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
