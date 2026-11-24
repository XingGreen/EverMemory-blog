<script lang="ts">
import { getContext } from "svelte";
import AdminPostStats from "@/components/admin/AdminPostStats.svelte";
import PostMetaBar from "@/components/admin/PostMetaBar.svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { resolveAdminAsset } from "@/utils/admin-asset-url";
import { countWords, readingMinutes } from "@/utils/reading-stats";
import { POST_EDITOR_CONTEXT } from "./postEditorContext";

const { state: editorState, actions } = getContext<{
	state: import("./postEditorContext").PostEditorContextValue["state"];
	actions: import("./postEditorContext").PostEditorContextValue["actions"];
}>(POST_EDITOR_CONTEXT);

/* 正文统计：与前台同一口径（reading-time 词数 + 200 词/分钟） */
const wordCount = $derived(countWords(editorState.content));
const minutes = $derived(readingMinutes(wordCount));
/* 封面图可能是相对路径（./images/x.avif），换算成后台取图端点 */
const coverUrl = $derived(
	resolveAdminAsset(
		editorState.image,
		`src/content/posts/${editorState.slug}.md`,
	),
);

/* 行号列：textarea 的文本不是 DOM 节点，CSS 计数器数不了行，所以用一个与正文
   同字体、同 line-height 的 gutter，靠 translateY 同步。
   gutterEl 是裁剪框（overflow:hidden），gutterInnerEl 才是被位移的那一层。 */
let gutterEl = $state<HTMLDivElement | undefined>();
let gutterInnerEl = $state<HTMLDivElement | undefined>();

/**
 * MDX 预览的代码块复制：EC 的交互脚本不会在预览容器里执行，
 * 这里用事件委托接住复制按钮，把同块代码写进剪贴板。
 *
 * EC 生成的按钮没有 class，只带 title="Copy to clipboard"、data-copied
 * 与 data-code 三个属性（实测 HTML 如此）。早先按 `button.copy` 选，
 * 永远匹配不到，点击毫无反应。优先读 data-code：它是原始代码，比从
 * <pre> 取 textContent 更准（后者含行号与语言徽章的文字）。
 */
function handlePreviewCopyClick(event: MouseEvent) {
	const target = event.target as HTMLElement;
	const btn = target.closest<HTMLButtonElement>(
		'button[title="Copy to clipboard"], button[data-code], button.copy, .copy > button',
	);
	if (!btn) return;

	const code =
		btn.dataset.code ??
		btn.closest("figure")?.querySelector("pre code")?.textContent ??
		btn.closest(".expressive-code")?.querySelector("pre code")?.textContent ??
		"";
	if (!code) return;

	void navigator.clipboard.writeText(code).then(() => {
		btn.classList.add("copied");
		/* EC 自己的按钮用 data-copied 换成「Copied!」文本，预览里没有它的
		   脚本，靠这个类给出同样的即时反馈。 */
		btn.setAttribute("data-copied-active", "true");
		setTimeout(() => {
			btn.classList.remove("copied");
			btn.removeAttribute("data-copied-active");
			}, 1500);
	});
}

const lineNumbers = $derived(
	Array.from(
		{ length: Math.max(1, editorState.content.split("\n").length) },
		(_, i) => i + 1,
	),
);

/**
 * 把 Ctrl/Cmd+Z 接到编辑器自己的历史栈（原生 textarea 撤销与快照栈相互独立，
 * 不拦截会导致两种「撤销」交替、行为割裂）。Ctrl+Y 与 Ctrl+Shift+Z 作重做。
 */
function handleEditorKeydown(e: KeyboardEvent) {
	if (e.isComposing || (!e.ctrlKey && !e.metaKey)) return;
	const key = e.key.toLowerCase();
	if (key === "z" && !e.shiftKey) {
		e.preventDefault();
		actions.undo();
	} else if ((key === "z" && e.shiftKey) || key === "y") {
		e.preventDefault();
		actions.redo();
	}
}

