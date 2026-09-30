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
import { expressiveCodeConfig, siteConfig } from "@/config";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import rehypeExternalLinks from "@/plugins/rehype-external-links.mjs";
import rehypeFigure from "@/plugins/rehype-figure.mjs";
import { parseDirectiveNode } from "@/plugins/remark-directive-rehype.js";

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
		rendererPromise = processor.createRenderer({
			syntaxHighlight: false,
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
