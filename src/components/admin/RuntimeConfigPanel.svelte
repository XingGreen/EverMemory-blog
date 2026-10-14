<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { getConfigItem } from "@/utils/admin-settings";
import { RUNTIME_CONFIG_KEYS } from "@/utils/runtime-config";

// 运行时配置：改这些项写入 KV 覆盖层，即时生效、不触发站点重建。
// 复用设置页的 SettingsEditor（表单/源码）与既有 /api/admin/configs、/api/admin/runtime-config 端点。
// 仅第二空间可达。
import SettingsEditor from "./SettingsEditor.svelte";

let {
	onNotify,
}: {
	onNotify: (
		message: string,
		type: "success" | "error",
		duration?: number,
	) => void;
} = $props();

const items = RUNTIME_CONFIG_KEYS.map((key) => getConfigItem(key)).filter(
	(item): item is NonNullable<typeof item> => Boolean(item),
);

let selected = $state(RUNTIME_CONFIG_KEYS[0] ?? "");
let data = $state<Record<string, unknown> | string | null>(null);
let source = $state("");
let remote = $state(false);
let mode = $state<"form" | "source">("form");
let loading = $state(false);
let saving = $state(false);
let error = $state("");
// 当前已有覆盖的 key 集合（来自公开只读端点 /api/runtime-config/）
let overrides = $state<Record<string, unknown>>({});

async function loadOverrides() {
	try {
		const res = await fetch("/api/runtime-config/");
		if (res.ok) overrides = (await res.json()) ?? {};
	} catch {
		// 覆盖层状态仅为提示，失败忽略
	}
}

async function load(key: string) {
	loading = true;
	error = "";
	try {
		const res = await fetch(`/api/admin/configs/${key}/`);
		const json = await res.json();
		if (!res.ok || !json.success) {
			error = json.message || "读取配置失败";
			return;
		}
		data = (json.data ?? null) as Record<string, unknown> | string | null;
		source = json.source ?? "";
		remote = !!json.remote;
		mode = remote && !data ? "source" : "form";
	} catch {
		error = "网络请求失败";
	} finally {
		loading = false;
	}
}

async function selectKey(key: string) {
	if (key === selected) return;
	selected = key;
	data = null;
	source = "";
	await load(key);
}

async function save() {
	if (mode === "source") {
		onNotify("运行时覆盖暂不支持源码模式，请使用可视化表单", "error", 6000);
		return;
	}
	if (!data || typeof data !== "object") {
		onNotify("没有可保存的数据", "error", 4000);
		return;
	}
	saving = true;
	try {
		const res = await fetch(`/api/admin/runtime-config/${selected}/`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ data }),
		});
		const json = (await res.json().catch(() => null)) as {
			success?: boolean;
			message?: string;
		} | null;
		if (res.ok && json?.success) {
			onNotify(json.message || "已保存并即时生效", "success", 4000);
			await loadOverrides();
		} else {
			onNotify(json?.message || "保存失败", "error", 8000);
		}
	} catch {
		onNotify("保存请求失败", "error", 8000);
	} finally {
		saving = false;
	}
}

async function clearOverride() {
	const label = getConfigItem(selected)?.label ?? selected;
	if (!confirm(`确认清除「${label}」的运行时覆盖，回落到源码默认值？`)) return;
	saving = true;
	try {
		const res = await fetch(`/api/admin/runtime-config/${selected}/`, {
			method: "DELETE",
		});
		const json = (await res.json().catch(() => null)) as {
			success?: boolean;
			message?: string;
		} | null;
		if (res.ok && json?.success) {
			onNotify("已清除运行时覆盖", "success", 4000);
			await load(selected);
			await loadOverrides();
		} else {
			onNotify(json?.message || "清除失败", "error", 8000);
		}
	} catch {
		onNotify("清除请求失败", "error", 8000);
	} finally {
		saving = false;
	}
}

onMount(async () => {
	await Promise.all([loadOverrides(), load(selected)]);
});
</script>

<div class="runtime-panel">
	<div class="runtime-tabs">
		{#each items as item (item.key)}
			<button
				type="button"
				class="runtime-tab"
				class:active={selected === item.key}
				onclick={() => selectKey(item.key)}
			>
				<Icon icon={item.iconOutline} class="tab-icon" />
				<span>{item.label}</span>
				{#if overrides[item.key] !== undefined}
					<span class="override-dot" title="当前有运行时覆盖">●</span>
				{/if}
			</button>
		{/each}
	</div>

	<div class="runtime-body">
		<div class="runtime-head">
			<div class="runtime-title">
				<Icon icon="material-symbols:bolt" />
				<span>保存后即时生效（写入 KV 覆盖层，无需重建站点）</span>
			</div>
			<div class="runtime-actions">
				<button
					class="sec-btn"
					type="button"
					onclick={() => load(selected)}
					disabled={loading || saving}
				>
					<Icon icon="material-symbols:refresh" />
					<span>重新加载</span>
				</button>
				<button
					class="sec-btn"
					type="button"
					onclick={clearOverride}
					disabled={loading || saving}
				>
					<Icon icon="material-symbols:restart-alt" />
					<span>清除覆盖</span>
				</button>
				<button
					class="sec-btn primary"
					type="button"
					onclick={save}
					disabled={loading || saving}
				>
					<Icon icon="material-symbols:save-outline" />
					<span>{saving ? "保存中…" : "保存"}</span>
				</button>
			</div>
		</div>

		{#if getConfigItem(selected)}
			<SettingsEditor
				item={getConfigItem(selected)!}
				{data}
				{source}
				{error}
				isLoading={loading}
				{remote}
				onUpdate={(v) => (data = v)}
				onModeChange={(m) => (mode = m)}
				onSourceChange={(s) => (source = s)}
			/>
		{/if}
	</div>
</div>

<style>
	.runtime-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.runtime-tabs {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.runtime-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		border: 1px solid var(--line-divider);
		background: var(--card-bg);
		color: var(--content-meta);
		font-size: 0.875rem;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease,
			border-color 0.15s ease;
	}

	.runtime-tab:hover {
		color: var(--deep-text);
	}

	.runtime-tab.active {
		background: var(--primary);
		border-color: var(--primary);
		color: var(--primary-foreground);
	}

	.override-dot {
		color: var(--success);
		font-size: 0.6rem;
		line-height: 1;
	}

	.runtime-tab.active .override-dot {
		color: var(--primary-foreground);
	}

	.tab-icon {
		font-size: 1.05rem;
	}

	.runtime-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.runtime-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.runtime-title {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: var(--content-meta);
	}

	.runtime-title :global(.inline-icon) {
		color: var(--primary);
	}

	.runtime-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.sec-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.875rem;
		border-radius: 0.65rem;
		border: 1px solid var(--line-divider);
		background: var(--card-bg);
		color: var(--deep-text);
		font-size: 0.875rem;
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease;
	}

	.sec-btn:hover:not(:disabled) {
		background: var(--btn-card-bg-hover);
	}

	.sec-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.sec-btn.primary {
		background: var(--primary);
		border-color: var(--primary);
		color: var(--primary-foreground);
	}

	.sec-btn.primary:hover:not(:disabled) {
		filter: brightness(1.05);
	}
</style>
