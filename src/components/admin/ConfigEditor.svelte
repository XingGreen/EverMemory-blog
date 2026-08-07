<script lang="ts">
	// 通用 JSON 可视表单编辑器：
	// 递归渲染传入的配置对象（$state 引用），所有编辑直接写回该对象，
	// 支持对象分组、数组增删、布尔开关、数字/文本输入。
	type JsonValue =
		| string
		| number
		| boolean
		| null
		| JsonValue[]
		| { [k: string]: JsonValue };

	import I18nKey from "@/i18n/i18nKey";
	import { i18n } from "@/i18n/translation";
	import { configFieldLabel } from "@/config/configFieldLabels";

	let { data }: { data: Record<string, JsonValue> } = $props();

	function isObject(v: JsonValue | undefined): v is Record<string, JsonValue> {
		return !!v && typeof v === "object" && !Array.isArray(v);
	}

	function setValue(obj: Record<string, JsonValue>, key: string, value: JsonValue) {
		obj[key] = value;
	}

	function removeItem(arr: JsonValue[], idx: number) {
		arr.splice(idx, 1);
	}

	// 新增数组项：以首项为模板（无模板时用空对象）
	function addItem(arr: JsonValue[]) {
		const template = arr[0];
		if (isObject(template)) {
			const copy: Record<string, JsonValue> = {};
			for (const k of Object.keys(template)) copy[k] = template[k];
			arr.push(copy as JsonValue);
		} else if (Array.isArray(template)) {
			arr.push([...(template as JsonValue[])] as JsonValue);
		} else {
			arr.push({} as JsonValue);
		}
	}

	
</script>

{#snippet renderScalar(value: JsonValue, onUpdate: (v: JsonValue) => void)}
	{#if typeof value === "boolean"}
		<button
			class="toggle"
			class:on={value}
			type="button"
			onclick={() => onUpdate(!value)}
			aria-pressed={value}
		>
			<span class="toggle-dot"></span>
			{value ? i18n(I18nKey.configOn) : i18n(I18nKey.configOff)}
		</button>
	{:else if typeof value === "number"}
		<input
			class="field-input"
			type="number"
			value={value}
			oninput={(e) => {
				const v = e.currentTarget.value;
				onUpdate(v === "" ? 0 : Number(v));
			}}
		/>
	{:else if typeof value === "string"}
		{#if value.length > 60 || value.includes("\n")}
			<textarea
				class="field-input"
				rows={Math.min(6, Math.max(2, Math.ceil(value.length / 60)))}
				value={value}
				oninput={(e) => onUpdate(e.currentTarget.value)}
			></textarea>
		{:else}
			<input
				class="field-input"
				type="text"
				value={value}
				oninput={(e) => onUpdate(e.currentTarget.value)}
			/>
		{/if}
	{:else}
		<span class="null-value">{i18n(I18nKey.configNullValue)}</span>
	{/if}
{/snippet}

{#snippet renderArray(arr: JsonValue[], depth: number)}
	<div class="array-block">
		{#each arr as item, i (i)}
			<div class="array-item">
				{#if isObject(item)}
					{@render renderObject(item, depth + 1)}
				{:else if Array.isArray(item)}
					{@render renderArray(item as JsonValue[], depth + 1)}
				{:else}
					{@render renderScalar(item, (nv) => (arr[i] = nv))}
				{/if}
				<button
					class="icon-btn remove-btn"
					type="button"
					title={i18n(I18nKey.configDeleteItem)}
					onclick={() => removeItem(arr, i)}
				>✕</button>
			</div>
		{/each}
		<button class="add-btn" type="button" onclick={() => addItem(arr)}>{i18n(I18nKey.configAdd)}</button>
	</div>
{/snippet}

{#snippet renderObject(obj: Record<string, JsonValue>, depth: number)}
	<div class="obj-fields">
		{#each Object.keys(obj) as key (key)}
			{@const v = obj[key]}
			<div class="field-row">
				<div class="field-label" title={key}>{configFieldLabel(key)}</div>
				<div class="field-control">
					{#if isObject(v)}
						<div class="sub-card">
							<div class="sub-card-title">{configFieldLabel(key)}</div>
							{@render renderObject(v, depth + 1)}
						</div>
					{:else if Array.isArray(v)}
						<div class="array-card">
							<div class="sub-card-title">{configFieldLabel(key)}</div>
							{@render renderArray(v as JsonValue[], depth + 1)}
						</div>
					{:else}
						{@render renderScalar(v, (nv) => setValue(obj, key, nv))}
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/snippet}

{@render renderObject(data, 0)}

<style>
	.obj-fields {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.field-row {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.375rem 0;
	}

	.field-label {
		width: 8.5rem;
		flex-shrink: 0;
		font-size: 0.8125rem;
		color: var(--deep-text);
		font-weight: 500;
		padding-top: 0.5rem;
		/* 右对齐让标签文字紧贴输入框，避免短标签与输入框之间留白过大 */
		text-align: right;
		word-break: break-word;
	}

	.field-control {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.field-input {
		width: 100%;
		padding: 0.4375rem 0.625rem;
		font-size: 0.8125rem;
		font-family: inherit;
		color: var(--deep-text);
		background: var(--btn-regular-bg);
		border: 1px solid var(--input-border);
		border-radius: var(--radius-md);
		box-sizing: border-box;
		transition: border-color 0.2s;
	}

	.field-input:focus {
		outline: none;
		border-color: var(--primary);
	}

	textarea.field-input {
		resize: vertical;
		line-height: 1.5;
	}

	/* 布尔开关 */
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		width: fit-content;
		padding: 0.3125rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: inherit;
		border: 1px solid var(--line-divider);
		border-radius: 999px;
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		cursor: pointer;
		transition: all 0.2s;
	}

	.toggle-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--content-meta);
		transition: background 0.2s;
	}

	.toggle.on {
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		border-color: var(--primary);
		color: var(--primary);
	}

	.toggle.on .toggle-dot {
		background: var(--primary);
	}

	.null-value {
		font-size: 0.8125rem;
		color: var(--content-meta);
		padding-top: 0.5rem;
	}

	/* 嵌套对象 / 数组卡片 */
	.sub-card,
	.array-card {
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		padding: 0.625rem 0.75rem;
		width: 100%;
		box-sizing: border-box;
		background: color-mix(in srgb, var(--card-bg) 60%, transparent);
	}

	.sub-card-title {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--primary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 0.375rem;
	}

	/* 数组 */
	.array-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
	}

	.array-item {
		position: relative;
		border: 1px dashed var(--line-divider);
		border-radius: var(--radius-md);
		padding: 0.5rem 2.25rem 0.5rem 0.625rem;
		background: color-mix(in srgb, var(--card-bg) 40%, transparent);
	}

	.remove-btn {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		width: 1.5rem;
		height: 1.5rem;
		font-size: 0.75rem;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-sm, 0.375rem);
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		cursor: pointer;
		transition: all 0.2s;
		padding: 0;
	}

	.icon-btn:hover {
		color: #ef4444;
		border-color: #ef4444;
	}

	.add-btn {
		width: fit-content;
		padding: 0.3125rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: inherit;
		border: 1px dashed var(--primary);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--primary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.add-btn:hover {
		background: color-mix(in srgb, var(--primary) 10%, transparent);
	}

	@media (max-width: 768px) {
		.field-row {
			flex-direction: column;
			gap: 0.25rem;
		}

		.field-label {
			width: 100%;
			padding-top: 0.25rem;
			text-align: left;
		}

		.array-item {
			padding-right: 2rem;
		}
	}
</style>
