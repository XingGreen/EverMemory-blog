<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { SecretItemState, SecretRow } from "@/utils/admin-secrets";
import {
	isRowConfigured,
	isRowDirty,
	readPrivateKeyFile,
} from "@/utils/secret-draft";

/**
 * 字段区：一行一个设置项，桌面两列、窄屏一列。
 *
 * 引导页（/setup/）与后台环境变量页（/admin/env/）共用这一份，
 * 差异只在传进来的 rows、writable 与几个回调——同一套行，不写两遍。
 * 状态与保存都在父级，这里只负责画。
 */
let {
	rows,
	itemOf,
	drafts,
	origin,
	writable,
	replacing,
	addressRaw = "",
	addressError = "",
	flashKey = "",
	rotating = "",
	probeRepoDetail = "",
	probeAppDetail = "",
	probeInstallDetail = "",
	probeCandidates = [],
	onInput,
	onAddress,
	onView,
	onEdit,
	onRotate,
	onCandidate,
}: {
	rows: SecretRow[];
	itemOf: (key: string) => SecretItemState | undefined;
	drafts: Record<string, string>;
	origin: Record<string, string>;
	writable: boolean;
	replacing: Record<string, boolean>;
	addressRaw?: string;
	addressError?: string;
	flashKey?: string;
	rotating?: string;
	probeRepoDetail?: string;
	probeAppDetail?: string;
	probeInstallDetail?: string;
	probeCandidates?: { id: string; account: string }[];
	onInput: (key: string, value: string) => void;
	onAddress: (value: string) => void;
	onView: (key: string) => void;
	onEdit: (key: string) => void;
	onRotate: (item: SecretItemState) => void;
	onCandidate: (id: string) => void;
} = $props();

/** 密码框的显隐：只跟这一屏有关，没必要上抛 */
let showInput = $state<Record<string, boolean>>({});

/** 刚切到编辑态的多行框自动聚焦；未配置时挂载不抢焦点 */
function autofocus(node: HTMLTextAreaElement, active: boolean) {
	if (active) node.focus();
}

/** 私钥文件上传的本地错误（大小/读取），只影响本行显示 */
let uploadError = $state("");
</script>

