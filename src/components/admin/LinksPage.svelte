<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import Checkbox from "./Checkbox.svelte";
import ConfirmDialog from "./ConfirmDialog.svelte";

/**
 * 友链管理。
 *
 * 数据源是 src/data/friends.json（不是 TS 源码）：后台需要写入结构化数据，
 * 而 .ts 里的注释和手写格式无法无损往返。
 *
 * 保存是整份覆盖，不是逐条提交——友链总量只有几十条，
 * 一次写盘比逐条打补丁更能保证文件结构稳定。
 */

interface FriendLink {
	title: string;
	imgurl: string;
	desc: string;
	siteurl: string;
	tags?: string[];
	weight: number;
	enabled: boolean;
}

let links = $state<FriendLink[]>([]);
let loading = $state(true);
let saving = $state(false);
let writable = $state(true);
let error = $state<string | null>(null);
let message = $state<string | null>(null);
let dirty = $state(false);

/** 标签在 UI 上是逗号分隔的文本，编辑时单独存，提交前再拆回数组 */
let tagText = $state<string[]>([]);

let confirmState = $state<{
	title: string;
	body: string;
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

async function load() {
	loading = true;
	error = null;
	try {
		const res = await fetch("/api/admin/links/", { cache: "no-store" });
		const data = await res.json();
		if (!res.ok || !data.success) {
			error = data?.message ?? `HTTP ${res.status}`;
			return;
		}
		links = (data.links ?? []).map((l: FriendLink) => ({ ...l }));
		tagText = links.map((l) => (l.tags ?? []).join(", "));
		writable = data.writable !== false;
		dirty = false;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

function markDirty() {
	dirty = true;
	message = null;
}

function addLink() {
	links = [
		...links,
		{
			title: "",
			imgurl: "",
			desc: "",
			siteurl: "",
			tags: [],
			weight: 0,
			enabled: true,
		},
	];
	tagText = [...tagText, ""];
	markDirty();
}

async function removeLink(index: number) {
	const name = links[index]?.title?.trim() || `第 ${index + 1} 条`;
	const ok = await askConfirm({
		title: `删除「${name}」？`,
		body: "这条友链会从列表里移除，保存后写入文件。",
		confirmText: "删除",
		cancelText: "取消",
		tone: "danger",
	});
	if (!ok) return;
	links = links.filter((_, i) => i !== index);
	tagText = tagText.filter((_, i) => i !== index);
	markDirty();
}

function move(index: number, delta: number) {
	const target = index + delta;
	if (target < 0 || target >= links.length) return;
	const next = [...links];
	const t = [...tagText];
	[next[index], next[target]] = [next[target], next[index]];
	[t[index], t[target]] = [t[target], t[index]];
	links = next;
	tagText = t;
	markDirty();
}

async function save() {
	if (saving || !writable) return;
	saving = true;
	message = null;
	try {
		const payload = links.map((l, i) => ({
			...l,
			tags: (tagText[i] ?? "")
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean),
		}));
		const res = await fetch("/api/admin/links/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ links: payload }),
		});
		const data = await res.json();
		if (!res.ok || !data.success) {
			message = data?.message ?? `保存失败（HTTP ${res.status}）`;
			return;
		}
		message = data.message ?? "已保存";
		dirty = false;
		await load();
	} catch (err) {
		message = err instanceof Error ? err.message : String(err);
	} finally {
		saving = false;
	}
}

$effect(() => {
	void load();
});
</script>

<ConfirmDialog
	open={confirmState !== null}
	title={confirmState?.title ?? ""}
	body={confirmState?.body ?? ""}
	confirmText={confirmState?.confirmText ?? "确定"}
	cancelText={confirmState?.cancelText ?? "取消"}
	tone={confirmState?.tone ?? "default"}
	onConfirm={() => answerConfirm(true)}
	onCancel={() => answerConfirm(false)}
/>

<div class="card-base links-page">
	<header class="links-head">
		<div class="head-text">
			<h1>友链管理</h1>
			<p class="head-meta">
				共 {links.length} 条 · {links.filter((l) => l.enabled).length} 条启用
				{#if !writable}
					<span class="warn">· 当前部署环境只读，需在本地修改</span>
				{/if}
			</p>
		</div>
		<div class="head-actions">
			<button
				class="ui-btn ui-btn-soft"
				type="button"
				onclick={addLink}
				disabled={!writable}
			>
				<Icon icon="material-symbols:add" />
				新增
			</button>
			<button
				class="ui-btn ui-btn-primary"
				type="button"
				onclick={save}
				disabled={saving || !writable || !dirty}
			>
				{saving ? "保存中…" : dirty ? "保存" : "已保存"}
			</button>
		</div>
	</header>

	<div class="links-body">
		{#if loading}
			<p class="state">正在加载…</p>
		{:else if error}
			<p class="state error">{error}</p>
		{:else}
			{#if message}
				<p class="state tip">{message}</p>
			{/if}

			{#each links as link, i (i)}
				<section class="link-card">
					<header class="card-head">
						<span class="card-index">{i + 1}</span>
						<span class="card-title">{link.title.trim() || "未命名"}</span>
						<div class="card-actions">
							<button
								class="icon-btn"
								type="button"
								title="上移"
								disabled={i === 0 || !writable}
								onclick={() => move(i, -1)}
							>
								<Icon icon="material-symbols:arrow-upward" />
							</button>
							<button
								class="icon-btn"
								type="button"
								title="下移"
								disabled={i === links.length - 1 || !writable}
								onclick={() => move(i, 1)}
							>
								<Icon icon="material-symbols:arrow-downward" />
							</button>
							<button
								class="icon-btn danger"
								type="button"
								title="删除"
								disabled={!writable}
								onclick={() => removeLink(i)}
							>
								<Icon icon="material-symbols:delete-outline" />
							</button>
						</div>
					</header>

					<div class="fields">
						<label class="field">
							<span>名称</span>
							<input
								type="text"
								bind:value={link.title}
								oninput={markDirty}
								disabled={!writable}
							/>
						</label>
						<label class="field">
							<span>站点地址</span>
							<input
								type="url"
								bind:value={link.siteurl}
								oninput={markDirty}
								disabled={!writable}
								placeholder="https://"
							/>
						</label>
						<label class="field">
							<span>头像地址</span>
							<input
								type="url"
								bind:value={link.imgurl}
								oninput={markDirty}
								disabled={!writable}
								placeholder="https://"
							/>
						</label>
						<label class="field">
							<span>标签</span>
							<input
								type="text"
								bind:value={tagText[i]}
								oninput={markDirty}
								disabled={!writable}
								placeholder="用逗号分隔"
							/>
						</label>
						<label class="field wide">
							<span>描述</span>
							<input
								type="text"
								bind:value={link.desc}
								oninput={markDirty}
								disabled={!writable}
							/>
						</label>
						<label class="field narrow">
							<span>权重</span>
							<input
								type="number"
								bind:value={link.weight}
								oninput={markDirty}
								disabled={!writable}
							/>
						</label>
						<div class="field toggle-field">
							<Checkbox
								checked={link.enabled}
								disabled={!writable}
								onchange={() => {
									link.enabled = !link.enabled;
									markDirty();
								}}
								label="是否启用"
							/>
							<span>启用</span>
						</div>
					</div>
				</section>
			{/each}

			{#if links.length === 0}
				<p class="state">还没有友链，点右上角「新增」添加。</p>
			{/if}
		{/if}
	</div>
</div>

<style>
	.links-page {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: var(--admin-viewport-h, calc(100vh - 3rem));
		min-height: 0;
		overflow: hidden;
	}

	.links-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 1.75rem 1.75rem 1.625rem;
		border-bottom: 1px solid var(--line-divider);
		flex-shrink: 0;
	}

	.head-text h1 {
		margin: 0;
		font-size: 1.75rem;
		font-weight: 650;
		line-height: 1.4;
		color: var(--deep-text);
	}

	.head-meta {
		margin: 0.375rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.7;
		color: var(--content-meta);
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

	.head-actions :global(svg) {
		font-size: 1rem;
	}

	.links-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 1.25rem 1.75rem 1.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.state {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.state.error {
		color: var(--destructive, #d33);
	}

	.state.tip {
		color: oklch(0.7 0.15 145);
	}

	.link-card {
		border-radius: 0.75rem;
		background: var(--btn-regular-bg);
		overflow: hidden;
	}

	.card-head {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem 0.875rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.card-index {
		display: grid;
		place-items: center;
		width: 1.375rem;
		height: 1.375rem;
		border-radius: 9999px;
		background: var(--float-panel-bg);
		font-size: 0.6875rem;
		color: var(--content-meta);
		flex-shrink: 0;
	}

	.card-title {
		flex: 1;
		min-width: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--deep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.icon-btn {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
	}

	.icon-btn:hover:not(:disabled) {
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.icon-btn.danger:hover:not(:disabled) {
		color: var(--destructive, #d33);
	}

	.icon-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem 1rem;
		padding: 0.875rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.field.wide {
		grid-column: 1 / -1;
	}

	.field.narrow {
		max-width: 8rem;
	}

	.field > span {
		font-size: 0.6875rem;
		color: var(--content-meta);
	}

	.field input {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.375rem;
		background: var(--float-panel-bg);
		font-size: 0.8125rem;
		color: var(--deep-text);
	}

	.field input:focus-visible {
		outline: none;
		border-color: var(--primary);
	}

	.field input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.toggle-field {
		flex-direction: row;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--content-meta);
		align-self: end;
		padding-bottom: 0.4375rem;
	}

	@media (width < 720px) {
		.fields {
			grid-template-columns: 1fr;
		}
	}
</style>
