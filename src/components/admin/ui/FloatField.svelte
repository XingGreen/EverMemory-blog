<script lang="ts">
import Icon from "@/components/common/Icon.svelte";

/**
 * 浮动标签输入栏——从 VerifyScreen 的应急令牌输入抽出（样式与
 * focused/filled 状态逻辑未改动），登录页与首次引导页共用。
 *
 * 空态：标签待在框内；聚焦或有值：标签缩放悬浮到上边框。
 * 标签水平位置：默认贴左（与输入文字起点对齐）；只有传入 `icon`
 * （前置图标）时才向右避让图标宽度。
 * filled 判定用 trim 后的值；autofill 的边角（-webkit-autofill）已处理。
 */
let {
	id,
	label,
	type = "text",
	value = $bindable(""),
	multiline = false,
	mono = false,
	icon,
	autocomplete = "off",
	disabled = false,
	oninput,
	onkeydown,
}: {
	id: string;
	label: string;
	type?: string;
	value?: string;
	multiline?: boolean;
	/** 机器值（仓库地址、App ID 等）用等宽字族 */
	mono?: boolean;
	/** 前置图标：出现时标签与输入文字向右避让 */
	icon?: string;
	autocomplete?: string;
	disabled?: boolean;
	oninput?: (value: string) => void;
	onkeydown?: (event: KeyboardEvent) => void;
} = $props();

let focused = $state(false);
</script>

<div class="field" class:focused class:filled={value.trim()} class:has-icon={Boolean(icon)}>
	{#if icon}
		<Icon {icon} class="lead-icon" aria-hidden="true" />
	{/if}
	{#if multiline}
		<textarea
			{id}
			class:mono
			bind:value
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			oninput={(e) => oninput?.(e.currentTarget.value)}
			placeholder=" "
			{disabled}
			spellcheck="false"
		></textarea>
	{:else}
		<input
			{id}
			{type}
			class:mono
			bind:value
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			oninput={(e) => oninput?.(e.currentTarget.value)}
			onkeydown={(e) => onkeydown?.(e)}
			placeholder=" "
			{autocomplete}
			{disabled}
			spellcheck="false"
		/>
	{/if}
	<label for={id}>{label}</label>
</div>

<style>
	/* ── 浮动 label 输入框（与 VerifyScreen 原实现一致）── */
	.field {
		position: relative;
	}

	.field input,
	.field textarea {
		width: 100%;
		padding: 1rem 0.75rem 0.5rem;
		border: 1px solid var(--input-border);
		border-radius: var(--radius-md);
		font-size: 0.9375rem;
		transition: border-color 0.2s;
		background: var(--card-bg);
		color: var(--deep-text);
		font-family: inherit;
	}

	/* 前置图标：占住左侧，输入文字与标签一起向右避让 */
	.field.has-icon input,
	.field.has-icon textarea {
		padding-left: 2.6rem;
	}

	.lead-icon {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		font-size: 18px;
		color: var(--content-meta);
		pointer-events: none;
	}

	.field textarea {
		min-height: 96px;
		resize: vertical;
		line-height: 1.55;
	}

	.field input:focus,
	.field textarea:focus {
		outline: none;
		border-color: var(--primary);
		border-width: 2px;
		padding: calc(1rem - 1px) calc(0.75rem - 1px) calc(0.5rem - 1px);
	}

	.field input.mono,
	.field textarea.mono {
		font-family: var(--font-mono);
	}

	.field label {
		position: absolute;
		/* 无图标：与输入文字起点对齐、贴左 */
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		font-size: 0.9375rem;
		color: var(--content-meta);
		pointer-events: none;
		transition: all 0.18s ease;
	}

	/* 有前置图标：标签与文字一起向右避让 */
	.field.has-icon label {
		left: 2.6rem;
	}

	/* 多行框的标签停在首行位置 */
	.field textarea ~ label {
		top: 1.1rem;
		transform: none;
	}

	.field.focused label,
	.field.filled label {
		top: 0;
		/* 原点是修正关键：默认 center 会让越宽的标签左缘漂得越靠右，
		   以左缘为缩放原点后标签始终贴住起点 */
		transform: translateY(-50%) scale(0.8);
		transform-origin: left center;
		color: var(--primary);
		background: var(--card-bg);
		padding: 0 0.25rem;
	}

	.field input:-webkit-autofill ~ label,
	.field textarea:-webkit-autofill ~ label {
		top: 0;
		transform: translateY(-50%) scale(0.8);
		transform-origin: left center;
		color: var(--primary);
		background: var(--card-bg);
		padding: 0 0.25rem;
	}

	.field.focused input,
	.field.focused textarea {
		border-color: var(--primary);
	}

	.field input:-webkit-autofill,
	.field textarea:-webkit-autofill {
		-webkit-text-fill-color: var(--deep-text);
		-webkit-box-shadow: 0 0 0 1000px var(--card-bg) inset;
		transition: background-color 9999s ease-in-out 0s;
	}
</style>
