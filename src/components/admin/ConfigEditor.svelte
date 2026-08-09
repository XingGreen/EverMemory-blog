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

import { configFieldLabel } from "@/config/configFieldLabels";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

let { data, fileKey = "" }: { data: Record<string, JsonValue>; fileKey?: string } =
	$props();

// 需要以下拉菜单切换的枚举字段（路径 = 从当前配置对象根开始的键路径）
// navbar 配置单独编辑时根即导航栏本身，故同时收录前缀（navbar.x）与裸键（x）两种路径
const SELECT_OPTIONS: Record<string, readonly string[]> = {
	// 站点配置（site）
	"themeColor.defaultMode": ["light", "dark", "system"],
	"postListLayout.defaultMode": ["list", "grid"],
	"postListLayout.mobileDefaultMode": ["list", "grid"],
	"post.rehypeCallouts.theme": ["github", "obsidian", "vitepress", "docusaurus"],
	"bangumi.mode": ["static", "dynamic"],
	// 站点配置里的音乐区块与音乐播放器配置（musicConfig）同名键取值不同，需分开
	"site.music.mode": ["static", "dynamic"],
	"imageOptimization.formats": ["avif", "webp", "both"],
	// 导航栏（navbar，含单独编辑时的裸键回退）
	"navbar.menuAlign": ["left", "center"],
	"navbar.mode": ["attached", "detached"],
	"navbar.logo.type": ["icon", "image", "url"],
	"menuAlign": ["left", "center"],
	"mode": ["attached", "detached"],
	"logo.type": ["icon", "image", "url"],
	// 背景壁纸（wallpaper）
	"wallpaper.mode": ["banner", "fullscreen", "overlay", "none"],
	// 音乐播放器（music）
	"music.mode": ["meting", "local"],
	"music.playMode": ["list", "one", "random"],
};

function isObject(v: JsonValue | undefined): v is Record<string, JsonValue> {
	return !!v && typeof v === "object" && !Array.isArray(v);
}

function setValue(
	obj: Record<string, JsonValue>,
	key: string,
	value: JsonValue,
) {
	obj[key] = value;
}

function removeItem(arr: JsonValue[], idx: number) {
	arr.splice(idx, 1);
}

// 新增数组项：以首项为模板（对象/数组用克隆，标量用同类型默认值）
function addItem(arr: JsonValue[]) {
	const template = arr[0];
	if (isObject(template)) {
		const copy: Record<string, JsonValue> = {};
		for (const k of Object.keys(template)) copy[k] = template[k];
		arr.push(copy as JsonValue);
	} else if (Array.isArray(template)) {
		arr.push([...(template as JsonValue[])] as JsonValue);
	} else if (typeof template === "string") {
		// 字符串列表（如关键词）：新增一个空输入框
		arr.push("" as JsonValue);
	} else if (typeof template === "number") {
		arr.push(0 as JsonValue);
	} else if (typeof template === "boolean") {
		arr.push(false as JsonValue);
	} else {
		arr.push(null as JsonValue);
	}
}
</script>

{#snippet renderScalar(value: JsonValue, onUpdate: (v: JsonValue) => void, options?: readonly string[])}
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
	{:else if typeof value === "string" && options && options.length > 0}
		<select
			class="field-input field-select"
			value={value}
			onchange={(e) => onUpdate(e.currentTarget.value)}
		>
			{#if !options.includes(value)}
				<option value={value} selected>{value}</option>
			{/if}
			{#each options as opt (opt)}
				<option value={opt}>{opt}</option>
			{/each}
		</select>
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

{#snippet renderArray(arr: JsonValue[], depth: number, path: string[])}
	<div class="array-block">
		{#each arr as item, i (i)}
			{#if isObject(item) || Array.isArray(item)}
				<div class="array-item">
					{#if isObject(item)}
						{@render renderObject(item, depth + 1, path)}
					{:else}
						{@render renderArray(item as JsonValue[], depth + 1, path)}
					{/if}
					<button
						class="icon-btn remove-btn"
						type="button"
						title={i18n(I18nKey.configDeleteItem)}
						onclick={() => removeItem(arr, i)}
					>✕</button>
				</div>
			{:else}
				<!-- 纯标量列表（如关键词）：直接 输入框 + 删除按钮，不加虚线框 -->
				<div class="scalar-item">
					{@render renderScalar(item, (nv) => (arr[i] = nv))}
					<button
						class="icon-btn remove-btn"
						type="button"
						title={i18n(I18nKey.configDeleteItem)}
						onclick={() => removeItem(arr, i)}
					>✕</button>
				</div>
			{/if}
		{/each}
		<button class="add-btn" type="button" onclick={() => addItem(arr)}>{i18n(I18nKey.configAdd)}</button>
	</div>
{/snippet}

{#snippet renderObject(obj: Record<string, JsonValue>, depth: number, path: string[])}
	<div class="obj-fields">
		{#each Object.keys(obj) as key (key)}
			{@const v = obj[key]}
			{@const keyPath = [...path, key]}
			{#if isObject(v)}
				<div class="group-card">
					<div class="group-title" title={key}>{configFieldLabel(key)}</div>
					<div class="group-body">{@render renderObject(v, depth + 1, keyPath)}</div>
				</div>
			{:else if Array.isArray(v)}
				<div class="group-card">
					<div class="group-title" title={key}>{configFieldLabel(key)}</div>
					<div class="group-body">{@render renderArray(v as JsonValue[], depth + 1, keyPath)}</div>
				</div>
			{:else}
				{@const options = (fileKey ? SELECT_OPTIONS[`${fileKey}.${keyPath.join(".")}`] : undefined) ?? SELECT_OPTIONS[keyPath.join(".")]}
				<div class="field-row">
					<div class="field-label" title={key}>{configFieldLabel(key)}</div>
					<div class="field-control">
						{@render renderScalar(v, (nv) => setValue(obj, key, nv), options)}
					</div>
				</div>
			{/if}
		{/each}
	</div>
{/snippet}

{@render renderObject(data, 0, [])}

<style>
	.obj-fields {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.field-row {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
		padding: 0.375rem 0;
	}

	.field-label {
		display: block;
		font-size: 0.8125rem;
		color: var(--deep-text);
		font-weight: 500;
		text-align: left;
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
		appearance: none;
		box-sizing: border-box;
		transition: border-color 0.2s;
	}

	/* 下拉选择框：增加右侧下拉箭头，避免无样式 */
	.field-select {
		background-image: linear-gradient(45deg, transparent 50%, var(--content-meta) 50%),
			linear-gradient(135deg, var(--content-meta) 50%, transparent 50%);
		background-position: calc(100% - 0.9rem) 50%, calc(100% - 0.65rem) 50%;
		background-repeat: no-repeat;
		background-size: 0.25rem 0.25rem;
		cursor: pointer;
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

	/* 嵌套分组：通栏卡片 + 组头，卡片内复用同一套两列网格 */
	.group-card {
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-md);
		padding: 0.625rem 0.875rem 0.75rem;
		width: 100%;
		box-sizing: border-box;
		background: color-mix(in srgb, var(--card-bg) 45%, transparent);
	}

	.group-title {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--primary);
		margin-bottom: 0.5rem;
		letter-spacing: 0.02em;
	}

	.group-body {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
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

	/* 纯标量列表项：不加虚线框，输入框 + 删除按钮一行排列 */
	.scalar-item {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		width: 100%;
	}

	.scalar-item .field-input {
		flex: 1;
	}

	.scalar-item .remove-btn {
		position: static;
		margin-top: 0.25rem;
		flex-shrink: 0;
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
</style>
