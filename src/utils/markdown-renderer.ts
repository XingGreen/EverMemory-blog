import { unified } from "@astrojs/markdown-remark";
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";
import { pluginCollapsible } from "expressive-code-collapsible";
import { pluginLanguageBadge } from "expressive-code-language-badge";
import katex from "katex";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeCallouts from "rehype-callouts";
import rehypeExpressiveCode, {
	type ThemeObjectOrShikiThemeName,
} from "rehype-expressive-code";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkAdmonitionToBlockquoteCallout from "remark-admonition-to-blockquote-callout";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import remarkSectionize from "remark-sectionize";
import { expressiveCodeConfig, plantumlConfig, siteConfig } from "@/config";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import rehypeEmailProtection from "@/plugins/rehype-email-protection.mjs";
import rehypeExternalLinks from "@/plugins/rehype-external-links.mjs";
import rehypeFigure from "@/plugins/rehype-figure.mjs";
import { rehypeMermaid } from "@/plugins/rehype-mermaid.mjs";
import { rehypePlantuml } from "@/plugins/rehype-plantuml.mjs";
import { parseDirectiveNode } from "@/plugins/remark-directive-rehype.js";
import { remarkExcerpt } from "@/plugins/remark-excerpt.js";
import { remarkImageGrid } from "@/plugins/remark-image-grid.js";
import { remarkMermaid } from "@/plugins/remark-mermaid.js";
import { remarkPlantuml } from "@/plugins/remark-plantuml.js";
import { remarkReadingTime } from "@/plugins/remark-reading-time.mjs";

let processorInstance: ReturnType<typeof unified> | null = null;
let rendererPromise: Promise<
	Awaited<ReturnType<ReturnType<typeof unified>["createRenderer"]>>
> | null = null;

/**
 * 预览代码块渲染：与前台文章页一致的 expressive-code（高亮/复制/折叠/行号/双主题）。
 * 注意：unified 会把传入的插件当「工厂」在 use() 时立即调用，因此这里不能直接传
 * rehypeExpressiveCode(...) 返回的 transformer，而要包一层工厂，返回共享的
 * transformer 实例（其内部 asyncRenderer 缓存保证 engine/主题只构建一次）。
 */
const rehypeExpressiveCodePreviewInstance = rehypeExpressiveCode({
	themes: [
		expressiveCodeConfig.darkTheme as unknown as ThemeObjectOrShikiThemeName,
		expressiveCodeConfig.lightTheme as unknown as ThemeObjectOrShikiThemeName,
	],
	useDarkModeMediaQuery: false,
	themeCssSelector: (theme) => `[data-theme='${theme.name}']`,
	plugins: [
		...(expressiveCodeConfig.pluginLanguageBadge?.enable === true
			? [pluginLanguageBadge()]
			: []),
		pluginCollapsibleSections(),
		pluginLineNumbers(),
		...(expressiveCodeConfig.pluginCollapsible?.enable === true
			? [
					pluginCollapsible({
						lineThreshold:
							expressiveCodeConfig.pluginCollapsible.lineThreshold || 15,
						previewLines:
							expressiveCodeConfig.pluginCollapsible.previewLines || 8,
						defaultCollapsed:
							expressiveCodeConfig.pluginCollapsible.defaultCollapsed ?? true,
						expandButtonText: i18n(I18nKey.codeCollapsibleShowMore),
						collapseButtonText: i18n(I18nKey.codeCollapsibleShowLess),
						expandedAnnouncement: i18n(I18nKey.codeCollapsibleExpanded),
						collapsedAnnouncement: i18n(I18nKey.codeCollapsibleCollapsed),
					}),
				]
			: []),
	],
	defaultProps: {
		wrap: false,
		overridesByLang: {
			shellsession: {
				showLineNumbers: false,
			},
		},
	},
	styleOverrides: {
		borderRadius: "0.75rem",
		codeFontSize: "0.875rem",
		codeFontFamily:
			"var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
		codeLineHeight: "1.5rem",
		frames: {},
		textMarkers: {
			delHue: "0",
			insHue: "180",
			markHue: "250",
		},
		languageBadge: {
			fontSize: "0.75rem",
			fontWeight: "bold",
			borderRadius: "0.25rem",
			opacity: "1",
			borderWidth: "0px",
			borderColor: "transparent",
		},
	},
	frames: {
		showCopyToClipboardButton: true,
	},
});

const rehypeExpressiveCodePreview = () => rehypeExpressiveCodePreviewInstance;

/**
 * 获取与 Astro 配置一致的 Markdown 处理器
 * 包含项目使用的核心 remark/rehype 插件
 */
function getProcessor() {
	if (!processorInstance) {
		processorInstance = unified({
			remarkPlugins: [
				...(siteConfig.post.rehypeCallouts.enablePythonMarkdownAdmonitions !==
				false
					? [remarkAdmonitionToBlockquoteCallout]
					: []),
				remarkMath,
				remarkReadingTime,
				remarkImageGrid,
				remarkExcerpt,
				remarkDirective,
				remarkSectionize,
				parseDirectiveNode,
				remarkMermaid,
				[remarkPlantuml, plantumlConfig],
			],
			rehypePlugins: [
				[rehypeKatex, { katex }],
				[rehypeCallouts, { theme: siteConfig.post.rehypeCallouts.theme }],
				rehypeSlug,
				rehypeMermaid,
				rehypePlantuml,
				rehypeFigure as any,
				[rehypeExternalLinks as any, { siteUrl: siteConfig.site_url }],
				[rehypeEmailProtection, { method: "base64" }],
				/* 参考 astro.config 的 rehypeComponents + GithubCardComponent 需要
				   Astro 组件渲染上下文，运行时管线取不到，故跳过——github 短代码
				   在历史版本里会退化为普通链接，这是方案 a 已知的唯一缺口。 */
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
								"data-pagefind-ignore": true,
							},
							children: [
								{
									type: "text",
									value: "#",
								},
							],
						},
					},
				],
				rehypeExpressiveCodePreview,
			],
		});
	}
	return processorInstance;
}

async function getRenderer() {
	if (!rendererPromise) {
		const processor = getProcessor();
		/* 必须开启语法高亮：syntaxHighlight: false 会连带不生成主题颜色变量，
		   于是浅色模式下代码块仍是黑底（expressive-code 的双主题靠这些变量切换）。
		   类型定义只接受对象形式，但运行时布尔 true 才是「启用并复用插件已配的主题」，
		   故用 as any 绕过——实测 false 与「省略」都不生成变量，只有 true 生成。 */
		rendererPromise = processor.createRenderer({
			syntaxHighlight: true as unknown as undefined,
		});
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
