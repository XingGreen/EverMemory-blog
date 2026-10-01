<script lang="ts">
import { getContext } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { POST_EDITOR_CONTEXT } from "./postEditorContext";

const { state: editorState, actions } = getContext<{
	state: import("./postEditorContext").PostEditorContextValue["state"];
	actions: import("./postEditorContext").PostEditorContextValue["actions"];
}>(POST_EDITOR_CONTEXT);

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
	</div>

	{#if editorState.activeTab === "editor"}
		<textarea
			bind:this={editorState.editorEl}
			bind:value={editorState.content}
			onscroll={actions.handleEditorScroll}
			placeholder={i18n(I18nKey.postContentPlaceholder)}
			class="content-editor"
		></textarea>
	{:else}
		<!-- biome-ignore lint/security/noDangerouslySetInnerHtml: 服务端渲染管线产出的可信 HTML -->
		<div
			bind:this={editorState.previewEl}
			onscroll={actions.handlePreviewScroll}
			class="prose dark:prose-invert prose-base max-w-none! content-preview custom-md"
		>
			{@html editorState.renderedHtml}
		</div>
	{/if}
</section>

<style>
	/* ── 中间书写区：独立卡片，tabs / 工具栏 / 编辑框内嵌 ── */
	.write-panel {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		min-width: 0;
		padding: 1.25rem;
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-card);
		align-self: start;
		isolation: isolate;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--line-divider);
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

	.md-toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.5rem;
		background: var(--btn-regular-bg);
		border: none;
		border-radius: var(--radius-md);
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

	.toolbar-glyph {
		font-size: 0.6875rem;
		font-weight: 700;
	}

	.toolbar-sep {
		width: 1px;
		height: 1.25rem;
		background: var(--line-divider);
		margin: 0 0.375rem;
	}

	.content-editor {
		min-height: var(--editor-min-content-height, 26rem);
		height: var(--editor-default-content-height, calc(100vh - 18rem));
		max-height: var(--editor-max-content-height, calc(100vh - 10rem));
		padding: 0.625rem 0.875rem;
		border: none;
		border-radius: var(--radius-md);
		background: none;
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--deep-text);
		resize: vertical;
	}

	.content-editor:focus {
		outline: none;
	}

	.content-preview {
		min-height: var(--editor-min-content-height, 26rem);
		height: var(--editor-default-content-height, calc(100vh - 18rem));
		max-height: var(--editor-max-content-height, calc(100vh - 10rem));
		padding: 1.25rem;
		overflow-y: auto;
		border: none;
		border-radius: var(--radius-md);
		background: none;
	}

	/* 代码块排版：对齐前台 expressive-code（one-light / one-dark）观感，
	   并阻断 markdown.css 的 .custom-md code 内联码背景渗入 pre code */
	:global(.content-preview pre) {
		border-radius: var(--radius-md);
		overflow-x: auto;
		background: oklch(0.985 0.002 275);
		color: #383a42;
	}

	:global(.content-preview pre code) {
		background: transparent;
		color: inherit;
		padding: 0;
	}

	:global(.dark .content-preview pre) {
		background: oklch(0.205 0.015 275);
		color: #abb2bf;
	}

	.content-preview :global(.empty-preview) {
		color: var(--content-meta);
		text-align: center;
		padding: 2rem;
	}

	@media (max-width: 900px) {
		.content-editor,
		.content-preview {
			height: 60vh;
		}
	}
</style>