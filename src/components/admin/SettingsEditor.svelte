<script lang="ts">
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { AdminConfigItem } from "@/utils/admin-settings";
import ConfigEditor from "./ConfigEditor.svelte";

let {
	item,
	data,
	error,
	isLoading,
	onUpdate,
}: {
	item: AdminConfigItem;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	data: Record<string, any> | string | null;
	error: string;
	isLoading: boolean;
	onUpdate?: (value: string) => void;
} = $props();

// html 等原始文本配置的本地编辑副本（受控组件，随 data 刷新）
let htmlText = $state("");
$effect(() => {
	if (item.kind === "html" && typeof data === "string") {
		htmlText = data;
	}
});
</script>

<div class="card-base settings-editor">
	{#if isLoading}
		<div class="editor-status">{i18n(I18nKey.configLoading)}</div>
	{:else if error}
		<div class="editor-status error">{i18n(I18nKey.configLoadFailed)}: {error}</div>
	{:else if item.kind === "html" && typeof data === "string"}
		<div class="editor-body">
			<textarea
				class="html-editor"
				value={htmlText}
				spellcheck="false"
				oninput={(e) => {
					htmlText = e.currentTarget.value;
					onUpdate?.(htmlText);
				}}
			></textarea>
		</div>
	{:else if data && typeof data === "object"}
		<div class="editor-body">
			<ConfigEditor data={data} fileKey={item.key} />
		</div>
	{/if}

	<div class="editor-file">
		{#if item.kind === "html"}
			{i18n(I18nKey.configFile).replace("{file}", item.file)}
		{:else}
			{i18n(I18nKey.configFile)
				.replace("{file}", item.file)
				.replace("{exportName}", item.exportName)}
		{/if}
	</div>
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

	.html-editor {
		width: 100%;
		min-height: 18rem;
		padding: 0.75rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.8125rem;
		line-height: 1.6;
		color: var(--deep-text);
		background: var(--btn-regular-bg);
		border: 1px solid var(--input-border);
		border-radius: var(--radius-md);
		resize: vertical;
		box-sizing: border-box;
		transition: border-color 0.2s;
	}

	.html-editor:focus {
		outline: none;
		border-color: var(--primary);
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