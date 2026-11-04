<script lang="ts">
import SyncHistory from "@/components/admin/SyncHistory.svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import ConfirmDialog from "./ConfirmDialog.svelte";

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
	onOpenDiff,
}: {
	open?: boolean;
	onSynced?: () => void;
	/** 跳转到独立差异页；由调用方负责路由，面板不关心路径前缀 */
	onOpenDiff?: (slug: string, path: string) => void;
} = $props();

type PlanState = "same" | "differs" | "local-only" | "remote-only" | "unknown";

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
/** 同步记录：与操作台分离的只读视图 */
let historyOpen = $state(false);

let selected = $state<Set<string>>(new Set());
let direction = $state<Record<string, "pull" | "push">>({});
/** 覆盖本地前的确认；null 表示未打开 */
let confirmState = $state<{
	title: string;
	body: string;
	hint?: string;
	confirmText: string;
	cancelText: string;
	tone: "default" | "danger";
} | null>(null);
let confirmResolve: ((ok: boolean) => void) | null = null;

function askConfirm(info: NonNullable<typeof confirmState>): Promise<boolean> {
	confirmState = info;
	return new Promise<boolean>((resolve) => {
		confirmResolve = resolve;
	});
}

function answerConfirm(ok: boolean) {
	confirmState = null;
	const resolve = confirmResolve;
	confirmResolve = null;
	resolve?.(ok);
}

/** 执行失败的 slug，用于行内标红 */
let failedSlugs = $state<Set<string>>(new Set());

