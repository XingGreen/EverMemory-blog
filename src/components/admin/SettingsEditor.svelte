<script lang="ts">
	import ConfigEditor from "./ConfigEditor.svelte";
	import type { AdminConfigItem } from "@/utils/admin-settings";
	import I18nKey from "@/i18n/i18nKey";
	import { i18n } from "@/i18n/translation";

	let {
		item,
		data,
		error,
		isLoading,
	}: {
		item: AdminConfigItem;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		data: Record<string, any> | null;
		error: string;
		isLoading: boolean;
	} = $props();
</script>

<div class="card-base settings-editor">
	{#if isLoading}
		<div class="editor-status">{i18n(I18nKey.configLoading)}</div>
	{:else if error}
		<div class="editor-status error">{i18n(I18nKey.configLoadFailed)}: {error}</div>
	{:else if data}
		<div class="editor-body">
			<ConfigEditor data={data} />
		</div>
	{/if}

	<div class="editor-file">{i18n(I18nKey.configFile).replace("{file}", item.file).replace("{exportName}", item.exportName)}</div>
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
		padding-top: 0.125rem;
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