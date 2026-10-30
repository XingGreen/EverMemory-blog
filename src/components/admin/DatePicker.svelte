<script lang="ts">
/**
 * 日期选择器：照搬参考项目 src/components/ui/date-picker.tsx 的结构与尺寸。
 *
 * 差异只在技术栈（React → Svelte 5）：逻辑（UTC 计算、月历网格、禁用未来日期、
 * 点击外部关闭）与 Tailwind 尺寸值原样保留。
 *
 * 触发器 h-10 / rounded-xl / 底 btn-regular-bg / pl-9（左侧图标留位）
 * 面板   absolute top-full mt-2 / w-70(17.5rem) / rounded-xl / p-4 / ring-1
 * 单元格 w-8 h-8（2rem）
 */
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

let {
	value = "",
	onChange,
	maxDate,
	placeholder,
	id,
}: {
	value?: string;
	onChange: (next: string) => void;
	maxDate?: string;
	placeholder?: string;
	id?: string;
} = $props();

const todayDate = new Date().toISOString().slice(0, 10);
const activeDate = $derived(value || todayDate);

let open = $state(false);
let containerEl = $state<HTMLDivElement | undefined>();

function initView(dateStr: string): Date {
	return new Date(`${dateStr}T00:00:00Z`);
}

let viewDate = $state<Date>(initView(activeDate));

$effect(() => {
	// 外部值变化时把视图翻到对应月份（对应参考里 useEffect 的 setViewDate）
	viewDate = initView(activeDate);
});

/* 语言标签取 <html lang>（Astro 已按当前语言设置），SSR 阶段回退到 zh-CN。
   参考项目用 paraglide 的 getLocale()，本项目没有等价 API，故用文档属性。 */
const localeTag = $derived(
	typeof document !== "undefined" && document.documentElement.lang
		? document.documentElement.lang
		: "zh-CN",
);

const daysOfWeek = $derived(
	Array.from({ length: 7 }, (_, index) =>
		new Intl.DateTimeFormat(localeTag, {
			weekday: "narrow",
			timeZone: "UTC",
		}).format(new Date(Date.UTC(2024, 0, 7 + index))),
	),
);

const monthLabel = $derived(
	viewDate.toLocaleString(localeTag, {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}),
);

function daysInMonth(date: Date): number {
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
	).getUTCDate();
}

function firstDayOfMonth(date: Date): number {
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
	).getUTCDay();
}

function shiftMonth(offset: number) {
	viewDate = new Date(
		Date.UTC(viewDate.getUTCFullYear(), viewDate.getUTCMonth() + offset, 1),
	);
}

function dayValue(day: number): string {
	const year = viewDate.getUTCFullYear();
	const month = (viewDate.getUTCMonth() + 1).toString().padStart(2, "0");
	return `${year}-${month}-${day.toString().padStart(2, "0")}`;
}

function isDisabled(date: string): boolean {
	return Boolean(maxDate && date > maxDate);
}

function pick(day: number) {
	const next = dayValue(day);
	if (isDisabled(next)) return;
	onChange(next);
	open = false;
}

/** 点击组件外收起（参考用 document mousedown，这里用 window pointerdown） */
function handleOutside(e: PointerEvent) {
	if (!open) return;
	if (containerEl && !containerEl.contains(e.target as Node)) open = false;
}
</script>

<svelte:window onpointerdown={handleOutside} />

<div class="date-picker" bind:this={containerEl}>
	<button
		{id}
		type="button"
		class="date-trigger"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="date-trigger-icon">
			<Icon icon="material-symbols:calendar-month-outline-rounded" />
		</span>
		<span class={value ? "" : "is-empty"}>
			{value || placeholder || i18n(I18nKey.postPublished)}
		</span>
	</button>

	{#if open}
		<div class="date-panel">
			<div class="date-panel-head">
				<button
					type="button"
					class="date-nav"
					aria-label="-1"
					onclick={() => shiftMonth(-1)}
				>
					<Icon icon="material-symbols:chevron-left" />
				</button>
				<h4>{monthLabel}</h4>
				<button
					type="button"
					class="date-nav"
					aria-label="+1"
					onclick={() => shiftMonth(1)}
				>
					<Icon icon="material-symbols:chevron-right" />
				</button>
			</div>

			<div class="date-weekdays">
				{#each daysOfWeek as label, i (i)}
					<span>{label}</span>
				{/each}
			</div>

			<div class="date-grid">
				{#each Array.from({ length: firstDayOfMonth(viewDate) }, (_, i) => i) as i (i)}
					<span class="date-empty"></span>
				{/each}
				{#each Array.from({ length: daysInMonth(viewDate) }, (_, i) => i + 1) as day (day)}
					{@const dv = dayValue(day)}
					<button
						type="button"
						class="date-cell"
						class:is-selected={dv === value}
						class:is-today={dv === todayDate}
						disabled={isDisabled(dv)}
						aria-pressed={dv === value}
						onclick={() => pick(day)}
					>
						{day}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.date-picker {
		position: relative;
		width: 100%;
	}

	/* 触发器：h-10 rounded-xl bg-btn-regular-bg pl-9 pr-3 text-sm */
	.date-trigger {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		height: 2.5rem;
		padding: 0 0.75rem 0 2.25rem;
		border: none;
		border-radius: 0.75rem;
		background: var(--btn-regular-bg);
		color: var(--deep-text);
		font-family: inherit;
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
	}

	.date-trigger-icon {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		color: var(--content-meta);
	}

	.date-trigger .is-empty {
		color: color-mix(in srgb, var(--content-meta) 60%, transparent);
	}

	/* 面板：absolute top-full mt-2 w-70 rounded-xl bg-card p-4 ring-1 */
	.date-panel {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 50;
		width: 17.5rem;
		margin-top: 0.5rem;
		padding: 1rem;
		border-radius: 0.75rem;
		background: var(--card-bg);
		box-shadow:
			0 0 0 1px var(--input-border),
			0 8px 24px rgb(0 0 0 / 0.18);
	}

	.date-panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.date-panel-head h4 {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--deep-text);
	}

	.date-nav {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
	}

	.date-nav:hover {
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.date-weekdays {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		margin-bottom: 0.25rem;
		font-size: 0.75rem;
		color: var(--content-meta);
		text-align: center;
	}

	.date-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 0.125rem;
	}

	.date-empty {
		width: 2rem;
		height: 2rem;
	}

	/* 单元格 w-8 h-8 */
	.date-cell {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--deep-text);
		font-family: inherit;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.date-cell:hover:not(:disabled) {
		background: var(--btn-regular-bg);
	}

	.date-cell:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.date-cell.is-selected {
		background: var(--primary);
		color: var(--primary-foreground);
	}

	/* 今天：单元格底部一个小横线（参考用 absolute bottom-1 的 1px 主色线段） */
	.date-cell.is-today::after {
		content: "";
		position: absolute;
		bottom: 0.25rem;
		left: 50%;
		width: 0.25rem;
		height: 1px;
		transform: translateX(-50%);
		background: var(--primary);
	}

	.date-cell.is-selected.is-today::after {
		background: var(--primary-foreground);
	}
</style>
