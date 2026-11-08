import { requireAuth } from "@/utils/auth";
import { rewriteRelativeSrc } from "@/utils/admin-asset-url";
import { renderMarkdown } from "@/utils/markdown-renderer";
import { renderMdxFallback } from "@/utils/mdx-fallback";
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

		/* ── 路由分发：双通道 ──
		   .md  → MD 通道（renderMarkdown，标准 Markdown，gfm/smartypants 由
		          markdown-remark 默认启用）
		   .mdx → MDX 主通道（evaluate 全量执行）；编辑中的半成品编译不过时
		          落到 MDX 降级通道（remark-mdx-flatten，零执行保结构）
		   扩展名判定放服务端，避免各调用点各写一份。 */
		const isMdx =
			mdx === true ||
			(typeof filePath === "string" && /\.mdx$/i.test(filePath.trim()));

		let html: string;
		if (isMdx) {
			try {
				html = await renderMdxRuntime(content);
			} catch (error) {
				console.warn(
					"[Admin Preview] MDX runtime failed, fallback to flatten:",
					error instanceof Error ? error.message : error,
				);
				html = await renderMdxFallback(content);
			}
		} else {
			html = await renderMarkdown(content);
		}

		/* 相对图片路径（`./images/x.avif`）在后台页面里会以 `/admin/...` 为基准解析，
		   必然 404；统一换成后台取图端点，按文章文件所在目录取源文件。 */
		html = rewriteRelativeSrc(html, typeof filePath === "string" ? filePath : "");

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
