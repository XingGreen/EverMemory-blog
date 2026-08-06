<script lang="ts">
	import Icon from "@/components/common/Icon.svelte";
	import { CONFIG_ITEMS } from "@/utils/admin-settings";

	let { onNavigate }: { onNavigate: (key: string) => void } = $props();
</script>

<div class="settings-overview">
	<div class="card-base overview-intro">
		<h2>网站配置</h2>
		<p>选择下方配置项进行在线编辑，保存后写入对应配置文件并自动同步到 GitHub。</p>
	</div>
	<div class="config-grid">
		{#each CONFIG_ITEMS as item}
			<button class="card-base config-card" type="button" onclick={() => onNavigate(item.key)}>
				<div class="config-icon">
					<Icon icon={item.icon} class="text-xl" />
				</div>
				<div class="config-info">
					<h3>{item.label}</h3>
					<p>{item.description}</p>
				</div>
				<span class="config-file">{item.file}</span>
				<Icon icon="material-symbols:chevron-right" class="config-arrow" />
			</button>
		{/each}
	</div>
</div>

<style>
	.settings-overview {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.overview-intro {
		padding: 1.25rem 1.5rem;
	}

	.overview-intro h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--deep-text);
		margin-bottom: 0.375rem;
	}

	.overview-intro p {
		font-size: 0.875rem;
		color: var(--content-meta);
		line-height: 1.6;
	}

	.config-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 1rem;
	}

	.config-card {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: 0.875rem;
		padding: 1.25rem;
		text-align: left;
		font-family: inherit;
		cursor: pointer;
		border-radius: var(--radius-2xl);
		transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
	}

	.config-card:hover {
		transform: translateY(-3px);
		border-color: var(--primary);
		box-shadow: var(--shadow-card-hover);
	}

	.config-icon {
		width: 2.75rem;
		height: 2.75rem;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--primary) 12%, transparent);
		color: var(--primary);
		box-shadow: var(--shadow-button);
	}

	.config-info {
		flex: 1;
		min-width: 0;
		padding-bottom: 1.25rem;
	}

	.config-info h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--deep-text);
		margin-bottom: 0.25rem;
	}

	.config-info p {
		font-size: 0.8125rem;
		color: var(--content-meta);
		line-height: 1.5;
	}

	.config-file {
		position: absolute;
		right: 1.25rem;
		bottom: 0.875rem;
		font-size: 0.6875rem;
		color: var(--content-meta);
		opacity: 0.75;
		font-family: var(--font-mono, monospace);
		pointer-events: none;
	}

	.config-arrow {
		position: absolute;
		right: 1rem;
		top: 1.25rem;
		color: var(--content-meta);
		opacity: 0.6;
	}

	@media (max-width: 768px) {
		.config-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
