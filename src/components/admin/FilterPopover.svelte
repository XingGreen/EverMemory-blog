<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

let {
	categories,
	tags,
	categoryFilter,
	tagFilter,
	onCategoryChange,
	onTagChange,
}: {
	categories: string[];
	tags: string[];
	categoryFilter: string;
	tagFilter: string;
	onCategoryChange: (value: string) => void;
	onTagChange: (value: string) => void;
} = $props();

let open = $state(false);
let triggerEl = $state<HTMLButtonElement | null>(null);
let panelEl = $state<HTMLElement | null>(null);
/* 面板用 fixed 定位：.md3-list-container 是 overflow:hidden，
   absolute 会被裁剪；坐标在打开瞬间算好，滚动/改尺寸直接关闭 */
let pos = $state<{
	right: number;
	top?: number;
	bottom?: number;
	origin: string;
} | null>(null);

const activeCount = $derived((categoryFilter ? 1 : 0) + (tagFilter ? 1 : 0));

const label = i18n(I18nKey.postFilter);

const panelStyle = $derived(
	pos
		? `position:fixed;right:${pos.right}px;transform-origin:${pos.origin};` +
				(pos.top !== undefined ? `top:${pos.top}px;` : "") +
				(pos.bottom !== undefined ? `bottom:${pos.bottom}px;` : "")
		: "",
);

function place() {
	const rect = triggerEl?.getBoundingClientRect();
	if (!rect) return;
	/* 距视口底部不足 180px 翻向上弹（面板比单行菜单高） */
	const flip = window.innerHeight - rect.bottom < 180;
	pos = {
		right: Math.max(8, window.innerWidth - rect.right),
		top: flip ? undefined : rect.bottom + 4,
		bottom: flip ? window.innerHeight - rect.top + 4 : undefined,
		origin: flip ? "bottom right" : "top right",
	};
}

function close() {
	open = false;
	pos = null;
}

function toggle() {
	if (open) {
		close();
		return;
	}
	place();
	open = true;
}

/* 面板内的 select 由键盘正常 Tab 进入；这里不自动聚焦，
   避免部分平台（移动端）聚焦 select 直接弹出系统选择器 */
$effect(() => {
	if (!open) return;

	const onPointerDown = (event: MouseEvent) => {
		const target = event.target as Node | null;
		if (!target) return;
		if (panelEl?.contains(target) || triggerEl?.contains(target)) return;
		close();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Escape") return;
		close();
		triggerEl?.focus({ preventScroll: true });
	};
	const dismiss = () => close();

	/* scroll 用捕获阶段：滚动发生在 .admin-content 上，冒泡阶段的
	   window 监听器拦不到它 */
	document.addEventListener("mousedown", onPointerDown);
	document.addEventListener("keydown", onKeyDown);
	document.addEventListener("scroll", dismiss, true);
	window.addEventListener("resize", dismiss);
	return () => {
		document.removeEventListener("mousedown", onPointerDown);
		document.removeEventListener("keydown", onKeyDown);
		document.removeEventListener("scroll", dismiss, true);
		window.removeEventListener("resize", dismiss);
	};
});
</script>