/** 工具栏按钮定义：图标或字形 + 动作，集中渲染避免模板冗长 */
const TOOLS: {
	icon?: string;
	glyph?: string;
	title: I18nKey;
	run: () => void;
}[] = [
	{
		icon: "material-symbols:format-bold",
		title: I18nKey.postMdBold,
		run: () => actions.insertBold(),
	},
	{
		icon: "material-symbols:format-italic",
		title: I18nKey.postMdItalic,
		run: () => actions.insertItalic(),
	},
	{
		icon: "material-symbols:format-strikethrough",
		title: I18nKey.postMdStrikethrough,
		run: () => actions.insertStrikethrough(),
	},
	{ glyph: "H2", title: I18nKey.postMdH2, run: () => actions.insertH2() },
	{ glyph: "H3", title: I18nKey.postMdH3, run: () => actions.insertH3() },
	{
		icon: "material-symbols:code",
		title: I18nKey.postMdInlineCode,
		run: () => actions.insertInlineCode(),
	},
	{
		icon: "material-symbols:data-object",
		title: I18nKey.postMdCodeBlock,
		run: () => actions.insertCodeBlock(),
	},
	{
		icon: "material-symbols:link",
		title: I18nKey.postMdLink,
		run: () => actions.insertLink(),
	},
	{
		icon: "material-symbols:image",
		title: I18nKey.postMdImage,
		run: () => actions.insertImage(),
	},
	{
		icon: "material-symbols:format-quote",
		title: I18nKey.postMdQuote,
		run: () => actions.insertQuote(),
	},
	{
		icon: "material-symbols:format-list-bulleted",
		title: I18nKey.postMdUl,
		run: () => actions.insertUl(),
	},
	{
		icon: "material-symbols:format-list-numbered",
		title: I18nKey.postMdOl,
		run: () => actions.insertOl(),
	},
	{
		icon: "material-symbols:horizontal-rule",
		title: I18nKey.postMdDivider,
		run: () => actions.insertDivider(),
	},
];
</script>

