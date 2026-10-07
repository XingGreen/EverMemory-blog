<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

let {
	title,
	onDelete,
}: {
	title: string;
	onDelete: (trigger: HTMLButtonElement) => void;
} = $props();

let open = $state(false);
let triggerEl = $state<HTMLButtonElement | null>(null);
let menuEl = $state<HTMLElement | null>(null);
/* 菜单用 fixed 定位（列表容器曾有过 overflow:hidden，absolute 会被裁掉；现为
   列表形态后依旧用 fixed 保持稳定）。坐标在打开瞬间按触发器算好，之后滚动/
   改尺寸一律直接关闭而不是重算：
   列表在 .admin-content 里内部滚动，fixed 元素不会跟着走。 */
let pos = $state<{
	right: number;
	top?: number;
	bottom?: number;
	origin: string;
} | null>(null);

const actionPattern = i18n(I18nKey.postActionLabel);
const triggerLabel = $derived(
	actionPattern
		.replace("{action}", i18n(I18nKey.postColActions))
		.replace("{title}", title),
);

const menuStyle = $derived(
	pos
		? `position:fixed;right:${pos.right}px;transform-origin:${pos.origin};` +
				(pos.top !== undefined ? `top:${pos.top}px;` : "") +
				(pos.bottom !== undefined ? `bottom:${pos.bottom}px;` : "")
		: "",
);

function place() {
	const rect = triggerEl?.getBoundingClientRect();
	if (!rect) return;
	/* 距视口底部不足 120px 就翻向上弹，避免末行的菜单被顶出屏幕 */
	const flip = window.innerHeight - rect.bottom < 120;
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

function handleDelete() {
	/* 先收菜单再交给上层：此刻触发器按钮仍在 DOM 里，
	   删除确认框关掉时焦点有地方可回 */
	const trigger = triggerEl;
	close();
	if (trigger) onDelete(trigger);
}

$effect(() => {
	if (!open) return;

	/* 打开后把焦点送进菜单，否则键盘用户的焦点还停在触发器上，
	   这时按方向键会直接跳到页面别处 */
	menuEl
		?.querySelector<HTMLElement>('[role="menuitem"]')
		?.focus({ preventScroll: true });

	const onPointerDown = (event: MouseEvent) => {
		const target = event.target as Node | null;
		if (!target) return;
		if (menuEl?.contains(target) || triggerEl?.contains(target)) return;
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

<div class="row-menu-wrap">
	<button
		bind:this={triggerEl}
		type="button"
		class="icon-action more"
		aria-label={triggerLabel}
		aria-haspopup="menu"
		aria-expanded={open}
		title={i18n(I18nKey.postColActions)}
		onclick={toggle}
	>
		<Icon icon="material-symbols:more-horiz" class="action-icon" />
	</button>

	{#if open && pos}
		<div
			bind:this={menuEl}
			role="menu"
			aria-label={triggerLabel}
			class="row-menu card-base"
			style={menuStyle}
		>
			<button type="button" role="menuitem" class="menu-item danger" onclick={handleDelete}>
				<Icon icon="material-symbols:delete-outline" class="menu-icon" />
				<span>{i18n(I18nKey.postDelete)}</span>
			</button>
		</div>
	{/if}
</div>

<style>
	/* 基础形状沿用列表里 view/edit 两枚按钮（PostList 里 :global(.icon-action)），
	   这里只补它自己那档中性 hover */
	.icon-action.more:hover {
		background: color-mix(in srgb, var(--md-on-surface-variant) 14%, transparent);
	}

	.row-menu-wrap {
		display: flex;
		align-items: center;
	}

	/* .card-base 只给到背景色与大圆角，浮层该有的紧凑圆角和投影自己补 */
	.row-menu {
		z-index: 90;
		min-width: 8.5rem;
		padding: 0.25rem;
		border-radius: var(--radius-md, 0.75rem);
		box-shadow: var(--shadow-lg);
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: none;
		border-radius: var(--radius-md, 0.5rem);
		background: transparent;
		color: var(--md-on-surface-variant);
		font: inherit;
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
		transition: background-color 0.15s;
	}

	.menu-item:hover {
		background: color-mix(in srgb, var(--md-on-surface-variant) 12%, transparent);
	}

	/* 破坏性操作不主动吸引注意：文字用压暗的红，悬停才显出色块 */
	.menu-item.danger {
		color: color-mix(in srgb, var(--destructive) 75%, var(--md-on-surface));
	}

	.menu-item.danger:hover {
		background: color-mix(in srgb, var(--destructive) 14%, transparent);
	}

	.menu-item:focus-visible {
		outline: 2px solid var(--md-primary-text);
		outline-offset: -2px;
	}

	:global(.menu-icon) {
		font-size: 1.125rem;
	}
</style>
