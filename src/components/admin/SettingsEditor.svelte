<script lang="ts">
	import Icon from "@/components/common/Icon.svelte";
	import ConfigEditor from "./ConfigEditor.svelte";
	import type { AdminConfigItem } from "@/utils/admin-settings";

	type ToastFn = (message: string, type: "success" | "error", duration?: number) => void;

	let {
		item,
		onToast,
	}: {
		item: AdminConfigItem;
		onToast: ToastFn;
	} = $props();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let data = $state<Record<string, any> | null>(null);
	let isLoading = $state(true);
	let loadError = $state("");
	let isSaving = $state(false);

	async function load() {
		isLoading = true;
		loadError = "";
		try {
			const res = await fetch(`/api/admin/configs/${item.key}/`);
			const json = await res.json();
			if (json.success) {
				data = json.data;
			} else {
				loadError = json.message || "读取配置失败";
			}
		} catch (err) {
			loadError = err instanceof Error ? err.message : "网络请求失败";
		} finally {
			isLoading = false;
		}
	}

	// item 变化（切换配置项）或首次挂载时加载对应配置：
	// 用 $effect 而非 onMount，避免 Svelte 复用组件实例时仍显示上一个配置的数据
	$effect(() => {
		void item.key;
		load();
	});

	async function save() {
		if (!data) return;
		isSaving = true;
		try {
			const res = await fetch(`/api/admin/configs/${item.key}/`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ data }),
			});
			const json = await res.json();
			if (json.success) {
				onToast(json.message || "保存成功", "success");
			} else {
				onToast(json.message || "保存失败", "error", 10000);
			}
		} catch (err) {
			onToast(`保存请求失败: ${err instanceof Error ? err.message : String(err)}`, "error", 10000);
		} finally {
			isSaving = false;
		}
	}
</script>

<div class="card-base settings-editor">
	<div class="editor-head">
		<div class="editor-title">
			<div class="title-icon">
				<Icon icon={item.icon} class="text-lg" />
			</div>
			<div>
				<h2>{item.label}</h2>
				<span class="editor-desc">{item.description}</span>
			</div>
		</div>
		<div class="editor-actions">
			<button class="action-btn" onclick={load} disabled={isLoading}>
				<Icon icon="material-symbols:refresh" class="text-sm" />
				<span>重新加载</span>
			</button>
			<button class="action-btn primary" onclick={save} disabled={isSaving || isLoading}>
				<Icon icon="material-symbols:save-outline" class="text-sm" />
				<span>{isSaving ? "保存中…" : "保存配置"}</span>
			</button>
		</div>
	</div>

	{#if isLoading}
		<div class="editor-status">加载中…</div>
	{:else if loadError}
		<div class="editor-status error">加载失败：{loadError}</div>
	{:else if data}
		<div class="editor-body">
			<ConfigEditor data={data} />
		</div>
	{/if}

	<div class="editor-file">配置文件：{item.file}（导出 {item.exportName}）</div>
</div>

<style>
	.settings-editor {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		/* card-base 未内置内边距，这里补充卡片内边距 */
		padding: 1.25rem 1.5rem;
		box-shadow: var(--shadow-card);
	}

	.editor-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.editor-title {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}

	.title-icon {
		width: 2.75rem;
		height: 2.75rem;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-xl);
		background: var(--primary);
		color: var(--primary-foreground);
		box-shadow: var(--shadow-button);
	}

	.editor-title h2 {
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--deep-text);
		line-height: 1.2;
	}

	.editor-desc {
		display: block;
		font-size: 0.8125rem;
		color: var(--content-meta);
		margin-top: 0.25rem;
	}

	.editor-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.875rem;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		background: var(--btn-regular-bg);
		color: var(--deep-text);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
	}

	.action-btn:hover {
		background: var(--btn-regular-bg-hover);
	}

	.action-btn.primary {
		background: var(--primary);
		border-color: var(--primary);
		color: var(--primary-foreground);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-button);
	}

	.action-btn.primary:hover:not(:disabled) {
		filter: brightness(1.05);
		transform: translateY(-1px);
	}

	.action-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.editor-status {
		padding: 2.5rem 1.5rem;
		text-align: center;
		color: var(--content-meta);
		font-size: 0.875rem;
	}

	.editor-status.error {
		color: #ef4444;
	}

	.editor-body {
		border-top: 1px solid var(--line-divider);
		padding-top: 1rem;
	}

	.editor-file {
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px dashed var(--line-divider);
		font-size: 0.75rem;
		color: var(--content-meta);
		font-family: var(--font-mono, monospace);
		word-break: break-all;
	}
</style>