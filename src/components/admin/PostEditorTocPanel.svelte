<script lang="ts">
import { getContext } from "svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	extractTocItems,
	POST_EDITOR_CONTEXT,
	tocDepthLevelFn,
} from "./postEditorContext";

const { state: editorState, actions } = getContext<{
	state: import("./postEditorContext").PostEditorContextValue["state"];
	actions: import("./postEditorContext").PostEditorContextValue["actions"];
}>(POST_EDITOR_CONTEXT);

const tocItems = $derived(extractTocItems(editorState.content));
const tocMinDepth = $derived(
	tocItems.length ? Math.min(...tocItems.map((i) => i.level)) : 6,
);

let tocListEl: HTMLElement | undefined = $state();
let indicatorTop = $state(0);
let indicatorHeight = $state(0);
let indicatorOpacity = $state(0);

/** 连续指示器包住所有可见项，随可见集变化重算 */
$effect(() => {
	const lines = editorState.visibleTocLines;
	if (!tocListEl) return;
	requestAnimationFrame(() => {
		const list = tocListEl;
		if (!list) return;
		const items = Array.from(
			list.querySelectorAll<HTMLElement>(".toc-item.visible"),
		);
		if (!items.length) {
			indicatorHeight = 0;
			indicatorOpacity = 0;
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const listRect = list.getBoundingClientRect();
		const firstRect = first.getBoundingClientRect();
		const lastRect = last.getBoundingClientRect();
		indicatorTop = firstRect.top - listRect.top;
		indicatorHeight = lastRect.bottom - firstRect.top;
		indicatorOpacity = 1;
	});
});
</script>

<aside class="toc-panel">
	<h3>{i18n(I18nKey.postToc)}</h3>
	{#if tocItems.length > 0}
		<nav class="toc-list" bind:this={tocListEl}>
			{#each tocItems as item, idx (item.lineIndex)}
				<a
					href="#"
					class="toc-item toc-level-{tocDepthLevelFn(item.level, tocMinDepth)}"
					class:visible={editorState.visibleTocLines.includes(item.lineIndex)}
					aria-label={item.text}
					title={item.text}
					onclick={(event) => {
						event.preventDefault();
						actions.jumpToToc(item);
					}}
				>
					<div
						class="toc-badge {item.level === tocMinDepth
							? 'toc-badge-index'
							: ''}"
					>
						{#if item.level === tocMinDepth}
							{idx + 1}
						{:else if item.level <= tocMinDepth + 1}
							<span class="toc-badge-dot"></span>
						{:else}
							<span class="toc-badge-dot toc-badge-dot-sm"></span>
						{/if}
					</div>
					<div
						class="toc-label {item.level <= tocMinDepth + 1
							? 'toc-label-primary'
							: 'toc-label-secondary'}"
					>
						{item.text}
					</div>
				</a>
			{/each}
			<div
				class="toc-active-indicator"
				style="top: {indicatorTop}px; height: {indicatorHeight}px; opacity: {indicatorOpacity};"
				aria-hidden="true"
			></div>
		</nav>
	{:else}
		<p class="toc-empty">{i18n(I18nKey.postTocEmpty)}</p>
	{/if}
</aside>

<style>
	/* ── 右侧目录栏：独立卡片 ── */
	.toc-panel {
		position: sticky;
		top: 1rem;
		max-height: calc(100vh - 7.5rem);
		overflow-y: auto;
		padding: 1.5rem 1.25rem;
		background: var(--card-bg);
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-card);
		align-self: start;
		isolation: isolate;
	}

	.toc-panel h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--deep-text);
		padding-bottom: 0.5rem;
		margin-bottom: 0.75rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.toc-list {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.28rem;
	}

	/* 指示器位于条目之下作为底衬 */
	.toc-list .toc-item {
		position: relative;
		z-index: 1;
	}

	.toc-list .toc-active-indicator {
		z-index: 0;
		background: color-mix(in oklab, var(--primary) 12%, var(--btn-regular-bg));
	}

	.toc-list .toc-badge-index {
		background: color-mix(in oklab, var(--primary) 16%, var(--btn-regular-bg));
		color: color-mix(in oklab, var(--primary) 75%, var(--deep-text));
	}

	.toc-empty {
		font-size: 0.8125rem;
		line-height: 1.6;
		color: var(--content-meta);
	}

	@media (max-width: 1400px) {
		.toc-panel {
			display: none;
		}
	}

	@media (max-width: 900px) {
		.toc-panel {
			display: block;
			position: static;
			max-height: none;
		}
	}
</style>