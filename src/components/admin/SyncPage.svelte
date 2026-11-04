<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	collapseUnchanged,
	countChanges,
	type DiffLine,
	diffLines,
} from "@/utils/line-diff";
import Checkbox from "./Checkbox.svelte";
import ConfirmDialog from "./ConfirmDialog.svelte";
import SyncHistory from "./SyncHistory.svelte";

/**
 * 同步工作台（/admin/sync/）。
 *
 * 左栏是清单与导航，右栏是这一个文件的全部细节。
 *
 * 「勾选」和「选中」是两个独立状态，刻意不合并：
 *   勾选 —— 参与批量执行
 *   选中 —— 右栏展示，不改动待执行队列
 * 合并的话，想看某个文件的差异就得先把它加进执行队列，很容易误操作。
 */

let {
	slug = "",
	onOpen,
	onBack,
}: {
	/** 右栏当前展示的文件；空串表示概览 */
	slug?: string;
	onOpen: (slug: string) => void;
	onBack: () => void;
} = $props();

type PlanState = "same" | "differs" | "local-only" | "remote-only" | "unknown";

interface PlanItem {
	slug: string;
	path: string;
	state: PlanState;
	title: string | null;
	draft: boolean;
}

interface PlanPayload {
	connected: boolean;
	localAvailable: boolean;
	error: string | null;
	localTotal: number;
	remoteTotal: number;
	counts: Record<string, number>;
	items: PlanItem[];
}

interface FilediffPayload {
	localContent: string | null;
	remoteContent: string | null;
	localError: string | null;
	remoteError: string | null;
}

let data = $state<PlanPayload | null>(null);
let loading = $state(true);
/** 勾选：参与批量执行 */
let selected = $state<Set<string>>(new Set());
let direction = $state<Record<string, "pull" | "push">>({});
let showSame = $state(false);
let running = $state(false);
let runMessage = $state<string | null>(null);
let runFailed = $state(false);
let loadToken = 0;

let historyOpen = $state(false);
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

const actionable = $derived(
	(data?.items ?? []).filter(
		(i) => i.state !== "same" && i.state !== "unknown",
	),
);
const visibleItems = $derived(showSame ? (data?.items ?? []) : actionable);
const allSelected = $derived(
	actionable.length > 0 && actionable.every((i) => selected.has(i.slug)),
);
const activeItem = $derived(
	(data?.items ?? []).find((i) => i.slug === slug) ?? null,
);

function stateText(state: PlanState): string {
	if (state === "unknown") return "状态未知";
	if (state === "same") return "一致";
	if (state === "differs") return "内容不同";
	if (state === "local-only") return "仅本地";
	return "仅远端";
}

function canPull(item: PlanItem): boolean {
	return item.state !== "local-only" && item.state !== "unknown";
}

function canPush(item: PlanItem): boolean {
	return item.state !== "remote-only" && item.state !== "unknown";
}

function currentDir(item: PlanItem): "pull" | "push" | null {
	return direction[item.slug] ?? null;
}

function toggle(slugToToggle: string) {
	const next = new Set(selected);
	if (next.has(slugToToggle)) next.delete(slugToToggle);
	else next.add(slugToToggle);
	selected = next;
	persistSelection();
}

function toggleAll() {
	selected = allSelected ? new Set() : new Set(actionable.map((i) => i.slug));
}

/** 从 sessionStorage 恢复勾选，按当前条目过滤掉已消失的 */
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

function persistSelection() {
	try {
		sessionStorage.setItem(
			"sync:pending",
			JSON.stringify({ selected: [...selected], direction }),
		);
	} catch {
		// sessionStorage 不可用，忽略
	}
}

async function load() {
	const token = ++loadToken;
	loading = true;
	runMessage = null;
	try {
		const res = await fetch("/api/admin/sync/plan/", { cache: "no-store" });
		const payload = (await res.json().catch(() => null)) as PlanPayload | null;
		if (token !== loadToken) return;
		if (!payload) {
			data = {
				connected: false,
				localAvailable: false,
				error: `HTTP ${res.status}`,
				localTotal: 0,
				remoteTotal: 0,
				counts: {},
				items: [],
			};
			return;
		}
		data = payload;
		restoreSelection(payload);
	} catch (error) {
		if (token !== loadToken) return;
		data = {
			connected: false,
			localAvailable: false,
			error: error instanceof Error ? error.message : String(error),
			localTotal: 0,
			remoteTotal: 0,
			counts: {},
			items: [],
		};
	} finally {
		if (token === loadToken) loading = false;
	}
}