<div class="filter-popover">
	<button
		bind:this={triggerEl}
		type="button"
		class="icon-text-btn filter-trigger"
		class:active={activeCount > 0}
		aria-expanded={open}
		aria-haspopup="dialog"
		aria-label={label}
		title={label}
		onclick={toggle}
	>
		<Icon icon="material-symbols:tune" class="trigger-icon" />
		<span>{label}</span>
		{#if activeCount > 0}
			<span class="filter-badge">{activeCount}</span>
		{/if}
		<Icon
			icon="material-symbols:expand-more"
			class={open ? "trigger-caret flipped" : "trigger-caret"}
		/>
	</button>

	{#if open && pos}
		<div
			bind:this={panelEl}
			role="group"
			aria-label={label}
			class="filter-panel card-base"
			style={panelStyle}
		>
			<label class="field">
				<span class="field-label">{i18n(I18nKey.postFilterCategory)}</span>
				<div class="select-wrap">
					<select
						value={categoryFilter}
						onchange={(e) => onCategoryChange(e.currentTarget.value)}
						disabled={categories.length === 0}
					>
						<option value="">{i18n(I18nKey.postAll)}</option>
						{#each categories as category (category)}
							<option value={category}>{category}</option>
						{/each}
					</select>
					<Icon icon="material-symbols:expand-more" class="select-caret" />
				</div>
			</label>

			<label class="field">
				<span class="field-label">{i18n(I18nKey.postFilterTag)}</span>
				<div class="select-wrap">
					<select
						value={tagFilter}
						onchange={(e) => onTagChange(e.currentTarget.value)}
						disabled={tags.length === 0}
					>
						<option value="">{i18n(I18nKey.postAll)}</option>
						{#each tags as tag (tag)}
							<option value={tag}>{tag}</option>
						{/each}
					</select>
					<Icon icon="material-symbols:expand-more" class="select-caret" />
				</div>
			</label>

			{#if activeCount > 0}
				<button
					type="button"
					class="panel-reset"
					onclick={() => {
						onCategoryChange("");
						onTagChange("");
					}}
				>
					<Icon icon="material-symbols:close" class="reset-icon" />
					<span>{i18n(I18nKey.postClearFilter)}</span>
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* 触发按钮复用 PostList 的 :global(.icon-text-btn)，
	   这里只补激活态与徽标 */
	.filter-trigger {
		position: relative;
	}

	.filter-trigger.active {
		background: color-mix(in srgb, var(--primary) 16%, transparent);
	}

	.trigger-icon {
		font-size: 1.125rem;
	}

	/* 激活筛选时在右上角顶一个计数徽标 */
	.filter-badge {
		position: absolute;
		top: -6px;
		right: -6px;
		min-width: 1.125rem;
		height: 1.125rem;
		padding: 0 0.25rem;
		border-radius: 999px;
		background: var(--primary);
		color: var(--on-primary, #fff);
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.125rem;
		text-align: center;
		pointer-events: none;
	}

	.trigger-caret {
		font-size: 1.125rem;
		transition: transform 0.15s;
	}

	.trigger-caret.flipped {
		transform: rotate(180deg);
	}

	.filter-panel {
		z-index: 90;
		width: 15rem;
		padding: 0.75rem;
		border-radius: var(--radius-md, 0.75rem);
		box-shadow: var(--shadow-lg);
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.field-label {
		font-size: 0.75rem;
		color: var(--md-on-surface-variant);
	}

	.select-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.select-wrap select {
		appearance: none;
		width: 100%;
		height: 2.125rem;
		padding: 0 2rem 0 0.75rem;
		border: 1px solid var(--md-outline);
		border-radius: var(--md-control-r, 0.5rem);
		background: var(--md-surface-container-high);
		color: var(--md-on-surface);
		font-family: inherit;
		font-size: 0.8125rem;
		cursor: pointer;
		text-overflow: ellipsis;
	}

	.select-wrap select:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: 1px;
	}

	.select-wrap select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.select-caret) {
		position: absolute;
		right: 0.75rem;
		font-size: 1.125rem;
		color: var(--md-on-surface-variant);
		pointer-events: none;
	}

	.panel-reset {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: none;
		border-radius: var(--radius-md, 0.5rem);
		background: color-mix(in srgb, var(--md-on-surface-variant) 10%, transparent);
		color: var(--md-on-surface-variant);
		font: inherit;
		font-size: 0.8125rem;
		cursor: pointer;
		transition: background-color 0.15s;
	}

	.panel-reset:hover {
		background: color-mix(in srgb, var(--md-on-surface-variant) 18%, transparent);
	}

	.panel-reset:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: -2px;
	}

	.reset-icon {
		font-size: 1.125rem;
	}
</style>