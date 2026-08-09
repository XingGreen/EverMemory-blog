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
	onUpdate,
}: {
	item: AdminConfigItem;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	data: Record<string, any> | string | null;
	error: string;
	isLoading: boolean;
	onUpdate?: (value: string | Record<string, any>) => void;
} = $props();

// html 等原始文本配置的本地编辑副本（受控组件，随 data 刷新）
let htmlText = $state("");
$effect(() => {
	if (item.kind === "html" && typeof data === "string") {
		htmlText = data;
	}
});

// json 配置的可视表单 / 纯文本双模式
let mode: "form" | "json" = $state("form");
let jsonDraft = $state("");
let jsonError = $state("");

// 进入 JSON 模式：以当前配置对象生成草稿
function goJson() {
	mode = "json";
	jsonDraft = JSON.stringify(data, null, 2);
	jsonError = "";
}

// 切换回可视化表单：解析 JSON 草稿，校验通过后写回配置并切换，失败则留在 JSON 模式提示错误
function goFormMode() {
	if (mode === "json") {
		try {
			const parsed = JSON.parse(jsonDraft);
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				throw new Error("expect object");
			}
			onUpdate?.(parsed as Record<string, any>);
			jsonError = "";
		} catch (e) {
			jsonError = `${i18n(I18nKey.configJsonInvalid)}: ${
				e instanceof Error ? e.message : String(e)
			}`;
			return;
		}
	}
	mode = "form";
}

// 外部重新加载配置（data 引用变化）时，若正处于 json 模式则同步刷新草稿
$effect(() => {
	if (mode === "json" && typeof data === "object" && data !== null) {
		jsonDraft = JSON.stringify(data, null, 2);
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
		<!-- json 配置：可视化表单 / 纯文本 模式切换 -->
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
				class:active={mode === "json"}
				onclick={goJson}
			>
				<Icon icon="material-symbols:data-object" class="tab-icon" />
				{i18n(I18nKey.configModeJson)}
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
					value={jsonDraft}
					spellcheck="false"
					oninput={(e) => {
						jsonDraft = e.currentTarget.value;
						jsonError = "";
					}}
				></textarea>
				{#if jsonError}
					<div class="editor-error">{jsonError}</div>
				{/if}
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

	.editor-error {
		margin-top: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.35);
		border-radius: var(--radius-md);
		color: #ef4444;
		font-size: 0.8125rem;
		word-break: break-all;
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