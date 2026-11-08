<script lang="ts">
/**
 * 草稿与正文的冲突选择。
 *
 * 触发场景：编辑一篇文章时，发现本地/云端还留着一份未保存的草稿，且它的内容
 * 与当前正文不同。此时不能替用户决定——直接套用草稿会让人以为「正文被改了」，
 * 直接用正文又会悄悄丢掉草稿。所以把两份并排摆出来，让用户看着选。
 *
 * 三个出口（含取消）：
 *   onUseDraft  用草稿内容替换编辑区（正文文件不动）
 *   onUseBody   丢弃草稿，保持正文（会删除草稿，文案里明确说明）
 *   onCancel    暂不决定，草稿留着，下次进来还会再问一次
 *
 * 采用项目自己的弹窗而不是 window.confirm：原生弹窗拿不到主题，
 * 也没法把「哪台设备、多久之前、多少字」排成可读的对比。
 */
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

type Side = {
	title: string;
	excerpt: string;
	words: number;
	meta: string;
};

let {
	open,
	draft,
	body,
	onUseDraft,
	onUseBody,
	onCancel,
}: {
	open: boolean;
	/** 草稿一侧：meta 已拼好「19 分钟前 · Chrome · Windows」 */
	draft: Side & { fromCloud: boolean };
	/** 正文一侧：meta 已拼好「更新于 2026-11-07」 */
	body: Side;
	onUseDraft: () => void;
	onUseBody: () => void;
	onCancel: () => void;
} = $props();

let primaryBtn = $state<HTMLButtonElement | undefined>();

/** 打开时把焦点放到「使用草稿」上：它是默认选择，回车即可确认 */
$effect(() => {
	if (open) primaryBtn?.focus();
});

function handleKeydown(e: KeyboardEvent) {
	if (!open) return;
	if (e.key === "Escape") onCancel();
}

/** 空内容统一显示占位，避免卡片高度塌成一条线 */
function textOf(value: string): string {
	return value.trim() || i18n(I18nKey.postDraftConflictEmpty);
}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="modal-overlay"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) onCancel();
		}}
	>
		<div
			class="modal-content"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="draft-conflict-title"
			aria-describedby="draft-conflict-lead"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="modal-header">
				<span class="header-icon">
					<Icon icon="material-symbols:warning-rounded" />
				</span>
				<h2 id="draft-conflict-title">{i18n(I18nKey.postDraftConflictTitle)}</h2>
			</div>

			<div class="modal-body">
				<p id="draft-conflict-lead" class="lead">
					{i18n(I18nKey.postDraftConflictLead)}
				</p>

				<div class="compare">
					<!-- 草稿一侧：时间是「多久之前改的」，因为用户记的是「我刚刚写过」 -->
					<section class="side is-draft">
						<header class="side-head">
							<span class="side-label">
								{i18n(I18nKey.postDraftConflictDraft)}
							</span>
							{#if draft.fromCloud}
								<span class="side-tag">
									{i18n(I18nKey.postDraftConflictCloud)}
								</span>
							{/if}
						</header>
						<h3 class="side-title">{textOf(draft.title)}</h3>
						<p class="side-excerpt">{textOf(draft.excerpt)}</p>
						<p class="side-foot">
							<span>
								{i18n(I18nKey.postDraftConflictWords).replace(
									"{n}",
									String(draft.words),
								)}
							</span>
							<span class="dot">·</span>
							<span>{draft.meta}</span>
						</p>
					</section>

					<!-- 正文一侧：时间取发布日期，用户据此判断「草稿是不是改在正文之后」 -->
					<section class="side">
						<header class="side-head">
							<span class="side-label">
								{i18n(I18nKey.postDraftConflictBody)}
							</span>
						</header>
						<h3 class="side-title">{textOf(body.title)}</h3>
						<p class="side-excerpt">{textOf(body.excerpt)}</p>
						<p class="side-foot">
							<span>
								{i18n(I18nKey.postDraftConflictWords).replace(
									"{n}",
									String(body.words),
								)}
							</span>
							<span class="dot">·</span>
							<span>{body.meta}</span>
						</p>
					</section>
				</div>

				<p class="hint">{i18n(I18nKey.postDraftConflictHint)}</p>
			</div>

			<div class="modal-footer">
				<button class="ui-btn ui-btn-soft" type="button" onclick={onUseBody}>
					{i18n(I18nKey.postDraftConflictUseBody)}
				</button>
				<button
					bind:this={primaryBtn}
					class="ui-btn ui-btn-primary"
					type="button"
					onclick={onUseDraft}
				>
					{i18n(I18nKey.postDraftConflictUseDraft)}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		/* 与 ConfirmDialog 同层：都是压住内容的询问框 */
		z-index: 12000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgb(0 0 0 / 0.25);
		-webkit-backdrop-filter: blur(4px);
		backdrop-filter: blur(4px);
		animation: fadeIn 0.2s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.modal-content {
		width: 94%;
		/* 两张卡片并排，比单栏询问框宽一些 */
		max-width: 640px;
		background: var(--float-panel-bg);
		border-radius: var(--radius-large);
		box-shadow: var(--shadow-card-hover);
		overflow: hidden;
		animation: slideIn 0.3s ease-out;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.modal-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 1.25rem 1.5rem 0.75rem;
	}

	.header-icon {
		display: flex;
		color: var(--primary);
		font-size: 1.25rem;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--deep-text);
	}

	.modal-body {
		padding: 0 1.5rem 1rem;
	}

	.lead {
		margin: 0 0 0.875rem;
		font-size: 0.875rem;
		line-height: 1.7;
		color: var(--deep-text);
	}

	.compare {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	/* 窄屏（手机）下并排会挤成两列窄条，改为上下叠放 */
	@media (max-width: 560px) {
		.compare {
			grid-template-columns: 1fr;
		}
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.625rem;
		background: var(--btn-regular-bg);
		min-width: 0;
	}

	/* 草稿一侧用主色描边，让「这是待决定的那份」一眼可辨 */
	.side.is-draft {
		border-color: color-mix(in oklab, var(--primary) 55%, transparent);
		background: color-mix(in oklab, var(--primary) 8%, var(--btn-regular-bg));
	}

	.side-head {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 1.25rem;
	}

	.side-label {
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--content-meta);
	}

	.side.is-draft .side-label {
		color: var(--primary);
	}

	.side-tag {
		padding: 0.0625rem 0.375rem;
		border-radius: 999px;
		background: color-mix(in oklab, var(--primary) 16%, transparent);
		font-size: 0.6875rem;
		color: var(--primary);
	}

	.side-title {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--deep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.side-excerpt {
		margin: 0;
		/* 固定三行高度：两侧视觉齐平，不会因为一份内容多就长短不一 */
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: 0.8125rem;
		line-height: 1.6;
		color: var(--content-meta);
		min-height: 3.9em;
	}

	.side-foot {
		margin: auto 0 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: color-mix(in oklab, var(--deep-text) 55%, transparent);
	}

	.dot {
		opacity: 0.5;
	}

	.hint {
		margin: 0.75rem 0 0;
		font-size: 0.75rem;
		line-height: 1.6;
		color: var(--content-meta);
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0 1.5rem 1.5rem;
	}
</style>
