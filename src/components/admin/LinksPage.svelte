<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import AdminPage from "./AdminPage.svelte";
import Checkbox from "./Checkbox.svelte";
import ConfirmDialog from "./ConfirmDialog.svelte";

/**
 * 友链管理。
 *
 * 数据源是 src/data/friends.json（不是 TS 源码）：后台需要写入结构化数据，
 * 而 .ts 里的注释和手写格式无法无损往返。
 *
 * 版式对齐项目原生列表页：AdminPage 外壳 + 表头/行 grid + 弹窗编辑。
 * 不做行内表单——字段有七个，塞进一行会把列宽挤散。
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
/** 按字段的校验提示：显示在对应输入框正下方 */
let fieldErrors = $state<Record<string, string>>({});
let dirty = $state(false);

/** 弹窗编辑中的副本；null 表示未打开 */
let editing = $state<{ index: number; draft: FriendLink; tags: string } | null>(
	null,
);

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
		writable = data.writable !== false;
		dirty = false;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

const DRAFT_KEY = "admin-links-draft";

interface StoredDraft {
	/** "new" 或该条友链的 id */
	key: string;
	draft: FriendLink;
	tags: string;
}

/**
 * 补全协议：已带协议的原样保留，没有的补 https://。
 * 任何 schema: 形式都算「已带协议」，javascript: 之类会被后面的白名单挡掉。
 */
function normalizeUrl(value: string): string {
	const t = value.trim();
	if (!t) return "";
	if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
	return `https://${t}`;
}

/** 草稿键：新增独立一槽，编辑按 id 区分，删条目不会让草稿串位 */
function draftKeyOf(index: number): string {
	if (index < 0) return "new";
	return links[index]?.id ?? "gone";
}

/** 草稿提示：恢复时告诉用户「内容不是你刚填的」 */
let dialogNotice = $state<string | null>(null);

/** 关闭弹窗时的三选一 */
let closePrompt = $state(false);
let closeResolve: ((choice: "save" | "discard" | "keep") => void) | null = null;

function askClose(): Promise<"save" | "discard" | "keep"> {
	closePrompt = true;
	return new Promise((resolve) => {
		closeResolve = resolve;
	});
}

function answerClose(choice: "save" | "discard" | "keep") {
	closePrompt = false;
	const resolve = closeResolve;
	closeResolve = null;
	resolve?.(choice);
}

function saveDraftToStorage() {
	if (!editing) return;
	try {
		sessionStorage.setItem(
			DRAFT_KEY,
			JSON.stringify({
				key: draftKeyOf(editing.index),
				draft: editing.draft,
				tags: editing.tags,
			} satisfies StoredDraft),
		);
	} catch {
		// 隐私模式 / 配额不足：关掉就当放弃，至少不会卡住流程
	}
}

function readStoredDraft(): StoredDraft | null {
	try {
		const raw = sessionStorage.getItem(DRAFT_KEY);
		return raw ? (JSON.parse(raw) as StoredDraft) : null;
	} catch {
		return null;
	}
}

function clearStoredDraft() {
	try {
		sessionStorage.removeItem(DRAFT_KEY);
	} catch {
		// 忽略
	}
}

/** 弹窗里的内容是否与打开时不同 */
function isDraftDirty(): boolean {
	if (!editing) return false;
	const d = editing.draft;
	if (editing.index < 0) {
		return Boolean(
			d.title.trim() ||
				d.siteurl.trim() ||
				d.imgurl.trim() ||
				d.desc.trim() ||
				editing.tags.trim(),
		);
	}
	const original = links[editing.index];
	if (!original) return true;
	return (
		d.title !== original.title ||
		d.siteurl !== original.siteurl ||
		d.imgurl !== original.imgurl ||
		d.desc !== original.desc ||
		d.weight !== original.weight ||
		d.enabled !== original.enabled ||
		editing.tags !== (original.tags ?? []).join(", ")
	);
}