async function pick(item: PlanItem, dir: "pull" | "push") {
	if (dir === "pull" && item.state === "differs") {
		const ok = await askConfirm({
			title: `用远端版本覆盖 ${item.slug}？`,
			body: "本地这一份会被远端内容整体替换，未推送的改动不会保留，也没有回收站。",
			hint: "如果只是想看差异，先在右栏确认内容再决定。",
			confirmText: "覆盖本地",
			cancelText: "再看看",
			tone: "danger",
		});
		if (!ok) return;
	}
	direction = { ...direction, [item.slug]: dir };
	if (!selected.has(item.slug)) toggle(item.slug);
	persistSelection();
}

async function apply() {
	if (running || selected.size === 0) return;
	running = true;
	runMessage = null;
	runFailed = false;
	try {
		const items = [...selected]
			.map((s) => {
				const item = actionable.find((i) => i.slug === s);
				const dir = item ? currentDir(item) : null;
				return item && dir
					? { slug: item.slug, path: item.path, direction: dir }
					: null;
			})
			.filter((x): x is NonNullable<typeof x> => x !== null);

		if (items.length === 0) {
			runMessage = "选中的条目还没确定方向";
			runFailed = true;
			return;
		}

		const res = await fetch("/api/admin/sync/apply/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ items }),
		});
		const payload = (await res.json().catch(() => null)) as {
			success?: boolean;
			message?: string;
		} | null;
		runFailed = !payload?.success;
		runMessage = payload?.message ?? `HTTP ${res.status}`;
		if (!runFailed) {
			try {
				sessionStorage.removeItem("sync:pending");
			} catch {
				// 忽略
			}
			selected = new Set();
			direction = {};
		}
		await load();
	} catch (error) {
		runFailed = true;
		runMessage = error instanceof Error ? error.message : String(error);
	} finally {
		running = false;
	}
}

function badgeClass(state: PlanState): string {
	if (state === "same") return "same";
	if (state === "differs") return "differs";
	if (state === "unknown") return "unknown";
	return "one-side";
}

/* ── 右栏 ── */
let detail = $state<FilediffPayload | null>(null);
let detailLoading = $state(false);
let hideUnchanged = $state(true);
let detailToken = 0;

const diffRows = $derived(() => {
	if (!detail) return [];
	const rows = diffLines(detail.localContent ?? "", detail.remoteContent ?? "");
	return hideUnchanged ? collapseUnchanged(rows, 3) : rows;
});

const diffStats = $derived(() => {
	if (!detail) return { added: 0, removed: 0 };
	return countChanges(
		diffLines(detail.localContent ?? "", detail.remoteContent ?? ""),
	);
});

async function loadDetail() {
	const target = slug;
	if (!target || !data) {
		detail = null;
		return;
	}
	const token = ++detailToken;
	detailLoading = true;
	try {
		/* 路径取 plan 里的真实值：slug 抹掉了 /index，自己拼会拼错 */
		const path =
			data.items.find((i) => i.slug === target)?.path ??
			`src/content/posts/${target}.md`;
		const res = await fetch(
			`/api/admin/sync/filediff/?slug=${encodeURIComponent(target)}&path=${encodeURIComponent(path)}`,
			{ cache: "no-store" },
		);
		if (token !== detailToken) return;
		detail = res.ok ? ((await res.json()) as FilediffPayload) : null;
	} catch {
		if (token === detailToken) detail = null;
	} finally {
		if (token === detailToken) detailLoading = false;
	}
}

$effect(() => {
	void load();
});

