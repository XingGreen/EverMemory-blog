<script lang="ts">
/**
 * 通用下拉选择器：结构与视觉照搬参考项目 src/components/ui/select.tsx，
 * 触发器沿用 DatePicker 的 h-10 / rounded-xl / --btn-regular-bg 规格，
 * 保证同一表单里的「日期」与「下拉」看起来是同一套控件。
 *
 * 参考的 Select 是 Radix 风格（触发器 + portal 浮层 + 键盘导航），这里用
 * 原生 button + 绝对定位浮层实现同等交互：点击展开、点击外部收起、Esc 关闭、
 * 上下键在选项间移动、Enter 选中。
 */
import Icon from "@/components/common/Icon.svelte";
import {
	floatingStyle,
	placeUnder,
	portalToBody,
	type FloatingPosition,
} from "@/utils/floating";

let {
	value = "",
	options = [],
	onChange,
	placeholder,
	id,
	disabled = false,
}: {
	value?: string;
	options: { value: string; label: string }[];
	onChange: (next: string) => void;
	placeholder?: string;
	id?: string;
	disabled?: boolean;
} = $props();

let open = $state(false);
let containerEl = $state<HTMLDivElement | undefined>();
let activeIndex = $state(-1);
let menuEl = $state<HTMLElement | null>(null);
let pos = $state<FloatingPosition | null>(null);

const selectedLabel = $derived(
	options.find((o) => o.value === value)?.label ?? "",
);

function toggle() {
	if (disabled) return;
	if (open) {
		open = false;
		pos = null;
		return;
	}
	/* 浮层挂到 body，坐标必须在这里算好 */
	if (containerEl) pos = placeUnder(containerEl, "start", 180);
	activeIndex = options.findIndex((o) => o.value === value);
	open = true;
}

function pick(next: string) {
	onChange(next);
	open = false;
}

function handleKey(e: KeyboardEvent) {
	if (disabled) return;
	if (!open) {
		if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
			e.preventDefault();
			toggle();
		}
		return;
	}
	if (e.key === "Escape") {
		open = false;
		return;
	}
	if (e.key === "ArrowDown") {
		e.preventDefault();
		activeIndex = Math.min(options.length - 1, activeIndex + 1);
		return;
	}
	if (e.key === "ArrowUp") {
		e.preventDefault();
		activeIndex = Math.max(0, activeIndex - 1);
		return;
	}
	if (e.key === "Enter") {
		e.preventDefault();
		const opt = options[activeIndex];
		if (opt) pick(opt.value);
	}
}

/* 菜单挂到 body，脱离 .admin-page 的 overflow 裁切 */
$effect(() => {
	const el = menuEl;
	if (!el) return;
	portalToBody(el);
	return () => {
		el.remove();
	};
});

/* 页面滚动收起，但菜单自己内部滚动不算 */
$effect(() => {
	if (!open) return;
	const close = () => {
		open = false;
		pos = null;
	};
	const onScroll = (e: Event) => {
		if (menuEl?.contains(e.target as Node)) return;
		close();
	};
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", close);
	return () => {
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", close);
	};
});

function handleOutside(e: PointerEvent) {
	if (!open) return;
	const target = e.target as Node;
	if (containerEl?.contains(target) || menuEl?.contains(target)) return;
	open = false;
	pos = null;
}
</script>

<svelte:window onpointerdown={handleOutside} />

<div class="select-root" bind:this={containerEl}>
	<button
		{id}
		type="button"
		class="select-trigger"
		aria-haspopup="listbox"
		aria-expanded={open}
		{disabled}
		onclick={toggle}
		onkeydown={handleKey}
	>
		<span class={selectedLabel ? "" : "is-empty"}>
			{selectedLabel || placeholder || ""}
		</span>
		<span class="select-caret" aria-hidden="true">
			<Icon icon="material-symbols:expand-more" />
		</span>
	</button>

	{#if open && pos}
		<ul
			class="ui-menu"
			role="listbox"
			tabindex="-1"
			bind:this={menuEl}
			style={floatingStyle(pos)}
			onmousedown={(e) => e.stopPropagation()}
		>
			{#each options as opt, i (opt.value)}
				<li>
					<button
						type="button"
						class="ui-menu-item"
						data-active={i === activeIndex}
						aria-selected={opt.value === value}
						onclick={() => pick(opt.value)}
						onmouseenter={() => (activeIndex = i)}
					>
						<span class="ui-menu-item-label">{opt.label}</span>
						{#if opt.value === value}
							<Icon icon="material-symbols:check" class="ui-menu-item-check" />
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.select-root {
		position: relative;
		width: 100%;
	}

	/* 触发器：与 DatePicker 同高同圆角同底色 */
	.select-trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		height: 2.5rem;
		padding: 0 0.75rem;
		border: none;
		border-radius: 0.75rem;
		background: var(--btn-regular-bg);
		color: var(--deep-text);
		font-family: inherit;
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
	}

	.select-trigger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.select-trigger .is-empty {
		color: color-mix(in srgb, var(--content-meta) 60%, transparent);
	}

	.select-caret {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--content-meta);
	}

	/* 浮层：absolute top-full mt-1 w-full rounded-xl bg-card ring-1 */
	/* 浮层与选项的外观已并入 ui-base 的 .ui-menu / .ui-menu-item */
</style>
