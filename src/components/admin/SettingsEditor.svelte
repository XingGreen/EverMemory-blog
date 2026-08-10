<script lang="ts">
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { AdminConfigItem } from "@/utils/admin-settings";
import Icon from "@/components/common/Icon.svelte";
import ConfigEditor from "./ConfigEditor.svelte";

let {
	item,
	data,
	error,
	isLoading,
	source = "",
	onUpdate,
	onModeChange,
	onSourceChange,
}: {
	item: AdminConfigItem;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	data: Record<string, any> | string | null;
	error: string;
	isLoading: boolean;
	source: string;
	onUpdate?: (value: string | Record<string, any>) => void;
	onModeChange?: (mode: "form" | "source") => void;
	onSourceChange?: (source: string) => void;
} = $props();

// html 等原始文本配置的本地编辑副本（受控组件，随 data 刷新）
let htmlText = $state("");
$effect(() => {
	if (item.kind === "html" && typeof data === "string") {
		htmlText = data;
	}
});

// json 配置的可视表单 / 源码（真实文件）双模式
let mode: "form" | "source" = $state("form");
let sourceDraft = $state("");

// 进入源码模式：以磁盘文件原文生成草稿
function goSource() {
	mode = "source";
	sourceDraft = source;
	onModeChange?.("source");
	onSourceChange?.(sourceDraft);
}

// 切回可视化表单：直接切换（保存时后端会做源码语法校验并回滚）
function goFormMode() {
	mode = "form";
	onModeChange?.("form");
}

// 外部重新加载配置（source 变化）时，若正处于源码模式则同步刷新草稿
$effect(() => {
	if (mode === "source" && source) {
		sourceDraft = source;
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
				class="json-editor"
				value={htmlText}
				spellcheck="false"
				oninput={(e) => {
					htmlText = e.currentTarget.value;
					onUpdate?.(htmlText);
				}}
			></textarea>
		</div>
	{:else if data && typeof data === "object"}
		<!-- json 配置：可视化表单 / 源码（真实文件）模式切换 -->
		<div class="mode-tabs">
			<button
				type="button"
				class:active={mode === "form"}
				onclick={goFormMode}
			>
				<Icon icon="material-symbols:view-quilt-outline" class="tab-icon" />
				{i18n(I18nKey.configModeForm)}
			</button>
			<button
				type="button"
				class:active={mode === "source"}
				onclick={goSource}
			>
				<Icon icon="material-symbols:data-object" class="tab-icon" />
				{i18n(I18nKey.configModeSource)}
			</button>
		</div>
		{#if mode === "form"}
			<div class="editor-body">
				<ConfigEditor data={data} fileKey={item.key} />
			</div>
		{:else}
			<div class="editor-body">
				<textarea
					class="json-editor"
					value={sourceDraft}
					spellcheck="false"
					oninput={(e) => {
						sourceDraft = e.currentTarget.value;
						onSourceChange?.(sourceDraft);
					}}
				></textarea>
			</div>
		{/if}
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

	/* ── 模式切换 ── */
	.mode-tabs {
		display: inline-flex;
		gap: 0.25rem;
		padding: 0.25rem;
		background: var(--btn-regular-bg);
		border: 1px solid var(--line-divider);
		border-radius: 999px;
		align-self: flex-start;
	}

	.mode-tabs button {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.4rem 1rem;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--content-meta);
		font-size: 0.8125rem;
		white-space: nowrap;
		cursor: pointer;
		transition: background 0.2s, color 0.2s;
	}

	.mode-tabs button:hover {
		color: var(--deep-text);
	}

	.mode-tabs button.active {
		background: var(--primary);
		color: #fff;
		font-weight: 600;
	}

	.tab-icon {
		font-size: 1.125rem;
	}

	.editor-body {
		padding-top: 0.125rem;
	}

	.json-editor {
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
		tab-size: 2;
	}

	.json-editor:focus {
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