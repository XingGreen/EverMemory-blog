<script lang="ts">
import { onMount } from "svelte";
import SecretFields from "@/components/admin/secrets/SecretFields.svelte";
import type I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { SECRET_GROUPS, type SecretItemState } from "@/utils/admin-secrets";
import {
	bootstrapRows,
	buildEntries,
	isRowConfigured,
} from "@/utils/secret-draft";

/**
 * 首次引导页（/setup/）。
 *
 * 与 /admin/env/ 是两条独立入口：这里没有会话、没有侧栏，只做一件事——
 * 把「能登录」所必需的那几项填好，保存后送去登录页。字段渲染与写入判定
 * 都复用后台那一份（SecretFields / secret-draft），只是入口和职责分开了。
 *
 * 写入本身走 /api/admin/secrets/ 的引导分支：本机 + 缺必填 + 非生产才放行，
 * 且服务端只收 BOOTSTRAP_KEYS。页面不做鉴权判断，服务端是唯一判据。
 */
let items = $state<SecretItemState[]>([]);
let loading = $state(true);
let saving = $state(false);
let loadError = $state("");
let notice = $state("");

let drafts = $state<Record<string, string>>({});
let draftsOrigin = $state<Record<string, string>>({});
let replacing = $state<Record<string, boolean>>({});
let addressRaw = $state("");
let addressError = $state("");

const itemByKey = $derived(new Map(items.map((item) => [item.key, item])));
/** 引导期要显示的行，判定与后台共享 */
const rows = $derived(bootstrapRows(items));
const groups = $derived(
	SECRET_GROUPS.filter((group) =>
		rows.some((row) => row.group === group.id),
	).map((group) => ({
		...group,
		rows: rows.filter((row) => row.group === group.id),
	})),
);

/** 必填项是否齐了——齐了才出现「去登录」，没齐只能保存 */
const ready = $derived(
	(() => {
		const required = items.filter((item) => item.required && !item.managed);
		return required.length > 0 && required.every((item) => item.configured);
	})(),
);

function addressOf(): string {
	const owner = (drafts.GITHUB_OWNER ?? "").trim();
	const repo = (drafts.GITHUB_REPO ?? "").trim();
	const branch = (drafts.GITHUB_BRANCH ?? "").trim();
	if (!owner && !repo && !branch) return "";
	return `${owner}/${repo}${branch ? `@${branch}` : ""}`;
}

function syncAddress() {
	addressRaw = addressOf();
	addressError = "";
}

function setAddress(raw: string) {
	addressRaw = raw;
	const trimmed = raw.trim();
	if (!trimmed) {
		addressError = "";
		drafts.GITHUB_OWNER = "";
		drafts.GITHUB_REPO = "";
		drafts.GITHUB_BRANCH = "";
		return;
	}
	const m = trimmed.match(/^([^/\s]+)\/([^@\s]+)(?:@(\S+))?$/);
	if (!m) {
		addressError = "格式：owner/repo@branch";
		return;
	}
	addressError = "";
	drafts.GITHUB_OWNER = m[1];
	drafts.GITHUB_REPO = m[2];
	drafts.GITHUB_BRANCH = m[3] ?? "";
}

async function load() {
	loading = true;
	loadError = "";
	try {
		// 引导分支：未登录时服务端只放行本机 + 缺必填 + 非生产
		const res = await fetch("/api/admin/secrets/", { cache: "no-store" });
		const data = await res.json();
		if (!data.success) {
			loadError = data.message || "读取配置失败";
			return;
		}
		items = data.items;
		drafts = {};
		draftsOrigin = {};
		for (const item of items) {
			const value = item.value ?? "";
			if (value) {
				drafts[item.key] = value;
				draftsOrigin[item.key] = value;
			}
		}
		syncAddress();
	} catch (err) {
		loadError = err instanceof Error ? err.message : "网络请求失败";
	} finally {
		loading = false;
	}
}

