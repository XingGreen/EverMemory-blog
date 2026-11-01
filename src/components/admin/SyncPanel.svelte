<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

/**
 * 文章同步面板。
 *
 * 与旧的行内冲突检查相比，这里要解决三件事：
 * 1. 失败时能说清为什么失败（连不上 / 超时 / 鉴权失败），而不是只留一句「检查失败」；
 * 2. 一次看清本地与远端的全部差异，而不是逐行点开；
 * 3. 操作集中在一处（重新检查 / 拉取 / 推送），并且执行后立刻刷新状态。
 */
let {
	open = $bindable(false),
	onClose,
	onSynced,
}: {
	open?: boolean;
	onClose?: () => void;
	/** 同步完成后通知列表刷新 */
	onSynced?: () => void;
} = $props();

interface DiffItem {
	slug: string;
	path: string;
	state: "both" | "local-only" | "remote-only";
	localTitle?: string;
	draft?: boolean;
}

interface StatusPayload {
	success: boolean;
	checkedAt: number;
	connected: boolean;
	error: string | null;
	localError: string | null;
	localTotal: number;
	remoteTotal: number;
	counts: { both: number; localOnly: number; remoteOnly: number };
	diffs: DiffItem[];
}

let loading = $state(false);
let data = $state<StatusPayload | null>(null);
let running = $state(false);
let runMessage = $state<string | null>(null);
let runFailed = $state(false);