const actionable = $derived(
	(data?.items ?? []).filter(
		(i) => i.state !== "same" && i.state !== "unknown",
	),
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

async function pick(item: PlanItem, dir: "pull" | "push") {
	/* 覆盖本地是破坏性的：本地未推送的改动会被直接替换且无回收站。
	   这里必须拦一次，文案要具体到文件名，不能只问「确定吗」。 */
	if (dir === "pull" && item.state === "differs") {
		const ok = await askConfirm({
			title: `用远端版本覆盖 ${item.slug}？`,
			body: "本地这一份会被远端内容整体替换，未推送的改动不会保留，也没有回收站。",
			hint: "如果只是想看差异，先点「差异」确认内容再决定。",
			confirmText: "覆盖本地",
			cancelText: "再看看",
			tone: "danger",
		});
		if (!ok) return;
	}
	direction = { ...direction, [item.slug]: dir };
	if (!selected.has(item.slug)) toggle(item.slug);
}

/** 请求序号：连续开关面板会产生并发的 load，只认最后一次的结果 */
let loadToken = 0;

/**
 * 从 sessionStorage 恢复勾选。
 * 看完 diff 返回时不该丢掉已经选好的条目；
 * 但 plan 可能已经变化（同步过或远端更新），所以要按当前条目过滤，
 * 避免留下已经消失的 slug 导致执行时报「远端不存在」。
 */
function restoreSelection(plan: PlanPayload) {
	let saved: {
		selected?: string[];
		direction?: Record<string, "pull" | "push">;
	} | null = null;
	try {
		const raw = sessionStorage.getItem("sync:pending");
		if (raw) saved = JSON.parse(raw);
	} catch {
		saved = null;
	}
	if (!saved) {
		selected = new Set();
		direction = {};
		return;
	}
	const valid = new Set(plan.items.map((i) => i.slug));
	selected = new Set((saved.selected ?? []).filter((s) => valid.has(s)));
	direction = Object.fromEntries(
		Object.entries(saved.direction ?? {}).filter(([k]) => valid.has(k)),
	);
}

async function load() {
	const token = ++loadToken;
	loading = true;
	runMessage = null;
	failedSlugs = new Set();
	try {
		/* no-store 必须显式加：GET 请求默认走浏览器缓存，
		   快速开关面板时会拿到上一次的响应。 */
		const res = await fetch("/api/admin/sync/plan/", { cache: "no-store" });
		const payload = (await res.json().catch(() => null)) as PlanPayload | null;
		/* 后发先至的响应丢弃：期间用户可能已经重新打开了面板 */
		if (token !== loadToken) return;
		if (!payload) {
			data = emptyPlan(`HTTP ${res.status}`);
			return;
		}
		data = payload;
		restoreSelection(payload);
	} catch (error) {
		if (token !== loadToken) return;
		data = emptyPlan(error instanceof Error ? error.message : String(error));
	} finally {
		if (token === loadToken) loading = false;
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

/**
 * 打开独立差异页。
 * 目标路径不放进 URL：slug 抹掉了 /index，靠它猜不出真实路径，
 * 所以连同 slug 一起写进 sessionStorage 交给差异页取。
 * 同时把当前勾选与方向存下来——看完 diff 回来还要接着选。
 */
function openDiff(item: PlanItem) {
	try {
		sessionStorage.setItem(
			"sync:diff-target",
			JSON.stringify({ slug: item.slug, path: item.path }),
		);
		sessionStorage.setItem(
			"sync:pending",
			JSON.stringify({
				selected: [...selected],
				direction,
			}),
		);
	} catch {
		// sessionStorage 不可用时仍然允许跳转，只是回来会丢勾选
	}
	onOpenDiff?.(item.slug, item.path);
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
		if (!runFailed) {
			/* 同步成功后清掉暂存：这一轮的选择已经执行完，
			   留着会让下次打开面板时「凭空」恢复一批旧勾选。 */
			try {
				sessionStorage.removeItem("sync:pending");
				sessionStorage.removeItem("sync:diff-target");
			} catch {
				// sessionStorage 不可用，忽略
			}
			onSynced?.();
		}
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

/* 每次打开都重新比对，不复用上一次的结果。
	   之前是 `!data` 才加载，于是「新建文章 → 再打开面板」看到的还是旧列表，
	   新文章永远不出现——这是排查不到新文章的根因。 */
$effect(() => {
	if (open) void load();
});
</script>

<ConfirmDialog
	open={confirmState !== null}
	title={confirmState?.title ?? ""}
	body={confirmState?.body ?? ""}
	hint={confirmState?.hint ?? ""}
	confirmText={confirmState?.confirmText ?? "确定"}
	cancelText={confirmState?.cancelText ?? "取消"}
	tone={confirmState?.tone ?? "default"}
	onConfirm={() => answerConfirm(true)}
	onCancel={() => answerConfirm(false)}
/>

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
					<h2>{i18n(I18nKey.postSyncNow)}</h2>
					{#if data}
						<p class="sync-sub">
							<span class="dot" class:ok={data.connected}></span>
							{data.connected ? "GitHub 已连接" : "读取远端失败"}
							<span class="sep">·</span>
							本地 {data.localTotal} 篇 / 远端 {data.connected ? `${data.remoteTotal} 篇` : "-- 篇"}
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
				<p class="hint sync-state">正在比对…</p>
			{:else if data?.error || !data?.connected}
				<pre class="sync-error sync-state">{data?.error ?? "读取远端失败，原因未知"}</pre>
			{:else if data}
				<div class="sync-list-wrap">
					<!-- 表头工具栏：全选、统计、显示一致项合并成一行，省掉一层堆叠 -->
					<div class="list-head">
						<label class="head-check">
							<input
								type="checkbox"
								checked={allSelected}
								onchange={toggleAll}
								aria-label="全选可处理项"
							/>
							<span class="head-label">全选</span>
						</label>
						<div class="head-stats">
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
					</div>

					<ul class="sync-list">
						{#each visibleItems as item (item.slug)}
							{@const isSame = item.state === "same"}
							{@const picked = currentDir(item)}
							<li class="sync-row" class:same={isSame || item.state === "unknown"} class:failed={failedSlugs.has(item.slug)}>
								<label class="row-check">
									<input
										type="checkbox"
										disabled={isSame}
										checked={selected.has(item.slug)}
										onchange={() => toggle(item.slug)}
									/>
								</label>
								<div class="row-main">
									<!-- 标题为主、文件名为辅：使用者认的是文章名，不是 slug。
									     远端独有项拿不到 frontmatter（那要拉正文），
									     此时退回显示 slug，而不是谎称「无标题文章」。 -->
									<div class="row-text">
										<span class="row-title">
											{item.state === "remote-only"
												? item.slug
												: item.title?.trim() || "无标题文章"}
										</span>
										<span class="row-sub">{item.slug}</span>
									</div>
									<span class="badge" data-state={item.state}>
										{stateText(item.state)}
									</span>
								</div>
								{#if !isSame}
									<div class="row-actions">
										<button
											class="act-btn"
											type="button"
											disabled={item.state !== "differs"}
											title={item.state === "differs" ? "在独立页面查看行级差异" : "只有一边存在文件，无内容可比"}
											onclick={() => openDiff(item)}
										>
											差异
										</button>
										<button
											class="act-btn"
											class:primary={picked === "pull" || (canPull(item) && !canPush(item))}
											class:danger={item.state === "differs"}
											type="button"
											disabled={!canPull(item)}
											onclick={() => pick(item, "pull")}
										>
											拉取到本地
										</button>
										<button
											class="act-btn"
											class:primary={picked === "push" || (canPush(item) && !canPull(item))}
											type="button"
											disabled={!canPush(item)}
											onclick={() => pick(item, "push")}
										>
											推送到远端
										</button>
									</div>
								{/if}
							</li>

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
							class="ui-btn ui-btn-soft"
							type="button"
							onclick={() => (historyOpen = true)}
						>
							查看记录
						</button>
						<button
							class="ui-btn ui-btn-soft"
							type="button"
							onclick={load}
							disabled={loading || running}
						>
							重新检查
						</button>
						<button
							class="ui-btn ui-btn-primary"
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

	<SyncHistory bind:open={historyOpen} />
{/if}

<style>
	.sync-overlay {
		position: fixed;
		inset: 0;
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(0 0 0 / 0.25);
		-webkit-backdrop-filter: blur(4px);
		backdrop-filter: blur(4px);
		animation: fadeIn 0.2s ease-out;
	}

	.sync-panel {
		display: flex;
		flex-direction: column;
		width: 90%;
		max-width: 44rem;
		max-height: 84vh;
		overflow: hidden;
		background: var(--float-panel-bg);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-card-hover);
		color: var(--deep-text);
		animation: slideIn 0.3s ease-out;
	}

	.sync-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 1.25rem 1.5rem 1rem;
	}

	.head-text h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--deep-text);
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

	.sync-state {
		margin: 0 1.5rem 1rem;
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
		overflow: hidden;
	}

	.list-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1.5rem;
		border-top: 1px solid var(--line-divider);
		border-bottom: 1px solid var(--line-divider);
	}

	.head-check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}

	.head-stats {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	.head-label {
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	.sync-list {
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	.sync-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--line-divider);
		transition: background 0.15s;
	}

	.sync-row:hover {
		background: var(--btn-plain-bg-hover);
	}

	.sync-row.same {
		opacity: 0.6;
	}

	/* 失败的条目整行标红：底栏一行文字在长列表里太容易漏看 */
	.sync-row.failed {
		background: color-mix(in srgb, var(--destructive, #d33) 12%, transparent);
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

	.row-text {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
		flex: 1;
	}

	/* 标题为主：大字号、常规字重 */
	.row-title {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--deep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* slug 为辅：小字号、次级色，方便对照文件名但不抢注意力 */
	.row-sub {
		font-size: 0.6875rem;
		color: var(--content-meta);
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

	/* 行内动作：无边框文字按钮，hover 才浮现；主动作实底形成主次 */
	.act-btn {
		padding: 0.375rem 0.75rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		font-size: 0.75rem;
		color: var(--content-meta);
		cursor: pointer;
		white-space: nowrap;
		transition:
			color 0.15s,
			background 0.15s;
	}

	.act-btn:hover:not(:disabled) {
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.act-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* 该行只有一个可行方向时，它是主动作，给实底 */
	.act-btn.primary {
		background: var(--btn-regular-bg);
		color: var(--deep-text);
	}

	.act-btn.primary:hover:not(:disabled) {
		background: var(--btn-plain-bg-hover);
	}

	/* 覆盖本地是破坏性操作，未选中时也保留警告色 */
	.act-btn.danger:not(.primary) {
		color: oklch(0.72 0.16 45);
	}

	.run-msg {
		margin: 0;
		padding: 0 1.5rem 0.75rem;
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
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--line-divider);
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