/* 换选中项或重新比对后刷新右栏 */
$effect(() => {
	void slug;
	void data;
	void loadDetail();
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

<SyncHistory bind:open={historyOpen} />

<div class="sync-page">
	<header class="sync-head">
		<div class="head-text">
			<h1>{i18n(I18nKey.postSyncNow)}</h1>
			{#if data}
				<p class="head-meta">
					<span class="dot" class:ok={data.connected}></span>
					{data.connected ? "GitHub 已连接" : "读取远端失败"}
					<span class="sep">·</span>
					本地 {data.localTotal} 篇 / 远端 {data.connected
						? `${data.remoteTotal} 篇`
						: "-- 篇"}
					{#if !data.localAvailable}
						<span class="warn">· 当前环境读不到本地文件</span>
					{/if}
				</p>
			{/if}
		</div>
		<div class="head-actions">
			<button class="ui-btn ui-btn-soft" type="button" onclick={onBack}>
				返回文章
			</button>
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
		</div>
	</header>

	<div class="sync-split">
		<aside class="sync-sidebar">
			{#if loading}
				<p class="hint">正在比对…</p>
			{:else if data?.error || !data?.connected}
				<pre class="err">{data?.error ?? "读取远端失败，原因未知"}</pre>
			{:else if data}
				<div class="side-stats">
					<span>
						需处理 <b class="num-warn">{actionable.length}</b> 项 · 一致
						<b class="num-ok">{data.counts.same ?? 0}</b> 项
					</span>
					<button
						class="link-btn"
						type="button"
						onclick={() => (showSame = !showSame)}
						disabled={(data.counts.same ?? 0) === 0}
					>
						{showSame ? "隐藏一致项" : "显示一致项"}
					</button>
				</div>

				<div class="side-check">
					<Checkbox
						checked={allSelected}
						onchange={toggleAll}
						label="全选可处理项"
					/>
					<span>全选</span>
				</div>

				<ul class="side-list">
					{#each visibleItems as item (item.slug)}
						{@const isActive = item.slug === slug}
						{@const isSame = item.state === "same"}
						<li
							class="side-row"
							class:active={isActive}
							class:dim={isSame || item.state === "unknown"}
						>
							<Checkbox
								checked={selected.has(item.slug)}
								disabled={isSame || item.state === "unknown"}
								onchange={() => toggle(item.slug)}
								label={`勾选 ${item.slug}`}
							/>
							<button
								class="row-open"
								type="button"
								onclick={() => onOpen(item.slug)}
							>
								<span class="row-title">
									{item.state === "remote-only"
										? item.slug
										: item.title?.trim() || "无标题文章"}
								</span>
								<span class="row-sub">{item.slug}</span>
							</button>
							<span class="badge {badgeClass(item.state)}">
								{stateText(item.state)}
							</span>
						</li>
					{/each}
				</ul>

				{#if runMessage}
					<p class="run-msg" class:failed={runFailed}>{runMessage}</p>
				{/if}

				<div class="side-foot">
					<span>已选 <b>{selected.size}</b> 项</span>
					<button
						class="ui-btn ui-btn-primary"
						type="button"
						onclick={apply}
						disabled={running || selected.size === 0}
					>
						{running ? "执行中…" : "执行同步"}
					</button>
				</div>
			{/if}
		</aside>

		<section class="sync-main">
			{#if !slug}
				<div class="main-empty">
					<Icon icon="material-symbols:article" class="empty-icon" />
					<p class="empty-title">从左侧选一项查看</p>
					<p class="empty-hint">
						选中后可以查看这个文件的差异或内容，再决定拉取还是推送。
						勾选框用于批量执行，点行只切换右侧展示。
					</p>
				</div>
			{:else if detailLoading}
				<p class="hint">正在加载内容…</p>
			{:else if !detail}
				<p class="hint">读取不到这个文件的内容。</p>
			{:else}
				<div class="detail-head">
					<h2>{activeItem?.title?.trim() || slug}</h2>
					<div class="detail-meta">
						<span class="badge {badgeClass(activeItem?.state ?? "unknown")}">
							{activeItem ? stateText(activeItem.state) : "状态未知"}
						</span>
						{#if activeItem?.state === "differs"}
							<span class="stat-add">+{diffStats().added}</span>
							<span class="stat-del">-{diffStats().removed}</span>
							<div class="toggle">
								<Checkbox
									checked={hideUnchanged}
									onchange={() => (hideUnchanged = !hideUnchanged)}
									label="折叠未变更的行"
								/>
								<span>折叠未变更</span>
							</div>
						{/if}
					</div>
				</div>

				{#if detail.localError}
					<p class="detail-err">本地读取失败：{detail.localError}</p>
				{/if}
				{#if detail.remoteError}
					<p class="detail-err">远端读取失败：{detail.remoteError}</p>
				{/if}

				{#if activeItem?.state === "differs" && detail.localContent !== null && detail.remoteContent !== null}
					<div class="diff-body">
						{#each diffRows() as line, idx (idx)}
							{#if line.kind === "gap"}
								<div class="diff-row gap">
									<span class="lno"></span>
									<span class="code">⋯ 跳过 {line.count} 行未变更</span>
								</div>
							{:else}
								<div class="diff-row {line.kind}">
									<span class="lno">{line.left ?? line.right ?? ""}</span>
									<span class="code">
										<span class="marker">{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}</span><span class="text">{line.text || " "}</span>
									</span>
								</div>
							{/if}
						{/each}
					</div>
				{:else}
					<!-- 只有一边存在：直接展示这一边的全文，供判断是否推送/拉取 -->
					<pre class="single-body">{detail.localContent ?? detail.remoteContent ?? "（无内容）"}</pre>
				{/if}

				{#if activeItem}
					<div class="detail-actions">
						<button
							class="ui-btn ui-btn-soft"
							type="button"
							disabled={!canPull(activeItem)}
							onclick={() => pick(activeItem, "pull")}
						>
							拉取到本地
						</button>
						<button
							class="ui-btn ui-btn-primary"
							type="button"
							disabled={!canPush(activeItem)}
							onclick={() => pick(activeItem, "push")}
						>
							推送到远端
						</button>
					</div>
				{/if}
			{/if}
		</section>
	</div>
</div>

<style>
	.sync-page {
		display: flex;
		flex-direction: column;
		height: var(--admin-viewport-h, calc(100vh - 3rem));
		min-height: 0;
		overflow: hidden;
		background: var(--float-panel-bg);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-card);
	}

	.sync-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--line-divider);
		flex-shrink: 0;
	}

	.head-text h1 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 650;
		color: var(--deep-text);
	}

	.head-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.375rem 0 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
		flex-wrap: wrap;
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

	.warn {
		color: oklch(0.72 0.15 70);
	}

	.head-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.sync-split {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: clamp(16rem, 26%, 21rem) 1fr;
	}

	.sync-sidebar {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-right: 1px solid var(--line-divider);
	}

	.side-stats {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.75rem 1rem 0.5rem;
		font-size: 0.75rem;
		color: var(--content-meta);
		flex-shrink: 0;
	}

	.num-warn {
		color: oklch(0.72 0.16 45);
	}

	.num-ok {
		color: oklch(0.72 0.15 145);
	}

	.link-btn {
		padding: 0;
		border: none;
		background: transparent;
		font-size: 0.75rem;
		color: var(--primary);
		cursor: pointer;
	}

	.link-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.side-check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0 1rem 0.5rem;
		font-size: 0.75rem;
		color: var(--content-meta);
		cursor: pointer;
		flex-shrink: 0;
	}

	.side-list {
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
	}

	.side-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border-left: 2px solid transparent;
	}

	.side-row:hover {
		background: var(--btn-plain-bg-hover);
	}

	.side-row.active {
		background: var(--btn-regular-bg);
		border-left-color: var(--primary);
	}

	.side-row.dim {
		opacity: 0.6;
	}

	.row-open {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.0625rem;
		flex: 1;
		min-width: 0;
		padding: 0;
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}

	.row-title {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--deep-text);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-sub {
		font-size: 0.6875rem;
		color: var(--content-meta);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.badge {
		flex-shrink: 0;
		padding: 0.0625rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.6875rem;
		background: var(--btn-regular-bg);
		color: var(--content-meta);
	}

	/* 两侧存在的差异 */
	.badge.differs {
		background: color-mix(in srgb, var(--primary) 16%, transparent);
		color: var(--primary);
	}

	/* 只有一边：橙，表示需要决定 */
	.badge.one-side {
		background: color-mix(in srgb, oklch(0.72 0.16 45) 16%, transparent);
		color: oklch(0.72 0.16 45);
	}

	/* 读不到远端：灰，不下判断 */
	.badge.unknown {
		background: var(--btn-regular-bg);
		color: var(--content-meta);
	}

	.badge.same {
		background: color-mix(in srgb, oklch(0.72 0.15 145) 15%, transparent);
		color: oklch(0.72 0.15 145);
	}

	.run-msg {
		margin: 0;
		padding: 0.5rem 1rem;
		font-size: 0.75rem;
		color: var(--deep-text);
		flex-shrink: 0;
	}

	.run-msg.failed {
		color: var(--destructive, #d33);
	}

	.side-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--line-divider);
		font-size: 0.75rem;
		color: var(--content-meta);
		flex-shrink: 0;
	}

	.sync-main {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
		padding: 1.25rem 1.5rem;
	}

	.main-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.625rem;
		flex: 1;
		text-align: center;
		padding: 2rem;
	}

	.empty-icon {
		font-size: 2rem;
		color: var(--content-meta);
		opacity: 0.5;
	}

	.empty-title {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.empty-hint {
		margin: 0;
		max-width: 26rem;
		font-size: 0.8125rem;
		line-height: 1.7;
		color: var(--content-meta);
	}

	.hint {
		margin: 0;
		padding: 1rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.err {
		margin: 0;
		padding: 1rem;
		font-size: 0.75rem;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--destructive, #d33);
	}

	/* ── 右栏 ── */
	.detail-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.detail-head h2 {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--deep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.detail-meta {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		font-size: 0.75rem;
		color: var(--content-meta);
		flex-shrink: 0;
	}

	.stat-add {
		color: oklch(0.7 0.15 145);
		font-variant-numeric: tabular-nums;
	}

	.stat-del {
		color: var(--destructive, #d33);
		font-variant-numeric: tabular-nums;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		cursor: pointer;
	}

	.detail-err {
		margin: 0 0 0.5rem;
		font-size: 0.75rem;
		color: var(--destructive, #d33);
	}

	.diff-body {
		flex: 1;
		min-height: 0;
		border-radius: 0.5rem;
		overflow: auto;
		background: var(--btn-regular-bg);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.75rem;
		line-height: 1.65;
	}

	.diff-row {
		display: flex;
		/* 顶部对齐：代码软换行后行号仍与首行齐平，不会被垂直居中带偏 */
		align-items: flex-start;
	}

	.diff-row .lno {
		flex-shrink: 0;
		width: 3.25rem;
		padding: 0 0.5rem;
		text-align: right;
		color: var(--content-meta);
		background: var(--float-panel-bg);
		border-right: 1px solid var(--line-divider);
		font-variant-numeric: tabular-nums;
		user-select: none;
		/* 行号自身不换行，宽度固定，换行只发生在代码侧 */
		white-space: nowrap;
	}

	.diff-row .code {
		display: flex;
		gap: 0.5rem;
		padding: 0 0.75rem 0 0.5rem;
		min-width: 0;
		color: var(--deep-text);
		/* 长行软换行：不新增行号、不产生横向滚动条 */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.diff-row .marker {
		width: 0.75rem;
		flex-shrink: 0;
		color: var(--content-meta);
		user-select: none;
	}

	.diff-row.add {
		background: color-mix(in srgb, oklch(0.7 0.15 145) 14%, transparent);
	}

	.diff-row.add .marker {
		color: oklch(0.7 0.15 145);
	}

	.diff-row.del {
		background: color-mix(in srgb, var(--destructive, #d33) 13%, transparent);
	}

	.diff-row.del .marker {
		color: var(--destructive, #d33);
	}

	.diff-row.gap .code {
		color: var(--content-meta);
		font-size: 0.6875rem;
	}

	.single-body {
		margin: 0;
		padding: 0.75rem;
		flex: 1;
		min-height: 0;
		border-radius: 0.5rem;
		background: var(--btn-regular-bg);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.75rem;
		line-height: 1.65;
		color: var(--deep-text);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
		overflow: auto;
	}

	.detail-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.875rem;
		flex-shrink: 0;
	}

	@media (width < 900px) {
		.sync-split {
			grid-template-columns: 1fr;
		}

		.sync-sidebar {
			border-right: none;
		}
	}
</style>