function fmtTime(ts: number): string {
	if (!ts) return "—";
	const d = new Date(ts);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function check() {
	loading = true;
	runMessage = null;
	try {
		const res = await fetch("/api/admin/sync-status/");
		if (!res.ok) {
			/* HTTP 层面就失败时也要给出状态码，不然面板会一片空白 */
			data = {
				success: false,
				checkedAt: Date.now(),
				connected: false,
				error: `HTTP ${res.status}`,
				localError: null,
				localTotal: 0,
				remoteTotal: 0,
				counts: { both: 0, localOnly: 0, remoteOnly: 0 },
				diffs: [],
			};
			return;
		}
		data = (await res.json()) as StatusPayload;
	} catch (error) {
		data = {
			success: false,
			checkedAt: Date.now(),
			connected: false,
			error: error instanceof Error ? error.message : String(error),
			localError: null,
			localTotal: 0,
			remoteTotal: 0,
			counts: { both: 0, localOnly: 0, remoteOnly: 0 },
			diffs: [],
		};
	} finally {
		loading = false;
	}
}

async function runSync() {
	running = true;
	runMessage = null;
	runFailed = false;
	try {
		const res = await fetch("/api/admin/sync/", { method: "POST" });
		const payload = (await res.json().catch(() => null)) as {
			success?: boolean;
			message?: string;
		} | null;
		/* 关键：不能只看 fetch 有没有抛错。HTTP 500 + success:false 也是失败，
			   旧实现只判断 res 是否 resolve，于是「无网」也被显示成同步成功。 */
		if (!res.ok || !payload?.success) {
			runFailed = true;
			runMessage =
				payload?.message ?? `${i18n(I18nKey.conflictCheck)} HTTP ${res.status}`;
		} else {
			runMessage = payload.message ?? "";
			onSynced?.();
		}
	} catch (error) {
		runFailed = true;
		runMessage = error instanceof Error ? error.message : String(error);
	} finally {
		running = false;
		await check();
	}
}

function stateLabel(state: DiffItem["state"]): string {
	if (state === "remote-only") return i18n(I18nKey.conflictRemoteWins);
	if (state === "local-only") return i18n(I18nKey.conflictLocalWins);
	return i18n(I18nKey.conflictCheck);
}

/* 打开时自动检查一次；关闭不清空，再次打开会先看到上次结果再刷新 */
$effect(() => {
	if (open && !data && !loading) void check();
});
</script>

{#if open}
	<div
		class="sync-overlay"
		role="dialog"
		aria-modal="true"
		aria-label={i18n(I18nKey.conflictCheck)}
		tabindex="-1"
		onclick={(e) => {
			if (e.target === e.currentTarget) open = false;
		}}
		onkeydown={(e) => {
			if (e.key === "Escape") open = false;
		}}
	>
		<div class="sync-panel card-base">
			<header class="sync-head">
				<h3>{i18n(I18nKey.postSyncNow)}</h3>
				<button
					class="icon-btn"
					type="button"
					onclick={() => (open = false)}
					aria-label={i18n(I18nKey.announcementClose)}
				>
					<Icon icon="material-symbols:close" />
				</button>
			</header>

			<!-- 状态区：连接状态、数量、失败原因 -->
			<section class="sync-status">
				{#if loading}
					<p class="sync-line muted">
						<Icon icon="material-symbols:progress-activity" class="spin" />
						{i18n(I18nKey.conflictCheck)}…
					</p>
				{:else if data}
					<p class="sync-line">
						<span
							class="dot"
							class:ok={data.connected}
							class:bad={!data.connected}
						></span>
						{data.connected ? "GitHub" : "GitHub"}
						<span class="muted">· {fmtTime(data.checkedAt)}</span>
					</p>
					{#if data.error}
						<!-- 失败原因原文展示，不吞、不美化 -->
						<pre class="sync-error">{data.error}</pre>
					{/if}
					{#if data.localError}
						<pre class="sync-error">{data.localError}</pre>
					{/if}
					<p class="sync-stats">
						<span
							>{i18n(I18nKey.adminPosts)} {data.localTotal} /
							{data.remoteTotal}</span
						>
						<span class="muted">
							{i18n(I18nKey.conflictLocalWins)} {data.counts.localOnly}
						</span>
						<span class="muted">
							{i18n(I18nKey.conflictRemoteWins)} {data.counts.remoteOnly}
						</span>
					</p>
				{/if}
			</section>

			<!-- 差异清单 -->
			<section class="sync-diffs">
				{#if data && data.diffs.length > 0}
					{#each data.diffs as item (item.slug)}
						{@const state = item.state}
						<div class="diff-row" class:pending={state !== "both"}>
							<Icon
								icon={state === "both"
									? "material-symbols:check-circle-outline"
									: state === "remote-only"
										? "material-symbols:cloud-download-outline"
										: "material-symbols:cloud-upload-outline"}
							/>
							<span class="diff-slug">{item.slug}</span>
							<span class="diff-state">{stateLabel(state)}</span>
						</div>
					{/each}
				{:else if data && data.diffs.length === 0}
					<p class="sync-line muted">{i18n(I18nKey.postHistoryEmpty)}</p>
				{/if}
			</section>

			{#if runMessage}
				<p class="sync-run" class:failed={runFailed}>{runMessage}</p>
			{/if}

			<footer class="sync-actions">
				<button
					class="savebar-btn"
					type="button"
					onclick={check}
					disabled={loading || running}
				>
					{i18n(I18nKey.conflictCheck)}
				</button>
				<button
					class="savebar-btn primary"
					type="button"
					onclick={runSync}
					disabled={running || loading}
				>
					{running ? "…" : i18n(I18nKey.postSyncNow)}
				</button>
			</footer>
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
		background: rgb(0 0 0 / 0.4);
	}

	.sync-panel {
		display: flex;
		flex-direction: column;
		width: min(40rem, 92vw);
		max-height: 78vh;
		padding: 1.25rem 1.5rem;
		border-radius: 0.875rem;
		gap: 0.875rem;
	}

	.sync-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.sync-head h3 {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 700;
		color: var(--deep-text);
	}

	.icon-btn {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
	}

	.icon-btn:hover {
		background: var(--btn-plain-bg-hover);
	}

	.sync-status {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--post-editor-rule);
	}

	.sync-line {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-size: 0.875rem;
		color: var(--deep-text);
	}

	.muted {
		color: var(--content-meta);
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		background: var(--content-meta);
	}

	.dot.ok {
		background: oklch(0.72 0.17 145);
	}

	.dot.bad {
		background: var(--destructive, oklch(0.62 0.2 25));
	}

	/* 错误原文：保留换行、可横向滚动，不做截断 */
	.sync-error {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--destructive, #d33) 10%, transparent);
		color: var(--deep-text);
		font-size: 0.75rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 8rem;
		overflow: auto;
	}

	.sync-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin: 0;
		font-size: 0.8125rem;
	}

	.sync-diffs {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.diff-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.diff-row.pending {
		color: var(--deep-text);
	}

	.diff-slug {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.diff-state {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	.sync-run {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--deep-text);
	}

	.sync-run.failed {
		color: var(--destructive, #d33);
	}

	.sync-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--post-editor-rule);
	}

	.spin {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
