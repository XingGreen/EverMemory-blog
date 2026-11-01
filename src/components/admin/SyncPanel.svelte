<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

/**
 * 同步操作台。
 *
 * 数据来自 GET /api/admin/sync/plan —— 只拉远端元数据（sha），
 * 本地算 Git blob 哈希比对，不下载任何正文。
 * 正文只在用户点某一行的「差异」时才拉，走 GET /sync/filediff。
 *
 * 四种状态不含方向：sha 不同只说明内容不同，判断不出谁更新。
 * 所以两个方向按钮恒定显示，不可能的那个置灰——让用户看见「为什么不能」，
 * 比直接隐藏更清楚。
 */
let {
	open = $bindable(false),
	onSynced,
}: { open?: boolean; onSynced?: () => void } = $props();

type PlanState = "same" | "differs" | "local-only" | "remote-only";

interface PlanItem {
	slug: string;
	path: string;
	state: PlanState;
	localSha: string | null;
	remoteSha: string | null;
	crlf?: boolean;
	draft?: boolean;
	title?: string;
}

interface PlanPayload {
	success: boolean;
	connected: boolean;
	error: string | null;
	localAvailable: boolean;
	localTotal: number;
	remoteTotal: number;
	counts: {
		same: number;
		differs: number;
		localOnly: number;
		remoteOnly: number;
		crlfSuspect: number;
	};
	items: PlanItem[];
}

interface ApplyResult {
	slug: string;
	direction: "pull" | "push";
	ok: boolean;
	message?: string;
}

let loading = $state(false);
let running = $state(false);
let data = $state<PlanPayload | null>(null);
let runMessage = $state<string | null>(null);
let runFailed = $state(false);
let showSame = $state(false);

let selected = $state<Set<string>>(new Set());
let direction = $state<Record<string, "pull" | "push">>({});
/** 执行失败的 slug，用于行内标红 */
let failedSlugs = $state<Set<string>>(new Set());

/** 差异面板：一次只看一条 */
let diffSlug = $state<string | null>(null);
let diffData = $state<{
	localContent: string | null;
	remoteContent: string | null;
	localError: string | null;
	remoteError: string | null;
} | null>(null);
let diffLoading = $state(false);

const actionable = $derived(
	(data?.items ?? []).filter((i) => i.state !== "same"),
);
const visibleItems = $derived(
	(data?.items ?? []).filter((i) => i.state !== "same" || showSame),
);
const allSelected = $derived(
	actionable.length > 0 && actionable.every((i) => selected.has(i.slug)),
);

function canPull(item: PlanItem): boolean {
	return item.state !== "local-only";
}
function canPush(item: PlanItem): boolean {
	return item.state !== "remote-only";
}
function currentDir(item: PlanItem): "pull" | "push" | null {
	const picked = direction[item.slug];
	if (picked) return picked;
	if (item.state === "remote-only") return "pull";
	if (item.state === "local-only") return "push";
	return null;
}

function toggle(slug: string) {
	const next = new Set(selected);
	if (next.has(slug)) next.delete(slug);
	else next.add(slug);
	selected = next;
}

function toggleAll() {
	selected = allSelected ? new Set() : new Set(actionable.map((i) => i.slug));
}

function pick(item: PlanItem, dir: "pull" | "push") {
	/* 覆盖本地是破坏性的：本地未推送的改动会被直接替换且无回收站。
		   这里必须拦一次，文案要具体到文件名，不能只问「确定吗」。 */
	if (dir === "pull" && item.state === "differs") {
		const ok = window.confirm(
			`将用远端版本覆盖 ${item.slug}，本地未推送的改动会丢失。确定继续？`,
		);
		if (!ok) return;
	}
	direction = { ...direction, [item.slug]: dir };
	if (!selected.has(item.slug)) toggle(item.slug);
}

async function load() {
	loading = true;
	runMessage = null;
	failedSlugs = new Set();
	diffSlug = null;
	diffData = null;
	try {
		const res = await fetch("/api/admin/sync/plan/");
		const payload = (await res.json().catch(() => null)) as PlanPayload | null;
		if (!payload) {
			data = emptyPlan(`HTTP ${res.status}`);
			return;
		}
		data = payload;
		selected = new Set();
		direction = {};
	} catch (error) {
		data = emptyPlan(error instanceof Error ? error.message : String(error));
	} finally {
		loading = false;
	}
}

