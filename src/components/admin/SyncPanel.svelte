<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

/**
 * 同步操作台。
 *
 * 数据来自 GET /api/admin/sync/plan —— 只拉远端元数据（sha），
 * 本地算 Git blob 哈希比对，不下载任何正文。
 *
 * 四种状态不含方向：sha 不同只说明内容不同，判断不出谁更新，
 * 所以 differs 的条目必须由使用者自己选方向，界面不预选。
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

let loading = $state(false);
let running = $state(false);
let data = $state<PlanPayload | null>(null);
let runMessage = $state<string | null>(null);
let runFailed = $state(false);
let showSame = $state(false);

/** 勾选集合（只存需要处理的条目） */
let selected = $state<Set<string>>(new Set());
/** 每条的方向偏好；differs 默认不设，逼使用者选 */
let direction = $state<Record<string, "pull" | "push">>({});

const actionable = $derived(
	(data?.items ?? []).filter((i) => i.state !== "same"),
);

function defaultDirection(item: PlanItem): "pull" | "push" | null {
	const picked = direction[item.slug];
	if (picked) return picked;
	/* 仅一边存在时有唯一合理方向；differs 不猜 */
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

function setDirection(slug: string, dir: "pull" | "push") {
	direction = { ...direction, [slug]: dir };
	if (!selected.has(slug)) toggle(slug);
}

function selectAll() {
	selected = new Set(
		actionable.filter((i) => defaultDirection(i) !== null).map((i) => i.slug),
	);
}

function clearAll() {
	selected = new Set();
}

async function load() {
	loading = true;
	runMessage = null;
	try {
		const res = await fetch("/api/admin/sync/plan/");
		const payload = (await res.json().catch(() => null)) as PlanPayload | null;
		if (!payload) {
			data = {
				success: false,
				connected: false,
				error: `HTTP ${res.status}`,
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
			return;
		}
		data = payload;
		selected = new Set();
		direction = {};
	} catch (error) {
		data = {
			success: false,
			connected: false,
			error: error instanceof Error ? error.message : String(error),
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
	} finally {
		loading = false;
	}
}

async function apply() {
	const items = [...selected]
		.map((slug) => {
			const item = actionable.find((i) => i.slug === slug);
			const dir = item ? defaultDirection(item) : null;
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
	try {
		const res = await fetch("/api/admin/sync/apply/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ items }),
		});
		const payload = (await res.json().catch(() => null)) as {
			success?: boolean;
			message?: string;
			results?: Array<{ slug: string; ok: boolean; message?: string }>;
		} | null;
		runFailed = !res.ok || !payload?.success;
		const failed = payload?.results?.filter((r) => !r.ok) ?? [];
		runMessage = payload?.message ?? `HTTP ${res.status}`;
		if (failed.length > 0) {
			runMessage += `：${failed.map((f) => `${f.slug}(${f.message ?? "失败"})`).join("、")}`;
		}
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
				<div>
					<h3>{i18n(I18nKey.postSyncNow)}</h3>
					{#if data}
						<p class="sync-sub">
							<span class="dot" class:ok={data.connected}></span>
							{data.connected ? "GitHub" : "GitHub 不可达"}
							<span class="sep">·</span>
							本地 {data.localTotal} / 远端 {data.remoteTotal}
							{#if !data.localAvailable}
								<span class="warn">· 当前环境无法读取本地文件</span>
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
				{#if data.counts.crlfSuspect > 0}
					<p class="hint warn">
						{data.counts.crlfSuspect} 个本地文件含 CRLF，与 .gitattributes 的 eol=lf 不一致，哈希比对可能误报差异
					</p>
				{/if}

				<div class="sync-toolbar">
					<span class="muted">
						需处理 {actionable.length} · 一致 {data.counts.same}
					</span>
					<div class="toolbar-actions">
						<button class="link-btn" type="button" onclick={selectAll}>
							全选可处理
						</button>
						<button class="link-btn" type="button" onclick={clearAll}>
							清空
						</button>
						{#if data.counts.same > 0}
							<button
								class="link-btn"
								type="button"
								onclick={() => (showSame = !showSame)}
							>
								{showSame ? "隐藏一致" : "显示一致"}
							</button>
						{/if}
					</div>
				</div>

				<ul class="sync-list">
					{#each data.items as item (item.slug)}
						{@const checked = selected.has(item.slug)}
						{@const dir = defaultDirection(item)}
						<li
							class="sync-row"
							class:dim={item.state === "same"}
							class:hidden-same={item.state === "same" && !showSame}
						>
							<label class="row-check">
								<input
									type="checkbox"
									disabled={item.state === "same"}
									checked={checked}
									onchange={() => toggle(item.slug)}
								/>
							</label>
							<div class="row-main">
								<span class="row-slug">{item.slug}</span>
								<span class="row-state" data-state={item.state}>
									{stateText(item.state)}
								</span>
							</div>
							{#if item.state !== "same"}
								<div class="row-dir">
									<button
										class="dir-btn"
										type="button"
										class:active={dir === "pull"}
										onclick={() => setDirection(item.slug, "pull")}
										title="用远端覆盖本地"
									>
										<Icon icon="material-symbols:cloud-download" />
									</button>
									<button
										class="dir-btn"
										type="button"
										class:active={dir === "push"}
										onclick={() => setDirection(item.slug, "push")}
										title="用本地覆盖远端"
									>
										<Icon icon="material-symbols:cloud-upload" />
									</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				{#if runMessage}
					<p class="run-msg" class:failed={runFailed}>{runMessage}</p>
				{/if}

				<footer class="sync-actions">
					<span class="muted">已选 {selected.size} 项</span>
					<div class="toolbar-actions">
						<button
							class="savebar-btn"
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
		background: rgb(0 0 0 / 0.45);
		backdrop-filter: blur(2px);
	}

	.sync-panel {
		display: flex;
		flex-direction: column;
		width: min(44rem, 94vw);
		max-height: 82vh;
		padding: 1.25rem 1.375rem 1rem;
		gap: 0.75rem;
		border-radius: 0.875rem;
		border: 1px solid var(--line-divider);
		background: var(--card-bg);
		box-shadow: 0 20px 60px -12px rgb(0 0 0 / 0.45);
	}

	.sync-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.sync-head h3 {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 700;
		color: var(--deep-text);
	}

	.sync-sub {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
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
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--destructive, #d33) 12%, transparent);
		font-size: 0.75rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 7rem;
		overflow: auto;
	}

	.sync-toolbar,
	.sync-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.sync-actions {
		padding-top: 0.75rem;
		border-top: 1px solid var(--post-editor-rule);
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.muted {
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	.link-btn {
		border: none;
		background: transparent;
		font-size: 0.75rem;
		color: var(--primary);
		cursor: pointer;
		padding: 0.125rem 0.25rem;
	}

	.link-btn:hover {
		text-decoration: underline;
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
		gap: 0.125rem;
	}

	.sync-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.4375rem 0.5rem;
		border-radius: 0.5rem;
	}

	.sync-row:hover {
		background: var(--btn-plain-bg-hover);
	}

	.sync-row.dim {
		opacity: 0.55;
	}

	.hidden-same {
		display: none;
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
		font-size: 0.8125rem;
		color: var(--deep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-state {
		flex-shrink: 0;
		padding: 0.0625rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.6875rem;
		color: var(--content-meta);
		background: var(--btn-regular-bg);
	}

	.row-state[data-state="differs"] {
		color: oklch(0.7 0.16 40);
		background: color-mix(in srgb, oklch(0.7 0.16 40) 15%, transparent);
	}

	.row-state[data-state="remote-only"] {
		color: oklch(0.72 0.13 220);
		background: color-mix(in srgb, oklch(0.72 0.13 220) 15%, transparent);
	}

	.row-state[data-state="local-only"] {
		color: oklch(0.72 0.15 145);
		background: color-mix(in srgb, oklch(0.72 0.15 145) 15%, transparent);
	}

	.row-dir {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.dir-btn {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.375rem;
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
	}

	.dir-btn:hover {
		color: var(--deep-text);
		border-color: var(--primary);
	}

	.dir-btn.active {
		color: var(--primary-foreground, #fff);
		background: var(--primary);
		border-color: var(--primary);
	}

	.run-msg {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--deep-text);
	}

	.run-msg.failed {
		color: var(--destructive, #d33);
	}
</style>
