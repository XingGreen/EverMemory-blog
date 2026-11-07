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
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkSectionize from "remark-sectionize";
import remarkSmartypants from "remark-smartypants";
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
type Renderer = Awaited<
	ReturnType<ReturnType<typeof unified>["createRenderer"]>
>;
let rendererPromise: Promise<Renderer> | null = null;

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

/** 与 unified() 入参一致的插件列表类型：抽成函数后需要它来保留元组的上下文推断 */
type RemarkPluginList = NonNullable<
	ReturnType<typeof unified>["options"]["remarkPlugins"]
>;

/**
 * MD 通道的 remark 插件序列（标准 Markdown）。
 *
 * 导出给两条 MDX 通道复用（避免渲染行为漂移），但 MD 通道与 MDX 通道的
 * 解析互相独立：本文件的 renderMarkdown() 只接受标准 Markdown；
 * MDX 一律走 mdx-runtime.ts（主）或 mdx-fallback.ts（保底）。
 *
 * gfm / smartypants 不在这里——markdown-remark 默认启用它们（前台一致行为），
 * 显式传反而会在 evaluate 一侧造成两份默认值的漂移点。
 */
export function buildSharedRemarkPlugins(): RemarkPluginList {
	return [
		...(siteConfig.post.rehypeCallouts.enablePythonMarkdownAdmonitions !== false
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
	];
}

/**
 * MDX 主通道（@mdx-js/mdx evaluate）专用的 remark 插件列表。
 *
 * evaluate 不继承 markdown-remark 的默认行为，基础能力必须显式传：
 *   - remark-gfm：表格/删除线/任务列表（MD 通道由 markdown-remark 默认启用，
 *     MDX 通道漏掉它表格会渲染成纯文本段落）
 *   - remark-smartypants：引号/破折号美化（MD 通道同为默认启用）
 * 与 buildSharedRemarkPlugins 的另一处差别：去掉 remarkReadingTime / remarkExcerpt——
 * 它们只往 vfile 的 astro.frontmatter 写构建期元数据，对预览 HTML 无作用，
 * 且直接假设 data.astro 存在，在 evaluate 的裸 VFile 上会炸。
 */
export function buildMdxRuntimeRemarkPlugins(): RemarkPluginList {
	return [
		remarkGfm,
		/* remarkSmartypants 是工厂，必须用元组让 unified 调用 attacher；
		   预先调用会把 transformer 当 attacher 用，freeze 阶段直接炸。
		   其类型经 retext 包装，与 unified 的 Pluggable 不兼容，用 as never 绕过 */
		[remarkSmartypants as never, {}],
		...(siteConfig.post.rehypeCallouts.enablePythonMarkdownAdmonitions !== false
			? [remarkAdmonitionToBlockquoteCallout]
			: []),
		remarkMath,
		remarkImageGrid,
		remarkDirective,
		remarkSectionize,
		parseDirectiveNode,
		remarkMermaid,
		[remarkPlantuml, plantumlConfig],
	];
}

/**
 * 共用 rehype 插件序列。evaluate 与 unified 管线共用，理由同上。
 * 注意 rehypeExpressiveCodePreview 是共享单例（内部缓存了 shiki 主题），
 * 两条管线复用同一个实例，不会重复构建。
 */
export function buildSharedRehypePlugins() {
	return [
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
	];
}

/**
 * 获取 MD 通道的处理器：只处理标准 Markdown，与 Astro 前台 .md 文章同一管线。
 */
function getProcessor() {
	if (processorInstance) return processorInstance;

	processorInstance = unified({
		remarkPlugins: buildSharedRemarkPlugins(),
		rehypePlugins: buildSharedRehypePlugins(),
	});
	return processorInstance;
}

async function getRenderer() {
	if (!rendererPromise) {
		/* 必须开启语法高亮：syntaxHighlight: false 会连带不生成主题颜色变量，
		   于是浅色模式下代码块仍是黑底（expressive-code 的双主题靠这些变量切换）。
		   类型定义只接受对象形式，但运行时布尔 true 才是「启用并复用插件已配的主题」，
		   故用 as any 绕过——实测 false 与「省略」都不生成变量，只有 true 生成。 */
		rendererPromise = getProcessor().createRenderer({
			syntaxHighlight: true as unknown as undefined,
		});
	}
	return rendererPromise;
}

/**
 * 渲染 Markdown 为 HTML（MD 通道，与主站 .md 文章同一管线）。
 * MDX 内容不走这里——主通道在 mdx-runtime.ts，降级在 mdx-fallback.ts。
 */
export async function renderMarkdown(content: string): Promise<string> {
	const renderer = await getRenderer();
	const result = await renderer.render(content);
	return result.code;
}