function emptyPlan(error: string): PlanPayload {
	return {
		success: false,
		connected: false,
		error,
		localAvailable: false,
		localTotal: 0,
		remoteTotal: 0,
		counts: {
			same: 0,
			differs: 0,
			localOnly: 0,
			remoteOnly: 0,
			crlfSuspect: 0,
		},
		items: [],
	};
}

async function showDiff(item: PlanItem) {
	if (diffSlug === item.slug) {
		diffSlug = null;
		diffData = null;
		return;
	}
	diffSlug = item.slug;
	diffData = null;
	diffLoading = true;
	try {
		const res = await fetch(
			`/api/admin/sync/filediff/?slug=${encodeURIComponent(item.slug)}&path=${encodeURIComponent(item.path)}`,
		);
		diffData = await res.json();
	} catch (error) {
		diffData = {
			localContent: null,
			remoteContent: null,
			localError: error instanceof Error ? error.message : String(error),
			remoteError: null,
		};
	} finally {
		diffLoading = false;
	}
}

async function apply() {
	const items = [...selected]
		.map((slug) => {
			const item = actionable.find((i) => i.slug === slug);
			const dir = item ? currentDir(item) : null;
			if (!item || !dir) return null;
			return { slug: item.slug, path: item.path, direction: dir };
		})
		.filter(
			(x): x is { slug: string; path: string; direction: "pull" | "push" } =>
				x !== null,
		);

	if (items.length === 0) {
		runFailed = true;
		runMessage = "请先勾选条目并选择方向";
		return;
	}

	running = true;
	runMessage = null;
	runFailed = false;
	failedSlugs = new Set();
	try {
		const res = await fetch("/api/admin/sync/apply/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ items }),
		});
		const payload = (await res.json().catch(() => null)) as {
			success?: boolean;
			message?: string;
			results?: ApplyResult[];
		} | null;

		const failed = (payload?.results ?? []).filter((r) => !r.ok);
		failedSlugs = new Set(failed.map((f) => f.slug));
		runFailed = !res.ok || !payload?.success;
		runMessage = payload?.message ?? `HTTP ${res.status}`;
		if (!runFailed) onSynced?.();
		await load();
	} catch (error) {
		runFailed = true;
		runMessage = error instanceof Error ? error.message : String(error);
	} finally {
		running = false;
	}
}

function stateText(state: PlanState): string {
	if (state === "same") return "一致";
	if (state === "differs") return "内容不同";
	if (state === "remote-only") return "仅远端";
	return "仅本地";
}

$effect(() => {
	if (open && !data && !loading) void load();
});
</script>