async function save() {
	if (addressError) {
		notice = "请先修正仓库地址格式";
		return;
	}
	const entries = buildEntries(items, drafts, draftsOrigin);
	if (entries.length === 0) {
		notice = "没有需要保存的修改";
		return;
	}
	saving = true;
	notice = "";
	try {
		const res = await fetch("/api/admin/secrets/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ entries }),
		});
		const data = await res.json();
		if (res.ok && data.success) {
			await load();
			// 服务端会重新判定：配齐后引导通道自动关闭，这里直接送去登录
			window.location.href = "/login/";
			return;
		}
		notice = data.message || "保存失败";
	} catch (err) {
		notice = `保存请求失败: ${err instanceof Error ? err.message : String(err)}`;
	} finally {
		saving = false;
	}
}

onMount(load);
</script>

<svelte:head>
	<title>首次配置</title>
</svelte:head>

<main class="setup-page">
	<div class="setup-card">
		<header class="setup-head">
			<h1>首次配置</h1>
			<p>填好下面几项并保存，就能登录控制面板。这里是本机的一次性初始化通道，配齐后自动关闭。</p>
		</header>

		{#if loadError}
			<div class="setup-error" role="alert">{loadError}</div>
		{:else if loading}
			<div class="setup-loading">加载中…</div>
		{:else}
			{#each groups as group (group.id)}
				<section class="setup-group">
					<h2>{i18n(group.labelKey as I18nKey)}</h2>
					<SecretFields
						rows={group.rows}
						itemOf={(key) => itemByKey.get(key)}
						{drafts}
						origin={draftsOrigin}
						writable={true}
						{replacing}
						{addressRaw}
						{addressError}
						onInput={(key, value) => (drafts[key] = value)}
						onAddress={setAddress}
						onView={(key) => {
							const value = drafts[key] ?? "";
							window.alert(value || "无内容");
						}}
						onEdit={(key) => (replacing[key] = true)}
						onRotate={() => {}}
						onCandidate={(id) => (drafts.GITHUB_INSTALLATION_ID = id)}
					/>
				</section>
			{/each}

			{#if notice}
				<div class="setup-error" role="alert">{notice}</div>
			{/if}

			<footer class="setup-foot">
				<span class="setup-hint">
					{#if ready}
						必填项已齐，保存后即可登录。
					{:else}
						保存后仍需填齐全部必填项才能登录。
					{/if}
				</span>
				<button
					type="button"
					class="ui-btn ui-btn-primary"
					disabled={saving}
					onclick={save}
				>
					{saving ? "保存中…" : "保存并去登录"}
				</button>
			</footer>
		{/if}
	</div>
</main>

<style>
	.setup-page {
		min-height: 100vh;
		display: flex;
		justify-content: center;
		padding: 3rem 1.5rem;
		box-sizing: border-box;
	}

	.setup-card {
		width: min(960px, 100%);
		height: fit-content;
		padding: 2rem;
		background: var(--card-bg, var(--page-bg));
		border: 1px solid var(--card-border, var(--input-border));
		border-radius: 16px;
	}

	.setup-head {
		padding-bottom: 1.25rem;
		border-bottom: 1px solid var(--input-border);
	}

	.setup-head h1 {
		margin: 0;
		font-size: var(--admin-fs-title, 1.5rem);
		font-weight: 600;
		color: var(--deep-text);
	}

	.setup-head p {
		margin: 0.5rem 0 0;
		font-size: var(--admin-fs-body, 0.875rem);
		line-height: 1.6;
		color: var(--content-meta);
		max-width: 46rem;
	}

	.setup-group {
		padding: 1.5rem 0;
		border-bottom: 1px solid var(--input-border);
	}

	.setup-group h2 {
		margin: 0;
		font-size: var(--admin-fs-body, 0.875rem);
		font-weight: 600;
		color: var(--deep-text);
	}

	.setup-loading {
		padding: 3rem 0;
		text-align: center;
		color: var(--content-meta);
	}

	.setup-error {
		margin: 1rem 0;
		padding: 0.75rem 1rem;
		border-radius: 10px;
		background: color-mix(in oklab, var(--destructive) 10%, transparent);
		color: var(--destructive);
		font-size: var(--admin-fs-body, 0.875rem);
	}

	.setup-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-top: 1.5rem;
	}

	.setup-hint {
		font-size: var(--admin-fs-meta, 0.75rem);
		color: var(--content-meta);
	}

	@media (max-width: 640px) {
		.setup-card {
			padding: 1.25rem;
		}
		.setup-foot {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
