<script lang="ts">
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { markTourDone } from "@/utils/onboarding";

type TourAction = "secrets" | "posts" | "settings";

let {
	open,
	onClose,
	onNavigate,
}: {
	open: boolean;
	onClose: () => void;
	onNavigate: (page: TourAction) => void;
} = $props();

const steps: {
	title: string;
	desc: string;
	icon: string;
	action?: TourAction;
	actionLabel?: string;
}[] = [
	{
		title: i18n(I18nKey.adminTourWelcomeTitle),
		desc: i18n(I18nKey.adminTourWelcomeDesc),
		icon: "material-symbols:waving-hand-outline-rounded",
	},
	{
		title: i18n(I18nKey.adminTourSecretsTitle),
		desc: i18n(I18nKey.adminTourSecretsDesc),
		icon: "material-symbols:shield-lock",
		action: "secrets",
		actionLabel: i18n(I18nKey.adminTourGoSecrets),
	},
	{
		title: i18n(I18nKey.adminTourArticlesTitle),
		desc: i18n(I18nKey.adminTourArticlesDesc),
		icon: "material-symbols:article-outline",
		action: "posts",
		actionLabel: i18n(I18nKey.adminTourGoArticles),
	},
	{
		title: i18n(I18nKey.adminTourSettingsTitle),
		desc: i18n(I18nKey.adminTourSettingsDesc),
		icon: "material-symbols:settings-outline",
		action: "settings",
		actionLabel: i18n(I18nKey.adminTourGoSettings),
	},
];

let current = $state(0);
const total = steps.length;

function closeTour() {
	markTourDone();
	onClose();
}

function goAction(action: TourAction) {
	closeTour();
	onNavigate(action);
}
</script>

{#if open}
	<div
		class="tour-overlay"
		role="dialog"
		aria-modal="true"
		aria-label={i18n(I18nKey.adminTourTitle)}
		onclick={(e) => {
			if (e.target === e.currentTarget) closeTour();
		}}
	>
		<div class="tour-card card-base">
			<div class="tour-top">
				<span class="tour-badge">
					<Icon icon="material-symbols:tour-outline-rounded" size="sm" />
					{i18n(I18nKey.adminTourTitle)}
				</span>
				<button
					class="tour-close"
					type="button"
					title={i18n(I18nKey.adminTourSkip)}
					aria-label={i18n(I18nKey.adminTourSkip)}
					onclick={closeTour}
				>
					<Icon icon="material-symbols:close" size="sm" />
				</button>
			</div>

			<div class="tour-body">
				<div class="tour-icon">
					<Icon icon={steps[current].icon} class="tour-icon-svg" />
				</div>
				<h2>{steps[current].title}</h2>
				<p class="tour-desc">{steps[current].desc}</p>
			</div>

			<div class="tour-footer">
				<div class="tour-progress">
					{#each steps as _, index}
						<span class:active={index === current}></span>
					{/each}
				</div>
				<div class="tour-actions">
					{#if current > 0}
						<button class="tour-btn ghost" type="button" onclick={() => current--}>
							{i18n(I18nKey.adminTourPrev)}
						</button>
					{/if}
					{#if steps[current]?.action}
						<button
							class="tour-btn primary"
							type="button"
							onclick={() => goAction(steps[current].action!)}
						>
							{steps[current].actionLabel}
							<Icon icon="material-symbols:arrow-forward" size="sm" />
						</button>
					{:else if current < total - 1}
						<button class="tour-btn primary" type="button" onclick={() => current++}>
							{i18n(I18nKey.adminTourNext)}
							<Icon icon="material-symbols:arrow-forward" size="sm" />
						</button>
					{:else}
						<button class="tour-btn primary" type="button" onclick={closeTour}>
							<Icon icon="material-symbols:check" size="sm" />
							{i18n(I18nKey.adminTourDone)}
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.tour-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(2px);
		padding: 1rem;
	}

	.tour-card {
		width: 100%;
		max-width: 420px;
		padding: 1.5rem 1.5rem 1.25rem;
		box-shadow: var(--shadow-card);
		border-radius: var(--radius-large);
	}

	/* ── 顶部：徽标 + 关闭 ── */
	.tour-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.tour-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--primary);
	}

	.tour-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--content-meta);
		cursor: pointer;
		transition: all 0.2s;
	}

	.tour-close:hover {
		background: rgba(0, 0, 0, 0.05);
		color: var(--deep-text);
	}

	/* ── 主体 ── */
	.tour-body {
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.tour-icon {
		width: 4rem;
		height: 4rem;
		margin: 0 auto 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--primary);
		color: var(--primary-foreground);
		border-radius: 50%;
	}

	:global(.tour-icon-svg) {
		font-size: 2rem;
	}

	.tour-body h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--deep-text);
		margin-bottom: 0.5rem;
	}

	.tour-desc {
		font-size: 0.875rem;
		color: var(--content-meta);
		line-height: 1.7;
	}

	/* ── 底部：进度点 + 操作 ── */
	.tour-footer {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.tour-progress {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
	}

	.tour-progress span {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--line-divider);
		transition: all 0.2s;
	}

	.tour-progress span.active {
		width: 1.25rem;
		border-radius: 0.25rem;
		background: var(--primary);
	}

	.tour-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.625rem;
	}

	.tour-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5625rem 1rem;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.2s;
	}

	.tour-btn.primary {
		background: var(--primary);
		color: var(--primary-foreground);
	}

	.tour-btn.primary:hover {
		filter: brightness(1.05);
		transform: translateY(-1px);
	}

	.tour-btn.ghost {
		background: transparent;
		color: var(--content-meta);
	}

	.tour-btn.ghost:hover {
		color: var(--deep-text);
		background: rgba(0, 0, 0, 0.05);
	}
</style>