<section class="write-panel">
	<div class="tabs">
		<button
			class:active={editorState.activeTab === "editor"}
			onclick={() => actions.setTab("editor")}
		>
			<Icon icon="material-symbols:ink-pen-outline-rounded" class="text-sm" />
			{i18n(I18nKey.postTabEdit)}
		</button>
		<button
			class:active={editorState.activeTab === "preview"}
			onclick={() => actions.setTab("preview")}
		>
			<Icon icon="material-symbols:visibility-outline-rounded" class="text-sm" />
			{i18n(I18nKey.postTabPreview)}
		</button>
	</div>

	{#if editorState.activeTab === "editor"}
	<div class="md-toolbar" role="toolbar" aria-label={i18n(I18nKey.postMdToolbar)}>
		{#each TOOLS as tool, i (tool.title)}
			{#if i === 3 || i === 5 || i === 8 || i === 11 || i === 13}
				<span class="toolbar-sep"></span>
			{/if}
			<button
				type="button"
				title={i18n(tool.title)}
				aria-label={i18n(tool.title)}
				onclick={tool.run}
			>
				{#if tool.glyph}
					<span class="toolbar-glyph">{tool.glyph}</span>
				{:else}
					<Icon icon={tool.icon ?? ""} class="text-sm" />
				{/if}
			</button>
		{/each}
		<div class="toolbar-end">
			<!-- 行号开关：配置项，状态存 localStorage，跨文章复用 -->
			<button
				type="button"
				class:is-on={editorState.showLineNumbers}
				title={i18n(I18nKey.postLineNumbers)}
				aria-label={i18n(I18nKey.postLineNumbers)}
				aria-pressed={editorState.showLineNumbers}
				onclick={() => actions.toggleLineNumbers()}
			>
				<Icon icon="material-symbols:format-list-numbered" class="text-sm" />
			</button>
			<button
				type="button"
				title={i18n(I18nKey.postMdUndo)}
				aria-label={i18n(I18nKey.postMdUndo)}
				disabled={!editorState.canUndo}
				onclick={() => actions.undo()}
			>
				<Icon icon="material-symbols:undo" class="text-sm" />
			</button>
			<button
				type="button"
				title={i18n(I18nKey.postMdRedo)}
				aria-label={i18n(I18nKey.postMdRedo)}
				disabled={!editorState.canRedo}
				onclick={() => actions.redo()}
			>
				<Icon icon="material-symbols:redo" class="text-sm" />
			</button>
		</div>
	</div>
	{/if}

	{#if editorState.activeTab === "editor"}
		<div class="editor-field" class:with-lines={editorState.showLineNumbers}>
			{#if editorState.showLineNumbers}
				<div class="editor-gutter" bind:this={gutterEl} aria-hidden="true">
					<div class="editor-gutter-inner" bind:this={gutterInnerEl}>
						{#each lineNumbers as n (n)}
							<span>{n}</span>
						{/each}
					</div>
				</div>
			{/if}
			<textarea
				bind:this={editorState.editorEl}
				bind:value={editorState.content}
				onscroll={(e) => {
					actions.handleEditorScroll();
					/* 行号列与正文同步：位移必须写在内层 .editor-gutter-inner 上。
					   外层 .editor-gutter 才是 overflow:hidden 的裁剪框——给外层加
					   transform 等于把自己整体挪走，裁剪框跟着移动，数字会跑到
					   Tabs 栏上方（「向上滚时数字悬空」）。 */
					if (gutterInnerEl) {
						gutterInnerEl.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`;
						/* 行号只数换行符，正文高度却按折行算——有长行时正文更高，
						   滚到底后最后几行就没有对应数字（「最后的四个数字显示不出来」）。
						   把内层高度拉到与正文内容等高：多出来的部分是没有号码的
						   留白，但它保证最后一个数字能滚到视野里，而不是提前卡住。 */
						const contentH = e.currentTarget.scrollHeight;
						if (contentH > 0) {
							gutterInnerEl.style.height = `${contentH}px`;
						}
					}
				}}
				onkeydown={handleEditorKeydown}
				placeholder={i18n(I18nKey.postContentPlaceholder)}
				class="content-editor"
			></textarea>
		</div>
	{:else}
		<!-- biome-ignore lint/security/noDangerouslySetInnerHtml: 服务端渲染管线产出的可信 HTML -->
		<div
			bind:this={editorState.previewEl}
			onscroll={actions.handlePreviewScroll}
			onclick={handlePreviewCopyClick}
			class="prose dark:prose-invert prose-base max-w-none content-preview custom-md"
		>
			<!-- 标题 + 元数据栏：与历史版本页共用 PostMetaBar，
			     数据源绑定当前编辑器状态，随输入实时更新 -->
			<AdminPostStats
				words={wordCount}
				{minutes}
				password={(editorState.password ?? "").trim().length > 0}
			/>
			<h1 class="mb-3 text-3xl font-bold text-(--deep-text)">{editorState.title || "—"}</h1>
			<PostMetaBar
				published={editorState.published}
				category={editorState.category}
				tags={editorState.tags}
				image={coverUrl}
			/>
			<!-- 元信息与正文之间的虚线分隔。
			     照搬前台 src/pages/posts/[...slug].astro:320-324 那一条：
			       <div class="border-(--line-divider) border-dashed border-b mt-3 mb-5" />
			     前台只在「没有封面图」时显示，后台预览同样按 coverUrl 判断。 -->
			{#if !coverUrl}
				<div class="preview-meta-divider"></div>
			{/if}
			{@html editorState.renderedHtml}
		</div>
	{/if}
</section>

<style>
	/* ── 中间书写区：工作区卡片的内容，本身不再有卡片外观 ── */
	.write-panel {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		min-width: 0;
		min-height: 0;
		height: 100%;
		/* 内边距与宽度上限保持对称原值：内容宽度的调节权完全交给
		   宽度手柄（editorMaxWidth），面板层不再叠加任何限制或
		   非对称 padding——上一版的外层上限与右侧归零把手柄挤压失效 */
		width: 100%;
		padding: 1.25rem 1.5rem;
		isolation: isolate;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
		margin-inline: -1.5rem;
		padding-inline: 1.5rem;
		border-bottom: 1px solid var(--line-color);
	}

	.tabs button {
		padding: 0.625rem 1rem;
		border: none;
		background: none;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--content-meta);
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.tabs button.active {
		color: var(--primary);
		border-bottom-color: var(--primary);
	}

	/* 工具栏：对齐参考实现——淡色横条 + 底部细线，不用灰底圆角块，按钮保持轻量 */
	.md-toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		flex-shrink: 0;
		gap: 0.25rem;
		margin-inline: -1.5rem;
		padding: 0.5rem 1.5rem;
		background: color-mix(in srgb, var(--btn-regular-bg) 35%, var(--card-bg));
		border: none;
		border-bottom: 1px solid var(--line-color);
		border-radius: 0;
	}

	.md-toolbar button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--content-meta);
		cursor: pointer;
		font-family: inherit;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.md-toolbar button:hover {
		background: color-mix(in srgb, var(--primary) 12%, transparent);
		color: var(--primary);
	}

	/* 手机触控：2rem=28px（根字号 14px 时更小）远低于 44px 下限。
	   工具栏 flex-wrap，放大后换行排布即可，不能靠伪元素外扩——
	   0.25rem 的间距会让相邻热区几乎完全重叠 */
	@media (max-width: 768px) {
		.md-toolbar button {
			width: 44px;
			height: 44px;
		}
	}

	.toolbar-glyph {
		font-size: 0.6875rem;
		font-weight: 700;
	}

	.toolbar-sep {
		width: 1px;
		height: 1rem;
		background: var(--line-color);
		margin: 0 0.5rem;
	}

	.toolbar-end {
		display: flex;
		gap: 0.25rem;
		margin-left: auto;
	}

	.md-toolbar button:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.md-toolbar button:disabled:hover {
		background: none;
		color: var(--content-meta);
	}

	/* 书写区：高度由 shell 限高后的剩余空间决定（flex:1），
	   自身保留 overflow-y:auto 承担滚动。
	   不再用 --editor-default-content-height 这类固定 calc：
	   那是按视口估算的，与实际 header/tabs/toolbar 高度对不上，
	   会让整个卡片比侧栏高出几十像素。
	   min-height 用 0：否则 26rem 会撑破 shell 限高，把 header/tabs
	   挤出可视区。保证可见的最低靠 shell 的限高本身兜底。 */
	.content-editor {
		flex: 1;
		min-height: 0;
		padding: 0.625rem 0.875rem;
		border: none;
		border-radius: var(--radius-md);
		background: none;
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--deep-text);
		resize: none;
		overflow-y: auto;
	}

	.content-editor:focus {
		outline: none;
	}

	/* 元信息与正文之间的虚线分隔。
	   取值逐项照搬前台 src/pages/posts/[...slug].astro:322 的
	     border-(--line-divider) border-dashed border-b mt-3 mb-5
	   即：虚线、颜色 --line-divider、上下外边距 0.75rem / 1.25rem。
	   前台把这条线放在 PostMetadata 之后、正文之前；后台预览同样是
	   PostMetaBar 之后、渲染结果之前。 */
	.preview-meta-divider {
		margin-top: 0.75rem;
		margin-bottom: 1.25rem;
		border-bottom: 1px dashed var(--line-divider);
	}

	.content-preview {
		flex: 1;
		min-height: 0;
		padding: 1.25rem;
		overflow-y: auto;
		border: none;
		border-radius: var(--radius-md);
		background: none;
		/* 与 .editor-field 共用同一条宽度变量，让编辑/预览两种模式的手柄
		   行为一致。容器上的 Tailwind 类已从 `max-w-none!` 改为 `max-w-none`
		   （去掉 !important），这条规则才能按正常层叠生效——先前它被
		   !important 压制，写在这也完全无效，表现就是「预览区拖了不动」。 */
		max-width: var(--editor-max-page-width, 96rem);
		margin-inline: auto;
		width: 100%;
	}

	/* 分隔线：与前台保持同一份取值。
	   前台定义在 src/styles/markdown-extend.styl 的 `.custom-md hr`：
	     border-color: var(--line-divider)
	     border-style: dashed
	   预览容器本身带 .custom-md，理论上前台那条规则会命中；但 Tailwind
	   Typography 的 `.prose hr` 权重更高，先落地成 currentColor + 低透明度，
	   于是看起来没有线。这里只把前台那两个属性原样补一遍，不改色值、
	   不改透明度、不改间距——两边必须长得一样。

	   !important boundary: Tailwind Typography 的 `.prose hr` 拥有原有声明；
	   分隔线外观归前台的 markdown-extend.styl，此处只是把它照搬过来。 */
	:global(.content-preview.custom-md hr) {
		border-color: var(--line-divider) !important;
		border-style: dashed !important;
	}

	/* 代码块排版：对齐前台 expressive-code（one-light / one-dark）观感，
	   并阻断 markdown.css 的 .custom-md code 内联码背景渗入 pre code；
	   背景 hue 跟随主题（--hue），不写死品牌紫 */
	:global(.content-preview pre) {
		border-radius: var(--radius-md);
		overflow-x: auto;
		background: oklch(0.985 0.002 var(--hue));
		color: #383a42;
	}

	:global(.content-preview pre code) {
		background: transparent;
		color: inherit;
		padding: 0;
	}

	:global(.dark .content-preview pre) {
		background: oklch(0.205 0.015 var(--hue));
		color: #abb2bf;
	}

	.content-preview :global(.empty-preview) {
		color: var(--content-meta);
		text-align: center;
		padding: 2rem;
	}

	@media (max-width: 900px) {
		/* 原本是固定 60vh：手机上视口矮，60vh 再叠加顶栏/工具栏/统计条
		   就会把正文推出可视区。改为跟随 flex 分配，最小留 12rem，
		   保证再矮的屏幕上 textarea 也不是一条缝。 */
		.content-editor,
		.content-preview {
			height: auto;
			min-height: 12rem;
		}

		/* iOS 聚焦字号 <16px 的输入框会整页放大，且退出后常不还原。
		   行号列必须同步字号，否则与正文行高不一致，逐行错位。 */
		.content-editor,
		.editor-gutter {
			font-size: 16px;
		}
	}
	/* ── 行号列 ──
	   必须与 .content-editor 同字体、同 line-height(1.6)、同上下内边距，
	   否则行号会逐行漂移。滚动同步见 textarea 的 onscroll：内层用
	   translateY 跟随，外层 overflow:hidden 裁掉多余部分。 */
	.editor-field {
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
		/* 宽度手柄只约束正文：Tabs 栏与工具栏保持撑满（它们已用负 margin 顶到
		   面板边缘），正文按 --editor-max-page-width 收窄并居中。 */
		max-width: var(--editor-max-page-width, 96rem);
		margin-inline: auto;
		width: 100%;
	}

	.editor-gutter {
		flex: 0 0 auto;
		width: 3rem;
		/* 外层是裁剪框：必须有确定高度，否则 flex 会按内容（989 行）撑开，
		   overflow:hidden 等于没有作用范围，内层一位移数字就跑到 Tabs 栏上。
		   与 textarea 同为 .editor-field 的子项，用 align-self: stretch 取同高。 */
		position: relative;
		align-self: stretch;
		height: auto;
		min-height: 0;
		overflow: hidden;
		user-select: none;
		pointer-events: none;
	}

	.editor-gutter-inner {
		padding: 0.625rem 0.5rem 0.625rem 0;
		text-align: right;
		font-family: inherit;
		font-size: 0.875rem;
		line-height: 1.6;
		color: color-mix(in srgb, var(--content-meta) 55%, transparent);
		will-change: transform;
	}

	.editor-gutter span {
		display: block;
	}

	/* 行号开启时工具栏按钮显示为主色 */
	.toolbar-end button.is-on {
		color: var(--primary);
	}
</style>