{#if open}
	<div
		class="sync-overlay"
		role="dialog"
		aria-modal="true"
		aria-label={i18n(I18nKey.postSyncNow)}
		tabindex="-1"
		onclick={(e) => {
			if (e.target === e.currentTarget) open = false;
		}}
		onkeydown={(e) => {
			if (e.key === "Escape") open = false;
		}}
	>
		<div class="sync-panel">
			<header class="sync-head">
				<div class="head-text">
					<h3>
						<Icon icon="material-symbols:sync" class="head-icon" />
						{i18n(I18nKey.postSyncNow)}
					</h3>
					{#if data}
						<p class="sync-sub">
							<span class="dot" class:ok={data.connected}></span>
							{data.connected ? "GitHub 已连接" : "GitHub 不可达"}
							<span class="sep">·</span>
							本地 {data.localTotal} 篇 / 远端 {data.remoteTotal} 篇
							{#if !data.localAvailable}
								<span class="warn">· 当前环境读不到本地文件</span>
							{/if}
						</p>
					{/if}
				</div>
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
				<p class="hint">正在比对…</p>
			{:else if data?.error}
				<pre class="sync-error">{data.error}</pre>
			{:else if data}
				<div class="sync-toolbar">
					<span>
						需处理 <b class="num-warn">{actionable.length}</b> 项 · 一致
						<b class="num-ok">{data.counts.same}</b> 项
					</span>
					<button
						class="link-btn"
						type="button"
						onclick={() => (showSame = !showSame)}
						disabled={data.counts.same === 0}
					>
						{showSame ? "隐藏一致项" : "显示一致项"}
					</button>
				</div>

				<div class="sync-list-wrap">
					<!-- 表头：全选框负责批量选择，不再单设「清空」——再点一次即取消 -->
					<div class="list-head">
						<label class="head-check">
							<input
								type="checkbox"
								checked={allSelected}
								onchange={toggleAll}
								aria-label="全选可处理项"
							/>
						</label>
						<span class="head-label">全选可处理项</span>
					</div>

					<ul class="sync-list">
						{#each visibleItems as item (item.slug)}
							{@const isSame = item.state === "same"}
							{@const picked = currentDir(item)}
							<li class="sync-row" class:same={isSame} class:failed={failedSlugs.has(item.slug)}>
								<label class="row-check">
									<input
										type="checkbox"
										disabled={isSame}
										checked={selected.has(item.slug)}
										onchange={() => toggle(item.slug)}
									/>
								</label>
								<div class="row-main">
									<span class="row-slug">{item.slug}</span>
									<span class="badge" data-state={item.state}>
										{stateText(item.state)}
									</span>
								</div>
								{#if !isSame}
									<div class="row-actions">
										<button
											class="text-btn"
											type="button"
											onclick={() => showDiff(item)}
										>
											{ diffSlug === item.slug ? "收起" : "差异" }
										</button>
										<button
											class="text-btn"
											class:on={picked === "pull"}
											class:danger={item.state === "differs"}
											type="button"
											disabled={!canPull(item)}
											onclick={() => pick(item, "pull")}
										>
											拉取到本地
										</button>
										<button
											class="text-btn"
											class:on={picked === "push"}
											type="button"
											disabled={!canPush(item)}
											onclick={() => pick(item, "push")}
										>
											推送到远端
										</button>
									</div>
								{/if}
							</li>

							{#if diffSlug === item.slug}
								<li class="diff-pane">
									{#if diffLoading}
										<p class="hint">正在加载正文…</p>
									{:else if diffData}
										<div class="diff-cols">
											<div class="diff-col">
												<span class="diff-title">
													本地
													{#if diffData.localError}
														<span class="warn">· {diffData.localError}</span>
													{/if}
												</span>
												<pre class="diff-body">{diffData.localContent ?? "（本地无此文件）"}</pre>
											</div>
											<div class="diff-col">
												<span class="diff-title">
													远端
													{#if diffData.remoteError}
														<span class="warn">· {diffData.remoteError}</span>
													{/if}
												</span>
												<pre class="diff-body">{diffData.remoteContent ?? "（远端无此文件）"}</pre>
											</div>
										</div>
									{/if}
								</li>
							{/if}
						{/each}
					</ul>
				</div>

				{#if runMessage}
					<p class="run-msg" class:failed={runFailed}>{runMessage}</p>
				{/if}

				<footer class="sync-actions">
					<span class="selected-tip">
						已选 <b>{selected.size}</b> 项待同步
					</span>
					<div class="toolbar-actions">
						<button
							class="text-btn"
							type="button"
							onclick={load}
							disabled={loading || running}
						>
							重新检查
						</button>
						<button
							class="savebar-btn primary"
							type="button"
							onclick={apply}
							disabled={running || selected.size === 0}
						>
							{running ? "执行中…" : "执行同步"}
						</button>
					</div>
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.sync-overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		background: rgb(0 0 0 / 0.5);
		backdrop-filter: blur(2px);
	}

	.sync-panel {
		display: flex;
		flex-direction: column;
		width: min(48rem, 94vw);
		max-height: 84vh;
		padding: 1.5rem 1.5rem 1rem;
		gap: 1rem;
		border-radius: 1rem;
		border: 1px solid var(--line-divider);
		background: var(--card-bg);
		box-shadow: 0 24px 70px -14px rgb(0 0 0 / 0.5);
	}

	.sync-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.head-text h3 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--deep-text);
	}

	.head-icon {
		color: var(--primary);
	}

	.sync-sub {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0.5rem 0 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.dot {
		width: 0.4375rem;
		height: 0.4375rem;
		border-radius: 9999px;
		background: var(--content-meta);
	}

	.dot.ok {
		background: oklch(0.72 0.17 145);
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

	.warn {
		color: oklch(0.72 0.15 70);
	}

	.sync-error {
		margin: 0;
		padding: 0.625rem 0.875rem;
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--destructive, #d33) 12%, transparent);
		font-size: 0.75rem;
		line-height: 1.55;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 7rem;
		overflow: auto;
	}

	.sync-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		font-size: 0.875rem;
		color: var(--deep-text);
	}

	.num-warn {
		color: oklch(0.72 0.16 45);
	}

	.num-ok {
		color: oklch(0.72 0.15 145);
	}

	.sync-list-wrap {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-radius: 0.75rem;
		background: var(--btn-regular-bg);
		overflow: hidden;
	}

	.list-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.875rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.head-check {
		display: flex;
		align-items: center;
	}

	.head-label {
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	.sync-list {
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: 0.375rem;
		list-style: none;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.sync-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem 0.625rem;
		border-radius: 0.625rem;
		background: var(--card-bg);
		transition: background 0.15s;
	}

	.sync-row:hover {
		background: color-mix(in srgb, var(--primary) 6%, var(--card-bg));
	}

	.sync-row.same {
		opacity: 0.6;
	}

	/* 失败的条目整行标红：底栏一行文字在长列表里太容易漏看 */
	.sync-row.failed {
		background: color-mix(in srgb, var(--destructive, #d33) 12%, var(--card-bg));
	}

	.row-check {
		display: flex;
		align-items: center;
	}

	.row-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
	}

	.row-slug {
		font-size: 0.875rem;
		color: var(--deep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.badge {
		flex-shrink: 0;
		padding: 0.125rem 0.4375rem;
		border-radius: 0.3125rem;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--content-meta);
		background: var(--btn-plain-bg-hover);
	}

	.badge[data-state="differs"] {
		color: oklch(0.72 0.16 45);
		background: color-mix(in srgb, oklch(0.72 0.16 45) 16%, transparent);
	}

	.badge[data-state="remote-only"] {
		color: oklch(0.72 0.13 220);
		background: color-mix(in srgb, oklch(0.72 0.13 220) 16%, transparent);
	}

	.badge[data-state="local-only"] {
		color: oklch(0.72 0.15 145);
		background: color-mix(in srgb, oklch(0.72 0.15 145) 16%, transparent);
	}

	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.text-btn {
		padding: 0.3125rem 0.625rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.5rem;
		background: transparent;
		font-size: 0.75rem;
		color: var(--content-meta);
		cursor: pointer;
		white-space: nowrap;
		transition:
			color 0.15s,
			border-color 0.15s,
			background 0.15s;
	}

	.text-btn:hover:not(:disabled) {
		color: var(--deep-text);
		border-color: var(--primary);
	}

	.text-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.text-btn.on {
		color: var(--primary-foreground, #fff);
		background: var(--primary);
		border-color: var(--primary);
	}

	/* 覆盖本地是破坏性操作，未选中时也保留警告色，让风险先被看见 */
	.text-btn.danger:not(.on) {
		color: oklch(0.72 0.16 45);
		border-color: color-mix(in srgb, oklch(0.72 0.16 45) 45%, transparent);
	}

	.diff-pane {
		padding: 0.5rem;
	}

	.diff-cols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}

	.diff-col {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.diff-title {
		font-size: 0.6875rem;
		color: var(--content-meta);
	}

	.diff-body {
		margin: 0;
		max-height: 14rem;
		overflow: auto;
		padding: 0.5rem 0.625rem;
		border-radius: 0.5rem;
		background: var(--btn-regular-bg);
		font-size: 0.6875rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.run-msg {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--deep-text);
	}

	.run-msg.failed {
		color: var(--destructive, #d33);
	}

	.sync-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding-top: 0.875rem;
		border-top: 1px solid var(--post-editor-rule);
	}

	.selected-tip {
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.selected-tip b {
		color: var(--deep-text);
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
</style>
