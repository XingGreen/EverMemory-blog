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

/**
 * 差异查看页（独立路由 /admin/sync/diff/:slug）。
 *
 * 从面板里的小窗挪出来，因为代码 diff 需要视口级宽度：
 * 模态 704px 两栏分下来每行只剩 48 个字符，普通代码行必然横向滚动。
 *
 * 目标文件路径不放进 URL：slug 抹掉了 /index，靠它猜不出真实路径。
 * 由跳转前的面板写入 sessionStorage，这里按 slug 取回；
 * 直接打开链接（无 sessionStorage）时退回默认的 <slug>.md。
 */

let {
	slug,
	onBack,
}: {
	slug: string;
	onBack: () => void;
} = $props();

interface FilediffPayload {
	localContent: string | null;
	remoteContent: string | null;
	localError: string | null;
	remoteError: string | null;
}

let loading = $state(true);
let error = $state<string | null>(null);
let payload = $state<FilediffPayload | null>(null);
let hideUnchanged = $state(true);
/** 路径是否来自兜底猜测（没有 sessionStorage 时按 slug 拼） */
let guessedPath = $state(false);

const lines = $derived<DiffLine[]>(() => {
	if (!payload) return [];
	const rows = diffLines(
		payload.localContent ?? "",
		payload.remoteContent ?? "",
	);
	return hideUnchanged ? collapseUnchanged(rows, 3) : rows;
});

const stats = $derived(() => {
	if (!payload) return { added: 0, removed: 0 };
	return countChanges(
		diffLines(payload.localContent ?? "", payload.remoteContent ?? ""),
	);
});

function resolvePath(): string {
	try {
		const raw = sessionStorage.getItem("sync:diff-target");
		if (raw) {
			const target = JSON.parse(raw) as { slug?: string; path?: string };
			if (target.slug === slug && target.path) {
				guessedPath = false;
				return target.path;
			}
		}
	} catch {
		// sessionStorage 不可用或内容损坏，走兜底
	}
	guessedPath = true;
	return `src/content/posts/${slug}.md`;
}

async function load() {
	loading = true;
	error = null;
	const path = resolvePath();
	try {
		const res = await fetch(
			`/api/admin/sync/filediff/?slug=${encodeURIComponent(slug)}&path=${encodeURIComponent(path)}`,
			{ cache: "no-store" },
		);
		if (!res.ok) {
			error = `HTTP ${res.status}`;
			return;
		}
		payload = (await res.json()) as FilediffPayload;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

function lineClass(kind: DiffLine["kind"]): string {
	return kind === "add"
		? "add"
		: kind === "del"
			? "del"
			: kind === "gap"
				? "gap"
				: "";
}

$effect(() => {
	void load();
});
</script>

<div class="diff-page">
	<header class="diff-head">
		<button class="ui-btn ui-btn-soft back-btn" type="button" onclick={onBack}>
			<Icon icon="material-symbols:arrow-back" />
			返回同步
		</button>

		<div class="head-title">
			<h1>{slug}</h1>
			{#if payload}
				<p class="head-meta">
					<span class="add-count">+{stats().added}</span>
					<span class="del-count">-{stats().removed}</span>
					<span class="sep">·</span>
					左为本地，右为远端
					{#if payload.localError}
						<span class="err">· 本地读取失败：{payload.localError}</span>
					{/if}
					{#if payload.remoteError}
						<span class="err">· 远端读取失败：{payload.remoteError}</span>
					{/if}
				</p>
			{/if}
		</div>

		<label class="toggle">
			<input type="checkbox" bind:checked={hideUnchanged} />
			<span>折叠未变更</span>
		</label>
	</header>

	{#if loading}
		<p class="state">正在加载正文…</p>
	{:else if error}
		<pre class="state error">{error}</pre>
	{:else if payload && payload.localContent === null && payload.remoteContent === null}
		<!-- 两边都读不到：最常见的原因是 slug 归一化后猜错了路径，必须说清楚 -->
		<div class="state-block">
			<p class="state-title">没找到这个文件</p>
			{#if guessedPath}
				<p class="state-hint">
					这个页面不是从同步面板进的，无法确定文件的真实路径。像
					<code>guide</code> 这种 slug 实际对应 <code>guide/index.md</code>，
					按 <code>guide.md</code> 去找就会落空。请返回同步面板后点「差异」。
				</p>
			{:else}
				<p class="state-hint">
					本地与远端都没有这个文件，可能已被删除或改名。
				</p>
			{/if}
			<button class="ui-btn ui-btn-soft" type="button" onclick={onBack}>
				返回同步
			</button>
		</div>
	{:else if payload}
		<div class="diff-body">
			{#each lines as line, idx (idx)}
				{#if line.kind === "gap"}
					<div class="diff-row gap">
						<span class="lno"></span>
						<span class="rno"></span>
						<span class="code">⋯ 跳过 {line.count} 行未变更</span>
					</div>
				{:else}
					<div class="diff-row {lineClass(line.kind)}">
						<span class="lno">{line.left ?? ""}</span>
						<span class="rno">{line.right ?? ""}</span>
						<span class="code">
							<span class="marker"
								>{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}</span
							><span class="text">{line.text || " "}</span>
						</span>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.diff-page {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		height: 100%;
		min-height: 0;
	}

	.diff-head {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.back-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.head-title {
		flex: 1;
		min-width: 0;
	}

	.head-title h1 {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 700;
		color: var(--deep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.head-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: var(--content-meta);
		flex-wrap: wrap;
	}

	.add-count {
		color: oklch(0.7 0.15 145);
		font-variant-numeric: tabular-nums;
	}

	.del-count {
		color: var(--destructive, #d33);
		font-variant-numeric: tabular-nums;
	}

	.err {
		color: var(--destructive, #d33);
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--content-meta);
		cursor: pointer;
		flex-shrink: 0;
	}

	.state {
		margin: 0;
		padding: 1rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.state-block {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.625rem;
		padding: 1.5rem;
		border-radius: var(--radius-large);
		background: var(--btn-regular-bg);
	}

	.state-title {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.state-hint {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.65;
		color: var(--content-meta);
	}

	.state-hint code {
		padding: 0.0625rem 0.3125rem;
		border-radius: 0.25rem;
		background: var(--btn-plain-bg-hover);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.75rem;
		color: var(--deep-text);
	}

	.state.error {
		color: var(--destructive, #d33);
		white-space: pre-wrap;
	}

	.diff-body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		border-radius: var(--radius-large);
		background: var(--btn-regular-bg);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.75rem;
		line-height: 1.65;
	}

	.diff-row {
		display: flex;
		align-items: stretch;
		min-width: max-content;
	}

	.diff-row .lno,
	.diff-row .rno {
		position: sticky;
		flex-shrink: 0;
		width: 3.25rem;
		padding: 0 0.5rem;
		text-align: right;
		color: var(--content-meta);
		background: var(--float-panel-bg);
		font-variant-numeric: tabular-nums;
		user-select: none;
	}

	.diff-row .lno {
		left: 0;
	}

	.diff-row .rno {
		left: 3.25rem;
		border-right: 1px solid var(--line-divider);
	}

	.diff-row .code {
		display: flex;
		gap: 0.5rem;
		padding: 0 0.75rem 0 0.5rem;
		white-space: pre;
		color: var(--deep-text);
	}

	.diff-row .text {
		white-space: pre;
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
</style>
