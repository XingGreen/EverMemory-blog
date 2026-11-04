<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

/**
 * 同步记录：只读。
 *
 * 与操作台分离的理由：操作台回答「现在要不要同步」，
 * 记录页回答「过去同步过几次、结果如何」。两者数据源、时效、
 * 用户意图都不同，混在一个面板里会让主操作被历史信息淹没。
 */
let { open = $bindable(false) }: { open?: boolean } = $props();

interface HistoryItem {
	event: string;
	at: number | null;
	detail: string;
	username: string;
}

let loading = $state(false);
let items = $state<HistoryItem[]>([]);
let error = $state<string | null>(null);

function fmtTime(ts: number | null): string {
	if (!ts) return "—";
	const d = new Date(ts);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 从 detail 里判断成败：apply.ts 写入的是「同步执行：成功 N / 失败 M」 */
function isFailure(item: HistoryItem): boolean {
	if (item.event !== "sync_applied") return false;
	const m = item.detail.match(/失败\s*(\d+)/);
	return m ? Number(m[1]) > 0 : false;
}

async function load() {
	loading = true;
	error = null;
	try {
		const res = await fetch("/api/admin/sync/history/?limit=100");
		const payload = (await res.json().catch(() => null)) as {
			success?: boolean;
			items?: HistoryItem[];
		} | null;
		if (!res.ok || !payload?.success) {
			error = `HTTP ${res.status}`;
			return;
		}
		items = payload.items ?? [];
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

$effect(() => {
	if (open) void load();
});
</script>

{#if open}
	<div
		class="history-overlay"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => {
			if (e.target === e.currentTarget) open = false;
		}}
		onkeydown={(e) => {
			if (e.key === "Escape") open = false;
		}}
	>
		<div class="history-panel">
			<header class="history-head">
				<h2>同步记录</h2>
				<button
					class="icon-btn"
					type="button"
					onclick={() => (open = false)}
					aria-label={i18n(I18nKey.announcementClose)}
				>
					<Icon icon="material-symbols:close" />
				</button>
			</header>

			{#if loading}
				<p class="hint">正在读取…</p>
			{:else if error}
				<pre class="error">{error}</pre>
			{:else if items.length === 0}
				<p class="hint">还没有同步记录。执行一次同步后这里会出现。</p>
			{:else}
				<ul class="history-list">
					{#each items as item, i (item.at ?? i)}
						<li class="history-row" class:failed={isFailure(item)}>
							<span class="row-time">{fmtTime(item.at)}</span>
							<span class="row-event">
								{item.event === "sync_applied" ? "执行同步" : "检查"}
							</span>
							<span class="row-detail">{item.detail || "—"}</span>
						</li>
					{/each}
				</ul>
			{/if}

			<footer class="history-actions">
				<span class="hint">保留最近 90 天</span>
				<button class="ui-btn ui-btn-soft" type="button" onclick={load} disabled={loading}>
					刷新
				</button>
			</footer>
		</div>
	</div>
{/if}

<style>
	.history-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgb(0 0 0 / 0.25);
		-webkit-backdrop-filter: blur(4px);
		backdrop-filter: blur(4px);
	}

	.history-panel {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 40rem;
		max-height: 76vh;
		padding: 1.5rem;
		gap: 0.75rem;
		overflow: hidden;
		background: var(--float-panel-bg);
		box-shadow: var(--shadow-card);
		border-radius: var(--radius-large);
		color: var(--deep-text);
	}

	.history-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.history-head h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 700;
	}

	.icon-btn {
		display: grid;
		place-items: center;
		width: 1.875rem;
		height: 1.875rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
	}

	.icon-btn:hover {
		background: var(--btn-plain-bg-hover);
	}

	.hint {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.error {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--destructive, #d33) 12%, transparent);
		font-size: 0.75rem;
		white-space: pre-wrap;
	}

	.history-list {
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.history-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
	}

	.history-row:hover {
		background: var(--btn-plain-bg-hover);
	}

	.history-row.failed .row-detail {
		color: var(--destructive, #d33);
	}

	.row-time {
		flex-shrink: 0;
		width: 8.5rem;
		color: var(--content-meta);
		font-variant-numeric: tabular-nums;
	}

	.row-event {
		flex-shrink: 0;
		padding: 0.0625rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.6875rem;
		background: var(--btn-regular-bg);
		color: var(--content-meta);
	}

	.row-detail {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.history-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-top: 0.75rem;
		border-top: 1px solid var(--post-editor-rule);
	}

	.text-btn {
		padding: 0.3125rem 0.75rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.5rem;
		background: transparent;
		font-size: 0.75rem;
		color: var(--content-meta);
		cursor: pointer;
	}

	.text-btn:hover:not(:disabled) {
		color: var(--deep-text);
		border-color: var(--primary);
	}

	.text-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
