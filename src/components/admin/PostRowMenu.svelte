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
/* 菜单用 fixed 定位，坐标在打开瞬间按触发器算好；之后滚动/改尺寸一律直接
   关闭而不是重算：列表在 .admin-content 里内部滚动，fixed 元素不会跟着走。
   zoom 是触发按钮所在容器相对视口的缩放比，用于还原菜单的视觉尺寸（见下）。 */
let pos = $state<{
	right: number;
	top?: number;
	bottom?: number;
	origin: string;
	zoom: number;
} | null>(null);

/* 后台 DOM 作用域内的 token 需要随菜单一起搬到 body：--md-* 定义在
   PostList 的 .md3-list-container，--destructive 定义在 .admin-shell。
   菜单挂到 body 后不在这些作用域里，不搬会丢色。 */
const PORTED_VARS = [
	"--md-on-surface",
	"--md-on-surface-variant",
	"--md-primary-text",
	"--destructive",
];

const actionPattern = i18n(I18nKey.postActionLabel);
const triggerLabel = $derived(
	actionPattern
		.replace("{action}", i18n(I18nKey.postColActions))
		.replace("{title}", title),
);

const menuStyle = $derived(
	pos
		? `position:fixed;right:${pos.right}px;transform-origin:${pos.origin};` +
				`--row-menu-zoom:${pos.zoom};` +
				(pos.top !== undefined ? `top:${pos.top}px;` : "") +
				(pos.bottom !== undefined ? `bottom:${pos.bottom}px;` : "")
		: "",
);

/* 触发器所在 zoom 容器相对视口的缩放比。
   后台 .admin-content 带 zoom: var(--admin-zoom)（0.85 / 1 / 1.15 分档），其子树的
   getBoundingClientRect() 返回的是放大后的视觉坐标，而 offsetWidth 仍是布局
   坐标——两者之比就是 zoom。取容器而非按钮自身：34px 小尺寸取整误差会放大。
   这里反算实际值而不是写死 0.85，分档调整或未来改档位时无需同步修改。 */
function hostZoom(el: HTMLElement): number {
	const host = el.closest<HTMLElement>(".admin-content");
	if (!host) return 1;
	const visual = host.getBoundingClientRect().width;
	const layout = host.offsetWidth;
	return layout > 0 && visual > 0 ? visual / layout : 1;
}

function place() {
	if (!triggerEl) return;
	const rect = triggerEl.getBoundingClientRect();
	/* 用 clientWidth/clientHeight 而非 innerWidth/innerHeight：后者含滚动条
	   宽度，一旦页面出现滚动条，菜单右缘会横向偏移一个滚动条的宽度。 */
	const vw = document.documentElement.clientWidth;
	const vh = document.documentElement.clientHeight;
	/* 距视口底部不足 120px 就翻向上弹，避免末行的菜单被顶出屏幕 */
	const flip = vh - rect.bottom < 120;
	pos = {
		right: Math.max(8, vw - rect.right),
		top: flip ? undefined : rect.bottom + 4,
		bottom: flip ? vh - rect.top + 4 : undefined,
		origin: flip ? "bottom right" : "top right",
		zoom: hostZoom(triggerEl),
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

/* 把菜单节点搬到 body 下（项目既有做法：AnimeDetailModal / Calendar tooltip 同）。
   为什么不留在行内：后台 .admin-content 带 zoom，子树里 getBoundingClientRect()
   返回的是放大后的坐标，而 fixed 偏移又在这个 zoom 空间里再乘一次，菜单会随
   行位置线性下移（1440px 视口几乎正常，1920px 偏约三成行高，2560px 最狠）；
   并且留在行内会被 .card-base / .admin-page / .md3-table 的 overflow 裁掉。
   移出后 rect 与 fixed 偏移同在视口坐标系，也不再受任何祖先裁剪。
   Svelte 的 {#if} 卸载走 node.remove()，节点已迁移也能正常摘除。 */
$effect(() => {
	const el = menuEl;
	if (!open || !el) return;

	/* 同时把作用域内的 token 与字体搬过去：离开 .md3-list-container /
	   .admin-shell 后它们既不继承也读不到，菜单会掉色、换字体 */
	if (triggerEl) {
		const cs = getComputedStyle(triggerEl);
		for (const name of PORTED_VARS) {
			const value = cs.getPropertyValue(name).trim();
			if (value) el.style.setProperty(name, value);
		}
		el.style.fontFamily = cs.fontFamily;
	}

	document.body.appendChild(el);
	return () => el.remove();
});

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

	/* .card-base 只给到背景色与大圆角，浮层该有的紧凑圆角和投影自己补。
	   浮层底色改用前台 --float-panel-bg：与下拉/模态同档，暗色下比承载卡片高一级 */
	.row-menu {
		/* 挂在 body 下、脱离了 .admin-content 的 zoom，尺寸不再被放大，
		   用 scale 还原成与周围后台 UI 同一视觉比例。origin 由内联样式设为
		   锚点角（top right / bottom right），缩放以锚点为不动点，
		   因此菜单始终紧贴按钮的那一角 */
		transform: scale(var(--row-menu-zoom, 1));
		/* 与后台其它浮层同档（删除确认框 10000）；挂 body 后不再受
		   .admin-content 内层级与裁剪影响 */
		z-index: 9999;
		/* 兜底：JS 未读到作用域 token 时（极端情况）退到 body 上同义的 light token */
		--md-on-surface-variant: var(--content-meta);
		--md-primary-text: var(--primary);
		min-width: 8.5rem;
		padding: 0.25rem;
		background: var(--float-panel-bg);
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