<div class="prows">
	{#each rows as row (row.id)}
		{@const first = itemOf(row.keys[0])}
		{@const configured = isRowConfigured(row, itemOf)}
		{@const dirty = isRowDirty(row, itemOf, drafts, origin)}
		<div
			class="prow"
			class:dirty
			class:field-flash={flashKey === row.keys[0] || flashKey === row.keys[1]}
			data-secret-key={row.keys.join(" ")}
		>
			<div class="left">
				<div class="name-row">
					<div class="name">{row.label}</div>
					{#if dirty}
						<span class="flag">{i18n(I18nKey.secretsUnsaved)}</span>
					{/if}
				</div>
				<p class="how">{row.how}</p>
			</div>

			<div class="right">
				{#if row.shape === "address"}
					<input
						class="ui-input mono"
						class:invalid={addressError}
						type="text"
						value={addressRaw}
						placeholder={row.format}
						spellcheck="false"
						autocomplete="off"
						aria-label={row.label}
						disabled={!writable}
						oninput={(e) => onAddress(e.currentTarget.value)}
					/>
					{#if addressError}
						<p class="trace bad">{addressError}</p>
					{/if}
					{#if probeRepoDetail}
						<p class="trace">{probeRepoDetail}</p>
					{/if}
				{:else if row.shape === "content"}
					{#if configured && !replacing[row.keys[0]]}
						<div class="summary">
							<span class="word">{i18n(I18nKey.secretsConfigured)}</span>
							<button
								type="button"
								class="link"
								onclick={() => onView(row.keys[0])}>查看</button
							>
							<button
								type="button"
								class="link"
								onclick={() => onEdit(row.keys[0])}>编辑</button
							>
						</div>
					{:else}
						<!-- 上传私钥文件：本地读取后填入草稿，与粘贴等效（仍需保存落盘） -->
						<div class="upload-row">
							<label class="upload-btn">
								<Icon icon="material-symbols:upload-rounded" />
								上传私钥文件
								<input
									type="file"
									accept=".pem,.key,.txt"
									hidden
									disabled={!writable}
									onchange={async (e) => {
										const file = e.currentTarget.files?.[0];
										e.currentTarget.value = "";
										if (!file) return;
										uploadError = "";
										try {
											const content = await readPrivateKeyFile(file);
											onInput(row.keys[0], content);
										} catch (err) {
											uploadError =
												err instanceof Error ? err.message : "读取文件失败";
										}
									}}
								/>
							</label>
							<span class="upload-note">读取后仍需保存才写入 .env.local</span>
						</div>
						{#if uploadError}
							<p class="trace bad" role="alert">{uploadError}</p>
						{/if}
						<textarea
							use:autofocus={configured}
							class="ui-input mono keyarea"
							rows="4"
							placeholder="-----BEGIN PRIVATE KEY-----"
							spellcheck="false"
							value={drafts[row.keys[0]] ?? ""}
							disabled={!writable}
							aria-label={row.label}
							oninput={(e) => onInput(row.keys[0], e.currentTarget.value)}
						></textarea>
						{#if itemOf("GITHUB_PRIVATE_KEY_PATH")}
							<input
								class="ui-input mono"
								type="text"
								placeholder="或填私钥文件路径，例如 .key/blog.pem"
								spellcheck="false"
								value={drafts.GITHUB_PRIVATE_KEY_PATH ?? ""}
								disabled={!writable}
								aria-label="私钥文件路径"
								oninput={(e) =>
									onInput("GITHUB_PRIVATE_KEY_PATH", e.currentTarget.value)}
							/>
						{/if}
					{/if}
					{#if probeAppDetail}
						<p class="trace">{probeAppDetail}</p>
					{/if}
				{:else if row.shape === "managed"}
					<div class="summary">
						<span class="word">已自动生成</span>
						<button
							type="button"
							class="link"
							disabled={rotating === row.keys[0]}
							onclick={() => first && onRotate(first)}
							>{rotating === row.keys[0]
								? "轮换中…"
								: i18n(I18nKey.secretsRotate)}</button
						>
					</div>
				{:else}
					{@const it = first}
					{#if it}
						{#if it.sensitive}
							<div class="eye-wrap">
								<input
									class="ui-input mono"
									type={showInput[it.key] ? "text" : "password"}
									value={drafts[it.key] ?? ""}
									placeholder={it.example ?? ""}
									spellcheck="false"
									autocomplete="new-password"
									aria-label={it.label}
									disabled={!writable}
									oninput={(e) => onInput(it.key, e.currentTarget.value)}
								/>
								<button
									type="button"
									class="eye"
									aria-label={showInput[it.key] ? "隐藏" : "显示"}
									onclick={() => (showInput[it.key] = !showInput[it.key])}
								>
									<Icon
										icon={showInput[it.key]
											? "material-symbols:visibility-off-outline-rounded"
											: "material-symbols:visibility-outline-rounded"}
									/>
								</button>
							</div>
						{:else}
							<input
								class="ui-input mono"
								type="text"
								value={drafts[it.key] ?? ""}
								placeholder={it.example ?? ""}
								spellcheck="false"
								autocomplete="off"
								aria-label={it.label}
								disabled={!writable}
								oninput={(e) => onInput(it.key, e.currentTarget.value)}
							/>
						{/if}
						{#if probeInstallDetail && row.id === "install"}
							<p class="trace">{probeInstallDetail}</p>
							{#if probeCandidates.length}
								<p class="trace">
									{#each probeCandidates as candidate (candidate.id)}
										<button
											type="button"
											class="link"
											onclick={() => onCandidate(candidate.id)}
											>用 {candidate.id}（{candidate.account}）</button
										>
									{/each}
									<span class="dim">· 填入后先保存，再验证一次</span>
								</p>
							{/if}
						{/if}
					{/if}
				{/if}
			</div>
		</div>
	{/each}
</div>

<style>
	/* 字段区：桌面两列横排，标签在控件之上。
	   行不画分隔线——网格靠列间距分栏，横线会把两列切断。 */
	.prows {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1.25rem 1.5rem;
		margin-top: 1rem;
		padding-left: 0.5rem;
	}

	.prow {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	.prow .name-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}

	/* 未保存：左缘 2px 竖线 + 标签行末尾一个词，两条线索，不只靠颜色 */
	.prow.dirty {
		box-shadow: inset 2px 0 0 var(--primary);
		padding-left: 0.5rem;
		margin-left: -0.5rem;
	}

	.prow.dirty .name {
		color: var(--primary);
	}

	.prow .flag {
		margin-left: auto;
		flex: none;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--admin-fs-data, 0.6875rem);
		color: var(--primary);
	}

	.prow.field-flash {
		box-shadow: inset 3px 0 0 var(--primary);
		animation: field-breathe 0.8s ease-in-out 2;
	}

	@keyframes field-breathe {
		0%,
		100% {
			background: color-mix(in oklab, var(--primary) 6%, transparent);
			box-shadow: inset 3px 0 0
				color-mix(in oklab, var(--primary) 35%, transparent);
		}
		50% {
			background: color-mix(in oklab, var(--primary) 14%, transparent);
			box-shadow: inset 3px 0 0 var(--primary);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.prow.field-flash {
			animation: none;
			background: color-mix(in oklab, var(--primary) 12%, transparent);
		}
	}

	.prow .left {
		min-width: 0;
	}

	.prow .name {
		font-size: var(--admin-fs-body, 0.875rem);
		font-weight: 600;
		color: var(--deep-text);
	}

	.prow .how {
		margin: 0.1875rem 0 0;
		font-size: var(--admin-fs-meta, 0.75rem);
		line-height: 1.55;
		color: var(--content-meta);
		text-wrap: pretty;
	}

	.right {
		min-width: 0;
	}

	.right > * {
		width: 100%;
	}

	/* 机器值用等宽：字号继承 .ui-input，只换字族 */
	.ui-input.mono {
		font-family: var(--font-mono, ui-monospace, monospace);
	}

	.ui-input.invalid {
		border-color: var(--destructive);
	}

	/* 已配置 / 已生成：占住和输入框同一个槽位（同底、同描边、同高度） */
	.summary {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 2.25rem;
		padding: 0 0.75rem;
		background: var(--input-bg);
		border: 1px solid var(--input-border);
		border-radius: 10px;
	}

	.summary .word {
		margin-right: auto;
		font-size: var(--admin-fs-body, 0.875rem);
		color: var(--content-meta);
	}

	.summary .link {
		flex: none;
	}

	/* 私钥内容：多行等宽，行高放宽便于核对首尾标记 */
	.ui-input.keyarea {
		height: auto;
		min-height: 6rem;
		padding: 0.5rem 0.75rem;
		resize: vertical;
		line-height: 1.55;
	}

	/* 密码框：眼睛压在输入框右侧，不另起一列 */
	.eye-wrap {
		position: relative;
	}

	.eye-wrap .ui-input {
		padding-right: 2.25rem;
	}

	.eye {
		position: absolute;
		top: 50%;
		right: 0.5rem;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border: none;
		background: none;
		color: var(--content-meta);
		cursor: pointer;
	}

	.eye:hover {
		color: var(--deep-text);
	}

	.link {
		display: inline-flex;
		align-items: center;
		min-height: 24px;
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		font-size: var(--admin-fs-meta, 0.75rem);
		font-weight: 500;
		color: var(--primary);
		white-space: nowrap;
		cursor: pointer;
	}

	.link:hover:not(:disabled) {
		text-decoration: underline;
	}

	.link:disabled {
		color: var(--content-meta);
		cursor: default;
	}

	.link:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* 验证痕迹：机器记账的一行，等宽 */
	.trace {
		max-width: 40rem;
		margin: 0.375rem 0 0;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--admin-fs-data, 0.6875rem);
		line-height: 1.6;
		color: var(--content-meta);
	}

	.trace.bad {
		color: var(--destructive);
	}

	.dim {
		color: var(--content-meta);
	}

	/* 私钥上传：按钮压在一行，说明文字跟着，错误只落本行 */
	.upload-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.upload-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 28px;
		padding: 0 0.75rem;
		border: 1px solid var(--input-border);
		border-radius: 999px;
		font-size: var(--admin-fs-meta, 0.75rem);
		color: var(--content-meta);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.upload-btn:hover {
		color: var(--primary);
		border-color: var(--primary);
	}

	.upload-btn:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	.upload-note {
		font-size: var(--admin-fs-meta, 0.75rem);
		color: var(--content-meta);
	}

	/* 窄屏改纵向：一列，标签仍在控件之上 */
	@media (max-width: 860px) {
		.prows {
			grid-template-columns: minmax(0, 1fr);
			gap: 1rem;
		}
	}
</style>