/**
 * 关闭弹窗的唯一入口。
 *
 * 有未确定的改动时给三个出口，而不是「丢弃 / 取消」二选一：
 * 用户常常只是想先放一放，不是要放弃——所以要有「保存草稿」。
 */
async function requestClose() {
	if (!editing) return;
	if (!isDraftDirty()) {
		editing = null;
		fieldErrors = {};
		dialogNotice = null;
		return;
	}
	const choice = await askClose();
	if (choice === "keep") return;
	if (choice === "save") saveDraftToStorage();
	else clearStoredDraft();
	editing = null;
	fieldErrors = {};
	dialogNotice = null;
}

/** 取出与目标位对应的草稿，取到即清，避免下次重复恢复 */
function takeStoredDraft(expected: string): StoredDraft | null {
	const stored = readStoredDraft();
	if (!stored || stored.key !== expected) return null;
	clearStoredDraft();
	return stored;
}

function openNew() {
	fieldErrors = {};
	const stored = takeStoredDraft("new");
	if (stored) {
		editing = { index: -1, draft: stored.draft, tags: stored.tags };
		dialogNotice = "已恢复上次未保存的草稿";
		return;
	}
	dialogNotice = null;
	editing = {
		index: -1,
		draft: {
			id: crypto.randomUUID().slice(0, 8),
			title: "",
			imgurl: "",
			desc: "",
			siteurl: "",
			tags: [],
			weight: 0,
			enabled: true,
		},
		tags: "",
	};
}

function openEdit(index: number) {
	const link = links[index];
	if (!link) return;
	fieldErrors = {};
	const stored = takeStoredDraft(draftKeyOf(index));
	if (stored) {
		editing = { index, draft: stored.draft, tags: stored.tags };
		dialogNotice = "已恢复上次未保存的草稿";
		return;
	}
	dialogNotice = null;
	editing = {
		index,
		draft: { ...link, tags: [...(link.tags ?? [])] },
		tags: (link.tags ?? []).join(", "),
	};
}

function commitEdit() {
	if (!editing) return;
	const { index, draft, tags } = editing;
	const errors: Record<string, string> = {};
	const title = draft.title.trim();
	if (!title) errors.title = "请填写名称";

	const siteurl = normalizeUrl(draft.siteurl);
	if (!siteurl) {
		errors.siteurl = "请填写站点地址";
	} else if (!/^https?:\/\/\S+/i.test(siteurl)) {
		errors.siteurl = "只支持 http 或 https 地址";
	}

	fieldErrors = errors;
	if (Object.keys(errors).length > 0) return;

	const next: FriendLink = {
		...draft,
		title,
		siteurl,
		imgurl: normalizeUrl(draft.imgurl),
		desc: draft.desc.trim(),
		weight: Number.isFinite(draft.weight) ? draft.weight : 0,
		tags: tags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean),
	};

	links =
		index < 0
			? [...links, next]
			: links.map((l, i) => (i === index ? next : l));
	editing = null;
	fieldErrors = {};
	dialogNotice = null;
	clearStoredDraft();
	dirty = true;
	message = null;
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
	dirty = true;
}

function move(index: number, delta: number) {
	const target = index + delta;
	if (target < 0 || target >= links.length) return;
	const next = [...links];
	[next[index], next[target]] = [next[target], next[index]];
	links = next;
	dirty = true;
}

