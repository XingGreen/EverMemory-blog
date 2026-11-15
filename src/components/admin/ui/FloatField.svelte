<script lang="ts">
/**
 * 浮动标签输入栏——从 VerifyScreen 的应急令牌输入原样抽出（样式与
 * focused/filled 状态逻辑未改动），登录页与首次引导页共用。
 *
 * 空态：标签待在框内；聚焦或有值：标签缩放悬浮到上边框。
 * filled 判定用 trim 后的值；autofill 的边角（-webkit-autofill）已处理。
 */
let {
	id,
	label,
	type = "text",
	value = $bindable(""),
	multiline = false,
	mono = false,
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
	autocomplete?: string;
	disabled?: boolean;
	oninput?: (value: string) => void;
	onkeydown?: (event: KeyboardEvent) => void;
} = $props();

let focused = $state(false);
</script>

<div class="field" class:focused class:filled={value.trim()}>
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
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		font-size: 0.9375rem;
		color: var(--content-meta);
		pointer-events: none;
		transition: all 0.18s ease;
	}

	/* 多行框的标签停在首行位置 */
	.field textarea ~ label {
		top: 1.1rem;
		transform: none;
	}

	.field.focused label,
	.field.filled label {
		top: 0;
		transform: translateY(-50%) scale(0.8);
		color: var(--primary);
		background: var(--card-bg);
		padding: 0 0.25rem;
	}

	.field input:-webkit-autofill ~ label,
	.field textarea:-webkit-autofill ~ label {
		top: 0;
		transform: translateY(-50%) scale(0.8);
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
