import { unified } from "@astrojs/markdown-remark";
import remarkMath from "remark-math";
import remarkDirective from "remark-directive";
import remarkSectionize from "remark-sectionize";
import remarkAdmonitionToBlockquoteCallout from "remark-admonition-to-blockquote-callout";
import rehypeKatex from "rehype-katex";
import rehypeCallouts from "rehype-callouts";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import katex from "katex";
import { siteConfig } from "@/config";
import { parseDirectiveNode } from "@/plugins/remark-directive-rehype.js";
import rehypeExternalLinks from "@/plugins/rehype-external-links.mjs";
import rehypeFigure from "@/plugins/rehype-figure.mjs";

let processorInstance: ReturnType<typeof unified> | null = null;
let rendererPromise: Promise<Awaited<ReturnType<ReturnType<typeof unified>["createRenderer"]>>> | null = null;

/**
 * 获取与 Astro 配置一致的 Markdown 处理器
 * 包含项目使用的核心 remark/rehype 插件
 */
function getProcessor() {
	if (!processorInstance) {
		processorInstance = unified({
			remarkPlugins: [
				...(siteConfig.post.rehypeCallouts.enablePythonMarkdownAdmonitions !== false
					? [remarkAdmonitionToBlockquoteCallout]
					: []),
				remarkMath,
				remarkDirective,
				remarkSectionize,
				parseDirectiveNode,
			],
			rehypePlugins: [
				[rehypeKatex, { katex }],
				[rehypeCallouts, { theme: siteConfig.post.rehypeCallouts.theme }],
				rehypeSlug,
				rehypeFigure as any,
				[rehypeExternalLinks as any, { siteUrl: siteConfig.site_url }],
				[
					rehypeAutolinkHeadings,
					{
						behavior: "append",
						properties: {
							className: ["anchor"],
						},
						content: {
							type: "element",
							tagName: "span",
							properties: {
								className: ["anchor-icon"],
							},
							children: [],
						},
					},
				],
			],
		});
	}
	return processorInstance;
}

async function getRenderer() {
	if (!rendererPromise) {
		const processor = getProcessor();
		rendererPromise = processor.createRenderer({});
	}
	return rendererPromise;
}

/**
 * 渲染 Markdown 为 HTML，使用与主站相同的渲染管线
 */
export async function renderMarkdown(content: string): Promise<string> {
	const renderer = await getRenderer();
	const result = await renderer.render(content);
	return result.code;
}