async function save() {
	if (saving || !writable) return;
	saving = true;
	message = null;
	try {
		const res = await fetch("/api/admin/links/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ links }),
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

<ConfirmDialog
	open={closePrompt}
	title="保存这次编辑吗？"
	body=""
	confirmText="保存草稿并退出"
	cancelText="不保存并退出"
	onConfirm={() => answerClose("save")}
	onCancel={() => answerClose("discard")}
	onTertiary={() => answerClose("keep")}
/>

<AdminPage
	title="友链管理"
	intro="管理友链页展示的站点，保存后写入 src/data/friends.json"
>

	{#snippet footer()}
		<div class="savebar">
			<span class="savebar-text">
				共 {links.length} 条 · {links.filter((l) => l.enabled).length} 条启用
				{#if dirty}
					<b class="savebar-dirty">有未保存的改动</b>
				{:else if message}
					<b class="savebar-done">{message}</b>
				{/if}
				{#if !writable}
					<b class="savebar-warn">当前环境只读</b>
				{/if}
			</span>
			<div class="savebar-actions">
				<button
					class="ui-btn ui-btn-soft"
					type="button"
					onclick={openNew}
					disabled={!writable}
				>
					<Icon icon="material-symbols:add" class="btn-icon" />
					新增友链
				</button>
				<button
					class="ui-btn ui-btn-primary"
					type="button"
					onclick={save}
					disabled={saving || !writable || !dirty}
				>
					{saving ? "保存中…" : dirty ? "保存更改" : "已保存"}
				</button>
			</div>
		</div>
	{/snippet}

	{#if loading}
		<p class="state">正在加载…</p>
	{:else if error}
		<p class="state error">{error}</p>
	{:else if links.length === 0}
		<p class="state">还没有友链，点右上角「新增友链」添加。</p>
	{:else}
		<div class="table" role="table" aria-label="友链列表">
			<div class="table-head" role="row">
				<span class="c-name">名称</span>
				<span class="c-site">站点</span>
				<span class="c-tags">标签</span>
				<span class="c-weight">权重</span>
				<span class="c-status">状态</span>
				<span class="c-actions"></span>
			</div>

			{#each links as link, i (i)}
				<div class="table-row" role="row">
					<div class="c-name" role="cell">
						{#if link.imgurl}
							<img class="avatar" src={link.imgurl} alt="" loading="lazy" />
						{:else}
							<span class="avatar placeholder"></span>
						{/if}
						<div class="name-text">
							<span class="name">{link.title || "未命名"}</span>
							{#if link.desc}
								<span class="desc">{link.desc}</span>
							{/if}
						</div>
					</div>

					<div class="c-site" role="cell">
						<a href={link.siteurl} target="_blank" rel="noopener noreferrer">
							{link.siteurl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
						</a>
					</div>

					<div class="c-tags" role="cell">
						{#if link.tags?.length}
							{#each link.tags as tag (tag)}
								<span class="tag">{tag}</span>
							{/each}
						{:else}
							<span class="muted">—</span>
						{/if}
					</div>

					<div class="c-weight" role="cell">{link.weight}</div>

					<div class="c-status" role="cell">
						<span class="status" class:on={link.enabled}>
							{link.enabled ? "启用" : "停用"}
						</span>
					</div>

					<div class="c-actions" role="cell">
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
							class="icon-btn"
							type="button"
							title="编辑"
							disabled={!writable}
							onclick={() => openEdit(i)}
						>
							<Icon icon="material-symbols:edit-outline" />
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
				</div>
			{/each}
		</div>
	{/if}
</AdminPage>

{#if editing}
	<div
		class="modal-overlay"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) void requestClose();
		}}
	>
		<div
			class="modal-card card-base"
			role="dialog"
			aria-modal="true"
			aria-labelledby="link-edit-title"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => {
				e.stopPropagation();
				if (e.key === "Escape") void requestClose();
			}}
		>
			<div class="modal-head">
				<h2 id="link-edit-title">
					{editing.index < 0 ? "新增友链" : "编辑友链"}
				</h2>
				<button
					class="icon-btn"
					type="button"
					onclick={() => void requestClose()}
					aria-label="关闭"
				>
					<Icon icon="material-symbols:close" />
				</button>
			</div>

			{#if dialogNotice}
				<p class="dialog-notice">{dialogNotice}</p>
			{/if}

			<div class="modal-body">
				<label class="field">
					<span>名称</span>
					<input
						type="text"
						bind:value={editing.draft.title}
						oninput={() => (fieldErrors.title = "")}
						class:invalid={fieldErrors.title}
					/>
					{#if fieldErrors.title}
						<span class="field-error">{fieldErrors.title}</span>
					{/if}
				</label>
				<label class="field">
					<span>站点地址</span>
					<input
						type="url"
						bind:value={editing.draft.siteurl}
						oninput={() => (fieldErrors.siteurl = "")}
						class:invalid={fieldErrors.siteurl}
						placeholder="example.com"
					/>
					{#if fieldErrors.siteurl}
						<span class="field-error">{fieldErrors.siteurl}</span>
					{/if}
				</label>
				<label class="field">
					<span>头像地址</span>
					<input
						type="url"
						bind:value={editing.draft.imgurl}
						oninput={() => (fieldErrors.imgurl = "")}
						placeholder="example.com/avatar.png"
					/>
				</label>
				<label class="field">
					<span>描述</span>
					<input type="text" bind:value={editing.draft.desc} />
				</label>
				<label class="field">
					<span>标签（逗号分隔）</span>
					<input type="text" bind:value={editing.tags} />
				</label>
				<div class="field-row">
					<label class="field compact">
						<span>权重</span>
						<input type="number" bind:value={editing.draft.weight} />
					</label>
					<div class="field toggle-field">
						<Checkbox
							checked={editing.draft.enabled}
							onchange={() => {
								if (editing) editing.draft.enabled = !editing.draft.enabled;
							}}
							label="在前台显示此友链"
						/>
						<div class="toggle-copy">
							<span class="toggle-label">在前台显示此友链</span>
							<span class="toggle-hint">
								关闭后仍保留在列表里，只是友链页不再展示它
							</span>
						</div>
					</div>
				</div>
			</div>

			<div class="modal-actions">
				<button class="ui-btn ui-btn-soft" type="button" onclick={() => void requestClose()}>
					取消
				</button>
				<button class="ui-btn ui-btn-primary" type="button" onclick={commitEdit}>
					确定
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* 底部操作栏：参数与设置页的 .savebar 一致 */
	.savebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.25rem;
		flex-wrap: wrap;
		padding: 0.875rem 1.5rem;
		border-top: 1px solid var(--line-divider);
		background: var(--card-bg);
	}

	.savebar-text {
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.savebar-dirty {
		margin-left: 0.5rem;
		color: oklch(0.72 0.16 45);
	}

	.savebar-done {
		margin-left: 0.5rem;
		color: oklch(0.7 0.15 145);
	}

	.savebar-warn {
		margin-left: 0.5rem;
		color: oklch(0.72 0.15 70);
	}

	.savebar-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.toggle-copy {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.toggle-label {
		font-size: 0.8125rem;
		color: var(--deep-text);
	}

	.toggle-hint {
		font-size: 0.6875rem;
		line-height: 1.5;
		color: var(--content-meta);
	}

	.notice {
		margin: 0;
		font-size: 0.8125rem;
		color: oklch(0.7 0.15 145);
	}

	.state {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--content-meta);
	}

	.state.error {
		color: var(--destructive, #d33);
	}

	.table {
		display: flex;
		flex-direction: column;
	}

	/* 列宽与表头共用一套，靠 grid 保证逐列对齐 */
	.table-head,
	.table-row {
		display: grid;
		grid-template-columns:
			minmax(10rem, 1.6fr) minmax(9rem, 1.2fr) minmax(5rem, 0.8fr)
			3.5rem 4rem 8.5rem;
		gap: 1rem;
		align-items: center;
	}

	.table-head {
		padding: 0 0.75rem 0.625rem;
		border-bottom: 1px solid var(--line-divider);
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	.table-row {
		padding: 0.625rem 0.75rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.table-row:hover {
		background: var(--btn-plain-bg-hover);
	}

	.c-name {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		min-width: 0;
	}

	.avatar {
		width: 2rem;
		height: 2rem;
		border-radius: 0.5rem;
		object-fit: cover;
		flex-shrink: 0;
	}

	.avatar.placeholder {
		display: block;
		background: var(--btn-regular-bg);
	}

	.name-text {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
	}

	.name {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--deep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.desc {
		font-size: 0.6875rem;
		color: var(--content-meta);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.c-site a {
		font-size: 0.75rem;
		color: var(--primary);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: block;
	}

	.c-site a:hover {
		text-decoration: underline;
	}

	.c-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.tag {
		padding: 0.0625rem 0.375rem;
		border-radius: 0.25rem;
		background: var(--btn-regular-bg);
		font-size: 0.6875rem;
		color: var(--content-meta);
	}

	.muted {
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	.c-weight {
		font-size: 0.75rem;
		color: var(--content-meta);
		font-variant-numeric: tabular-nums;
	}

	.status {
		display: inline-block;
		padding: 0.0625rem 0.4375rem;
		border-radius: 0.25rem;
		font-size: 0.6875rem;
		background: var(--btn-regular-bg);
		color: var(--content-meta);
	}

	.status.on {
		background: color-mix(in srgb, oklch(0.72 0.15 145) 16%, transparent);
		color: oklch(0.7 0.15 145);
	}

	.c-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.125rem;
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

	/* 手机上 1.75rem = 24.5px（根字号 14px），低于 44px 触控下限；
	   直接放大按钮本体而不是伪元素外扩——行内按钮间距只有 0.125rem，
	   外扩会让相邻热区大面积重叠 */
	@media (max-width: 768px) {
		.icon-btn {
			width: 44px;
			height: 44px;
		}

		.c-actions {
			gap: 0.25rem;
		}
	}

	.icon-btn:hover:not(:disabled) {
		background: var(--btn-plain-bg-hover);
		color: var(--deep-text);
	}

	.icon-btn.danger:hover:not(:disabled) {
		color: var(--destructive, #d33);
	}

	.icon-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	/* ── 编辑弹窗：结构照 SecretManager 的 modal ── */
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgb(0 0 0 / 0.25);
		-webkit-backdrop-filter: blur(4px);
		backdrop-filter: blur(4px);
	}

	.modal-card {
		width: 90%;
		max-width: 32rem;
		max-height: 86vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem 1.5rem 0.75rem;
	}

	.modal-head h2 {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.modal-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0 1.5rem 1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	/* 只给字段标签上灰：不排除提示类的话，.field > span 的特异性会压过 .field-error */
	.field > span:not(.field-error):not(.field-hint) {
		font-size: 0.75rem;
		color: var(--content-meta);
	}

	.field input {
		width: 100%;
		padding: 0.4375rem 0.625rem;
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

	.field-row {
		display: flex;
		align-items: flex-end;
		gap: 1.5rem;
	}

	.field.compact {
		max-width: 7rem;
	}

	.toggle-field {
		flex-direction: row;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--content-meta);
		padding-bottom: 0.5rem;
	}

	.dialog-notice {
		margin: 0;
		padding: 0 1.5rem 0.75rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--content-meta);
		flex-shrink: 0;
	}

	/* 字段级提示：贴在对应输入框正下方，用户不用在弹窗里找。
	   用 .field > 前缀压过 .field > span 的灰色。 */
	.field > .field-error {
		font-size: 0.6875rem;
		line-height: 1.5;
		color: var(--destructive, #d33);
	}

	.field-hint {
		font-size: 0.6875rem;
		line-height: 1.5;
		color: var(--content-meta);
	}

	.field input.invalid {
		border-color: var(--destructive, #d33);
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0 1.5rem 1.5rem;
	}

	@media (width < 900px) {
		.table-head {
			display: none;
		}

		.table-row {
			grid-template-columns: 1fr auto;
			gap: 0.5rem;
		}

		.c-site,
		.c-tags,
		.c-weight,
		.c-status {
			grid-column: 1 / -1;
		}
	}
</style>
